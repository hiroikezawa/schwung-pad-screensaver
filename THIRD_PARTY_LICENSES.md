# Third-party code in PAD SCREENSAVER

Everything the module ships is MIT-licensed, and all of it is original code
written for this module (Hiro Ikezawa) except the item below. `dsp.so` needs
only `libc`; `scripts/check_abi.py` checks the build.

## Schwung — MIT

`third_party/schwung/host/plugin_api_v1.h` and `midi_fx_api_v1.h` are
Schwung's plugin API headers (Copyright 2025-2026 Charles Vestal, MIT),
vendored unmodified; the licence is in `third_party/schwung/LICENSE`.
The pad colour table in `palette.mjs` is the palette documented in Schwung's
`src/shared/constants.mjs` (same licence).
