#pragma once

#include <pebble.h>

Layer* navigation_create_map_layer(GRect bounds);
void navigation_destroy_map_layer(void);
bool navigation_handle_message(DictionaryIterator* iter);
