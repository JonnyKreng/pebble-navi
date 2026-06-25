#include <pebble.h>
#include "navigation.h"
#include "menu.h"

static Window* s_main_window;
static Layer* s_map_layer;
static TextLayer* s_route_summary_layer;
static TextLayer* s_next_step_layer;
static TextLayer* s_waiting_layer;
static char* s_route_summary_text;
static char* s_next_step_text;
static uint32_t max_message_size = 2028;

static bool s_js_ready = false;
static bool s_pending = false;
static uint32_t s_pending_key;
static unsigned int s_pending_val;

static void try_flush_pending(void)
{
    if (!s_pending) return;
    DictionaryIterator* iter;
    AppMessageResult result = app_message_outbox_begin(&iter);
    if (result != APP_MSG_OK) return;
    dict_write_int32(iter, s_pending_key, (int)s_pending_val);
    app_message_outbox_send();
    s_pending = false;
}

int main_get_text_layers_height(void)
{
    if (s_next_step_layer && !layer_get_hidden(text_layer_get_layer(s_next_step_layer)))
    {
        return 36;
    }
    if (s_route_summary_layer && !layer_get_hidden(text_layer_get_layer(s_route_summary_layer)))
    {
        return 18;
    }
    return 0;
}

static void inbox_received(DictionaryIterator* iter, void* ctx)
{
    //APP_LOG(APP_LOG_LEVEL_DEBUG, "Received AppMessage");

    if (!s_js_ready)
    {
        s_js_ready = true;
        layer_remove_from_parent(text_layer_get_layer(s_waiting_layer));
        text_layer_destroy(s_waiting_layer);
        s_waiting_layer = NULL;
    }

    if (navigation_handle_message(iter)) return;
    if (menu_handle_message(iter)) return;

    Tuple* route_mode_t = dict_find(iter, MESSAGE_KEY_ROUTE_MODE);
    if (route_mode_t)
    {
        menu_set_route_mode((RouteMode)route_mode_t->value->int32);
    }

    Tuple* rotation_mode_t = dict_find(iter, MESSAGE_KEY_ROTATION_MODE);
    if (rotation_mode_t)
    {
        menu_set_rotation_mode(rotation_mode_t->value->int32 != 0);
    }

    Tuple* nav_line1 = dict_find(iter, MESSAGE_KEY_NAV_INFO_LINE1);
    if (nav_line1)
    {
        free(s_route_summary_text);
        size_t len = strlen(nav_line1->value->cstring) + 1;
        s_route_summary_text = malloc(len);
        memcpy(s_route_summary_text, nav_line1->value->cstring, len);
        text_layer_set_text(s_route_summary_layer, s_route_summary_text);
        layer_set_hidden(text_layer_get_layer(s_route_summary_layer), s_route_summary_text[0] == '\0');
    }
    Tuple* nav_line2 = dict_find(iter, MESSAGE_KEY_NAV_INFO_LINE2);
    if (nav_line2)
    {
        free(s_next_step_text);
        size_t len = strlen(nav_line2->value->cstring) + 1;
        s_next_step_text = malloc(len);
        memcpy(s_next_step_text, nav_line2->value->cstring, len);
        text_layer_set_text(s_next_step_layer, s_next_step_text);
        layer_set_hidden(text_layer_get_layer(s_next_step_layer), s_next_step_text[0] == '\0');
    }

    Tuple* route_active = dict_find(iter, MESSAGE_KEY_ROUTE_ACTIVE);
    if (route_active)
    {
        menu_set_has_route(route_active->value->int32 != 0);
    }

    Tuple* show_dictation = dict_find(iter, MESSAGE_KEY_SHOW_DICTATION);
    if (show_dictation)
    {
        menu_set_show_dictation(show_dictation->value->int32 != 0);
    }

    if (nav_line1 || nav_line2)
    {
        layer_mark_dirty(s_map_layer);
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
#ifdef LOGGING_ENABLED
    APP_LOG(APP_LOG_LEVEL_INFO, "Outbox send success!");
#endif
    try_flush_pending();
}

static void enqueue_send(uint32_t key, unsigned int value)
{
    s_pending = true;
    s_pending_key = key;
    s_pending_val = value;
    try_flush_pending();
}

static void send_zoom_dir(int dir)
{
    enqueue_send(MESSAGE_KEY_ZOOM_DIR, dir);
}

static void send_max_message_size_handler(void* data)
{
    if (s_js_ready)
    {
#ifdef LOGGING_ENABLED
        APP_LOG(APP_LOG_LEVEL_INFO, "Send appmessage size to phone %d", max_message_size);
#endif
        enqueue_send(MESSAGE_KEY_MAX_MESSAGE_SIZE, max_message_size);
    }
    else
    {
#ifdef LOGGING_ENABLED
        APP_LOG(APP_LOG_LEVEL_INFO, "Waiting to send Chunk Size");
#endif
        app_timer_register(500, send_max_message_size_handler, NULL);
    }
}

static void menu_send_callback(uint32_t key, uint32_t value)
{
    enqueue_send(key, value);
}

static void select_click_handler(ClickRecognizerRef recognizer, void* context)
{
    if (!s_js_ready) return;
    if (menu_handle_select()) return;
    menu_show_main();
}

static void up_click_handler(ClickRecognizerRef recognizer, void* context)
{
    if (menu_handle_up()) return;
    send_zoom_dir(1);
}

static void down_click_handler(ClickRecognizerRef recognizer, void* context)
{
    if (menu_handle_down()) return;
    send_zoom_dir(-1);
}

static void back_click_handler(ClickRecognizerRef recognizer, void* context)
{
    if (menu_handle_back()) return;
    window_stack_pop(s_main_window);
}

static void click_config_provider(void* context)
{
    window_single_click_subscribe(BUTTON_ID_UP, up_click_handler);
    window_single_click_subscribe(BUTTON_ID_DOWN, down_click_handler);
    window_single_click_subscribe(BUTTON_ID_SELECT, select_click_handler);
    window_single_click_subscribe(BUTTON_ID_BACK, back_click_handler);
}

static void main_window_load(Window* window)
{
    Layer* window_layer = window_get_root_layer(window);
    GRect bounds = layer_get_bounds(window_layer);

    s_map_layer = navigation_create_map_layer(bounds);
    layer_add_child(window_layer, s_map_layer);


#ifdef PBL_PLATFORM_GABBRO
#define OFFSET 30
#elif  defined(PBL_PLATFORM_CHALK)
#define OFFSET 20
#else
#define OFFSET 0
#endif

    s_next_step_layer = text_layer_create(GRect(0, bounds.size.h - 36 - OFFSET, bounds.size.w, 18));
    text_layer_set_background_color(s_next_step_layer, GColorBlack);
    text_layer_set_text_color(s_next_step_layer, GColorWhite);
    text_layer_set_font(s_next_step_layer, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD));
    text_layer_set_text_alignment(s_next_step_layer, GTextAlignmentCenter);
    layer_add_child(window_layer, text_layer_get_layer(s_next_step_layer));
    layer_set_hidden(text_layer_get_layer(s_next_step_layer), true);

    s_route_summary_layer = text_layer_create(GRect(0, bounds.size.h - 18 - OFFSET, bounds.size.w, 18));
    text_layer_set_background_color(s_route_summary_layer, GColorBlack);
    text_layer_set_text_color(s_route_summary_layer, GColorWhite);
    text_layer_set_font(s_route_summary_layer, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD));
    text_layer_set_text_alignment(s_route_summary_layer, GTextAlignmentCenter);
    layer_add_child(window_layer, text_layer_get_layer(s_route_summary_layer));
    layer_set_hidden(text_layer_get_layer(s_route_summary_layer), true);

    window_set_click_config_provider(window, click_config_provider);

    menu_init(window_layer, menu_send_callback);

    app_timer_register(500, send_max_message_size_handler, NULL);

    s_waiting_layer = text_layer_create(GRect(0, 0, bounds.size.w, bounds.size.h));
    text_layer_set_background_color(s_waiting_layer, GColorBulgarianRose);
    text_layer_set_text_color(s_waiting_layer, GColorWhite);
    text_layer_set_font(s_waiting_layer, fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD));
    text_layer_set_text_alignment(s_waiting_layer, GTextAlignmentCenter);
    text_layer_set_text(s_waiting_layer, "Waiting for\nphone...");
    layer_add_child(window_layer, text_layer_get_layer(s_waiting_layer));
}

static void main_window_unload(Window* window)
{
    navigation_destroy_map_layer();
    text_layer_destroy(s_route_summary_layer);
    text_layer_destroy(s_next_step_layer);
    free(s_route_summary_text);
    s_route_summary_text = NULL;
    free(s_next_step_text);
    s_next_step_text = NULL;
    if (s_waiting_layer)
    {
        text_layer_destroy(s_waiting_layer);
        s_waiting_layer = NULL;
    }
}

static void init()
{
    s_main_window = window_create();
    APP_LOG(APP_LOG_LEVEL_INFO, "Windows Created");

    navigation_init();

    window_set_background_color(s_main_window, GColorBlack);
    window_set_window_handlers(s_main_window, (WindowHandlers)
    {
        .load = main_window_load,
        .unload = main_window_unload,
    });
    app_message_register_inbox_received(inbox_received);
    app_message_register_inbox_dropped(inbox_dropped);
    app_message_register_outbox_failed(outbox_failed);
    app_message_register_outbox_sent(outbox_sent);

    max_message_size = app_message_inbox_size_maximum();

    app_message_open(max_message_size, 1024);

    window_stack_push(s_main_window, true);
}

static void deinit()
{
    window_destroy(s_main_window);
    menu_destroy();
}

int main(void)
{
    init();
    app_event_loop();
    deinit();
}
