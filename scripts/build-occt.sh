#!/usr/bin/env bash
# Builds Open CASCADE Technology as static WebAssembly libraries for the ParaWerk kernel.
#
# Usage: scripts/build-occt.sh
# Needs: git, curl, cmake, ninja. Downloads Emscripten and the OCCT sources into
# $PARAWERK_BUILD_DIR (default ~/.cache/parawerk-build); the build takes 30-60 minutes once.
set -euo pipefail

OCCT_VERSION="8.0.1"
OCCT_TAG="V8_0_1"
EMSDK_VERSION="6.0.12"
ROOT="${PARAWERK_BUILD_DIR:-$HOME/.cache/parawerk-build}"
JOBS="${JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}"

mkdir -p "$ROOT"
cd "$ROOT"

if [ ! -d emsdk ]; then
  git clone --depth 1 https://github.com/emscripten-core/emsdk.git
fi
./emsdk/emsdk install "$EMSDK_VERSION" >/dev/null
./emsdk/emsdk activate "$EMSDK_VERSION" >/dev/null
# shellcheck disable=SC1091
source ./emsdk/emsdk_env.sh >/dev/null 2>&1

SRC="$ROOT/occt-$OCCT_VERSION"
if [ ! -d "$SRC" ]; then
  curl -sL -o occt.tar.gz "https://github.com/Open-Cascade-SAS/OCCT/archive/refs/tags/$OCCT_TAG.tar.gz"
  mkdir -p "$SRC"
  tar -xzf occt.tar.gz -C "$SRC" --strip-components=1
  rm occt.tar.gz
fi

# Emscripten: OCCT would add -fexceptions (JavaScript exception model) and enable signal
# conversion with setjmp/longjmp. Combined with native WebAssembly exceptions this produces
# invalid WebAssembly, and WebAssembly has no signals to convert, so both are disabled.
FLAGS_FILE="$SRC/adm/cmake/occt_defs_flags.cmake"
if ! grep -q "PARAWERK_PATCHED" "$FLAGS_FILE"; then
  perl -0pi -e 's/  set \(CMAKE_CXX_FLAGS "\$\{CMAKE_CXX_FLAGS\} -fexceptions"\)\n  set \(CMAKE_C_FLAGS   "\$\{CMAKE_C_FLAGS\}   -fexceptions"\)/  if (NOT EMSCRIPTEN) # PARAWERK_PATCHED\n  set (CMAKE_CXX_FLAGS "\$\{CMAKE_CXX_FLAGS\} -fexceptions")\n  set (CMAKE_C_FLAGS   "\$\{CMAKE_C_FLAGS\}   -fexceptions")\n  endif()/' "$FLAGS_FILE"
  perl -0pi -e 's/  add_definitions\(-DOCC_CONVERT_SIGNALS\)/  if (NOT EMSCRIPTEN)\n    add_definitions(-DOCC_CONVERT_SIGNALS)\n  endif()/' "$FLAGS_FILE"
fi
grep -q "PARAWERK_PATCHED" "$FLAGS_FILE" || { echo "Could not patch $FLAGS_FILE" >&2; exit 1; }

BUILD="$ROOT/occt-$OCCT_VERSION-build"
INSTALL="$ROOT/occt-$OCCT_VERSION-wasm"
# Native WebAssembly exceptions: OCCT reports failures with C++ exceptions.
FLAGS="-fwasm-exceptions -O3"

emcmake cmake -S "$SRC" -B "$BUILD" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$INSTALL" \
  -DBUILD_LIBRARY_TYPE=Static \
  -DBUILD_CPP_STANDARD=C++17 \
  -DBUILD_MODULE_FoundationClasses=ON \
  -DBUILD_MODULE_ModelingData=ON \
  -DBUILD_MODULE_ModelingAlgorithms=ON \
  -DBUILD_MODULE_Visualization=ON \
  -DBUILD_MODULE_ApplicationFramework=ON \
  -DBUILD_MODULE_DataExchange=ON \
  -DBUILD_MODULE_Draw=OFF \
  -DUSE_OPENGL=OFF -DUSE_GLES2=OFF -DUSE_FREETYPE=OFF -DUSE_TK=OFF -DUSE_XLIB=OFF \
  -DUSE_TBB=OFF -DUSE_VTK=OFF -DUSE_RAPIDJSON=OFF -DUSE_DRACO=OFF -DUSE_FREEIMAGE=OFF \
  -DUSE_FFMPEG=OFF -DUSE_OPENVR=OFF \
  -DBUILD_DOC_Overview=OFF \
  -DCMAKE_C_FLAGS="$FLAGS" \
  -DCMAKE_CXX_FLAGS="$FLAGS"

cmake --build "$BUILD" -j "$JOBS"
cmake --install "$BUILD" >/dev/null
echo "OCCT $OCCT_VERSION installed to $INSTALL"
