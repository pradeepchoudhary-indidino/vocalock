#!/bin/bash
# Builds libvosk.so for arm64-v8a with 16 KB page alignment.
#
# Derived from vosk-api master's android/lib/build-vosk.sh, cut down to the one
# ABI that needs it: 16 KB pages only exist on 64-bit ARM, so armeabi-v7a keeps
# the released 0.3.47 binary and x86/x86_64 are dropped (emulator-only).
#
# The alignment comes from the final link of libvosk.so, so the static
# dependencies (OpenBLAS, CLAPACK, OpenFST, Kaldi) need no special flags.
set -eux

: "${ANDROID_NDK_HOME:?set ANDROID_NDK_HOME}"

OS_NAME=$(uname -s | tr '[:upper:]' '[:lower:]')
ANDROID_TOOLCHAIN_PATH=$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/${OS_NAME}-x86_64
WORKDIR_BASE=$(pwd)/build
# Absolute, resolved once: the later stages cd around, so a relative path here
# resolves against whatever directory the previous stage happened to leave us in.
VOSK_SRC=$(cd "$(dirname "$0")/../../src" && pwd)
OPENFST_VERSION=1.8.0
JOBS=$(sysctl -n hw.ncpu)

# GNU tools ahead of the macOS ones: OpenFST's autoreconf needs GNU libtoolize,
# and OpenBLAS needs a make newer than the 3.81 macOS ships.
export PATH="/opt/homebrew/opt/make/libexec/gnubin:/opt/homebrew/opt/libtool/libexec/gnubin:$ANDROID_TOOLCHAIN_PATH/bin:/opt/homebrew/bin:$PATH"

arch=arm64-v8a
BLAS_ARCH=ARMV8
HOST=aarch64-linux-android
AR=llvm-ar
RANLIB=llvm-ranlib
# API 26, not upstream's 21, for two reasons: it matches the app's minSdk, and
# bionic only exports stdin/stdout/stderr as real symbols from API 23. CLAPACK's
# libf2c is compiled outside the Android sysroot and emits references to them,
# which fail to link at API 21.
CC=aarch64-linux-android26-clang
CXX=aarch64-linux-android26-clang++
ARCHFLAGS=""
PAGESIZE_LDFLAGS="-Wl,-z,common-page-size=4096 -Wl,-z,max-page-size=16384"

WORKDIR=${WORKDIR_BASE}/kaldi_${arch}
mkdir -p "$WORKDIR/local/lib"

# ---- OpenBLAS ----
if [ ! -f "$WORKDIR/local/lib/libopenblas.a" ]; then
  cd "$WORKDIR"
  [ -d OpenBLAS ] || git clone -b v0.3.20 --depth 1 --single-branch https://github.com/xianyi/OpenBLAS
  # NO_SHARED: we only static-link into libvosk.so, and OpenBLAS 0.3.20's
  # shared-link step runs a linktest.c full of implicit declarations, which
  # NDK 28's clang rejects outright.
  # LEGACY_C: same era of C in the sources themselves.
  LEGACY_C="-Wno-implicit-function-declaration -Wno-int-conversion -Wno-implicit-int"
  make -C OpenBLAS TARGET=$BLAS_ARCH ONLY_CBLAS=1 NO_SHARED=1 \
      AR=$AR CC=$CC HOSTCC=cc ARM_SOFTFP_ABI=1 USE_THREAD=0 NUM_THREADS=1 \
      COMMON_OPT="-O2 $LEGACY_C" -j "$JOBS"
  make -C OpenBLAS install NO_SHARED=1 PREFIX="$WORKDIR/local"
fi

# ---- CLAPACK ----
if [ ! -f "$WORKDIR/local/lib/liblapack.a" ]; then
  cd "$WORKDIR"
  [ -d clapack ] || git clone -b v3.2.1 --depth 1 --single-branch https://github.com/alphacep/clapack
  mkdir -p clapack/BUILD && cd clapack/BUILD
  cmake -DCMAKE_C_FLAGS="$ARCHFLAGS -Wno-implicit-function-declaration -Wno-int-conversion -Wno-implicit-int -Wno-return-type" -DCMAKE_C_COMPILER_TARGET=$HOST \
      -DCMAKE_C_COMPILER=$CC -DCMAKE_SYSTEM_NAME=Generic \
      -DCMAKE_AR="$ANDROID_TOOLCHAIN_PATH/bin/$AR" \
      -DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY \
      -DCMAKE_CROSSCOMPILING=True \
      -DCMAKE_POLICY_VERSION_MINIMUM=3.5 ..
  make -j "$JOBS" -C F2CLIBS/libf2c
  make -j "$JOBS" -C BLAS/SRC
  make -j "$JOBS" -C SRC
  find . -name "*.a" -exec cp {} "$WORKDIR/local/lib/" \;
  # f2c's main.o defines main() and calls the Fortran MAIN__ stub. Pulled into a
  # shared library it leaves MAIN__ undefined, so drop it — nothing in Kaldi
  # wants an entry point from f2c.
  llvm-ar d "$WORKDIR/local/lib/libf2c.a" main.c.obj main.obj main.o 2>/dev/null || true
  llvm-ranlib "$WORKDIR/local/lib/libf2c.a"
fi

# ---- OpenFST ----
if [ ! -f "$WORKDIR/local/lib/libfst.a" ]; then
  cd "$WORKDIR"
  [ -d openfst ] || git clone --depth 1 https://github.com/alphacep/openfst
  cd openfst
  autoreconf -i
  CXX=$CXX CXXFLAGS="$ARCHFLAGS -O3 -DFST_NO_DYNAMIC_LINKING" ./configure --prefix="${WORKDIR}/local" \
      --enable-shared --enable-static --with-pic --disable-bin \
      --enable-lookahead-fsts --enable-ngram-fsts --host=$HOST --build=x86-linux-gnu
  make -j "$JOBS"
  make install
fi

# ---- Kaldi ----
if [ ! -f "$WORKDIR/kaldi/src/online2/kaldi-online2.a" ]; then
  cd "$WORKDIR"
  [ -d kaldi ] || git clone -b vosk-android --depth 1 --single-branch https://github.com/alphacep/kaldi
  cd "$WORKDIR/kaldi/src"
  # Static only, with -fPIC added by hand. Upstream configures --shared, but the
  # only consumer is libvosk.so, which links the .a archives (USE_SHARED=0) —
  # and Kaldi's own .so link drags f2c's main()/MAIN__ in and fails. Skipping it
  # removes a whole failure surface and builds less.
  CXX=$CXX AR=$AR RANLIB=$RANLIB CXXFLAGS="$ARCHFLAGS -O3 -fPIC -DFST_NO_DYNAMIC_LINKING" ./configure --use-cuda=no \
      --mathlib=OPENBLAS_CLAPACK \
      --android-incdir="${ANDROID_TOOLCHAIN_PATH}/sysroot/usr/include" \
      --host=$HOST --openblas-root="${WORKDIR}/local" \
      --fst-root="${WORKDIR}/local" --fst-version=${OPENFST_VERSION}
  # This fork's configure writes KALDI_FLAVOR := dynamic whatever it is asked
  # for, and the dynamic path links every kaldi-*.so. Nothing consumes those:
  # libvosk.so links the .a archives. Force the flavor so they are not built.
  sed -i.bak 's/^KALDI_FLAVOR := dynamic/KALDI_FLAVOR := static/' kaldi.mk
  grep -q '^KALDI_FLAVOR := static' kaldi.mk || { echo "failed to force static kaldi"; exit 1; }

  make -j "$JOBS" depend
  make -j "$JOBS" online2 rnnlm
fi

# ---- libvosk.so (this link is where the 16 KB alignment is applied) ----
mkdir -p "$WORKDIR/vosk"
make -j "$JOBS" -C "$VOSK_SRC" \
    OUTDIR="$WORKDIR/vosk" \
    KALDI_ROOT="${WORKDIR}/kaldi" \
    OPENFST_ROOT="${WORKDIR}/local" \
    OPENBLAS_ROOT="${WORKDIR}/local" \
    CXX=$CXX \
    EXTRA_LDFLAGS="-llog -static-libstdc++ -Wl,-soname,libvosk.so ${PAGESIZE_LDFLAGS}"

echo "BUILT: $WORKDIR/vosk/libvosk.so"
