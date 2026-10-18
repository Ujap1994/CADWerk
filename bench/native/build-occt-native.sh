#!/usr/bin/env bash
# Builds OCCT natively (same version and modules as the WebAssembly kernel) for the
# native-vs-WebAssembly comparison benchmark. Not needed for building ParaWerk.
set -euo pipefail
OCCT_VERSION="8.0.1"
ROOT="${PARAWERK_BUILD_DIR:-$HOME/.cache/parawerk-build}"
SRC="$ROOT/occt-$OCCT_VERSION"
BUILD="$ROOT/occt-$OCCT_VERSION-native-build"
INSTALL="$ROOT/occt-$OCCT_VERSION-native"
JOBS="${JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}"
[ -d "$SRC" ] || { echo "Run scripts/build-occt.sh first (it downloads the sources)" >&2; exit 1; }
cmake -S "$SRC" -B "$BUILD" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$INSTALL" -DBUILD_LIBRARY_TYPE=Static \
  -DBUILD_MODULE_Draw=OFF -DBUILD_DOC_Overview=OFF \
  -DUSE_OPENGL=OFF -DUSE_GLES2=OFF -DUSE_FREETYPE=OFF -DUSE_TK=OFF -DUSE_XLIB=OFF -DUSE_TBB=OFF \
  -DUSE_VTK=OFF -DUSE_RAPIDJSON=OFF -DUSE_DRACO=OFF -DUSE_FREEIMAGE=OFF -DUSE_FFMPEG=OFF -DUSE_OPENVR=OFF
cmake --build "$BUILD" -j "$JOBS"
cmake --install "$BUILD" >/dev/null
echo "Native OCCT installed to $INSTALL"
