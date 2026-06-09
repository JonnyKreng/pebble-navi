#include <pebble.h>
#include "menu.h"

#define MAX_DEST_NAMES 30
#define MAX_NAME_LEN 32
#define ITEM_HEIGHT 36

static MenuMode s_mode = MODE_MAP;
static Layer* s_menu_layer;
static MenuSendCallback s_send_cb;
static bool s_has_route;
static bool s_backlight_on;
static char s_backlight_label[20];
static RouteMode s_route_mode;
static char s_route_label[20];
static bool s_rotation_mode;
static char s_rotation_label[20];

static int s_selected_index;

static char s_dest_names[MAX_DEST_NAMES][MAX_NAME_LEN];
static int s_dest_names_total;
static int s_dest_names_received;
static bool s_collecting_dests;
static int s_dest_scroll_offset;

static void update_backlight_label(void)
{
    snprintf(s_backlight_label, sizeof(s_backlight_label),
             s_backlight_on ? "Backlight: On" : "Backlight: Off");
}

static void update_route_label(void)
{
    static const char* names[] = {
        [ROUTE_MODE_WALKING] = "Walking",
        [ROUTE_MODE_CYCLING] = "Cycling",
        [ROUTE_MODE_DRIVING] = "Driving",
    };
    snprintf(s_route_label, sizeof(s_route_label),
             "Mode: %s", names[s_route_mode]);
}

static void update_rotation_label(void)
{
    snprintf(s_rotation_label, sizeof(s_rotation_label),
             "Rotate Map: %s", s_rotation_mode ? "On" : "Off");
}

static void draw_about(GContext* ctx, GRect bounds)
{
    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_rect(ctx, bounds, 0, GCornerNone);
    graphics_context_set_text_color(ctx, GColorWhite);

    const char* lines[] = {
        "Map data:",
        "(c) OpenStreetMap",
        "contributors (ODbL)",
        "",
        "Full attributions",
        "in phone settings",
    };
    int num_lines = sizeof(lines) / sizeof(lines[0]);
    int line_h = 18;
    int total_h = num_lines * line_h;
    int y = bounds.origin.y + (bounds.size.h - total_h) / 2;

    for (int i = 0; i < num_lines; i++)
    {
        GRect r = GRect(0, y, bounds.size.w, line_h);
        graphics_draw_text(ctx, lines[i],
                           fonts_get_system_font(FONT_KEY_GOTHIC_18),
                           r, GTextOverflowModeTrailingEllipsis,
                           GTextAlignmentCenter, NULL);
        y += line_h;
    }
}

static void menu_layer_update_proc(Layer* layer, GContext* ctx)
{
    GRect bounds = layer_get_bounds(layer);

    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_rect(ctx, bounds, 0, GCornerNone);

    if (s_mode == MODE_ABOUT)
    {
        draw_about(ctx, bounds);
        return;
    }

    if (s_mode == MODE_MAIN_MENU)
    {
        int num_visible = s_has_route ? 7 : 6;
        int item_h = ITEM_HEIGHT;
        if (num_visible * item_h > bounds.size.h)
        {
            item_h = bounds.size.h / num_visible;
        }
        int total_h = num_visible * item_h;
        int start_y = (bounds.size.h - total_h) / 2;

        int drawn = 0;
        for (int slot = 0; slot < 7; slot++)
        {
            if (slot == 1 && !s_has_route) continue;

            const char* text;
            switch (slot)
            {
                case 0: text = "Select Destination"; break;
                case 1: text = "Stop Routing";       break;
                case 2: text = "Save Location";      break;
                case 3: text = s_route_label;        break;
                case 4: text = s_backlight_label;    break;
                case 5: text = s_rotation_label;     break;
                default: text = "About";             break;
            }

            GRect item_rect = GRect(0, start_y + drawn * item_h, bounds.size.w, item_h);

            if (drawn == s_selected_index)
            {
                graphics_context_set_fill_color(ctx, GColorWhite);
                graphics_fill_rect(ctx, item_rect, 0, GCornerNone);
                graphics_context_set_text_color(ctx, GColorBlack);
            }
            else
            {
                graphics_context_set_text_color(ctx, GColorWhite);
            }

            graphics_draw_text(ctx, text,
                               fonts_get_system_font(FONT_KEY_GOTHIC_24),
                               item_rect, GTextOverflowModeTrailingEllipsis,
                               GTextAlignmentCenter, NULL);
            drawn++;
        }
    }
    else if (s_mode == MODE_DEST_LIST)
    {
        int max_visible = bounds.size.h / ITEM_HEIGHT;
        if (s_selected_index < s_dest_scroll_offset)
        {
            s_dest_scroll_offset = s_selected_index;
        }
        else if (s_selected_index >= s_dest_scroll_offset + max_visible)
        {
            s_dest_scroll_offset = s_selected_index - max_visible + 1;
        }

        int drawn = 0;
        for (int i = s_dest_scroll_offset; i < s_dest_names_total && drawn < max_visible; i++, drawn++)
        {
            GRect item_rect = GRect(0, drawn * ITEM_HEIGHT, bounds.size.w, ITEM_HEIGHT);

            if (i == s_selected_index)
            {
                graphics_context_set_fill_color(ctx, GColorWhite);
                graphics_fill_rect(ctx, item_rect, 0, GCornerNone);
                graphics_context_set_text_color(ctx, GColorBlack);
            }
            else
            {
                graphics_context_set_text_color(ctx, GColorWhite);
            }

            graphics_draw_text(ctx, s_dest_names[i],
                               fonts_get_system_font(FONT_KEY_GOTHIC_24),
                               item_rect, GTextOverflowModeTrailingEllipsis,
                               GTextAlignmentCenter, NULL);
        }
    }
}

void menu_init(Layer* parent_layer, MenuSendCallback send_cb)
{
    s_send_cb = send_cb;
    s_mode = MODE_MAP;
    s_selected_index = 0;
    s_has_route = false;
    s_backlight_on = false;
    update_backlight_label();
    s_route_mode = ROUTE_MODE_WALKING;
    update_route_label();
    s_rotation_mode = false;
    update_rotation_label();
    s_collecting_dests = false;
    s_dest_names_total = 0;
    s_dest_names_received = 0;
    s_dest_scroll_offset = 0;

    s_menu_layer = layer_create(layer_get_bounds(parent_layer));
    layer_set_update_proc(s_menu_layer, menu_layer_update_proc);
    layer_set_hidden(s_menu_layer, true);
    layer_add_child(parent_layer, s_menu_layer);
}

void menu_destroy(void)
{
    light_enable(false);
    if (s_menu_layer)
    {
        layer_destroy(s_menu_layer);
        s_menu_layer = NULL;
    }
}

MenuMode menu_get_mode(void)
{
    return s_mode;
}

void menu_show_main(void)
{
    s_mode = MODE_MAIN_MENU;
    s_selected_index = 0;
    s_collecting_dests = false;
    layer_set_hidden(s_menu_layer, false);
    layer_mark_dirty(s_menu_layer);
}

void menu_set_has_route(bool has_route)
{
    s_has_route = has_route;
    if (s_mode == MODE_MAIN_MENU)
    {
        layer_mark_dirty(s_menu_layer);
    }
}

void menu_hide(void)
{
    s_mode = MODE_MAP;
    s_selected_index = 0;
    s_collecting_dests = false;
    layer_set_hidden(s_menu_layer, true);
}

static void reset_dest_collection(void)
{
    s_collecting_dests = true;
    s_dest_names_total = 0;
    s_dest_names_received = 0;
    s_dest_scroll_offset = 0;
    for (int i = 0; i < MAX_DEST_NAMES; i++)
    {
        s_dest_names[i][0] = '\0';
    }
}

bool menu_handle_up(void)
{
    if (s_mode == MODE_MAP) return false;

    if (s_selected_index > 0)
    {
        s_selected_index--;
        layer_mark_dirty(s_menu_layer);
    }
    return true;
}

bool menu_handle_down(void)
{
    if (s_mode == MODE_MAP) return false;

    int max_index;
    if (s_mode == MODE_MAIN_MENU)
    {
        max_index = s_has_route ? 6 : 5;
    }
    else
    {
        max_index = s_dest_names_total - 1;
    }

    if (s_selected_index < max_index)
    {
        s_selected_index++;
        layer_mark_dirty(s_menu_layer);
    }
    return true;
}

bool menu_handle_select(void)
{
    if (s_mode == MODE_MAP) return false;

    if (s_mode == MODE_MAIN_MENU)
    {
        static const int slot_noroute[5] = {0, 2, 3, 4, 5};
        int slot = s_has_route ? s_selected_index : slot_noroute[s_selected_index];

            switch (slot)
            {
                case 0:
                    if (s_send_cb) s_send_cb(MESSAGE_KEY_REQUEST_DESTINATIONS, 1);
                    reset_dest_collection();
                    break;
                case 1:
                    if (s_send_cb) s_send_cb(MESSAGE_KEY_STOP_ROUTING, 1);
                    s_has_route = false;
                    menu_hide();
                    break;
                case 2:
                    if (s_send_cb) s_send_cb(MESSAGE_KEY_SAVE_CURRENT_LOCATION, 1);
                    menu_hide();
                    break;
                case 3:
                    s_route_mode = (s_route_mode + 1) % 3;
                    update_route_label();
                    if (s_send_cb) s_send_cb(MESSAGE_KEY_ROUTE_MODE, s_route_mode);
                    layer_mark_dirty(s_menu_layer);
                    break;
                case 4:
                    s_backlight_on = !s_backlight_on;
                    light_enable(s_backlight_on);
                    update_backlight_label();
                    layer_mark_dirty(s_menu_layer);
                    break;
                case 5:
                    s_rotation_mode = !s_rotation_mode;
                    update_rotation_label();
                    if (s_send_cb) s_send_cb(MESSAGE_KEY_ROTATION_MODE, s_rotation_mode ? 1 : 0);
                    layer_mark_dirty(s_menu_layer);
                    break;
                default:
                    s_mode = MODE_ABOUT;
                    s_selected_index = 0;
                    layer_mark_dirty(s_menu_layer);
                    break;
            }
    }
    else if (s_mode == MODE_ABOUT)
    {
        s_mode = MODE_MAIN_MENU;
        s_selected_index = s_has_route ? 6 : 5;
        layer_mark_dirty(s_menu_layer);
    }
    else if (s_mode == MODE_DEST_LIST)
    {
        if (s_send_cb) s_send_cb(MESSAGE_KEY_SELECTED_DEST_INDEX, s_selected_index);
        menu_hide();
    }

    return true;
}

bool menu_handle_back(void)
{
    if (s_mode == MODE_MAP) return false;

    if (s_mode == MODE_DEST_LIST || s_mode == MODE_ABOUT)
    {
        s_mode = MODE_MAIN_MENU;
        s_selected_index = 0;
        s_collecting_dests = false;
        layer_mark_dirty(s_menu_layer);
    }
    else
    {
        menu_hide();
    }

    return true;
}

bool menu_handle_message(DictionaryIterator* iter)
{
    Tuple* total_t = dict_find(iter, MESSAGE_KEY_DEST_NAMES_TOTAL);
    if (total_t)
    {
        reset_dest_collection();
        s_dest_names_total = total_t->value->uint8;
        return true;
    }

    if (s_collecting_dests)
    {
        Tuple* idx_t = dict_find(iter, MESSAGE_KEY_SELECTED_DEST_INDEX);
        Tuple* name_t = dict_find(iter, MESSAGE_KEY_DEST_NAME);
        if (idx_t && name_t)
        {
            int idx = idx_t->value->uint8;
            if (idx < MAX_DEST_NAMES)
            {
                strncpy(s_dest_names[idx], name_t->value->cstring, MAX_NAME_LEN - 1);
                s_dest_names[idx][MAX_NAME_LEN - 1] = '\0';
                s_dest_names_received++;

                if (s_dest_names_total > 0 && s_dest_names_received >= s_dest_names_total)
                {
                    s_mode = MODE_DEST_LIST;
                    s_selected_index = 0;
                    s_dest_scroll_offset = 0;
                    layer_mark_dirty(s_menu_layer);
                }
            }
            return true;
        }
    }

    return false;
}
