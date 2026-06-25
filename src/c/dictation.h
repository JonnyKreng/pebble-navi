#pragma once
#include <pebble.h>

#define MAX_DICTATE_RESULTS 10
#define MAX_DICTATE_NAME_LEN 64
#define MAX_DICTATE_DIST_LEN 24

typedef enum {
    DictationEventListening,
    DictationEventSearching,
    DictationEventResultsReady,
    DictationEventFailed,
    DictationEventCancelled,
} DictationEvent;

typedef void (*DictationCallback)(DictationEvent event, const char* status_text);

void dictation_init(DictationCallback callback);
void dictation_destroy(void);
bool dictation_start(void);
void dictation_cancel(void);
bool dictation_handle_message(DictionaryIterator* iter);
int dictation_get_total(void);
const char* dictation_get_name(int index);
const char* dictation_get_dist(int index);
const char* dictation_get_status_text(void);
