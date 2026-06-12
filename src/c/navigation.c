#include <pebble.h>
#include "navigation.h"

//#define DEBUG_PNG

#if defined(PBL_PLATFORM_GABBRO)
#define SCREEN_W 260
#define SCREEN_H 260
#elif defined(PBL_PLATFORM_EMERY)
#define SCREEN_W 200
#define SCREEN_H 228
#else
#define SCREEN_W 144
#define SCREEN_H 168
#endif

// Allow up to ~1.4x expansion in each dimension (2x area)
#define MAX_BITMAP_DATA_SIZE  (SCREEN_W * SCREEN_H * 2)

// Screen position for user icon (0.85 = slightly below center, to show more road ahead)
#define USER_Y_OFFSET 0.5f

#ifndef MAX
#define MAX(a, b) (((a) > (b)) ? (a) : (b))
#define MIN(a, b) (((a) < (b)) ? (a) : (b))
#endif

static unsigned int s_chunk_size;

static Layer* s_map_layer;
static GBitmap* s_bitmap;
static GBitmap* s_rot_bmp;
static uint8_t* s_bitmap_data;
static char s_time_text[6];
static int s_chunks_received = 0;
static int s_decompressed_offset = 0;
static int s_rle_state = 0;
static int s_rle_run_count = 0;
static uint8_t s_rle_run_val = 0;

static int s_bitmap_width = SCREEN_W;
static int s_bitmap_height = SCREEN_H;
static int s_bitmap_data_size = SCREEN_W * SCREEN_H;
static uint16_t s_palette_rgb565[64];
static int s_palette_received = 1;

// Expanded map state (from MAP_BUFFER_WIDTH/HEIGHT messages)
static int s_map_buffer_width = 0;
static int s_map_buffer_height = 0;

// User position & velocity in expanded map pixel coords
static int s_user_x, s_user_y;
static int16_t s_user_vx, s_user_vy;
static int s_current_display_x, s_current_display_y;
static uint64_t s_last_pos_update;
static int s_user_bearing_deg;

// Compass state (with EMA filter)
static int32_t s_filtered_heading;
static bool s_compass_initialized;
static int s_compass_heading_deg;

// Rotation mode flag (set by main.c when MESSAGE_KEY_ROTATION_MODE arrives)
static bool s_rotation_mode;



static void apply_palette(GBitmap* bmp)
{
#ifdef PBL_PLATFORM_FLINT
    GColor8* pal = malloc(4 * sizeof(GColor8));
    if (!pal) return;
    pal[0].argb = 0xC0;
    pal[1].argb = 0xD5;
    pal[2].argb = 0xEA;
    pal[3].argb = 0xFF;
    gbitmap_set_palette(bmp, pal, true);
#else
    GColor8* pal = malloc(64 * sizeof(GColor8));
    if (!pal) return;
    if (s_palette_received)
    {
        for (int i = 0; i < 64; i++)
        {
            uint16_t rgb = s_palette_rgb565[i];
            uint8_t r5 = (rgb >> 11) & 0x1f;
            uint8_t g6 = (rgb >> 5) & 0x3f;
            uint8_t b5 = rgb & 0x1f;
            uint8_t r2 = (r5 * 3 + 15) / 31;
            uint8_t g2 = (g6 * 3 + 31) / 63;
            uint8_t b2 = (b5 * 3 + 15) / 31;
            uint8_t avg = (r2 + g2 + b2) / 3;
            if (r2 > avg && r2 < 3) r2++;
            else if (r2 < avg && r2 > 0) r2--;
            if (g2 > avg && g2 < 3) g2++;
            else if (g2 < avg && g2 > 0) g2--;
            if (b2 > avg && b2 < 3) b2++;
            else if (b2 < avg && b2 > 0) b2--;
            pal[i].argb = 0xC0 | (r2 << 4) | (g2 << 2) | b2;
        }
    }
    else
    {
        for (int i = 0; i < 64; i++) pal[i].argb = 0xC0 | i;
    }
    gbitmap_set_palette(bmp, pal, true);
#endif
}

static void time_tick_handler(struct tm* tick_time, TimeUnits units_changed)
{
    strftime(s_time_text, sizeof(s_time_text), "%H:%M", tick_time);
    if (s_map_layer && !s_rotation_mode) layer_mark_dirty(s_map_layer);
}

static uint8_t get_pixel_index(GBitmap* bmp, int x, int y)
{
    uint8_t* data = gbitmap_get_data(bmp);
    int bpr = gbitmap_get_bytes_per_row(bmp);
    GBitmapFormat fmt = gbitmap_get_format(bmp);

    if (fmt == GBitmapFormat2BitPalette)
    {
        uint8_t byte = data[y * bpr + (x >> 2)];
        return (byte >> (6 - ((x & 3) << 1))) & 3;
    }
    return data[y * bpr + x];
}

static void compass_handler(CompassHeadingData heading)
{
    if (!s_compass_initialized)
    {
        s_compass_initialized = true;
        APP_LOG(APP_LOG_LEVEL_INFO, "Compass initialized");
    }

    int32_t prev_deg = s_compass_heading_deg;
    s_compass_heading_deg = TRIGANGLE_TO_DEG(TRIG_MAX_ANGLE - heading.magnetic_heading);

    if (s_compass_heading_deg != prev_deg)
    {
        APP_LOG(APP_LOG_LEVEL_INFO, "Compass: deg=%d", s_compass_heading_deg);
        layer_mark_dirty(s_map_layer);
    }
}

static uint64_t get_ms_since_boot(void)
{
    uint16_t ms = time_ms(NULL, NULL);
    return (uint64_t)time(NULL) * 1000 + ms;
}

static void extrapolate_user_pos(void)
{
    if (s_user_vx == 0 && s_user_vy == 0)
    {
        s_current_display_x = s_user_x;
        s_current_display_y = s_user_y;
        return;
    }

    uint64_t now_ms = get_ms_since_boot();
    uint64_t dt_ms = now_ms - s_last_pos_update;

    // Fade velocity to 0 if position update is stale (> 10 s)
    if (dt_ms > 10000)
    {
        s_user_vx = 0;
        s_user_vy = 0;
        s_current_display_x = s_user_x;
        s_current_display_y = s_user_y;
        return;
    }

    // velocity (fixed-point 8.7) * dt_ms / (128 * 1000)
    int dx = (int)((int64_t)s_user_vx * (int64_t)dt_ms / (128 * 1000));
    int dy = (int)((int64_t)s_user_vy * (int64_t)dt_ms / (128 * 1000));
    s_current_display_x = s_user_x + dx;
    s_current_display_y = s_user_y + dy;
    layer_mark_dirty(s_map_layer);
}

static void render_rotated_to_ctx(GContext* ctx, GBitmap* src_bmp,
                                   int src_w, int src_h,
                                   int center_x_src, int center_y_src,
                                   int dst_w, int dst_h,
                                   int center_x_dst, int center_y_dst,
                                   int heading_deg)
{
#define STRIPE_H 32

    GBitmapFormat fmt = gbitmap_get_format(src_bmp);

    if (!s_rot_bmp || gbitmap_get_format(s_rot_bmp) != fmt)
    {
        if (s_rot_bmp) gbitmap_destroy(s_rot_bmp);
        s_rot_bmp = gbitmap_create_blank(GSize(dst_w, STRIPE_H), fmt);
        if (s_rot_bmp) apply_palette(s_rot_bmp);
    }
    if (!s_rot_bmp) return;

    int32_t trig_angle = DEG_TO_TRIGANGLE(heading_deg);
    int32_t cos_val = cos_lookup(trig_angle);
    int32_t sin_val = sin_lookup(trig_angle);

    for (int dy = 0; dy < dst_h; dy += STRIPE_H)
    {
        int n_rows = MIN(STRIPE_H, dst_h - dy);
        uint8_t* stripe_data = gbitmap_get_data(s_rot_bmp);
        int stripe_bpr = gbitmap_get_bytes_per_row(s_rot_bmp);

        if (fmt == GBitmapFormat2BitPalette)
        {
            memset(stripe_data, 0, stripe_bpr * n_rows);
            for (int r = 0; r < n_rows; r++)
            {
                for (int dx = 0; dx < dst_w; dx++)
                {
                    int dx_rel = dx - center_x_dst;
                    int dy_rel = (dy + r) - center_y_dst;

                    int sx = center_x_src + ((dx_rel * cos_val - dy_rel * sin_val + 32768) >> 16);
                    int sy = center_y_src + ((dx_rel * sin_val + dy_rel * cos_val + 32768) >> 16);

                    uint8_t p = (sx >= 0 && sx < src_w && sy >= 0 && sy < src_h)
                              ? (get_pixel_index(src_bmp, sx, sy) & 3) : 0;
                    int bi = r * stripe_bpr + (dx >> 2);
                    int sh = (3 - (dx & 3)) << 1;
                    stripe_data[bi] = (stripe_data[bi] & ~(3 << sh)) | (p << sh);
                }
            }
        }
        else
        {
            for (int r = 0; r < n_rows; r++)
            {
                for (int dx = 0; dx < dst_w; dx++)
                {
                    int dx_rel = dx - center_x_dst;
                    int dy_rel = (dy + r) - center_y_dst;

                    int sx = center_x_src + ((dx_rel * cos_val - dy_rel * sin_val + 32768) >> 16);
                    int sy = center_y_src + ((dx_rel * sin_val + dy_rel * cos_val + 32768) >> 16);

                    stripe_data[r * stripe_bpr + dx] = (sx >= 0 && sx < src_w && sy >= 0 && sy < src_h)
                                                      ? get_pixel_index(src_bmp, sx, sy) : 0;
                }
            }
        }

        graphics_draw_bitmap_in_rect(ctx, s_rot_bmp, GRect(0, dy, dst_w, STRIPE_H));
    }

#undef STRIPE_H
}

static void draw_user_icon(GContext* ctx, GRect bounds, int heading_deg)
{
    int cx = bounds.size.w / 2;
    int cy = (int)(bounds.size.h * USER_Y_OFFSET);
    int arrow_len = 14;

    int32_t trig_angle = DEG_TO_TRIGANGLE(heading_deg);
    int32_t sin_h = sin_lookup(trig_angle);
    int32_t cos_h = cos_lookup(trig_angle);

    // Tip: forward in heading direction
    int tip_x = cx + (int)((int64_t)sin_h * arrow_len / TRIG_MAX_RATIO);
    int tip_y = cy - (int)((int64_t)cos_h * arrow_len / TRIG_MAX_RATIO);

    // Base left: heading + 150 degrees
    int32_t trig_angle_l = DEG_TO_TRIGANGLE((heading_deg + 150) % 360);
    int32_t sin_l = sin_lookup(trig_angle_l);
    int32_t cos_l = cos_lookup(trig_angle_l);
    int bx1 = cx + (int)((int64_t)sin_l * arrow_len / TRIG_MAX_RATIO);
    int by1 = cy - (int)((int64_t)cos_l * arrow_len / TRIG_MAX_RATIO);

    // Base right: heading - 150 degrees
    int32_t trig_angle_r = DEG_TO_TRIGANGLE((heading_deg - 150 + 360) % 360);
    int32_t sin_r = sin_lookup(trig_angle_r);
    int32_t cos_r = cos_lookup(trig_angle_r);
    int bx2 = cx + (int)((int64_t)sin_r * arrow_len / TRIG_MAX_RATIO);
    int by2 = cy - (int)((int64_t)cos_r * arrow_len / TRIG_MAX_RATIO);

    GPathInfo arrow = {
        .num_points = 3,
        .points = (GPoint[]) { {tip_x, tip_y}, {bx1, by1}, {bx2, by2} },
    };
    GPath* path = gpath_create(&arrow);
    if (path)
    {
        graphics_context_set_fill_color(ctx, GColorCyan);
        gpath_draw_filled(ctx, path);
        gpath_destroy(path);
    }
}

static void map_update_proc(Layer* layer, GContext* ctx)
{
    GRect bounds = layer_get_bounds(layer);
    int screen_w = bounds.size.w;
    int screen_h = bounds.size.h;

    if (s_bitmap)
    {
        extrapolate_user_pos();

        if (s_rotation_mode)
        {
            int center_x = screen_w / 2;
            int center_y = (int)(screen_h * USER_Y_OFFSET);
            int heading = s_compass_initialized ? s_compass_heading_deg : s_user_bearing_deg;

            render_rotated_to_ctx(ctx, s_bitmap, s_bitmap_width, s_bitmap_height,
                                  s_current_display_x, s_current_display_y,
                                  screen_w, screen_h,
                                  center_x, center_y,
                                  heading);

            // Draw user icon in rotated mode (always facing north/up)
            draw_user_icon(ctx, bounds, 0);
        }
        else
        {
            // Non-rotated: blit viewport centred on user position
            int view_x = s_current_display_x - screen_w / 2;
            int view_y = s_current_display_y - (int)(screen_h * USER_Y_OFFSET);
            view_x = MAX(0, MIN(view_x, s_bitmap_width - screen_w));
            view_y = MAX(0, MIN(view_y, s_bitmap_height - screen_h));

            GBitmap* sub = gbitmap_create_as_sub_bitmap(s_bitmap,
                GRect(view_x, view_y, screen_w, screen_h));
            if (sub)
            {
                graphics_draw_bitmap_in_rect(ctx, sub, bounds);
                gbitmap_destroy(sub);
            }

            // Draw user icon in non-rotated mode (use GPS bearing)
            int heading = (s_user_bearing_deg != 0) ? s_user_bearing_deg : 0;
            draw_user_icon(ctx, bounds, heading);
        }
    }

    int icon_size = 22;

#ifdef PBL_PLATFORM_GABBRO
#define MARGINE 4
#define ROUND_FIX 35
    graphics_context_set_fill_color(ctx, GColorBulgarianRose);
    graphics_fill_rect(ctx, GRect(ROUND_FIX + MARGINE, ROUND_FIX + MARGINE, 44, 20), icon_size / 2, GCornersAll);
    graphics_context_set_text_color(ctx, GColorWhite);
    graphics_draw_text(ctx, s_time_text, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), GRect(ROUND_FIX + MARGINE, ROUND_FIX - 2 + MARGINE, 44, 20), GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

    GRect plus_rect = GRect(bounds.size.w - icon_size - ROUND_FIX - MARGINE + 24, ROUND_FIX + MARGINE + 30, icon_size, icon_size);
    graphics_context_set_fill_color(ctx, GColorBulgarianRose);
    graphics_fill_rect(ctx, plus_rect, icon_size / 2, GCornersAll);
    graphics_context_set_text_color(ctx, GColorWhite);
    graphics_draw_text(ctx, "+", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), GRect(plus_rect.origin.x, plus_rect.origin.y - 2, plus_rect.size.w, plus_rect.size.h), GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

    GRect minus_rect = GRect(bounds.size.w - icon_size - ROUND_FIX - MARGINE + 24, bounds.size.h - ROUND_FIX - MARGINE - icon_size - 30, icon_size, icon_size);
    graphics_context_set_fill_color(ctx, GColorBulgarianRose);
    graphics_fill_rect(ctx, minus_rect, icon_size / 2, GCornersAll);
    graphics_context_set_text_color(ctx, GColorWhite);
    graphics_draw_text(ctx, "-", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), GRect(minus_rect.origin.x, minus_rect.origin.y - 2, minus_rect.size.w, minus_rect.size.h), GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

    GPoint gear_center = GPoint(bounds.size.w - icon_size / 2 - MARGINE, (bounds.size.h / 2) + 1);
    GRect gear_rect = GRect(gear_center.x - icon_size / 2 - MARGINE, gear_center.y - icon_size / 2, icon_size, icon_size);
    graphics_context_set_fill_color(ctx, GColorBulgarianRose);
    graphics_fill_rect(ctx, gear_rect, icon_size / 2, GCornersAll);
    graphics_context_set_text_color(ctx, GColorWhite);
    graphics_draw_text(ctx, "*", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), GRect(gear_rect.origin.x, gear_rect.origin.y, gear_rect.size.w, gear_rect.size.h), GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
#else
#define MARGINE 0
    graphics_context_set_fill_color(ctx, GColorBulgarianRose);
    graphics_fill_rect(ctx, GRect(MARGINE, MARGINE, 44, 20), icon_size / 2, GCornerBottomRight);
    graphics_context_set_text_color(ctx, GColorWhite);
    graphics_draw_text(ctx, s_time_text, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), GRect(MARGINE, MARGINE - 2, 44, 20), GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

    GRect plus_rect = GRect(bounds.size.w - icon_size - MARGINE, MARGINE, icon_size, icon_size);
    graphics_context_set_fill_color(ctx, GColorBulgarianRose);
    graphics_fill_rect(ctx, plus_rect, icon_size / 2, GCornerBottomLeft);
    graphics_context_set_text_color(ctx, GColorWhite);
    graphics_draw_text(ctx, "+", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), GRect(plus_rect.origin.x, plus_rect.origin.y - 2, plus_rect.size.w, plus_rect.size.h), GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

    GRect minus_rect = GRect(bounds.size.w - icon_size - MARGINE, bounds.size.h - 36 - icon_size - MARGINE, icon_size, icon_size);
    graphics_context_set_fill_color(ctx, GColorBulgarianRose);
    graphics_fill_rect(ctx, minus_rect, icon_size / 2, GCornerTopLeft);
    graphics_context_set_text_color(ctx, GColorWhite);
    graphics_draw_text(ctx, "-", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), GRect(minus_rect.origin.x, minus_rect.origin.y - 2, minus_rect.size.w, minus_rect.size.h), GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

    GPoint gear_center = GPoint(bounds.size.w - icon_size / 2 - MARGINE, (bounds.size.h - 36) / 2);
    GRect gear_rect = GRect(gear_center.x - icon_size / 2, gear_center.y - icon_size / 2, icon_size, icon_size);
    graphics_context_set_fill_color(ctx, GColorBulgarianRose);
    graphics_fill_rect(ctx, gear_rect, icon_size / 2, GCornersLeft);
    graphics_context_set_text_color(ctx, GColorWhite);
    graphics_draw_text(ctx, "*", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), GRect(gear_rect.origin.x, gear_rect.origin.y, gear_rect.size.w, gear_rect.size.h), GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
#endif
}

static void init_default_palette(void)
{
    for (int i = 0; i < 64; i++)
    {
        int r = (i >> 4) & 0x3;
        int g = (i >> 2) & 0x3;
        int b = i & 0x3;
        uint16_t r5 = (r * 31 + 1) / 3;
        uint16_t g6 = (g * 63 + 1) / 3;
        uint16_t b5 = (b * 31 + 1) / 3;
        s_palette_rgb565[i] = (r5 << 11) | (g6 << 5) | b5;
    }
}

static int rle_decode_chunk(const uint8_t* in, int in_len, uint8_t* out, int out_max)
{
    int ip = 0, op = 0;

    // Handle pending state from previous chunk before flushing any run,
    // so we don't flush with a stale s_rle_run_val.
    if (s_rle_state == 1 && ip < in_len)
    {
        s_rle_run_count = in[ip++] + 1;
        s_rle_state = 2;
    }
    if (s_rle_state == 2 && ip < in_len)
    {
        s_rle_run_val = in[ip++];
        int n = s_rle_run_count;
        if (op + n > out_max) n = out_max - op;
        memset(out + op, s_rle_run_val, n);
        op += n;
        s_rle_run_count -= n;
        if (s_rle_run_count > 0) return op;
        s_rle_state = 0;
    }

    // Only flush remaining run if state is resolved (not waiting for value byte)
    if (s_rle_state != 2)
    {
        while (s_rle_run_count > 0 && op < out_max)
        {
            out[op++] = s_rle_run_val;
            s_rle_run_count--;
        }
    }

    while (ip < in_len && op < out_max)
    {
        uint8_t b = in[ip++];
        if (b < 64)
        {
            out[op++] = b;
        }
        else if (b == 64)
        {
            if (ip >= in_len) { s_rle_state = 1; break; }
            int count = in[ip++] + 1;
            if (ip >= in_len) { s_rle_run_count = count; s_rle_state = 2; break; }
            s_rle_run_val = in[ip++];
            int n = count;
            if (op + n > out_max) n = out_max - op;
            memset(out + op, s_rle_run_val, n);
            op += n;
            s_rle_run_count = count - n;
            if (s_rle_run_count > 0) break;
        }
    }
    return op;
}

void navigation_init(void)
{
    init_default_palette();
    s_chunk_size = 2048;
    time_t now = time(NULL);
    time_tick_handler(localtime(&now), MINUTE_UNIT);
    tick_timer_service_subscribe(MINUTE_UNIT, time_tick_handler);

    // Initialise position to bitmap centre (will be overwritten by first position message)
    s_user_x = s_bitmap_width / 2;
    s_user_y = s_bitmap_height / 2;
    s_current_display_x = s_user_x;
    s_current_display_y = s_user_y;
    s_last_pos_update = get_ms_since_boot();
    s_user_vx = 0;
    s_user_vy = 0;
    s_user_bearing_deg = 0;

    // Subscribe to compass
    s_compass_initialized = false;
    compass_service_set_heading_filter(DEG_TO_TRIGANGLE(2));
    compass_service_subscribe(compass_handler);
    APP_LOG(APP_LOG_LEVEL_INFO, "Chunk size set to %d", s_chunk_size);
}

int navigation_get_chunk_size(void)
{
    return s_chunk_size;
}

Layer* navigation_create_map_layer(GRect bounds)
{
    s_bitmap_width = bounds.size.w;
    s_bitmap_height = bounds.size.h;
    s_bitmap_data_size = s_bitmap_width * s_bitmap_height;
    if (s_bitmap_data_size > MAX_BITMAP_DATA_SIZE) {
        s_bitmap_data_size = MAX_BITMAP_DATA_SIZE;
    }

#ifdef PBL_PLATFORM_FLINT
    s_bitmap = gbitmap_create_blank(GSize(s_bitmap_width, s_bitmap_height), GBitmapFormat2BitPalette);
    s_bitmap_data_size /= 4;
#else
    s_bitmap = gbitmap_create_blank(GSize(s_bitmap_width, s_bitmap_height), GBitmapFormat8Bit);
#endif

    if (!s_bitmap) {
        APP_LOG(APP_LOG_LEVEL_ERROR, "Failed to create GBitmap!");
    } else {
        s_bitmap_data = gbitmap_get_data(s_bitmap);
        if (!s_bitmap_data) {
            APP_LOG(APP_LOG_LEVEL_ERROR, "Failed to get GBitmap data");
        }
    }

    if (s_bitmap)
    {
        apply_palette(s_bitmap);
        if (s_bitmap_data) memset(s_bitmap_data, 63, s_bitmap_data_size);
    }

    s_map_layer = layer_create(bounds);
    layer_set_update_proc(s_map_layer, map_update_proc);
    return s_map_layer;
}

void navigation_destroy_map_layer(void)
{
    if (s_rot_bmp)
    {
        gbitmap_destroy(s_rot_bmp);
        s_rot_bmp = NULL;
    }
    if (s_bitmap)
    {
        gbitmap_destroy(s_bitmap);
        s_bitmap = NULL;
    }
    s_bitmap_data = NULL;
    if (s_map_layer)
    {
        layer_destroy(s_map_layer);
        s_map_layer = NULL;
    }
}

bool navigation_handle_message(DictionaryIterator* iter)
{
    // Handle expanded map dimensions (PebbleKitJS sends numbers as int32)
    Tuple* buf_w = dict_find(iter, MESSAGE_KEY_MAP_BUFFER_WIDTH);
    if (buf_w) {
        s_map_buffer_width = buf_w->value->int32;
    }
    Tuple* buf_h = dict_find(iter, MESSAGE_KEY_MAP_BUFFER_HEIGHT);
    if (buf_h) {
        s_map_buffer_height = buf_h->value->int32;
    }

    // Handle bitmap chunks
    Tuple* idx = dict_find(iter, MESSAGE_KEY_IMAGE_CHUNK_INDEX);
    Tuple* total = dict_find(iter, MESSAGE_KEY_IMAGE_CHUNKS_TOTAL);
    Tuple* data = dict_find(iter, MESSAGE_KEY_IMAGE_CHUNK_DATA);

    if (idx && total && data)
    {
        if (idx->value->uint32 == 0)
        {
            // Recreate bitmap if dimensions have changed
            if (s_map_buffer_width > 0 && s_map_buffer_height > 0 &&
                (s_map_buffer_width != s_bitmap_width || s_map_buffer_height != s_bitmap_height))
            {
                int new_w = s_map_buffer_width;
                int new_h = s_map_buffer_height;
                int new_data_size;
                GBitmapFormat fmt;

#ifdef PBL_PLATFORM_FLINT
                new_data_size = new_w * new_h / 4;
                fmt = GBitmapFormat2BitPalette;
#else
                new_data_size = new_w * new_h;
                fmt = GBitmapFormat8Bit;
#endif

                APP_LOG(APP_LOG_LEVEL_DEBUG, "Map buffer dims received: %d x %d (data_size=%d, max=%d)",
                         new_w, new_h, new_data_size, MAX_BITMAP_DATA_SIZE);
                if (new_data_size > MAX_BITMAP_DATA_SIZE) {
                    APP_LOG(APP_LOG_LEVEL_ERROR, "Expanded bitmap too large: %d x %d", new_w, new_h);
                    return true;
                }

                // Destroy old bitmap and rotation stripe buffer FIRST to free
                // contiguous memory before creating the expanded bitmap.
                if (s_rot_bmp) {
                    gbitmap_destroy(s_rot_bmp);
                    s_rot_bmp = NULL;
                }
                if (s_bitmap) {
                    gbitmap_destroy(s_bitmap);
                    s_bitmap = NULL;
                    s_bitmap_data = NULL;
                }

                APP_LOG(APP_LOG_LEVEL_DEBUG, "Creating expanded bitmap: %d x %d, fmt=%d, data_size=%d",
                         new_w, new_h, fmt, new_data_size);
                s_bitmap = gbitmap_create_blank(GSize(new_w, new_h), fmt);
                if (!s_bitmap) {
                    APP_LOG(APP_LOG_LEVEL_ERROR, "Failed to recreate expanded GBitmap! %dx%d fmt=%d size=%d",
                             new_w, new_h, fmt, new_data_size);
                    return true;
                }

                s_bitmap_width = new_w;
                s_bitmap_height = new_h;
                s_bitmap_data_size = new_data_size;
                s_bitmap_data = gbitmap_get_data(s_bitmap);
                if (!s_bitmap_data) {
                    APP_LOG(APP_LOG_LEVEL_ERROR, "Failed to get expanded GBitmap data");
                    return true;
                }

                apply_palette(s_bitmap);
                memset(s_bitmap_data, 63, s_bitmap_data_size);

                // Reset user position to centre of new bitmap
                s_user_x = s_bitmap_width / 2;
                s_user_y = s_bitmap_height / 2;
                s_current_display_x = s_user_x;
                s_current_display_y = s_user_y;
            }

            s_chunks_received = 0;
            s_decompressed_offset = 0;
            s_rle_state = 0;
            s_rle_run_count = 0;
        }

        if (!s_bitmap_data)
        {
            APP_LOG(APP_LOG_LEVEL_ERROR, "Bitmap data buffer not allocated");
            return true;
        }
#ifdef DEBUG_PNG
        int chunk_index = idx->value->uint32;
        APP_LOG(APP_LOG_LEVEL_INFO, "Chunk %d/%lu (%d bytes)", chunk_index, total->value->uint32, data->length);
#endif

        int decoded = rle_decode_chunk(data->value->data, data->length,
                                        &s_bitmap_data[s_decompressed_offset],
                                        s_bitmap_data_size - s_decompressed_offset);
        s_decompressed_offset += decoded;
        s_chunks_received++;

        if (s_chunks_received >= (int)total->value->uint32)
        {
            APP_LOG(APP_LOG_LEVEL_INFO, "All %d chunks received (decompressed %d bytes)",
                     s_chunks_received, s_decompressed_offset);
            apply_palette(s_bitmap);
            layer_mark_dirty(s_map_layer);
        }
        else
        {
            APP_LOG(APP_LOG_LEVEL_DEBUG, "Chunk %d/%lu received, offset=%d",
                     s_chunks_received, total->value->uint32, s_decompressed_offset);
        }
        return true;
    }

    // Handle user position and velocity (PebbleKitJS sends numbers as int32)
    Tuple* pos_x = dict_find(iter, MESSAGE_KEY_USER_POS_X);
    if (pos_x) {
        s_user_x = pos_x->value->int32;
        s_last_pos_update = get_ms_since_boot();
    }
    Tuple* pos_y = dict_find(iter, MESSAGE_KEY_USER_POS_Y);
    if (pos_y) {
        s_user_y = pos_y->value->int32;
    }
    Tuple* vx = dict_find(iter, MESSAGE_KEY_USER_VX);
    if (vx) {
        s_user_vx = (int16_t)vx->value->int32;
    }
    Tuple* vy = dict_find(iter, MESSAGE_KEY_USER_VY);
    if (vy) {
        s_user_vy = (int16_t)vy->value->int32;
    }
    Tuple* bearing = dict_find(iter, MESSAGE_KEY_USER_BEARING);
    if (bearing) {
        s_user_bearing_deg = (int)(bearing->value->int32 / 1000); // millidegrees → degrees
    }

    return false;
}

void navigation_set_rotation_mode(bool enabled)
{
    s_rotation_mode = enabled;
    if (s_map_layer) layer_mark_dirty(s_map_layer);
}
