/* dlopen the built dsp.so and check it as the chain host would use it:
 * passthrough of every MIDI shape, no generated output, params, state. */
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "host/midi_fx_api_v1.h"
#include "host/plugin_api_v1.h"

static int failures = 0;
#define CHECK(c) do { if (!(c)) { fprintf(stderr, "FAIL %s:%d %s\n", __FILE__, __LINE__, #c); failures++; } } while (0)

static midi_fx_api_v1_t *api;

static void get(void *inst, const char *key, char *buf, int len) {
    int n = api->get_param(inst, key, buf, len);
    if (n < 0) buf[0] = '\0';
}

int main(int argc, char **argv) {
    if (argc < 2) { fprintf(stderr, "usage: %s dsp.so\n", argv[0]); return 2; }
    void *so = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
    if (!so) { fprintf(stderr, "dlopen: %s\n", dlerror()); return 1; }
    midi_fx_api_v1_t *(*init)(const host_api_v1_t *) =
        (midi_fx_api_v1_t *(*)(const host_api_v1_t *))dlsym(so, MIDI_FX_INIT_SYMBOL);
    CHECK(init != NULL);
    if (!init) return 1;
    host_api_v1_t host;
    memset(&host, 0, sizeof(host));
    api = init(&host);
    CHECK(api && api->api_version == MIDI_FX_API_VERSION);

    void *inst = api->create_instance("/nonexistent", NULL);
    CHECK(inst != NULL);
    char buf[512];
    uint8_t out[MIDI_FX_MAX_OUT_MSGS][3];
    int lens[MIDI_FX_MAX_OUT_MSGS];

    /* passthrough: every status byte, 1..3 bytes */
    for (int st = 0x80; st <= 0xFF; st++) {
        int len = st >= 0xF8 ? 1 : (st & 0xF0) == 0xC0 || (st & 0xF0) == 0xD0 ? 2 : 3;
        uint8_t in[3] = { (uint8_t)st, 60, 100 };
        memset(out, 0xEE, sizeof(out));
        int n = api->process_midi(inst, in, len, out, lens, MIDI_FX_MAX_OUT_MSGS);
        CHECK(n == 1);
        CHECK(lens[0] == len);
        CHECK(memcmp(out[0], in, (size_t)len) == 0);
    }
    /* nothing generated, ever */
    for (int i = 0; i < 10000; i++)
        CHECK(api->tick(inst, 128, 44100, out, lens, MIDI_FX_MAX_OUT_MSGS) == 0);
    CHECK(api->process_midi(inst, NULL, 0, out, lens, 4) == 0);

    /* defaults */
    get(inst, "ui_state", buf, sizeof(buf));
    CHECK(strcmp(buf, "1,30,70,100,0") == 0);
    CHECK(api->get_param(inst, "ui_hierarchy", buf, sizeof(buf)) == 0 && buf[0] == '\0');
    CHECK(api->get_param(inst, "nope", buf, sizeof(buf)) == -1);
    get(inst, "chain_params", buf, sizeof(buf));
    CHECK(strstr(buf, "\"interval\"") && strstr(buf, "\"sequential\""));

    /* params clamp */
    api->set_param(inst, "interval", "5");     get(inst, "interval", buf, sizeof(buf)); CHECK(strcmp(buf, "10") == 0);
    api->set_param(inst, "interval", "999");   get(inst, "interval", buf, sizeof(buf)); CHECK(strcmp(buf, "180") == 0);
    api->set_param(inst, "interval", "45.000000"); get(inst, "interval", buf, sizeof(buf)); CHECK(strcmp(buf, "45") == 0);
    api->set_param(inst, "interval", "abc");   get(inst, "interval", buf, sizeof(buf)); CHECK(strcmp(buf, "45") == 0);
    api->set_param(inst, "brightness", "0");   get(inst, "brightness", buf, sizeof(buf)); CHECK(strcmp(buf, "5") == 0);
    api->set_param(inst, "speed", "1000");     get(inst, "speed", buf, sizeof(buf)); CHECK(strcmp(buf, "300") == 0);
    api->set_param(inst, "mode", "sequential"); get(inst, "mode", buf, sizeof(buf)); CHECK(strcmp(buf, "sequential") == 0);
    api->set_param(inst, "mode", "bogus");     get(inst, "mode", buf, sizeof(buf)); CHECK(strcmp(buf, "sequential") == 0);
    api->set_param(inst, "mode", "0");         get(inst, "mode", buf, sizeof(buf)); CHECK(strcmp(buf, "random") == 0);

    /* state round trip into a fresh instance */
    api->set_param(inst, "interval", "120");
    api->set_param(inst, "brightness", "33");
    api->set_param(inst, "speed", "150");
    api->set_param(inst, "mode", "sequential");
    char state[256];
    get(inst, "state", state, sizeof(state));
    void *b = api->create_instance("/nonexistent", NULL);
    api->set_param(b, "state", state);
    get(b, "ui_state", buf, sizeof(buf));
    CHECK(strcmp(buf, "1,120,33,150,1") == 0);
    /* garbage state leaves values alone */
    api->set_param(b, "state", "{\"interval\":\"x\",\"mode\":\"??\"");
    get(b, "ui_state", buf, sizeof(buf));
    CHECK(strcmp(buf, "1,120,33,150,1") == 0);
    /* a too-small buffer is refused, not truncated */
    CHECK(api->get_param(b, "state", buf, 8) == -1);

    api->destroy_instance(b);
    api->destroy_instance(inst);
    dlclose(so);
    if (failures) { fprintf(stderr, "%d failure(s)\n", failures); return 1; }
    printf("test_dsp: OK\n");
    return 0;
}
