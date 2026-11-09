#!/usr/bin/env bash
# Native build + every test: DSP under ASan/UBSan, real dlopen of the built
# .so, the animations and UI under node, then the Move build + ABI check.
set -euo pipefail
MODULE="$(cd "$(dirname "$0")/.." && pwd)"
bash "$MODULE/scripts/build.sh" native
OUT="$MODULE/build/native"
"${CC:-gcc}" -std=c11 -O1 -g -Wall -Wextra -Werror \
  -fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer \
  -I"$MODULE/third_party/schwung" "$MODULE/tests/test_dsp.c" -o "$OUT/test-dsp" -ldl
"$OUT/test-dsp" "$OUT/dsp.so"
run_node() {
  if command -v node >/dev/null 2>&1; then node "$1"
  elif command -v node.exe >/dev/null 2>&1 && command -v wslpath >/dev/null 2>&1; then node.exe "$(wslpath -w "$1")"
  elif [[ -x "/mnt/c/Program Files/nodejs/node.exe" ]]; then "/mnt/c/Program Files/nodejs/node.exe" "$(wslpath -w "$1")"
  else echo "Node.js is required for the UI test" >&2; exit 1; fi
}
run_node "$MODULE/tests/test_anims.mjs"
run_node "$MODULE/tests/test_ui.mjs"
if command -v "${CROSS_PREFIX:-aarch64-linux-gnu-}gcc" >/dev/null 2>&1; then
  bash "$MODULE/scripts/build.sh" arm64
else
  echo "SKIP: no aarch64 cross compiler; ABI not checked" >&2
fi
