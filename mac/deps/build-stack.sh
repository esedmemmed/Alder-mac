#!/bin/bash
# Builds the mpv + FFmpeg stack for macOS 11.0 x86_64 from source, every dep static, one recipe per dep.
# Runs on the macOS CI runner (bash 3.2: no associative arrays, no mapfile; shasum, not sha256sum).
# Subcommands:
#   list               deps in build order with versions and what each needs
#   key <dep>          cache key: sha256 of the dep's pins lines, its recipe (declare -f), the keys of the deps
#                      it needs, and CACHE_EPOCH, so a fix rebuilds that dep and its dependents only
#   build <dep>        fetch, verify, build, DESTDIR-install into .stack/pkg/<dep> (what CI caches)
#   install <dep>      copy .stack/pkg/<dep> onto / (the fixed prefixes under $HOME)
#   pinhash            first 12 hex of sha256 over versions.env + this file; the release tag is stack-<pinhash>
#   sources            fetch every source tree (nasm included, GPL) into .stack/out/sources-<pinhash>.tar.gz
#   package            .stack/out/stack-<pinhash>.tar.gz (the prefix) and mpv-cli-<pinhash>.tar.gz
# Fixed prefixes: $HOME/stack (the .pc files hold it; T6 extracts there), $HOME/tools (nasm, meson venv; never shipped).
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
# shellcheck source=/dev/null
. "$HERE/versions.env"

# Bump to invalidate every cached dep at once.
CACHE_EPOCH=1
DEPS="nasm meson dav1d ffmpeg fribidi freetype harfbuzz libass libplacebo luajit mpv"
STACK_PREFIX="$HOME/stack"
TOOLS_PREFIX="$HOME/tools"
WORK="$ROOT/.stack"
JOBS=$(sysctl -n hw.ncpu 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)

die() { echo "build-stack: $*" >&2; exit 1; }

needs() {
  case "$1" in
    nasm | meson | luajit) echo "" ;;
    dav1d) echo "nasm meson" ;;
    ffmpeg) echo "nasm dav1d" ;;
    fribidi | freetype | libplacebo) echo "meson" ;;
    harfbuzz) echo "meson freetype" ;;
    libass) echo "nasm meson fribidi harfbuzz freetype" ;;
    mpv) echo "meson ffmpeg libass libplacebo luajit" ;;
    *) die "unknown dep: $1" ;;
  esac
}

upper() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]'; }

# Value of ${DEP}_<field> from versions.env (indirect expansion works in bash 3.2).
pin() {
  local var
  var="$(upper "$1")_$2"
  printf '%s' "${!var}"
}

# One environment for every recipe: deployment target, a pkg-config that sees only our prefix, our tools first.
common_env() {
  export MACOSX_DEPLOYMENT_TARGET=11.0
  export PKG_CONFIG_LIBDIR="$STACK_PREFIX/lib/pkgconfig"
  unset PKG_CONFIG_PATH
  export CFLAGS="-mmacosx-version-min=11.0"
  export CXXFLAGS="-mmacosx-version-min=11.0"
  export OBJCFLAGS="-mmacosx-version-min=11.0"
  export LDFLAGS="-mmacosx-version-min=11.0"
  export PATH="$TOOLS_PREFIX/bin:$TOOLS_PREFIX/venv/bin:$PATH"
}

ensure_tools() {
  mkdir -p "$TOOLS_PREFIX/bin" "$STACK_PREFIX"
  if ! command -v pkg-config >/dev/null 2>&1; then
    command -v pkgconf >/dev/null 2>&1 || die "neither pkg-config nor pkgconf on PATH"
    ln -sf "$(command -v pkgconf)" "$TOOLS_PREFIX/bin/pkg-config"
  fi
  command -v ninja >/dev/null 2>&1 || die "ninja not on PATH"
  command -v python3 >/dev/null 2>&1 || die "python3 not on PATH"
}

# Download <dep>'s tarball into .stack/src and check its sha256.
fetch_tarball() {
  local dep=$1 url sha file
  url=$(pin "$dep" URL)
  sha=$(pin "$dep" SHA256)
  file="$WORK/src/$(basename "$url")"
  mkdir -p "$WORK/src"
  if [ ! -f "$file" ]; then
    curl -fsSL --retry 3 -o "$file.part" "$url"
    mv "$file.part" "$file"
  fi
  echo "$sha  $file" | shasum -a 256 -c - >&2 || die "sha256 mismatch for $dep ($file)"
  echo "$file"
}

# libplacebo: clone at the tag with the submodules it needs (GitHub's archive omits them), check the commit, tar it.
fetch_libplacebo() {
  local tag commit file tmp
  tag=$(pin libplacebo TAG)
  commit=$(pin libplacebo COMMIT)
  file="$WORK/src/libplacebo-$tag-with-submodules.tar.gz"
  mkdir -p "$WORK/src"
  if [ ! -f "$file" ]; then
    tmp="$WORK/src/libplacebo-clone"
    rm -rf "$tmp"
    git clone -q --depth 1 --branch "$tag" "$(pin libplacebo URL)" "$tmp"
    [ "$(git -C "$tmp" rev-parse HEAD)" = "$commit" ] || die "libplacebo $tag is not commit $commit"
    git -C "$tmp" submodule update -q --init --depth 1 -- \
      3rdparty/glad 3rdparty/jinja 3rdparty/markupsafe 3rdparty/fast_float 3rdparty/Vulkan-Headers
    find "$tmp" -name .git -prune -exec rm -rf {} +
    tar -czf "$file.part" -C "$tmp" .
    mv "$file.part" "$file"
    rm -rf "$tmp"
  fi
  echo "$file"
}

# Source archive of <dep> (fetched and verified), printed as a path.
fetch_src() {
  case "$1" in
    meson) return 0 ;;
    libplacebo) fetch_libplacebo ;;
    *) fetch_tarball "$1" ;;
  esac
}

# Fresh source tree at $S for <dep>.
extract_src() {
  local dep=$1 archive
  archive=$(fetch_src "$dep")
  rm -rf "$WORK/build/$dep"
  mkdir -p "$S"
  if [ "$dep" = libplacebo ]; then
    tar -xzf "$archive" -C "$S"
  else
    tar -xf "$archive" -C "$S" --strip-components=1
  fi
}

# meson setup + compile + DESTDIR install into $PKG; extra meson options in "$@". wrap-mode nodownload: no network.
meson_build() {
  meson setup "$B" "$S" --prefix="$STACK_PREFIX" --libdir=lib --buildtype=release --wrap-mode=nodownload "$@"
  meson compile -C "$B" -j "$JOBS"
  meson install -C "$B" --destdir "$PKG"
}

meson_static() { meson_build -Ddefault_library=static "$@"; }

# Libtool .la files hold build paths and are not needed with static libs.
drop_la() { find "$PKG" -name '*.la' -exec rm -f {} +; }

# Fail unless config.h-style file $1 has the line $2.
assert_line() {
  grep -q "^$2\$" "$1" || die "$1 lacks '$2'"
  echo "assert ok: $2"
}

# Target all, not nasm ndisasm: all runs the dirs rule that makes asm/, stdlib/ etc. in an out-of-tree build.
recipe_nasm() {
  mkdir -p "$B"
  (cd "$B" && "$S/configure" --prefix="$TOOLS_PREFIX" && make -j "$JOBS" all \
    && install -d "$PKG$TOOLS_PREFIX/bin" && install -m 755 nasm ndisasm "$PKG$TOOLS_PREFIX/bin/")
}

# Not cached: a venv holds absolute paths, and installing from a hashed wheel takes seconds.
recipe_meson() {
  local req="$WORK/meson-requirements.txt"
  mkdir -p "$WORK"
  printf 'meson==%s --hash=sha256:%s\n' "$MESON_VERSION" "$MESON_WHEEL_SHA256" >"$req"
  python3 -m venv "$TOOLS_PREFIX/venv"
  "$TOOLS_PREFIX/venv/bin/python" -m pip install --quiet --require-hashes -r "$req"
  "$TOOLS_PREFIX/venv/bin/meson" --version
}

recipe_dav1d() {
  meson_static -Denable_tools=false -Denable_tests=false -Denable_examples=false
}

recipe_ffmpeg() {
  mkdir -p "$B"
  (cd "$B" && "$S/configure" --prefix="$STACK_PREFIX" --arch=x86_64 --target-os=darwin \
    --enable-gpl --disable-shared --enable-static --enable-pic --disable-debug \
    --disable-programs --disable-doc --disable-encoders --enable-libdav1d \
    --pkg-config-flags=--static \
    --extra-cflags=-mmacosx-version-min=11.0 --extra-ldflags=-mmacosx-version-min=11.0)
  # videotoolbox and securetransport are autodetected, so assert what configure decided.
  assert_line "$B/config.h" '#define CONFIG_GPL 1'
  assert_line "$B/config.h" '#define CONFIG_NONFREE 0'
  assert_line "$B/config.h" '#define CONFIG_LIBDAV1D 1'
  assert_line "$B/config.h" '#define CONFIG_VIDEOTOOLBOX 1'
  assert_line "$B/config.h" '#define CONFIG_SECURETRANSPORT 1'
  make -C "$B" -j "$JOBS"
  make -C "$B" install DESTDIR="$PKG"
}

recipe_fribidi() {
  meson_static -Ddocs=false -Dbin=false -Dtests=false
}

recipe_freetype() {
  meson_static -Dbrotli=disabled -Dbzip2=disabled -Dharfbuzz=disabled -Dpng=disabled \
    -Dzlib=disabled -Dtests=disabled
}

# Shaping only (libass needs hb core); the experimental raster/vector/gpu/subset parts stay off.
recipe_harfbuzz() {
  meson_static -Dglib=disabled -Dgobject=disabled -Dcairo=disabled -Dchafa=disabled -Dpng=disabled \
    -Dzlib=disabled -Dicu=disabled -Dfreetype=enabled -Dcoretext=disabled \
    -Draster=disabled -Dvector=disabled -Dgpu=disabled -Dsubset=disabled \
    -Dtests=disabled -Dintrospection=disabled -Ddocs=disabled -Dutilities=disabled \
    -Dgpu_demo=disabled -Dbenchmark=disabled
}

recipe_libass() {
  mkdir -p "$B"
  (cd "$B" && "$S/configure" --prefix="$STACK_PREFIX" --disable-shared --enable-static \
    --disable-fontconfig --enable-coretext)
  make -C "$B" -j "$JOBS"
  make -C "$B" install DESTDIR="$PKG"
  drop_la
}

# OpenGL only: no vulkan, shaderc, glslang, lcms, d3d11, libdovi, unwind. mpv finds it by pkg-config.
recipe_libplacebo() {
  meson_static -Dopengl=enabled -Dvulkan=disabled -Dshaderc=disabled -Dglslang=disabled \
    -Dlcms=disabled -Dd3d11=disabled -Dlibdovi=disabled -Dunwind=disabled \
    -Ddemos=false -Dtests=false
}

# make with BUILDMODE=static builds only libluajit-5.1.a; MACOSX_DEPLOYMENT_TARGET (exported) is mandatory there.
recipe_luajit() {
  make -C "$S" -j "$JOBS" BUILDMODE=static PREFIX="$STACK_PREFIX"
  make -C "$S" install BUILDMODE=static PREFIX="$STACK_PREFIX" DESTDIR="$PKG"
}

# libmpv is the one dylib (default_library=shared); the cplayer links libmpv's objects, so mpv is one binary.
# -lc++: static libplacebo (fast_float) and harfbuzz are C++, and their .pc files do not list it.
# swift-flags: the Swift step passes no -target, so give it the deployment target explicitly.
recipe_mpv() {
  LDFLAGS="$LDFLAGS -lc++" meson_build -Ddefault_library=shared -Dprefer_static=true \
    -Dlibmpv=true -Dcplayer=true -Dcocoa=enabled -Dcoreaudio=enabled -Dvideotoolbox-gl=enabled \
    -Dgl=enabled -Dlua=luajit -Dswift-build=enabled -Dmanpage-build=disabled \
    "-Dswift-flags=-target x86_64-apple-macos11.0"
}

# Helper functions that go into every key next to the recipe.
KEY_HELPERS="common_env fetch_tarball fetch_libplacebo extract_src meson_build meson_static drop_la assert_line needs pin"

key() {
  local dep=$1 d up
  needs "$dep" >/dev/null
  up=$(upper "$dep")
  {
    grep "^${up}_" "$HERE/versions.env"
    # shellcheck disable=SC2086
    declare -f "recipe_$dep" $KEY_HELPERS
    for d in $(needs "$dep"); do key "$d"; done
    echo "CACHE_EPOCH=$CACHE_EPOCH"
  } | shasum -a 256 | cut -c1-64
}

pinhash() { cat "$HERE/versions.env" "$HERE/build-stack.sh" | shasum -a 256 | cut -c1-12; }

build() {
  local dep=$1
  needs "$dep" >/dev/null
  ensure_tools
  common_env
  S="$WORK/build/$dep/src"
  B="$WORK/build/$dep/obj"
  PKG="$WORK/pkg/$dep"
  rm -rf "$PKG"
  if [ "$dep" != meson ]; then
    extract_src "$dep"
    mkdir -p "$PKG"
  fi
  echo "== build $dep (key $(key "$dep"))"
  "recipe_$dep"
  if [ "$dep" != meson ]; then
    [ -n "$(find "$PKG" -type f | head -n 1)" ] || die "$dep installed nothing into $PKG"
  fi
}

install_dep() {
  local dep=$1
  needs "$dep" >/dev/null
  if [ "$dep" = meson ]; then
    echo "meson: installed by build (venv in $TOOLS_PREFIX)"
    return 0
  fi
  # Both prefixes sit under $HOME; copying to / fails, as macOS's / is read-only.
  [ -d "$WORK/pkg/$dep$HOME" ] || die "no $WORK/pkg/$dep$HOME to install"
  cp -R "$WORK/pkg/$dep$HOME"/. "$HOME"/
  echo "installed $dep"
}

list() {
  local d
  for d in $DEPS; do
    echo "$d $(pin "$d" VERSION) needs: $(needs "$d")"
  done
}

sources() {
  local d out
  ensure_tools
  for d in $DEPS; do fetch_src "$d" >/dev/null; done
  out="$WORK/out"
  mkdir -p "$out"
  tar -czf "$out/sources-$(pinhash).tar.gz" -C "$WORK" src
  echo "$out/sources-$(pinhash).tar.gz"
}

package() {
  local out ph
  out="$WORK/out"
  ph=$(pinhash)
  mkdir -p "$out"
  [ -x "$STACK_PREFIX/bin/mpv" ] || die "no $STACK_PREFIX/bin/mpv: build and install the stack first"
  tar -czf "$out/stack-$ph.tar.gz" -C "$(dirname "$STACK_PREFIX")" "$(basename "$STACK_PREFIX")"
  tar -czf "$out/mpv-cli-$ph.tar.gz" -C "$STACK_PREFIX/bin" mpv
  echo "$out/stack-$ph.tar.gz"
  echo "$out/mpv-cli-$ph.tar.gz"
}

cmd=${1:-}
case "$cmd" in
  list) list ;;
  key) key "${2:?dep}" ;;
  build) build "${2:?dep}" ;;
  install) install_dep "${2:?dep}" ;;
  pinhash) pinhash ;;
  sources) sources ;;
  package) package ;;
  *) die "usage: build-stack.sh list|key <dep>|build <dep>|install <dep>|pinhash|sources|package" ;;
esac
