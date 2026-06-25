#pragma once

#include <pebble.h>

typedef enum {
    MODE_MAP,
    MODE_MAIN_MENU,
    MODE_DEST_LIST,
    MODE_ABOUT,
    MODE_DICTATE_LIST,
    MODE_DICTATE_WAITING,
} MenuMode;

typedef enum {
    ROUTE_MODE_WALKING = 0,
    ROUTE_MODE_CYCLING = 1,
    ROUTE_MODE_DRIVING = 2
} RouteMode;

typedef void (*MenuSendCallback)(uint32_t key, uint32_t value);

void menu_init(Layer* parent_layer, MenuSendCallback send_cb);
void menu_destroy(void);
MenuMode menu_get_mode(void);
void menu_show_main(void);
void menu_set_has_route(bool has_route);
void menu_set_route_mode(RouteMode mode);
void menu_set_rotation_mode(bool enabled);
void menu_set_show_dictation(bool show);
void menu_hide(void);
bool menu_handle_up(void);
bool menu_handle_down(void);
bool menu_handle_select(void);
bool menu_handle_back(void);
bool menu_handle_message(DictionaryIterator* iter);
