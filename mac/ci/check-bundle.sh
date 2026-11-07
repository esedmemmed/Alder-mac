#!/bin/bash
# Gate for the mpv stack build (macOS 11.0 x86_64) and for the app built on it. Three modes:
#   check-bundle.sh <dir>...            every Mach-O in <dir>/bin/* and <dir>/lib/*.dylib must be x86_64, have
#                                       minos <= 11.0 (vtool -show-build, compared as integers), and link only
#                                       /usr/lib/ and /System/ besides its own id. Each file's result is printed.
#   check-bundle.sh --features <mpv>    decoders h264/hevc, audio decoders dca/truehd, hwdec videotoolbox,
#                                       https protocol, and a smoke play of mac/test/clip.mp4 with null outputs.
#   check-bundle.sh --app <X.app>       every Mach-O anywhere in the bundle passes the same test, except that
#                                       @executable_path/... is also a legal dependency when the file it names exists
#                                       under Contents/MacOS; codesign --verify --deep --strict passes; the licence
#                                       texts and the source link file exist under Contents/Resources/licenses.
# Exit 0 only when every assertion holds. Needs lipo, vtool, otool, file, codesign (Xcode command line tools).
set -uo pipefail

MAX_MINOS=110000   # 11.0 as major*10000 + minor*100 + patch
HERE=$(cd "$(dirname "$0")" && pwd)
CLIP="$HERE/../test/clip.mp4"
failures=0
checked=0
APP_EXEC_DIR=""   # set by --app: what @executable_path stands for; empty keeps @executable_path illegal

fail() { echo "FAIL: $*"; failures=$((failures + 1)); }

# "11.0" -> 110000, "10.15.4" -> 101504; non-zero status when not numeric.
ver_int() {
  local a b c
  IFS=. read -r a b c <<EOF
$1
EOF
  case "$a${b:-0}${c:-0}" in
    '' | *[!0-9]*) return 1 ;;
  esac
  echo $((a * 10000 + ${b:-0} * 100 + ${c:-0}))
}

check_macho() {
  local f=$1 bad=0 archs minos_list m maxm="" id dep ndeps=0 v
  archs=$(lipo -archs "$f" 2>&1)
  if [ "$archs" != "x86_64" ]; then
    fail "$f: arch '$archs', want x86_64"
    bad=1
  fi

  minos_list=$(vtool -show-build "$f" 2>&1 | awk '$1 == "minos" { print $2 }')
  if [ -z "$minos_list" ]; then
    fail "$f: no parsable minos in vtool -show-build"
    bad=1
  else
    for m in $minos_list; do
      if ! v=$(ver_int "$m"); then
        fail "$f: minos '$m' not numeric"
        bad=1
        continue
      fi
      if [ "$v" -gt "$MAX_MINOS" ]; then
        fail "$f: minos $m above 11.0"
        bad=1
      fi
      if [ -z "$maxm" ] || [ "$v" -gt "$maxm" ]; then maxm=$v; fi
    done
  fi

  id=$(otool -D "$f" 2>/dev/null | tail -n +2 | head -n 1)
  while read -r dep; do
    [ -n "$dep" ] || continue
    [ "$dep" = "$id" ] && continue
    ndeps=$((ndeps + 1))
    case "$dep" in
      /usr/lib/* | /System/*) ;;
      @executable_path/*)
        if [ -z "$APP_EXEC_DIR" ]; then
          fail "$f: dependency $dep outside /usr/lib and /System"
          bad=1
        elif [ ! -e "$APP_EXEC_DIR/${dep#@executable_path/}" ]; then
          fail "$f: dependency $dep not found in the bundle"
          bad=1
        fi
        ;;
      *)
        fail "$f: dependency $dep outside /usr/lib and /System"
        bad=1
        ;;
    esac
  done <<EOF
$(otool -L "$f" 2>/dev/null | tail -n +2 | awk '{ print $1 }')
EOF

  checked=$((checked + 1))
  if [ "$bad" -eq 0 ]; then
    echo "ok: $f arch=$archs minos=$minos_list system-deps=$ndeps"
  fi
}

check_dirs() {
  local d f
  for d in "$@"; do
    [ -d "$d" ] || { fail "$d: not a directory"; continue; }
    for f in "$d"/bin/* "$d"/lib/*.dylib; do
      [ -f "$f" ] && [ ! -L "$f" ] || continue
      case "$(file -b "$f")" in
        *Mach-O*) check_macho "$f" ;;
        *) echo "skip (not Mach-O): $f" ;;
      esac
    done
  done
  if [ "$checked" -eq 0 ]; then fail "no Mach-O file found under: $*"; fi
}

check_app() {
  local app=$1 f lic
  [ -d "$app" ] || { fail "$app: not a directory"; return; }
  app=$(cd "$app" && pwd)
  APP_EXEC_DIR="$app/Contents/MacOS"
  while IFS= read -r f; do
    case "$(file -b "$f")" in
      *Mach-O*) check_macho "$f" ;;
    esac
  done <<EOF
$(find "$app" -type f)
EOF
  if [ "$checked" -eq 0 ]; then fail "no Mach-O file found in $app"; fi

  if codesign --verify --deep --strict "$app" 2>&1; then
    echo "ok: codesign --verify --deep --strict"
  else
    fail "$app: codesign --verify --deep --strict failed"
  fi

  for f in web/index.html web/proof.html web/LICENSE.txt web/licenses/NOTICE.txt; do
    if [ -s "$app/Contents/Resources/$f" ]; then
      echo "ok: $f"
    else
      fail "$app: $f missing or empty"
    fi
  done
  if grep -qE 'width=1920|[$]WEBAPIS' "$app/Contents/Resources/web/index.html" 2>/dev/null; then
    fail "$app: web/index.html is the TV page, not the Mac page"
  fi

  local plist="$app/Contents/Info.plist" want got
  want=$(tr -d '[:space:]' < "$HERE/../VERSION")
  got=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist" 2>/dev/null || true)
  if [ "$got" = "$want" ]; then echo "ok: CFBundleShortVersionString $got"; else fail "$app: CFBundleShortVersionString '$got' != mac/VERSION '$want'"; fi
  got=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist" 2>/dev/null || true)
  if [ "$got" = "com.esedmemmed.alderproof" ]; then echo "ok: CFBundleIdentifier $got"; else fail "$app: CFBundleIdentifier '$got' != com.esedmemmed.alderproof"; fi

  for lic in GPL-3.0.txt NOTICE.txt SOURCE.txt; do
    if [ -s "$app/Contents/Resources/licenses/$lic" ]; then
      echo "ok: licenses/$lic"
    else
      fail "$app: licenses/$lic missing or empty"
    fi
  done
}

# Run mpv with the given args, keep stdout+stderr in $out and its status in $rc.
run_mpv() {
  out=$("$mpv" --no-config "$@" 2>&1)
  rc=$?
}

want_word() {  # label word: $out must contain the word
  if printf '%s\n' "$out" | grep -qw -- "$2"; then
    echo "ok: $1 has $2"
  else
    fail "$1 lacks $2"
  fi
}

check_features() {
  mpv=$1
  local out rc
  [ -x "$mpv" ] || { fail "$mpv: not executable"; return; }
  "$mpv" --version | head -n 3

  run_mpv --vd=help
  want_word "--vd=help" h264
  want_word "--vd=help" hevc
  run_mpv --ad=help
  want_word "--ad=help" dca
  want_word "--ad=help" truehd
  run_mpv --hwdec=help
  want_word "--hwdec=help" videotoolbox
  run_mpv --list-protocols
  want_word "--list-protocols" https

  # Report only: a usable gpu context is a line for the report, not a failure of this workflow.
  echo "--- mpv --gpu-context=help"
  "$mpv" --no-config --gpu-context=help 2>&1 || true

  [ -f "$CLIP" ] || { fail "$CLIP missing"; return; }
  run_mpv --vo=null --ao=null "$CLIP"
  printf '%s\n' "$out" | tail -n 5
  if [ "$rc" -eq 0 ] && printf '%s\n' "$out" | grep -qF 'Exiting... (End of file)'; then
    echo "ok: smoke play exit 0, End of file"
  else
    fail "smoke play: exit $rc or no 'Exiting... (End of file)'"
  fi
}

case "${1:-}" in
  --features) check_features "${2:?path to mpv}" ;;
  --app) check_app "${2:?path to X.app}" ;;
  '' | -*) echo "usage: check-bundle.sh <dir>... | --features <mpv> | --app <X.app>" >&2; exit 2 ;;
  *) check_dirs "$@" ;;
esac

if [ "$failures" -ne 0 ]; then
  echo "check-bundle: $failures failure(s)"
  exit 1
fi
echo "check-bundle: all checks passed"
