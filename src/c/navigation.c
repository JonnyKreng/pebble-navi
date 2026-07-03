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

#define MAX_BITMAP_DATA_SIZE  SCREEN_W * SCREEN_H

static Layer* s_map_layer;
static GBitmap* s_bitmap;
static uint8_t* s_bitmap_data;
static char s_time_text[6];
static int s_chunks_received = 0;
static int s_decompressed_offset = 0;
static int s_hxl_state = 0;
static int s_hxl_run_count = 0;
static uint8_t s_hxl_run_val = 0;
static int s_hxl_xl_len_lo = 0;
static int s_hxl_pending_count = 0;

static int s_lzss_state = 0;
static int s_lzss_flags = 0;
static int s_lzss_bit = 0;
static int s_lzss_off = 0;
static int s_lzss_len = 0;
static int s_algo = 0;

static bool s_text_mode = false;
static char s_text_heading[64] = "";
static char s_text_subtitle[64] = "";
static char s_text_distance[64] = "";
static char s_text_arrival[64] = "";
static int s_text_bearing = -1;

static int s_bitmap_width = SCREEN_W;
static int s_bitmap_height = SCREEN_H;
static int s_bitmap_data_size = SCREEN_W * SCREEN_H;
static uint16_t s_palette_rgb565[64];
static int s_palette_received = 1;

static void apply_palette(GBitmap* bmp)
{
#ifdef PBL_BW
    GColor8* pal = malloc(4 * sizeof(GColor8));
    if (!pal) return;
    pal[0].argb = 0x0;
    pal[1].argb = 0x30;
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
    if (s_map_layer) layer_mark_dirty(s_map_layer);
}

int main_get_text_layers_height(void);

static void draw_compass(GContext* ctx, int cx, int cy, int bearing)
{
    if (bearing < 0) return;

    graphics_context_set_fill_color(ctx, GColorWhite);
    graphics_fill_circle(ctx, GPoint(cx, cy), 11);
    graphics_context_set_stroke_color(ctx, GColorBlack);
    graphics_draw_circle(ctx, GPoint(cx, cy), 11);

    int32_t angle = bearing * TRIG_MAX_ANGLE / 360;
    int32_t sin_a = sin_lookup(angle);
    int32_t cos_a = cos_lookup(angle);
    int tx = cx + (8 * sin_a / TRIG_MAX_RATIO);
    int ty = cy - (8 * cos_a / TRIG_MAX_RATIO);

    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_circle(ctx, GPoint(tx, ty), 3);
}

static void map_update_proc(Layer* layer, GContext* ctx)
{
    GRect bounds = layer_get_bounds(layer);

    if (s_text_mode)
    {
        graphics_context_set_fill_color(ctx, GColorWhite);
        graphics_fill_rect(ctx, bounds, 0, GCornerNone);
        graphics_context_set_text_color(ctx, GColorBlack);
        graphics_context_set_fill_color(ctx, GColorBlack);

        graphics_draw_text(ctx, s_time_text,
                           fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                           GRect(4, 2, 60, 28), GTextOverflowModeTrailingEllipsis,
                           GTextAlignmentLeft, NULL);

        if (s_text_heading[0] != '\0')
        {
            int center_y = bounds.size.h / 2 - 10;

            GRect heading_rect = GRect(4, center_y - 18, bounds.size.w - 8, 36);
#if SCREEN_W > 144
            graphics_draw_text(ctx, s_text_heading,
                               fonts_get_system_font(FONT_KEY_BITHAM_30_BLACK),
#else
            graphics_draw_text(ctx, s_text_heading,
                               fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
#endif
                               heading_rect, GTextOverflowModeWordWrap,
                               GTextAlignmentCenter, NULL);

            if (s_text_subtitle[0] != '\0')
            {
                GRect sub_rect = GRect(4, center_y + 26, bounds.size.w - 8, 26);
#if SCREEN_W > 144
                graphics_draw_text(ctx, s_text_subtitle,
                                   fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
#else
                graphics_draw_text(ctx, s_text_subtitle,
                                   fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
#endif
                                   sub_rect, GTextOverflowModeTrailingEllipsis,
                                   GTextAlignmentCenter, NULL);
            }
            if (s_text_distance[0] != '\0')
            {
                int dist_y = center_y + 54;
                if (s_text_subtitle[0] == '\0') dist_y = center_y + 30;
                GRect dist_rect = GRect(4, dist_y, bounds.size.w - 8, 22);
                graphics_draw_text(ctx, s_text_distance,
                                   fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                                   dist_rect, GTextOverflowModeTrailingEllipsis,
                                   GTextAlignmentCenter, NULL);
            }
        }

        if (s_text_arrival[0] != '\0')
        {
            GRect arr_rect = GRect(4, bounds.size.h - 28, bounds.size.w - 8, 26);
            graphics_draw_text(ctx, s_text_arrival,
                               fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                               arr_rect, GTextOverflowModeTrailingEllipsis,
                               GTextAlignmentCenter, NULL);
        }

        draw_compass(ctx, bounds.size.w - 20, 16, s_text_bearing);
        return;
    }

    if (s_bitmap)
    {
        graphics_draw_bitmap_in_rect(ctx, s_bitmap, layer_get_bounds(layer));
    }

    int icon_size = 22;

#ifdef PBL_PLATFORM_CHALK
#define MARGINE 0
#define ROUND_FIX 24
#define HEIGHT_CLAMP 29

    graphics_context_set_fill_color(ctx, GColorBulgarianRose);
    graphics_fill_rect(ctx, GRect(ROUND_FIX + MARGINE - 3, ROUND_FIX + MARGINE, 44, 20), icon_size / 2, GCornersAll);
    graphics_context_set_text_color(ctx, GColorWhite);
    graphics_draw_text(ctx, s_time_text, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), GRect(ROUND_FIX + MARGINE - 3, ROUND_FIX - 2 + MARGINE, 44, 20), GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

    GRect plus_rect = GRect(bounds.size.w - icon_size - ROUND_FIX - MARGINE + 24, ROUND_FIX + MARGINE + HEIGHT_CLAMP, icon_size, icon_size);
    graphics_context_set_fill_color(ctx, GColorBulgarianRose);
    graphics_fill_rect(ctx, plus_rect, icon_size / 2, GCornersAll);
    graphics_context_set_text_color(ctx, GColorWhite);
    graphics_draw_text(ctx, "+", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), GRect(plus_rect.origin.x, plus_rect.origin.y - 2, plus_rect.size.w, plus_rect.size.h), GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

    GRect minus_rect = GRect(bounds.size.w - icon_size - ROUND_FIX - MARGINE + 24, bounds.size.h - ROUND_FIX - MARGINE - icon_size - HEIGHT_CLAMP, icon_size, icon_size);
    graphics_context_set_fill_color(ctx, GColorBulgarianRose);
    graphics_fill_rect(ctx, minus_rect, icon_size / 2, GCornersAll);
    graphics_context_set_text_color(ctx, GColorWhite);
    graphics_draw_text(ctx, "-", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), GRect(minus_rect.origin.x, minus_rect.origin.y - 2, minus_rect.size.w, minus_rect.size.h), GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

    GPoint gear_center = GPoint(bounds.size.w - icon_size / 2 - MARGINE + 3, (bounds.size.h / 2) + 1);
    GRect gear_rect = GRect(gear_center.x - icon_size / 2 - MARGINE, gear_center.y - icon_size / 2, icon_size, icon_size);
    graphics_context_set_fill_color(ctx, GColorBulgarianRose);
    graphics_fill_rect(ctx, gear_rect, icon_size / 2, GCornersAll);
    graphics_context_set_text_color(ctx, GColorWhite);
    graphics_draw_text(ctx, "*", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), GRect(gear_rect.origin.x, gear_rect.origin.y, gear_rect.size.w, gear_rect.size.h), GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

#elif  defined(PBL_PLATFORM_GABBRO)
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

    int text_height = main_get_text_layers_height();
    GRect minus_rect = GRect(bounds.size.w - icon_size - MARGINE, bounds.size.h - text_height - icon_size - MARGINE, icon_size, icon_size);
    graphics_context_set_fill_color(ctx, GColorBulgarianRose);
    graphics_fill_rect(ctx, minus_rect, icon_size / 2, GCornerTopLeft);
    graphics_context_set_text_color(ctx, GColorWhite);
    graphics_draw_text(ctx, "-", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), GRect(minus_rect.origin.x, minus_rect.origin.y - 2, minus_rect.size.w, minus_rect.size.h), GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

    GPoint gear_center = GPoint(bounds.size.w - icon_size / 2 - MARGINE, (bounds.size.h - text_height) / 2);
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

static int hxl_decode_chunk(const uint8_t* in, int in_len, uint8_t* out, int out_max)
{
    int ip = 0, op = 0;

    while (s_hxl_run_count > 0 && op < out_max)
    {
        out[op++] = s_hxl_run_val;
        s_hxl_run_count--;
    }
    if (s_hxl_run_count > 0) return op;

    if (s_hxl_state == 1 && ip < in_len)
    {
        s_hxl_xl_len_lo = in[ip++];
        s_hxl_state = 2;
    }
    if (s_hxl_state == 2 && ip < in_len)
    {
        int hi = in[ip++];
        s_hxl_pending_count = s_hxl_xl_len_lo | (hi << 8);
        s_hxl_state = 3;
    }
    if (s_hxl_state == 3 && ip < in_len)
    {
        s_hxl_run_val = in[ip++];
        s_hxl_run_count = s_hxl_pending_count;
        s_hxl_pending_count = 0;
        s_hxl_state = 0;
    }

    if (s_hxl_run_count > 0)
    {
        int n = s_hxl_run_count;
        if (op + n > out_max) n = out_max - op;
        memset(out + op, s_hxl_run_val, n);
        op += n;
        s_hxl_run_count -= n;
        if (s_hxl_run_count > 0) return op;
    }

    while (ip < in_len && op < out_max)
    {
        uint8_t b = in[ip++];
        if (b < 0x80)
        {
            out[op++] = b;
        }
        else if (b == 0xFF)
        {
            if (ip >= in_len) { s_hxl_state = 1; break; }
            int lo = in[ip++];
            if (ip >= in_len) { s_hxl_xl_len_lo = lo; s_hxl_state = 2; break; }
            int hi = in[ip++];
            int count = lo | (hi << 8);
            if (ip >= in_len) { s_hxl_pending_count = count; s_hxl_state = 3; break; }
            s_hxl_run_val = in[ip++];
            int n = count;
            if (op + n > out_max) n = out_max - op;
            memset(out + op, s_hxl_run_val, n);
            op += n;
            s_hxl_run_count = count - n;
            if (s_hxl_run_count > 0) break;
        }
        else
        {
            int count = (b & 0x7F) + 1;
            if (ip >= in_len) { s_hxl_pending_count = count; s_hxl_state = 3; break; }
            s_hxl_run_val = in[ip++];
            int n = count;
            if (op + n > out_max) n = out_max - op;
            memset(out + op, s_hxl_run_val, n);
            op += n;
            s_hxl_run_count = count - n;
            if (s_hxl_run_count > 0) break;
        }
    }
    return op;
}

static int lzss_decode_chunk(const uint8_t* in, int in_len, uint8_t* out, int out_max)
{
    int ip = 0, op = 0;
    uint8_t* base = s_bitmap_data;

    if (s_lzss_state == 4) {
        int n = s_lzss_len;
        if (op + n > out_max) n = out_max - op;
        int abs_pos = (int)(out - base) + op;
        int src_abs = abs_pos - s_lzss_off;
        for (int k = 0; k < n; k++) {
            out[op++] = base[src_abs + k];
        }
        s_lzss_len -= n;
        if (s_lzss_len > 0) return op;
        s_lzss_bit++;
        if (s_lzss_bit >= 8) { s_lzss_state = 0; }
        else { s_lzss_state = 1; }
    }

    while (ip < in_len && op < out_max) {
        if (s_lzss_state == 0) {
            s_lzss_flags = in[ip++];
            s_lzss_bit = 0;
            s_lzss_state = 1;
        }

        if (s_lzss_state == 1) {
            if (s_lzss_flags & (1 << (7 - s_lzss_bit))) {
                s_lzss_state = 2;
            } else {
                s_lzss_state = 5;
            }
        }

        if (s_lzss_state == 5) {
            if (ip >= in_len) break;
            out[op++] = in[ip++];
            s_lzss_bit++;
            if (s_lzss_bit >= 8) { s_lzss_state = 0; }
            else { s_lzss_state = 1; }
            continue;
        }

        if (s_lzss_state == 2) {
            if (ip >= in_len) break;
            s_lzss_off = in[ip++];
            s_lzss_state = 3;
        }

        if (s_lzss_state == 3) {
            if (ip >= in_len) break;
            s_lzss_len = in[ip++];
            s_lzss_state = 4;
        }

        if (s_lzss_state == 4) {
            int n = s_lzss_len;
            if (op + n > out_max) n = out_max - op;
            int abs_pos = (int)(out - base) + op;
            int src_abs = abs_pos - s_lzss_off;
            for (int k = 0; k < n; k++) {
                out[op++] = base[src_abs + k];
            }
            s_lzss_len -= n;
            if (s_lzss_len > 0) break;
            s_lzss_bit++;
            if (s_lzss_bit >= 8) { s_lzss_state = 0; }
            else { s_lzss_state = 1; }
        }
    }

    return op;
}

void navigation_init(void)
{
    init_default_palette();
    time_t now = time(NULL);
    time_tick_handler(localtime(&now), MINUTE_UNIT);
    tick_timer_service_subscribe(MINUTE_UNIT, time_tick_handler);
}

Layer* navigation_create_map_layer(GRect bounds)
{
    s_bitmap_width = bounds.size.w;
    s_bitmap_height = bounds.size.h;
    s_bitmap_data_size = s_bitmap_width * s_bitmap_height;
    if (s_bitmap_data_size > MAX_BITMAP_DATA_SIZE) {
        s_bitmap_data_size = MAX_BITMAP_DATA_SIZE;
    }

#ifdef PBL_BW
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

    s_map_layer = layer_create(bounds);
    layer_set_update_proc(s_map_layer, map_update_proc);
    return s_map_layer;
}

void navigation_destroy_map_layer(void)
{
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

void navigation_set_text_mode(bool enabled)
{
    s_text_mode = enabled;
    if (s_map_layer) layer_mark_dirty(s_map_layer);
}

bool navigation_get_text_mode(void)
{
    return s_text_mode;
}

void navigation_set_arrival_text(const char* text)
{
    strncpy(s_text_arrival, text, sizeof(s_text_arrival) - 1);
    s_text_arrival[sizeof(s_text_arrival) - 1] = '\0';
    if (s_text_mode && s_map_layer) layer_mark_dirty(s_map_layer);
}

void navigation_set_text_info(const char* heading, const char* subtitle, const char* distance)
{
    strncpy(s_text_heading, heading, sizeof(s_text_heading) - 1);
    s_text_heading[sizeof(s_text_heading) - 1] = '\0';
    strncpy(s_text_subtitle, subtitle, sizeof(s_text_subtitle) - 1);
    s_text_subtitle[sizeof(s_text_subtitle) - 1] = '\0';
    strncpy(s_text_distance, distance, sizeof(s_text_distance) - 1);
    s_text_distance[sizeof(s_text_distance) - 1] = '\0';
    if (s_text_mode && s_map_layer) layer_mark_dirty(s_map_layer);
}

void navigation_set_text_bearing(int bearing)
{
    s_text_bearing = bearing;
    if (s_text_mode && s_map_layer) layer_mark_dirty(s_map_layer);
}

bool navigation_handle_message(DictionaryIterator* iter)
{
    Tuple* text_mode = dict_find(iter, MESSAGE_KEY_TEXT_MODE);
    if (text_mode)
    {
        s_text_mode = text_mode->value->int32 != 0;
        if (s_map_layer) layer_mark_dirty(s_map_layer);
    }

    Tuple* heading = dict_find(iter, MESSAGE_KEY_TEXT_MODE_HEADING);
    Tuple* subtitle = dict_find(iter, MESSAGE_KEY_TEXT_MODE_SUBTITLE);
    if (heading && subtitle)
    {
        strncpy(s_text_heading, heading->value->cstring, sizeof(s_text_heading) - 1);
        s_text_heading[sizeof(s_text_heading) - 1] = '\0';
        strncpy(s_text_subtitle, subtitle->value->cstring, sizeof(s_text_subtitle) - 1);
        s_text_subtitle[sizeof(s_text_subtitle) - 1] = '\0';
        if (s_text_mode && s_map_layer) layer_mark_dirty(s_map_layer);
    }
    Tuple* dist = dict_find(iter, MESSAGE_KEY_TEXT_MODE_DISTANCE);
    if (dist)
    {
        strncpy(s_text_distance, dist->value->cstring, sizeof(s_text_distance) - 1);
        s_text_distance[sizeof(s_text_distance) - 1] = '\0';
        if (s_text_mode && s_map_layer) layer_mark_dirty(s_map_layer);
    }

    Tuple* bearing_t = dict_find(iter, MESSAGE_KEY_TEXT_MODE_BEARING);
    if (bearing_t)
    {
        s_text_bearing = bearing_t->value->int32;
        if (s_text_mode && s_map_layer) layer_mark_dirty(s_map_layer);
    }

    Tuple* idx = dict_find(iter, MESSAGE_KEY_IMAGE_CHUNK_INDEX);
    Tuple* total = dict_find(iter, MESSAGE_KEY_IMAGE_CHUNKS_TOTAL);
    Tuple* data = dict_find(iter, MESSAGE_KEY_IMAGE_CHUNK_DATA);

    if (idx && total && data)
    {
        if (idx->value->uint32 == 0)
        {
            s_chunks_received = 0;
            s_decompressed_offset = 0;
            s_hxl_state = 0;
            s_hxl_run_count = 0;
            s_hxl_run_val = 0;
            s_hxl_xl_len_lo = 0;
            s_hxl_pending_count = 0;
            s_lzss_state = 0;
            s_algo = (data->length > 0) ? data->value->data[0] : 0;
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

        const uint8_t* chunk_data = data->value->data + (idx->value->uint32 == 0 ? 1 : 0);
        int chunk_len = data->length - (idx->value->uint32 == 0 ? 1 : 0);
        int decoded;
        if (s_algo == 0) {
            decoded = hxl_decode_chunk(chunk_data, chunk_len,
                                       &s_bitmap_data[s_decompressed_offset],
                                       s_bitmap_data_size - s_decompressed_offset);
        } else {
            decoded = lzss_decode_chunk(chunk_data, chunk_len,
                                        &s_bitmap_data[s_decompressed_offset],
                                        s_bitmap_data_size - s_decompressed_offset);
        }
        s_decompressed_offset += decoded;
        s_chunks_received++;

        if (s_chunks_received >= (int)total->value->uint32)
        {
#ifdef DEBUG_PNG
            APP_LOG(APP_LOG_LEVEL_INFO, "All %d chunks received, updating bitmap", s_chunks_received);
#endif
            apply_palette(s_bitmap);
            layer_mark_dirty(s_map_layer);
#ifdef DEBUG_PNG
            APP_LOG(APP_LOG_LEVEL_INFO, "Layer marked dirty");
#endif
        }
        return true;
    }

    return false;
}
