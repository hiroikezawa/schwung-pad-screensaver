/*
 * PAD SCREENSAVER - Schwung MIDI FX (midi_fx_api_v1).
 *
 * Visual only. Every MIDI message passes through unchanged; nothing is
 * generated. This DSP exists for two reasons:
 *   1. a MIDI FX slot needs one, and
 *   2. it holds the four settings, so they are saved and restored with the
 *      slot (the `state` blob) like any other module's.
 *
 * The animation itself lives in ui_chain.js / ui_core.mjs and runs only while
 * this module's own Schwung screen is shown. A chain MIDI FX receives no
 * midi_send_internal (only overtake DSP does), so there is no LED path from
 * here, and this file does not try to make one.
 *
 * REALTIME: every entry point runs on the SPI callback (see the top of
 * plugin_api_v1.h). Nothing here allocates beyond the instance, logs, or
 * does I/O.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "host/midi_fx_api_v1.h"
#include "host/plugin_api_v1.h"

#define PS_INTERVAL_MIN   10
#define PS_INTERVAL_MAX   180
#define PS_INTERVAL_DEF   30
#define PS_BRIGHT_MIN     5
#define PS_BRIGHT_MAX     100
#define PS_BRIGHT_DEF     70
#define PS_SPEED_MIN      25
#define PS_SPEED_MAX      300
#define PS_SPEED_DEF      100

typedef enum { PS_MODE_RANDOM = 0, PS_MODE_SEQUENTIAL = 1 } ps_mode_t;
static const char *const MODE_NAMES[] = { "random", "sequential" };

typedef struct {
    int interval;    /* seconds an animation stays up */
    int brightness;  /* percent */
    int speed;       /* percent */
    int mode;        /* ps_mode_t */
} ps_instance_t;

static int clampi(int v, int lo, int hi) { return v < lo ? lo : v > hi ? hi : v; }

/* Whole-string decimal integer; no strtol so errno is never touched. */
static int parse_int(const char *s, int *out) {
    if (!s) return 0;
    while (*s == ' ') s++;
    int neg = 0;
    if (*s == '-') { neg = 1; s++; }
    if (*s < '0' || *s > '9') return 0;
    long v = 0;
    while (*s >= '0' && *s <= '9') {
        v = v * 10 + (*s - '0');
        if (v > 1000000) return 0;
        s++;
    }
    while (*s == ' ') s++;
    if (*s == '.') {                      /* "30.000000" from a float knob */
        s++;
        while (*s >= '0' && *s <= '9') s++;
    }
    if (*s) return 0;
    *out = neg ? (int)-v : (int)v;
    return 1;
}

static int set_mode(ps_instance_t *inst, const char *val) {
    int v;
    for (int i = 0; i < 2; i++)
        if (strcmp(val, MODE_NAMES[i]) == 0) { inst->mode = i; return 1; }
    if (parse_int(val, &v) && (v == 0 || v == 1)) { inst->mode = v; return 1; }
    return 0;
}

/* Find "key": in a flat JSON object and copy its raw value (number or string
 * contents) into out. Enough for the blob get_param("state") writes. */
static int json_raw(const char *json, const char *key, char *out, int out_len) {
    char pat[32];
    int n = snprintf(pat, sizeof(pat), "\"%s\"", key);
    if (n <= 0 || n >= (int)sizeof(pat)) return 0;
    const char *p = strstr(json, pat);
    if (!p) return 0;
    p += n;
    while (*p == ' ') p++;
    if (*p != ':') return 0;
    p++;
    while (*p == ' ') p++;
    int quoted = *p == '"';
    if (quoted) p++;
    int i = 0;
    while (*p && i < out_len - 1) {
        if (quoted ? *p == '"' : (*p == ',' || *p == '}' || *p == ' ')) break;
        out[i++] = *p++;
    }
    out[i] = '\0';
    return i > 0;
}

static void *ps_create_instance(const char *module_dir, const char *config_json) {
    (void)module_dir; (void)config_json;
    ps_instance_t *inst = calloc(1, sizeof(*inst));
    if (!inst) return NULL;
    inst->interval = PS_INTERVAL_DEF;
    inst->brightness = PS_BRIGHT_DEF;
    inst->speed = PS_SPEED_DEF;
    inst->mode = PS_MODE_RANDOM;
    return inst;
}

static void ps_destroy_instance(void *instance) { free(instance); }

/* Everything passes through untouched, realtime included. */
static int ps_process_midi(void *instance, const uint8_t *in, int in_len,
                           uint8_t out[][3], int out_lens[], int max_out) {
    (void)instance;
    if (!in || in_len < 1 || max_out < 1) return 0;
    out[0][0] = in[0];
    out[0][1] = in_len > 1 ? in[1] : 0;
    out[0][2] = in_len > 2 ? in[2] : 0;
    out_lens[0] = in_len > 3 ? 3 : in_len;
    return 1;
}

static int ps_tick(void *instance, int frames, int sample_rate,
                   uint8_t out[][3], int out_lens[], int max_out) {
    (void)instance; (void)frames; (void)sample_rate;
    (void)out; (void)out_lens; (void)max_out;
    return 0;
}

static void ps_set_param(void *instance, const char *key, const char *val) {
    ps_instance_t *inst = (ps_instance_t *)instance;
    if (!inst || !key || !val) return;
    int v;
    if (strcmp(key, "interval") == 0) {
        if (parse_int(val, &v)) inst->interval = clampi(v, PS_INTERVAL_MIN, PS_INTERVAL_MAX);
    } else if (strcmp(key, "brightness") == 0) {
        if (parse_int(val, &v)) inst->brightness = clampi(v, PS_BRIGHT_MIN, PS_BRIGHT_MAX);
    } else if (strcmp(key, "speed") == 0) {
        if (parse_int(val, &v)) inst->speed = clampi(v, PS_SPEED_MIN, PS_SPEED_MAX);
    } else if (strcmp(key, "mode") == 0) {
        set_mode(inst, val);
    } else if (strcmp(key, "state") == 0) {
        char s[24];
        if (json_raw(val, "interval", s, sizeof(s)) && parse_int(s, &v))
            inst->interval = clampi(v, PS_INTERVAL_MIN, PS_INTERVAL_MAX);
        if (json_raw(val, "brightness", s, sizeof(s)) && parse_int(s, &v))
            inst->brightness = clampi(v, PS_BRIGHT_MIN, PS_BRIGHT_MAX);
        if (json_raw(val, "speed", s, sizeof(s)) && parse_int(s, &v))
            inst->speed = clampi(v, PS_SPEED_MIN, PS_SPEED_MAX);
        if (json_raw(val, "mode", s, sizeof(s))) set_mode(inst, s);
    }
}

static int ps_get_param(void *instance, const char *key, char *buf, int buf_len) {
    ps_instance_t *inst = (ps_instance_t *)instance;
    if (!inst || !key || !buf || buf_len < 1) return -1;
    int n = -1;
    if (strcmp(key, "interval") == 0)
        n = snprintf(buf, (size_t)buf_len, "%d", inst->interval);
    else if (strcmp(key, "brightness") == 0)
        n = snprintf(buf, (size_t)buf_len, "%d", inst->brightness);
    else if (strcmp(key, "speed") == 0)
        n = snprintf(buf, (size_t)buf_len, "%d", inst->speed);
    else if (strcmp(key, "mode") == 0)
        n = snprintf(buf, (size_t)buf_len, "%s", MODE_NAMES[inst->mode]);
    /* No host hierarchy: the shadow UI then opens ui_chain.js. Served-and-
     * EMPTY (0), never -1 -- a failed read means "not known yet". */
    else if (strcmp(key, "ui_hierarchy") == 0) { buf[0] = '\0'; return 0; }
    /* Everything ui_chain.js needs in one read: 1,interval,brightness,speed,mode */
    else if (strcmp(key, "ui_state") == 0)
        n = snprintf(buf, (size_t)buf_len, "1,%d,%d,%d,%d",
                     inst->interval, inst->brightness, inst->speed, inst->mode);
    else if (strcmp(key, "state") == 0)
        n = snprintf(buf, (size_t)buf_len,
                     "{\"interval\":%d,\"brightness\":%d,\"speed\":%d,\"mode\":\"%s\"}",
                     inst->interval, inst->brightness, inst->speed, MODE_NAMES[inst->mode]);
    else if (strcmp(key, "chain_params") == 0)
        n = snprintf(buf, (size_t)buf_len,
            "["
            "{\"key\":\"interval\",\"name\":\"Interval\",\"type\":\"int\",\"min\":10,\"max\":180,\"step\":1,\"unit\":\"s\"},"
            "{\"key\":\"brightness\",\"name\":\"Brightness\",\"type\":\"int\",\"min\":5,\"max\":100,\"step\":1,\"unit\":\"%%\"},"
            "{\"key\":\"speed\",\"name\":\"Speed\",\"type\":\"int\",\"min\":25,\"max\":300,\"step\":5,\"unit\":\"%%\"},"
            "{\"key\":\"mode\",\"name\":\"Mode\",\"type\":\"enum\",\"options\":[\"random\",\"sequential\"]}"
            "]");
    else
        return -1;
    return n >= 0 && n < buf_len ? n : -1;
}

static midi_fx_api_v1_t g_api = {
    .api_version = MIDI_FX_API_VERSION,
    .create_instance = ps_create_instance,
    .destroy_instance = ps_destroy_instance,
    .process_midi = ps_process_midi,
    .tick = ps_tick,
    .set_param = ps_set_param,
    .get_param = ps_get_param,
};

__attribute__((visibility("default")))
midi_fx_api_v1_t *move_midi_fx_init(const host_api_v1_t *host) {
    (void)host;
    return &g_api;
}
