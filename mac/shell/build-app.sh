#!/bin/bash
# Builds AlderProof.app (macOS 11.0 x86_64) from the extracted stack and signs it last.
# Usage: build-app.sh <out-dir>            writes <out-dir>/AlderProof.app
# Environment: STACK_PREFIX (default $HOME/stack, where the stack release tarball extracts), PINHASH (default: asked
# of mac/deps/build-stack.sh), COMMIT (default: git HEAD), ALDER_WEB_DIST (default dist-mac, from npm run build:mac). Needs swiftc, dylibbundler, install_name_tool, codesign.
# Layout: Contents/MacOS/AlderProof, Contents/libs (libmpv, via dylibbundler), Contents/Resources/{web,measure.lua,
# licenses}. Bash 3.2 compatible (macOS runner).
set -euo pipefail

OUT=${1:?usage: build-app.sh <out-dir>}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
STACK=${STACK_PREFIX:-$HOME/stack}
PIN=${PINHASH:-$(/bin/bash "$ROOT/mac/deps/build-stack.sh" pinhash)}
COMMIT=${COMMIT:-$(git -C "$ROOT" rev-parse HEAD)}
REPO_URL=https://github.com/esedmemmed/Alder-mac
STACK_URL=$REPO_URL/releases/tag/stack-$PIN

[ -f "$STACK/lib/libmpv.dylib" ] || { echo "no $STACK/lib/libmpv.dylib: extract the stack release first" >&2; exit 1; }
[ -f "$STACK/include/mpv/client.h" ] || { echo "no mpv headers under $STACK/include" >&2; exit 1; }

APP=$OUT/AlderProof.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/libs" "$APP/Contents/Resources/web" "$APP/Contents/Resources/licenses"
BIN=$APP/Contents/MacOS/AlderProof

# Plain swiftc, no back-deployed runtime: -swift-version 5 keeps top-level code and C callbacks out of Swift 6
# concurrency checking; the implicit _Concurrency import is switched off so no @rpath/libswift_Concurrency is linked.
# OpenGL is deprecated, not removed, on the macOS 11 to 26 range this runs on.
swiftc -target x86_64-apple-macos11.0 -O -swift-version 5 \
  -Xfrontend -disable-implicit-concurrency-module-import \
  -import-objc-header "$HERE/bridging.h" -Xcc "-I$STACK/include" \
  -framework AppKit -framework WebKit -framework OpenGL -framework QuartzCore -framework CoreAudio \
  -L"$STACK/lib" -lmpv \
  -o "$BIN" \
  "$HERE/main.swift" "$HERE/Options.swift" "$HERE/Selftest.swift" "$HERE/Player.swift" \
  "$HERE/VideoView.swift" "$HERE/WebHost.swift" "$HERE/Recorder.swift"

# libmpv and whatever of the stack it still links go to Contents/libs, install names rewritten to the bundle.
dylibbundler -od -b -x "$BIN" -d "$APP/Contents/libs" -p @executable_path/../libs/ -s "$STACK/lib" -ns

# dylibbundler renames every LC_RPATH to the -p path, so a file with two ends up with duplicates, and dyld refuses to
# load those (run 41394752166). Nothing here is loaded through @rpath (check-bundle fails on that), so all of them go.
rpaths_of() {
  otool -l "$1" | awk '/cmd LC_RPATH/ { f = 1; next } f && /^ *path / { sub(/^ *path /, ""); sub(/ \(offset [0-9]+\)$/, ""); print; f = 0 }'
}
strip_rpaths() {
  local n=0 p
  while :; do
    p=$(rpaths_of "$1" | sed -n 1p)
    [ -n "$p" ] || return 0
    install_name_tool -delete_rpath "$p" "$1"
    n=$((n + 1))
    [ "$n" -lt 20 ] || { echo "cannot strip LC_RPATH from $1" >&2; exit 1; }
  done
}
for f in "$BIN" "$APP"/Contents/libs/*; do
  strip_rpaths "$f"
done

# Resources: Alder (npm run build:mac -> dist-mac/, index.html = Alder) and the 1.1 proof page as proof.html with its
# scripts (never test/), the measuring script.
WEBDIST=${ALDER_WEB_DIST:-$ROOT/dist-mac}
[ -f "$WEBDIST/index.html" ] || { echo "no $WEBDIST/index.html: run npm ci && npm run build:mac first" >&2; exit 1; }
cp -R "$WEBDIST/." "$APP/Contents/Resources/web/"
cp "$ROOT/mac/web/index.html" "$APP/Contents/Resources/web/proof.html"
for f in bridge.js probe.js mock-bridge.js; do
  cp "$ROOT/mac/web/$f" "$APP/Contents/Resources/web/$f"
done
cp "$ROOT/air/measure.lua" "$APP/Contents/Resources/measure.lua"

# Licence texts: the app is GPL-3.0 (mpv and FFmpeg are built GPL), the sources are public.
LIC=$APP/Contents/Resources/licenses
cp "$ROOT/LICENSE" "$LIC/GPL-3.0.txt"
{
  echo "Alder (AlderProof) is licensed under the GNU General Public License version 3 (GPL-3.0.txt)."
  echo "It bundles these libraries, built from the sources named in SOURCE.txt:"
  echo
  /bin/bash "$ROOT/mac/deps/build-stack.sh" list
} > "$LIC/NOTICE.txt"
{
  echo "Source code of this app: $REPO_URL (commit $COMMIT)"
  echo "Source code of the bundled libraries: $STACK_URL"
  echo "  asset sources-$PIN.tar.gz at $REPO_URL/releases/download/stack-$PIN/sources-$PIN.tar.gz"
} > "$LIC/SOURCE.txt"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>AlderProof</string>
  <key>CFBundleIdentifier</key><string>com.esedmemmed.alderproof</string>
  <key>CFBundleName</key><string>AlderProof</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1</string>
  <key>CFBundleVersion</key><string>${COMMIT:0:7}</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST

# Last step: any change after this invalidates the signature (ad-hoc, no identity). The libs first: install_name_tool
# broke their signature and Contents/libs is not a standard nested-code folder, so --deep may not reach them.
codesign --force -s - "$APP"/Contents/libs/*
codesign --force --deep -s - "$APP"
echo "built $APP"
