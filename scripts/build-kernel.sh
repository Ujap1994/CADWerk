#!/usr/bin/env bash
# Compiles the ParaWerk kernel facade (native/kernel) against the OCCT WebAssembly libraries
# built by scripts/build-occt.sh and writes the result to vendor/parawerk-kernel/.
set -euo pipefail

OCCT_VERSION="8.0.1"
EMSDK_VERSION="6.0.12"
ROOT="${PARAWERK_BUILD_DIR:-$HOME/.cache/parawerk-build}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OCCT="$ROOT/occt-$OCCT_VERSION-wasm"
OUT="$REPO/vendor/parawerk-kernel"

# shellcheck disable=SC1091
source "$ROOT/emsdk/emsdk_env.sh" >/dev/null 2>&1
[ -d "$OCCT/lib" ] || { echo "OCCT libraries not found in $OCCT; run scripts/build-occt.sh first" >&2; exit 1; }

INCLUDE="$(find "$OCCT/include" -maxdepth 2 -name 'Standard.hxx' -exec dirname {} \; | head -1)"
LIBS=$(find "$OCCT/lib" -name 'libTK*.a' ! -name 'libTKOpenGl*' | sort)
mkdir -p "$OUT"

em++ "$REPO/native/kernel/src/core.cpp" "$REPO/native/kernel/src/bindings.cpp" -o "$OUT/parawerk-kernel.js" \
  -std=c++17 -O3 -fwasm-exceptions \
  -I"$INCLUDE" -DPARAWERK_OCCT_VERSION="\"$OCCT_VERSION\"" \
  -Wl,--start-group $LIBS -Wl,--end-group \
  -lembind \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createParaWerkKernel \
  -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB -sMAXIMUM_MEMORY=4GB \
  -sSTACK_SIZE=8MB \
  -sDYNAMIC_EXECUTION=0 -sEMBIND_AOT=1 \
  -sEXPORTED_RUNTIME_METHODS=wasmMemory \
  --emit-tsd parawerk-kernel.d.ts

# Record exactly what was built, so the binary in the repository is traceable and
# CI can detect C++ changes that were not rebuilt (scripts/verify-kernel.mjs).
node -e '
const fs = require("fs"); const crypto = require("crypto"); const path = require("path");
const [out, repo, occt, emsdk] = process.argv.slice(1);
const hash = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const sources = ["native/kernel/src/core.hpp", "native/kernel/src/core.cpp", "native/kernel/src/bindings.cpp", "scripts/build-kernel.sh"];
fs.writeFileSync(`${out}/manifest.json`, JSON.stringify({
  occt, emscripten: emsdk, built: new Date().toISOString(),
  sources: Object.fromEntries(sources.map((s) => [s, hash(path.join(repo, s))])),
  files: { "parawerk-kernel.js": hash(`${out}/parawerk-kernel.js`), "parawerk-kernel.wasm": hash(`${out}/parawerk-kernel.wasm`) },
}, null, 2) + "\n");
' "$OUT" "$REPO" "$OCCT_VERSION" "$EMSDK_VERSION"
ls -la "$OUT"
