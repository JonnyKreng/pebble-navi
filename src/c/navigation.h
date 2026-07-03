#pragma once

#include <pebble.h>

void navigation_init(void);
int navigation_get_chunk_size(void);
Layer* navigation_create_map_layer(GRect bounds);
void navigation_destroy_map_layer(void);
bool navigation_handle_message(DictionaryIterator* iter);
void navigation_set_text_mode(bool enabled);
bool navigation_get_text_mode(void);
void navigation_set_text_info(const char* heading, const char* subtitle, const char* distance);
void navigation_set_text_bearing(int bearing);
void navigation_set_arrival_text(const char* text);
