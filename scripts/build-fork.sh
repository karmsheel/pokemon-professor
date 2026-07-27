#!/usr/bin/env bash
# Build the Pokemon Professor headless mGBA fork into vendor/mgba/build/mGBA.exe
#
# Reproducible build for the forked mGBA (branch pokemon-professor-fork) with the
# compile-in agent bridge + --agent-headless / --agent-bridge flags.
#
# Works both locally (MSYS2 ucrt64) and in CI (GitHub Windows runner via
# msys2/setup-msys2). Callers should run this from a Bash shell with the MSYS2
# ucrt64 environment on PATH (the build needs ucrt64 DLLs at runtime too, e.g.
# when the Studio spawns the fork — set PATH=/c/msys64/ucrt64/bin:$PATH).
#
# Usage:
#   scripts/build-fork.sh            # configure + build
#   scripts/build-fork.sh --clean    # wipe build dir first
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORK_DIR="$ROOT/vendor/mgba"
BUILD_DIR="$FORK_DIR/build"

if [ ! -d "$FORK_DIR" ]; then
  echo "[build-fork] ERROR: fork dir not found at $FORK_DIR (ROOT=$ROOT)" >&2
  exit 1
fi

# msys2's cmake can't resolve the /c/Users/... POSIX form the script builds;
# convert source/build paths to native Windows form when cygpath is available.
if command -v cygpath >/dev/null 2>&1; then
  FORK_DIR="$(cygpath -w "$FORK_DIR")"
  BUILD_DIR="$(cygpath -w "$BUILD_DIR")"
fi

# --- Locate MSYS2 ucrt64 toolchain -----------------------------------------
# GitHub Actions (msys2/setup-msys2) sets MSYSTEM + RUNNER_*, and msys2 bin is
# on PATH. Locally it's typically /c/msys64/ucrt64/bin. We just need cmake,
# ninja, gcc on PATH; detect a sensible MSYS2 prefix if present.
if [ -z "${MSYS2_PREFIX:-}" ]; then
  for cand in /c/msys64/ucrt64 /ucrt64; do
    if [ -x "$cand/bin/gcc.exe" ] || [ -x "$cand/bin/gcc" ]; then
      MSYS2_PREFIX="$cand"
      break
    fi
  done
fi
if [ -n "${MSYS2_PREFIX:-}" ]; then
  export PATH="$MSYS2_PREFIX/bin:$PATH"
  echo "[build-fork] using MSYS2 ucrt64 prefix: $MSYS2_PREFIX"
fi

# --- Guard: a running mGBA.exe holds the output file and breaks the link ----
if command -v taskkill >/dev/null 2>&1; then
  taskkill //f //im mgba.exe >/dev/null 2>&1 || true
  sleep 1
fi

# --- Optional clean ---------------------------------------------------------
if [ "${1:-}" = "--clean" ]; then
  echo "[build-fork] cleaning $BUILD_DIR"
  rm -rf "$BUILD_DIR"
fi

mkdir -p "$BUILD_DIR"

echo "[build-fork] configuring (cmake)..."
cmake -S "$FORK_DIR" -B "$BUILD_DIR" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_QT=ON \
  -DBUILD_SDL=OFF \
  -DBUILD_TEST=OFF \
  -DUSE_PNG=ON \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DBUILD_STATIC=ON \
  -DBUILD_SHARED=OFF \
  -DENABLE_SCRIPTING=OFF

echo "[build-fork] building (ninja)..."
# Retry once: ninja sometimes reports "Linking CXX executable mGBA.exe" but the
# exe is missing due to a stale handle race; a second pass reliably links.
ninja -C "$BUILD_DIR" || {
  echo "[build-fork] first ninja pass failed/raced; retrying once..."
  ninja -C "$BUILD_DIR"
}

if [ ! -f "$BUILD_DIR/mGBA.exe" ]; then
  echo "[build-fork] ERROR: mGBA.exe not produced" >&2
  exit 1
fi

echo "[build-fork] OK -> $BUILD_DIR/mGBA.exe"
ls -la "$BUILD_DIR/mGBA.exe"
