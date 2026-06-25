#include <pebble.h>
#include "dictation.h"

static DictationCallback s_callback;

#ifdef PBL_MICROPHONE

static DictationSession* s_session;
static char s_text[256];
static char s_names[MAX_DICTATE_RESULTS][MAX_DICTATE_NAME_LEN];
static char s_dists[MAX_DICTATE_RESULTS][MAX_DICTATE_DIST_LEN];
static int s_total;
static int s_received;
static bool s_active;
static char s_status_text[32];

static void destroy_session(void)
{
    if (s_session)
    {
        dictation_session_destroy(s_session);
        s_session = NULL;
    }
    s_active = false;
}

static void callback(DictationSession *session,
                     DictationSessionStatus status,
                     char *transcription,
                     void *context)
{
    s_active = false;

    switch (status)
    {
        case DictationSessionStatusSuccess:
            if (transcription && strlen(transcription) > 0)
            {
                strncpy(s_text, transcription, sizeof(s_text) - 1);
                s_text[sizeof(s_text) - 1] = '\0';
                DictionaryIterator* iter;
                AppMessageResult result = app_message_outbox_begin(&iter);
                if (result == APP_MSG_OK)
                {
                    dict_write_cstring(iter, MESSAGE_KEY_DICTATE_TEXT, s_text);
                    app_message_outbox_send();
                }
                snprintf(s_status_text, sizeof(s_status_text), "Searching...");
                if (s_callback) s_callback(DictationEventSearching, s_status_text);
            }
            else
            {
                snprintf(s_status_text, sizeof(s_status_text), "No speech detected");
                if (s_callback) s_callback(DictationEventFailed, s_status_text);
            }
            break;

        case DictationSessionStatusFailureTranscriptionRejected:
            if (s_callback) s_callback(DictationEventCancelled, NULL);
            break;

        case DictationSessionStatusFailureNoSpeechDetected:
            snprintf(s_status_text, sizeof(s_status_text), "No speech detected");
            if (s_callback) s_callback(DictationEventFailed, s_status_text);
            break;

        case DictationSessionStatusFailureConnectivityError:
            snprintf(s_status_text, sizeof(s_status_text), "Connectivity error");
            if (s_callback) s_callback(DictationEventFailed, s_status_text);
            break;

        default:
            snprintf(s_status_text, sizeof(s_status_text), "Dictation failed");
            if (s_callback) s_callback(DictationEventFailed, s_status_text);
            break;
    }

    destroy_session();
}

#endif

void dictation_init(DictationCallback callback)
{
    s_callback = callback;

#ifdef PBL_MICROPHONE
    s_session = NULL;
    s_active = false;
    s_text[0] = '\0';
    s_total = 0;
    s_received = 0;
    s_status_text[0] = '\0';
#endif
}

void dictation_destroy(void)
{
#ifdef PBL_MICROPHONE
    destroy_session();
#endif
}

bool dictation_start(void)
{
#ifdef PBL_MICROPHONE
    if (s_active) return false;

    s_session = dictation_session_create(256, callback, NULL);
    if (!s_session)
    {
        snprintf(s_status_text, sizeof(s_status_text), "Dictation unavailable");
        if (s_callback) s_callback(DictationEventFailed, s_status_text);
        return false;
    }

    dictation_session_enable_confirmation(s_session, true);
    dictation_session_enable_error_dialogs(s_session, true);

    if (dictation_session_start(s_session))
    {
        s_active = true;
        snprintf(s_status_text, sizeof(s_status_text), "Listening...");
        if (s_callback) s_callback(DictationEventListening, s_status_text);
        return true;
    }
    else
    {
        dictation_session_destroy(s_session);
        s_session = NULL;
        snprintf(s_status_text, sizeof(s_status_text), "Dictation unavailable");
        if (s_callback) s_callback(DictationEventFailed, s_status_text);
        return false;
    }
#else
    return false;
#endif
}

void dictation_cancel(void)
{
#ifdef PBL_MICROPHONE
    destroy_session();
    if (s_callback) s_callback(DictationEventCancelled, NULL);
#endif
}

bool dictation_handle_message(DictionaryIterator* iter)
{
#ifdef PBL_MICROPHONE
    Tuple* total_t = dict_find(iter, MESSAGE_KEY_DICTATE_RESULTS_TOTAL);
    if (total_t)
    {
        s_total = total_t->value->uint8;
        s_received = 0;
        for (int i = 0; i < MAX_DICTATE_RESULTS; i++)
        {
            s_names[i][0] = '\0';
            s_dists[i][0] = '\0';
        }
        return true;
    }

    Tuple* idx_t = dict_find(iter, MESSAGE_KEY_DICTATE_RESULT_INDEX);
    Tuple* name_t = dict_find(iter, MESSAGE_KEY_DICTATE_RESULT_NAME);
    Tuple* dist_t = dict_find(iter, MESSAGE_KEY_DICTATE_RESULT_DISTANCE);
    if (idx_t && name_t && dist_t)
    {
        int idx = idx_t->value->uint8;
        if (idx < MAX_DICTATE_RESULTS)
        {
            strncpy(s_names[idx], name_t->value->cstring, MAX_DICTATE_NAME_LEN - 1);
            s_names[idx][MAX_DICTATE_NAME_LEN - 1] = '\0';
            strncpy(s_dists[idx], dist_t->value->cstring, MAX_DICTATE_DIST_LEN - 1);
            s_dists[idx][MAX_DICTATE_DIST_LEN - 1] = '\0';
            s_received++;

            if (s_total > 0 && s_received >= s_total)
            {
                if (s_callback) s_callback(DictationEventResultsReady, NULL);
            }
        }
        return true;
    }
#endif
    return false;
}

int dictation_get_total(void)
{
#ifdef PBL_MICROPHONE
    return s_total;
#else
    return 0;
#endif
}

const char* dictation_get_name(int index)
{
#ifdef PBL_MICROPHONE
    if (index >= 0 && index < MAX_DICTATE_RESULTS)
        return s_names[index];
    return "";
#else
    return "";
#endif
}

const char* dictation_get_dist(int index)
{
#ifdef PBL_MICROPHONE
    if (index >= 0 && index < MAX_DICTATE_RESULTS)
        return s_dists[index];
    return "";
#else
    return "";
#endif
}

const char* dictation_get_status_text(void)
{
#ifdef PBL_MICROPHONE
    return s_status_text;
#else
    return "";
#endif
}
