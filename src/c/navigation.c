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

static unsigned int s_chunk_size;

static Layer* s_map_layer;
static GBitmap* s_bitmap;
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
    if (s_map_layer) layer_mark_dirty(s_map_layer);
}

static void map_update_proc(Layer* layer, GContext* ctx)
{
    if (s_bitmap)
    {
        graphics_draw_bitmap_in_rect(ctx, s_bitmap, layer_get_bounds(layer));
    }

    GRect bounds = layer_get_bounds(layer);
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

    while (s_rle_run_count > 0 && op < out_max)
    {
        out[op++] = s_rle_run_val;
        s_rle_run_count--;
    }

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

bool navigation_handle_message(DictionaryIterator* iter)
{
    Tuple* idx = dict_find(iter, MESSAGE_KEY_IMAGE_CHUNK_INDEX);
    Tuple* total = dict_find(iter, MESSAGE_KEY_IMAGE_CHUNKS_TOTAL);
    Tuple* data = dict_find(iter, MESSAGE_KEY_IMAGE_CHUNK_DATA);

    if (idx && total && data)
    {
        if (idx->value->uint32 == 0)
        {
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
