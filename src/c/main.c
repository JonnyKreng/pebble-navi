#include <pebble.h>
#include "navigation.h"

static Window* s_main_window;
static Layer* s_map_layer;
static TextLayer* s_route_summary_layer;
static TextLayer* s_next_step_layer;

static void inbox_received(DictionaryIterator* iter, void* ctx)
{
    if (navigation_handle_message(iter)) return;

    Tuple* dist = dict_find(iter, MESSAGE_KEY_ROUTE_DISTANCE);
    Tuple* dur = dict_find(iter, MESSAGE_KEY_ROUTE_DURATION);
    if (dist && dur)
    {
        static char summary[32];
        int d = dist->value->int32;
        int m = dur->value->int32;
        if (d >= 1000)
        {
            snprintf(summary, sizeof(summary), "%.1f km  %d min", d / 1000.0, m);
        }
        else
        {
            snprintf(summary, sizeof(summary), "%d m  %d min", d, m);
        }
        text_layer_set_text(s_route_summary_layer, summary);
    }

    Tuple* ns_type = dict_find(iter, MESSAGE_KEY_NEXT_STEP_TYPE);
    Tuple* ns_mod = dict_find(iter, MESSAGE_KEY_NEXT_STEP_MODIFIER);
    Tuple* ns_name = dict_find(iter, MESSAGE_KEY_NEXT_STEP_NAME);
    Tuple* ns_dist = dict_find(iter, MESSAGE_KEY_NEXT_STEP_DISTANCE);
    if (ns_type)
    {
        static char next_step[64];
        const char* mod = ns_mod ? ns_mod->value->cstring : "";
        const char* name = ns_name ? ns_name->value->cstring : "";
        int nd = ns_dist ? ns_dist->value->int32 : 0;
        if (nd > 0)
        {
            snprintf(next_step, sizeof(next_step), "%s %s (%d m)", mod, name, nd);
        }
        else
        {
            text_layer_set_text(s_next_step_layer, "");
        }
        text_layer_set_text(s_next_step_layer, next_step);
    }
}

static void inbox_dropped(AppMessageResult reason, void* ctx)
{
    APP_LOG(APP_LOG_LEVEL_ERROR, "Message dropped! reason=%d", reason);
}

static void outbox_failed(DictionaryIterator* iterator, AppMessageResult reason, void* context)
{
    APP_LOG(APP_LOG_LEVEL_ERROR, "Outbox send failed!");
}

static void outbox_sent(DictionaryIterator* iterator, void* context)
{
    APP_LOG(APP_LOG_LEVEL_INFO, "Outbox send success!");
}

static void send_zoom_dir(int dir)
{
    DictionaryIterator* iter;
    AppMessageResult result = app_message_outbox_begin(&iter);
    if (result != APP_MSG_OK) return;
    dict_write_uint8(iter, MESSAGE_KEY_ZOOM_DIR, dir);
    app_message_outbox_send();
}

static void select_click_handler(ClickRecognizerRef recognizer, void* context)
{
    DictionaryIterator* iter;
    AppMessageResult result = app_message_outbox_begin(&iter);
    if (result != APP_MSG_OK) return;
    dict_write_uint8(iter, MESSAGE_KEY_REQUEST_DESTINATIONS, 1);
    app_message_outbox_send();
}

static void up_click_handler(ClickRecognizerRef recognizer, void* context)
{
    send_zoom_dir(1);
}

static void down_click_handler(ClickRecognizerRef recognizer, void* context)
{
    send_zoom_dir(0);
}

static void click_config_provider(void* context)
{
    window_single_click_subscribe(BUTTON_ID_UP, up_click_handler);
    window_single_click_subscribe(BUTTON_ID_DOWN, down_click_handler);
    window_single_click_subscribe(BUTTON_ID_SELECT, select_click_handler);
}

static void main_window_load(Window* window)
{
    Layer* window_layer = window_get_root_layer(window);
    GRect bounds = layer_get_bounds(window_layer);

    s_map_layer = navigation_create_map_layer(bounds);
    layer_add_child(window_layer, s_map_layer);

    s_route_summary_layer = text_layer_create(GRect(0, bounds.size.h - 36, bounds.size.w, 18));
    text_layer_set_background_color(s_route_summary_layer, GColorBlack);
    text_layer_set_text_color(s_route_summary_layer, GColorWhite);
    text_layer_set_font(s_route_summary_layer, fonts_get_system_font(FONT_KEY_GOTHIC_14));
    text_layer_set_text_alignment(s_route_summary_layer, GTextAlignmentCenter);
    layer_add_child(window_layer, text_layer_get_layer(s_route_summary_layer));

    s_next_step_layer = text_layer_create(GRect(0, bounds.size.h - 18, bounds.size.w, 18));
    text_layer_set_background_color(s_next_step_layer, GColorBlack);
    text_layer_set_text_color(s_next_step_layer, GColorWhite);
    text_layer_set_font(s_next_step_layer, fonts_get_system_font(FONT_KEY_GOTHIC_14));
    text_layer_set_text_alignment(s_next_step_layer, GTextAlignmentCenter);
    layer_add_child(window_layer, text_layer_get_layer(s_next_step_layer));

    window_set_click_config_provider(window, click_config_provider);
}

static void main_window_unload(Window* window)
{
    navigation_destroy_map_layer();
    text_layer_destroy(s_route_summary_layer);
    text_layer_destroy(s_next_step_layer);
}

static void init()
{
    s_main_window = window_create();
    APP_LOG(APP_LOG_LEVEL_INFO, "Windows Created");


    window_set_background_color(s_main_window, GColorBlack);
    window_set_window_handlers(s_main_window, (WindowHandlers)
    {
        .load = main_window_load,
        .unload = main_window_unload,
    });
    window_stack_push(s_main_window, true);

    app_message_register_inbox_received(inbox_received);
    app_message_register_inbox_dropped(inbox_dropped);
    app_message_register_outbox_failed(outbox_failed);
    app_message_register_outbox_sent(outbox_sent);

    app_message_open(8192, 2048);
}

static void deinit()
{
    window_destroy(s_main_window);
}

int main(void)
{
    init();
    app_event_loop();
    deinit();
}
