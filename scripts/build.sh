#!/usr/bin/env bash
# Builds every wasm/*.cpp into site/wasm/<name>.js + <name>.wasm
set -euo pipefail
cd "$(dirname "$0")/.."

command -v emcc >/dev/null || { echo "emcc not found. Activate emsdk first."; exit 1; }

WANT="$(tr -d '[:space:]' < .emscripten-version)"
HAVE="$(emcc --version | head -n1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)"
[ "$WANT" = "$HAVE" ] || echo "warning: pinned Emscripten is $WANT but you have $HAVE"

# Every libs/<name>/include directory goes on the include path.
INC=()
for d in libs/*/include; do
  [ -d "$d" ] && INC+=("-I$d")
done

OUT=site/wasm
mkdir -p "$OUT"

for src in wasm/*.cpp; do
  name="$(basename "$src" .cpp)"
  echo "building $name"
  emcc "$src" -o "$OUT/$name.js" \
    -std=c++23 -O2 -Wall -Wextra \
    "${INC[@]}" \
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sWASM_BIGINT=1 \
    -sEXPORT_NAME="create_${name}" \
    -sENVIRONMENT=web,worker,node \
    -sEXPORTED_RUNTIME_METHODS=ccall,cwrap \
    -sALLOW_MEMORY_GROWTH=1
done
echo "done -> $OUT"
