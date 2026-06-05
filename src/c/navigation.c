#include <pebble.h>
#include "navigation.h"

#define MAX_BITMAP_DATA_SIZE  50000
static unsigned int s_chunk_size;

#define DEBUG_PNG

#if defined(PBL_PLATFORM_EMERY)
#define SCREEN_W 200
#define SCREEN_H 228
#elif defined(PBL_PLATFORM_CHALK)
#define SCREEN_W 180
#define SCREEN_H 180
#else
#define SCREEN_W 144
#define SCREEN_H 168
#endif

static Layer* s_map_layer;
static GBitmap* s_bitmap;
static uint8_t s_bitmap_data[MAX_BITMAP_DATA_SIZE];
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
static bool s_transfer_active = false;

static void apply_palette(GBitmap* bmp)
{
    GColor8* pal = (GColor8*)malloc(64 * sizeof(GColor8));
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
}

static void map_update_proc(Layer* layer, GContext* ctx)
{
    if (s_bitmap)
    {
        graphics_draw_bitmap_in_rect(ctx, s_bitmap, layer_get_bounds(layer));
    }

    GRect bounds = layer_get_bounds(layer);
    int icon_size = 22;
    int margin = 4;

    GRect plus_rect = GRect(bounds.size.w - icon_size - margin, margin, icon_size, icon_size);
    graphics_context_set_text_color(ctx, GColorBlack);
    graphics_draw_text(ctx, "+", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), plus_rect, GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

    GRect minus_rect = GRect(bounds.size.w - icon_size - margin, bounds.size.h - 36 - icon_size - margin, icon_size, icon_size);
    graphics_context_set_text_color(ctx, GColorBlack);
    graphics_draw_text(ctx, "-", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), minus_rect, GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
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
    unsigned int max_inbox = app_message_inbox_size_maximum();
    s_chunk_size = max_inbox - 32;
    if (s_chunk_size > MAX_BITMAP_DATA_SIZE)
    {
        s_chunk_size = MAX_BITMAP_DATA_SIZE;
    }
    APP_LOG(APP_LOG_LEVEL_INFO, "Chunk size set to %d (max_inbox=%d)", s_chunk_size, max_inbox);
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
    if (s_map_layer)
    {
        layer_destroy(s_map_layer);
        s_map_layer = NULL;
    }
}

bool navigation_handle_message(DictionaryIterator* iter)
{
    Tuple* palette = dict_find(iter, MESSAGE_KEY_IMAGE_PALETTE);
    Tuple* idx = dict_find(iter, MESSAGE_KEY_IMAGE_CHUNK_INDEX);
    Tuple* total = dict_find(iter, MESSAGE_KEY_IMAGE_CHUNKS_TOTAL);
    Tuple* data = dict_find(iter, MESSAGE_KEY_IMAGE_CHUNK_DATA);

    if (palette)
    {
        s_transfer_active = true;
        s_chunks_received = 0;
        s_decompressed_offset = 0;
        s_rle_state = 0;
        s_rle_run_count = 0;
        if (palette->length == 128)
        {
            s_palette_received = 1;
            for (int i = 0; i < 64; i++)
            {
                s_palette_rgb565[i] = palette->value->data[i * 2] | (palette->value->data[i * 2 + 1] << 8);
            }
            APP_LOG(APP_LOG_LEVEL_INFO, "Palette stored (%d bytes)", palette->length);
        }
        else
        {
            APP_LOG(APP_LOG_LEVEL_INFO, "Palette msg ignored (wrong size %d)", palette->length);
        }
        return true;
    }

    if (idx && total && data)
    {
        if (idx->value->uint32 == 0)
        {
            s_transfer_active = true;
            s_chunks_received = 0;
            s_decompressed_offset = 0;
            s_rle_state = 0;
            s_rle_run_count = 0;
#ifdef DEBUG_PNG
            APP_LOG(APP_LOG_LEVEL_INFO, "Bitmap transfer starting, total=%lu", total->value->uint32);
#endif
        }
        int chunk_index = idx->value->uint32;
#ifdef DEBUG_PNG
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

            if (!s_bitmap)
            {
                s_bitmap = gbitmap_create_blank(GSize(s_bitmap_width, s_bitmap_height), GBitmapFormat8Bit);
                if (!s_bitmap)
                {
                    APP_LOG(APP_LOG_LEVEL_ERROR, "Failed to create GBitmap!");
                    return true;
                }
            }
            uint8_t* raw = gbitmap_get_data(s_bitmap);
            if (raw)
            {
                memcpy(raw, s_bitmap_data, s_bitmap_data_size);
#ifdef DEBUG_PNG
                APP_LOG(APP_LOG_LEVEL_INFO, "Bitmap data copied (%d bytes)", s_bitmap_data_size);
#endif
            }
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
