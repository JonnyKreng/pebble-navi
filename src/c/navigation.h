#pragma once

#include <pebble.h>

void navigation_init(void);
int navigation_get_chunk_size(void);
Layer* navigation_create_map_layer(GRect bounds);
void navigation_destroy_map_layer(void);
bool navigation_handle_message(DictionaryIterator* iter);
void navigation_set_rotation_mode(bool enabled);
