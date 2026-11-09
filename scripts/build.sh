#!/usr/bin/env bash
# Build PAD SCREENSAVER.
#   scripts/build.sh native   desktop dsp.so for the tests (build/native)
#   scripts/build.sh arm64    Move dsp.so + install tarball (dist/)
set -euo pipefail
ID=pad-screensaver
MODULE="$(cd "$(dirname "$0")/.." && pwd)"
# Schwung's plugin API headers ship in third_party/schwung (MIT), unmodified.
API="$MODULE/third_party/schwung"
case "${1:-arm64}" in
  native) CC="${CC:-gcc}"; OUT="$MODULE/build/native" ;;
  arm64)  CC="${CROSS_PREFIX:-aarch64-linux-gnu-}gcc"; OUT="$MODULE/dist/$ID" ;;
  *) echo "Usage: $0 [native|arm64]" >&2; exit 2 ;;
esac
rm -rf "$OUT"
mkdir -p "$OUT"
# -std=c11: GCC 15 defaults to C23, whose headers bind GLIBC_2.38 symbols.
"$CC" -std=c11 -O2 -Wall -Wextra -Werror -fPIC -shared -Wl,-z,defs \
  -fvisibility=hidden -I"$API" "$MODULE/dsp/pad_screensaver.c" -o "$OUT/dsp.so"
if [[ "${1:-arm64}" == arm64 ]]; then
  python3 "$MODULE/scripts/check_abi.py" "$OUT/dsp.so"
  for f in module.json ui_chain.js ui_core.mjs anims.mjs palette.mjs help.json README.md LICENSE THIRD_PARTY_LICENSES.md; do
    cp "$MODULE/$f" "$OUT/"
  done
  tar -czf "$MODULE/dist/$ID-module.tar.gz" -C "$MODULE/dist" "$ID"
  echo "Package: $MODULE/dist/$ID-module.tar.gz"
fi
file "$OUT/dsp.so"
