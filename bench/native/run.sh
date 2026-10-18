#!/usr/bin/env bash
# Compiles bench/native/bench.cpp with the kernel core against native OCCT and runs it.
set -euo pipefail
ROOT="${PARAWERK_BUILD_DIR:-$HOME/.cache/parawerk-build}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OCCT="$ROOT/occt-8.0.1-native"
[ -d "$OCCT/lib" ] || { echo "Run bench/native/build-occt-native.sh first" >&2; exit 1; }
INCLUDE="$(find "$OCCT/include" -maxdepth 2 -name 'Standard.hxx' -exec dirname {} \; | head -1)"
LIBS=$(find "$OCCT/lib" -name 'libTK*.a' ! -name 'libTKOpenGl*' | sort)
OUT="$ROOT/native-bench"
mkdir -p "$OUT" "$REPO/bench/results"
# The same optimization level as the WebAssembly build (-O3).
c++ -std=c++17 -O3 -DNDEBUG -I"$INCLUDE" "$REPO/native/kernel/src/core.cpp" "$REPO/bench/native/bench.cpp" \
  $LIBS $LIBS -framework CoreFoundation -framework AppKit -framework IOKit -o "$OUT/kernel-bench" 2>&1 | grep -v "duplicate libraries" || true
"$OUT/kernel-bench" "$REPO/bench/results/kernel-native-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m).json"
