#!/usr/bin/env python
"""Run the whole Air measurement from Windows: one command here, one short line typed on the Air.

Usage:  python air/run_from_windows.py        (see air/RECIPE.md, "The easy way")

1. Asks for the Stremio email and password (password with getpass). They are held in memory only.
2. Logs in, reads the add-on collection, asks the stream add-ons about popular titles, keeps direct links,
   labels them by name, checks each answers, and prints only which labels were found. Never a link.
3. Serves the kit and a script on the LAN and prints the line to type on the Air. Every path needs the token.
4. Collects status lines and the results archive, unpacks `results/` to .run/1.1/air-results/ with anything
   that looks like a link stripped, forgets the links and exits.
With --shell-check (T7.1): steps 1 and 2 for SHELL_LABELS only, then the line typed on the Air plays
docs/air/webview-1.1.md steps 7-11 in order, asking the add-on again for a fresh link before each play
(GET /<token>/link/<label>?fresh=1), and sends the results back as above. Links stay in ~/AlderProof/{.link,.fresh,logs}.
With --ui-check [--probe] (T2): no Stremio login and no links. The Air installs the newest app build and either runs
the page probe twice (?probe=1, ?probe=2; the second launch shows whether localStorage kept its value) or opens
the app plain for the user to try. Its --report text comes back with keys and links stripped, to --out/ui-report.txt.
Python standard library only. Test hooks: --host, --api, --cooldown, --end, --out.
"""
import argparse
import concurrent.futures
import getpass
import hmac
import http.server
import io
import json
import os
import re
import secrets
import socket
import sys
import tarfile
import threading
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
API = "https://api.strem.io/api/"
PORT = 8765
LABELS = ["720p-h264", "1080p-h264", "1080p-hevc8", "1080p-hevc10", "4k-hevc", "4k-h264", "dts", "truehd"]
SHELL_LABELS = ["1080p-h264", "4k-hevc"]  # what docs/air/webview-1.1.md plays
LINK_RE = re.compile(r"(?i)\b(?:https?|ftp)://\S*")
KEY_RE = re.compile(r"(?i)\b(auth_?key|password|token|api_?key)\b([\"']?\s*[:=]\s*[\"']?)[^\s,;\"']+")
TOKEN_CHARS ="abcdefghjkmnpqrstuvwxyz23456789"  # no 0/o/1/l/i: it is typed by hand

MOVIES = """tt0111161 tt0068646 tt0468569 tt0071562 tt0108052 tt0167260 tt0110912 tt0120737 tt0109830 tt1375666
tt0137523 tt0080684 tt0133093 tt0099685 tt0167261 tt0114369 tt0102926 tt0120815 tt0816692 tt0172495
tt0482571 tt0407887 tt0088763 tt0361748 tt1853728 tt2380307 tt0993846 tt1160419 tt15239678 tt1517268
tt15398776 tt4154796 tt4154756 tt1431045 tt2911666 tt1745960 tt0848228 tt0120689 tt0076759 tt0245429""".split()
SERIES = ["tt0903747:1:1", "tt0944947:1:1", "tt0108778:1:1", "tt4574334:1:1", "tt0386676:1:1", "tt2861424:1:1"]
MAX_SECONDS = 600  # cap on the whole search


# ---------------------------------------------------------------- classifier
def tags(text):
    """What a release name says: height, codec, bit depth, audio. None when it says two things at once."""
    w = " " + re.sub(r"[._\-\[\](){}/+]", " ", text.lower()).replace("\n", " ") + " "
    heights = set()
    if re.search(r"2160|\b4k\b|\buhd\b", w):
        heights.add(2160)
    if re.search(r"\b1080|\b1920x1080", w):
        heights.add(1080)
    if re.search(r"\b720", w):
        heights.add(720)
    hevc = bool(re.search(r"hevc|\b[xh] ?265\b|\bh265", w))
    h264 = bool(re.search(r"\b[xh] ?264\b|\bavc\b|\bh264", w))
    av1 = bool(re.search(r"\bav1\b", w))
    dv = bool(re.search(r"\b(dv|dovi|dolby vision)\b", w))
    hdr = bool(re.search(r"\bhdr|\bhlg\b", w))
    ten = bool(re.search(r"\b10 ?bit|\bhi10|\bmain ?10\b", w)) or hdr
    eight = bool(re.search(r"\b8 ?bit\b", w))
    truehd = bool(re.search(r"true ?hd", w))
    dts = bool(re.search(r"\bdts\b", w))
    bad = bool(re.search(r"\b(cam|camrip|hdcam|ts|hdts|telesync|tc|telecine|scr|screener|dvdscr|3d)\b", w))
    return dict(heights=heights, hevc=hevc, h264=h264, av1=av1, dv_only=dv and not hdr, ten=ten, eight=eight,
                truehd=truehd, dts=dts, bad=bad)


def classify(text):
    """The labels a stream could be measured for, as {label: explicit}; explicit=True when the name states the
    bit depth. A stream of doubtful content (cam, 3D, Dolby Vision without HDR10, AV1, two resolutions or two
    codecs, TrueHD with DTS) gets nothing."""
    t = tags(text)
    if t["bad"] or t["av1"] or t["dv_only"] or len(t["heights"]) != 1 or (t["hevc"] and t["h264"]):
        return {}
    h = next(iter(t["heights"]))
    out = {}
    if t["hevc"]:
        if h == 1080:
            out["1080p-hevc10" if t["ten"] else "1080p-hevc8"] = t["ten"] or t["eight"]
        if h == 2160:
            out["4k-hevc"] = True
    elif t["h264"]:
        if h == 720:
            out["720p-h264"] = True
        if h == 1080:
            out["1080p-h264"] = True
        if h == 2160:
            out["4k-h264"] = True
    if t["truehd"] != t["dts"] and h in (720, 1080, 2160):
        # Audio labels: any title will do; audio_rank prefers the lightest video, which isolates the audio best.
        out["truehd" if t["truehd"] else "dts"] = False
    return out


def audio_rank(text):
    h = next(iter(tags(text)["heights"]), 0)
    return {1080: 0, 720: 1, 2160: 2}.get(h, 3)


# ---------------------------------------------------------------- Stremio
def scrub(s):
    return LINK_RE.sub("[link removed]", str(s))


def http_json(url, body=None, timeout=15):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", "User-Agent": "alder-air/1"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def login(api, email, password):
    r = http_json(api + "login", {"type": "Login", "email": email, "password": password, "facebook": False})
    key = (r.get("result") or {}).get("authKey")
    if not key:
        raise RuntimeError("Stremio did not accept the email and password")
    return key


def stream_addons(api, key):
    r = http_json(api + "addonCollectionGet", {"type": "AddonCollectionGet", "authKey": key, "update": True})
    out = []
    for a in (r.get("result") or {}).get("addons") or []:
        m = a.get("manifest") or {}
        res = [x if isinstance(x, str) else (x or {}).get("name") for x in m.get("resources") or []]
        url = a.get("transportUrl") or ""
        if "stream" in res and url.endswith("/manifest.json"):
            out.append(url[: -len("/manifest.json")])
    return out


def ask_addon(base, kind, vid):
    """Direct-link streams of one add-on for one title: [(text, url)]. Any failure is an empty answer."""
    try:
        r = http_json("%s/stream/%s/%s.json" % (base, kind, vid.replace(":", "%3A")), timeout=10)
    except Exception:
        return []
    out = []
    for s in r.get("streams") or []:
        url = s.get("url")
        hints = s.get("behaviorHints") or {}
        if not isinstance(url, str) or not re.match(r"https?://", url) or hints.get("proxyHeaders"):
            continue
        text = " ".join(str(x) for x in (hints.get("filename"), s.get("name"), s.get("title"), s.get("description")) if x)
        out.append((text, url))
    return out


def link_answers(url):
    try:
        req = urllib.request.Request(url, headers={"Range": "bytes=0-1023", "User-Agent": "alder-air/1"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status in (200, 206) and len(r.read(1024)) > 0
    except Exception:
        return False


def find_links(api, key, say, movies=MOVIES, series=SERIES, deadline=MAX_SECONDS, check=link_answers, labels=LABELS,
               sources=None):
    """{label: url}. Movies first; series only for labels still missing. Deterministic order and tie-break.
    When `sources` is a dict it gets {label: (addon base, kind, vid, release text)} for each chosen url."""
    addons = stream_addons(api, key)
    say("%d stream add-on(s) in your collection" % len(addons))
    start = time.time()
    cands = {}  # label -> list of sort keys + url
    order = 0

    def sweep(kind, ids):
        nonlocal order
        for i in range(0, len(ids), 4):
            if time.time() - start > deadline or all(l in cands and len(cands[l]) >= 3 for l in labels):
                return
            batch = ids[i:i + 4]
            with concurrent.futures.ThreadPoolExecutor(4) as ex:
                jobs = [(ai, vid, base, ex.submit(ask_addon, base, kind, vid)) for vid in batch for ai, base in enumerate(addons)]
                for ai, vid, base, f in jobs:  # collected in submission order, not completion order
                    for text, url in f.result():
                        for label, explicit in classify(text).items():
                            order += 1
                            rank = audio_rank(text) if label in ("dts", "truehd") else 0
                            remux = 1 if re.search(r"remux", text.lower()) else 0
                            cands.setdefault(label, []).append((rank, not explicit, remux, ai, order, url, (base, kind, vid, text)))
            say("looked at %d of %d titles; found %d of %d labels" % (
                min(i + 4, len(ids)), len(ids), sum(1 for l in labels if l in cands), len(labels)))

    if addons:
        sweep("movie", movies)
        if any(l not in cands for l in labels):
            sweep("series", series)
    chosen = {}
    for label in labels:
        for c in sorted(cands.get(label, []))[:5]:
            if check(c[-2]):
                chosen[label] = c[-2]
                if sources is not None:
                    sources[label] = c[-1]
                break
    return chosen


# ---------------------------------------------------------------- the script served to the Air
AIR_SCRIPT = r'''#!/bin/bash
# Alder Air measurement. Served by run_from_windows.py; bash 3.2.
main() {
base="__BASE__"
labels="__LABELS__"
dir=${ALDERPROOF_DIR:-$HOME/AlderProof}
cool=${ALDER_COOLDOWN:-180}
umask 077
say() { curl -s -m 20 -X POST --data-binary "$1" "$base/status" >/dev/null 2>&1 </dev/null; echo "$1"; }
cleanup() { rm -rf "$dir/.link" "$dir/logs" "$dir/results.tgz"; [ -n "${cafpid:-}" ] && kill "$cafpid" 2>/dev/null; }
trap cleanup EXIT
mkdir -p "$dir" || { say "cannot make $dir"; return 1; }
if command -v caffeinate >/dev/null 2>&1; then caffeinate -disu -w $$ & cafpid=$!; fi
if command -v pmset >/dev/null 2>&1 && pmset -g ps 2>/dev/null | grep -q "Battery Power"; then
    say "warning: the Air is on battery; plug in the charger (going on anyway)"
fi
say "air started: $(sw_vers -productVersion 2>/dev/null) $(sysctl -n hw.model 2>/dev/null)"
curl -fsS -m 60 "$base/measure.sh" -o "$dir/measure.sh" </dev/null && curl -fsS -m 60 "$base/measure.lua" -o "$dir/measure.lua" </dev/null \
    || { say "could not fetch the kit from Windows"; echo "Could not reach the Windows computer. Same Wi-Fi? Firewall prompt allowed?"; return 1; }
say "kit fetched"

# mpv: the one already here, one on the path, else the recipe's download. Nothing here asks for a password.
find_mpv() {
    for c in "${MPV_BIN:-}" "$dir/mpv/mpv.app/Contents/MacOS/mpv" "$(command -v mpv 2>/dev/null)" /opt/local/bin/mpv /opt/homebrew/bin/mpv /usr/local/bin/mpv; do
        if [ -n "$c" ] && [ -x "$c" ] && "$c" --version >/dev/null 2>&1 </dev/null; then MPV_BIN=$c; export MPV_BIN; return 0; fi
    done
    return 1
}
if ! find_mpv; then
    say "installing mpv"
    mkdir -p "$dir/mpv"
    ( cd "$dir/mpv" && curl -fsSL -m 900 -O https://laboratory.stolendata.net/~djinn/mpv_osx/mpv-latest.tar.gz </dev/null \
        && tar xzf mpv-latest.tar.gz && xattr -dr com.apple.quarantine mpv.app ) >/dev/null 2>&1
fi
if ! find_mpv; then
    say "no mpv runs on this Air"
    echo "mpv would not start here, so nothing was measured. Tell Claude: the status was sent already."
    return 1
fi
say "mpv ready"

[ -d "$dir/results" ] && mv "$dir/results" "$dir/results.old.$(date +%s)"
n=0; total=0; for l in $labels; do total=$((total+1)); done
for label in $labels; do
    n=$((n+1))
    if ! curl -fsS -m 30 "$base/link/$label" -o "$dir/.link" </dev/null 2>/dev/null; then say "$label: no link from Windows, skipped"; continue; fi
    say "$label: playing ($n of $total)"
    out=$(bash "$dir/measure.sh" "$label" "$(cat "$dir/.link")" </dev/null 2>&1); rc=$?
    rm -f "$dir/.link"
    if [ $rc -eq 0 ]; then say "$label: done: $(echo "$out" | head -n 1)"; else say "$label: failed (exit $rc), moving on"; fi
    if [ $n -lt $total ]; then say "cooling for $cool seconds"; sleep "$cool"; fi
done

say "sending results"
if [ -d "$dir/results" ] && (cd "$dir" && tar czf results.tgz results) && \
   curl -fsS -m 300 --data-binary @"$dir/results.tgz" "$base/results" >/dev/null </dev/null; then
    say "results sent"
else
    say "results could not be sent; they stay in $dir/results"
fi
cleanup
echo
echo "Finished. The links are deleted from this Air. You can close this window."
}
main "$@"
'''


SHELL_SCRIPT = r'''#!/bin/bash
# Alder Air shell check (docs/air/webview-1.1.md steps 7-11). Served by run_from_windows.py --shell-check; bash 3.2.
main() {
base="__BASE__"
labels="__LABELS__"
dir=${ALDERPROOF_DIR:-$HOME/AlderProof}
cool=${ALDER_COOLDOWN:-180}
ci=${CI_MPV_BIN:-$dir/ci-mpv/mpv}
ALDERPROOF_BIN=${ALDERPROOF_BIN:-/Applications/AlderProof.app/Contents/MacOS/AlderProof}; export ALDERPROOF_BIN
umask 077
say() { curl -s -m 20 -X POST --data-binary "$1" "$base/status" >/dev/null 2>&1 </dev/null; echo "$1"; }
cleanup() { rm -rf "$dir/.link" "$dir/.fresh" "$dir/.stored" "$dir/logs" "$dir/results.tgz"; [ -n "${cafpid:-}" ] && kill "$cafpid" 2>/dev/null; }
trap cleanup EXIT
mkdir -p "$dir/logs" || { say "cannot make $dir"; return 1; }
if command -v caffeinate >/dev/null 2>&1; then caffeinate -disu -w $$ & cafpid=$!; fi
if command -v pmset >/dev/null 2>&1 && pmset -g ps 2>/dev/null | grep -q "Battery Power"; then
    say "warning: the Air is on battery; plug in the charger (going on anyway)"
fi
say "air started: $(sw_vers -productVersion 2>/dev/null) $(sysctl -n hw.model 2>/dev/null)"
curl -fsS -m 60 "$base/measure.sh" -o "$dir/measure.sh" </dev/null && curl -fsS -m 60 "$base/measure.lua" -o "$dir/measure.lua" </dev/null \
    || { say "could not fetch the kit from Windows"; echo "Could not reach the Windows computer. Same Wi-Fi? Firewall prompt allowed?"; return 1; }
say "kit fetched"

appurl="__APPURL__"; apptag="__APPTAG__"
if [ -n "$appurl" ]; then
    if [ "$(cat "$dir/app/.tag" 2>/dev/null)" = "$apptag" ] && [ -x "$dir/app/AlderProof.app/Contents/MacOS/AlderProof" ]; then
        ALDERPROOF_BIN="$dir/app/AlderProof.app/Contents/MacOS/AlderProof"; say "app $apptag already installed"
    else
        say "fetching app $apptag"
        rm -rf "$dir/app" "$dir/mnt"; mkdir -p "$dir/app" "$dir/mnt"
        if ! curl -fsSL -m 900 "$appurl" -o "$dir/AlderProof.dmg" </dev/null; then
            say "app download failed; using the one in Applications if present"
        elif ! hdiutil attach -nobrowse -readonly -mountpoint "$dir/mnt" "$dir/AlderProof.dmg" >/dev/null 2>&1; then
            say "app dmg could not be mounted; using the one in Applications if present"
        else
            if ditto "$dir/mnt/AlderProof.app" "$dir/app/AlderProof.app" >/dev/null 2>&1; then
                xattr -dr com.apple.quarantine "$dir/app/AlderProof.app" 2>/dev/null
                echo "$apptag" > "$dir/app/.tag"
                ALDERPROOF_BIN="$dir/app/AlderProof.app/Contents/MacOS/AlderProof"; say "app $apptag installed"
            else
                say "app could not be copied from the dmg; using the one in Applications if present"
            fi
            hdiutil detach "$dir/mnt" -force >/dev/null 2>&1
        fi
        rm -f "$dir/AlderProof.dmg"
        [ -f "$dir/app/.tag" ] || rm -rf "$dir/app"
    fi
fi
if [ ! -x "$ALDERPROOF_BIN" ]; then
    say "the AlderProof app is missing at $ALDERPROOF_BIN"
    echo "AlderProof is not in Applications. Install it (steps 2 to 4 of the steps page), then run this line again."
    return 1
fi
if [ ! -x "$ci" ]; then
    say "fetching ci-mpv"
    mkdir -p "$dir/ci-mpv"
    ( cd "$dir/ci-mpv" && curl -fsSL -m 900 https://github.com/esedmemmed/Alder-mac/releases/download/stack-158edb7e678b/mpv-cli-158edb7e678b.tar.gz </dev/null | tar xz ) >/dev/null 2>&1
fi
if [ ! -x "$ci" ]; then
    say "ci-mpv could not be fetched"
    echo "Could not get ci-mpv, so nothing was measured. The status was sent."
    return 1
fi
say "app and ci-mpv ready"

# Strip anything URL-like from text before it is sent.
nolink() { sed -E 's#[A-Za-z][A-Za-z0-9+.-]*://[^[:space:]]*#[link]#g'; }
# What a download of the first KB of $1 does, without the address.
probe() {
    r=$(curl -sS -L -r 0-1023 -o /dev/null -m 20 -w '%{http_code} redirects=%{num_redirects} type=%{content_type}' "$1" 2>/dev/null </dev/null)
    echo "$r curl_exit=$?" | nolink
}
first=1
# prep <label> <tag>: stored and fresh link into .link/.fresh, one diagnosis line, the fresh link left in .link.
prep() {
    if ! curl -fsS -m 30 "$base/link/$1" -o "$dir/.stored" </dev/null 2>/dev/null; then say "$2: no link from Windows, skipped"; return 1; fi
    if ! curl -fsS -m 60 "$base/link/$1?fresh=1" -o "$dir/.fresh" </dev/null 2>/dev/null; then cp "$dir/.stored" "$dir/.fresh"; fi
    if cmp -s "$dir/.stored" "$dir/.fresh"; then same=yes; else same=no; fi
    say "$2: stored link: $(probe "$(cat "$dir/.stored")"); fresh link: $(probe "$(cat "$dir/.fresh")"); fresh same as stored: $same"
    mv -f "$dir/.fresh" "$dir/.link"; rm -f "$dir/.stored"
}
rest() { if [ $first -eq 0 ]; then say "cooling for $cool seconds"; sleep "$cool"; fi; first=0; }
# why <logfile> <rc>: what to tell about a failed play, no links.
why() {
    say "$tag: failed (exit $2). Player log, error-like lines: $( [ -f "$1" ] && grep -iE 'error|fail|http|403|404|refused|end-file' "$1" | tail -n 5 | cut -c1-200 | nolink | tr '\n' '|')"
}
# play <label> <mode> <tag> <end> <mpv> <extra>
play() {
    rest
    prep "$1" "$3" || return 0
    say "$3: playing"
    out=$(MEASURE_END="$4" MPV_BIN="$5" MEASURE_EXTRA="$6" bash "$dir/measure.sh" "$1" "$(cat "$dir/.link")" "$2" </dev/null 2>&1); rc=$?
    rm -f "$dir/.link"
    tag=$3
    if [ $rc -eq 0 ]; then say "$3: done: $(echo "$out" | head -n 1)"; else why "$dir/logs/$1.$2.player.log" "$rc"; fi
}

end=${MEASURE_END:-600}
heavy=${MEASURE_END:-120}
bare_extra=${MEASURE_EXTRA:---no-fs --geometry=1280x720}
[ -d "$dir/results" ] && mv "$dir/results" "$dir/results.old.$(date +%s)"
play 1080p-h264 bare "1080p-h264 bare" "$end" "$ci" "$bare_extra"
play 1080p-h264 shell-hidden "1080p-h264 shell-hidden" "$end" "" ""
play 1080p-h264 shell-shown "1080p-h264 shell-shown" "$end" "" ""
case " $labels " in
    *" 4k-hevc "*) play 4k-hevc shell-shown "4k-hevc shell-shown" "$heavy" "" "" ;;
    *) say "4k-hevc: no link was found, skipped" ;;
esac

if grep -ho 'hwdec=[^ ]*' "$dir"/results/1080p-h264.shell-*.summary.txt 2>/dev/null | grep -qv '^hwdec=videotoolbox'; then
    rest
    if prep 1080p-h264 "1080p-h264 videotoolbox-copy"; then
        say "1080p-h264 videotoolbox-copy: playing"
        "$ALDERPROOF_BIN" --page proof.html --url "$(cat "$dir/.link")" --overlay shown --end "$end" --hwdec videotoolbox-copy --measure "$dir/measure.lua" --label 1080p-h264-copy > "$dir/logs/copy.player.log" 2>&1
        rc=$?
        rm -f "$dir/.link"
        tag="1080p-h264 videotoolbox-copy"
        if [ $rc -eq 0 ]; then say "$tag: done"; else why "$dir/logs/copy.player.log" "$rc"; fi
    fi
fi

say "sending results"
if [ -d "$dir/results" ] && (cd "$dir" && tar czf results.tgz results) && \
   curl -fsS -m 300 --data-binary @"$dir/results.tgz" "$base/results" >/dev/null </dev/null; then
    say "results sent"
else
    say "results could not be sent; they stay in $dir/results"
fi
cleanup
echo
echo "Finished. The links are deleted from this Air. You can close this window."
}
main "$@"
'''


UI_SCRIPT = r'''#!/bin/bash
# Alder Air UI check (T2). Served by run_from_windows.py --ui-check; bash 3.2. No Stremio login, no links.
main() {
base="__BASE__"
mode="__UIMODE__"
dir=${ALDERPROOF_DIR:-$HOME/AlderProof}
ALDERPROOF_BIN=${ALDERPROOF_BIN:-/Applications/AlderProof.app/Contents/MacOS/AlderProof}; export ALDERPROOF_BIN
umask 077
say() { curl -s -m 20 -X POST --data-binary "$1" "$base/status" >/dev/null 2>&1 </dev/null; echo "$1"; }
cleanup() { rm -rf "$dir/ui-report.txt" "$dir/ui-report.clean"; }
trap cleanup EXIT
mkdir -p "$dir" || { say "cannot make $dir"; return 1; }
say "air started: $(sw_vers -productVersion 2>/dev/null) $(sysctl -n hw.model 2>/dev/null)"

appurl="__APPURL__"; apptag="__APPTAG__"
if [ -n "$appurl" ]; then
    if [ "$(cat "$dir/app/.tag" 2>/dev/null)" = "$apptag" ] && [ -x "$dir/app/AlderProof.app/Contents/MacOS/AlderProof" ]; then
        ALDERPROOF_BIN="$dir/app/AlderProof.app/Contents/MacOS/AlderProof"; say "app $apptag already installed"
    else
        say "fetching app $apptag"
        rm -rf "$dir/app" "$dir/mnt"; mkdir -p "$dir/app" "$dir/mnt"
        if ! curl -fsSL -m 900 "$appurl" -o "$dir/AlderProof.dmg" </dev/null; then
            say "app download failed; using the one in Applications if present"
        elif ! hdiutil attach -nobrowse -readonly -mountpoint "$dir/mnt" "$dir/AlderProof.dmg" >/dev/null 2>&1; then
            say "app dmg could not be mounted; using the one in Applications if present"
        else
            if ditto "$dir/mnt/AlderProof.app" "$dir/app/AlderProof.app" >/dev/null 2>&1; then
                xattr -dr com.apple.quarantine "$dir/app/AlderProof.app" 2>/dev/null
                echo "$apptag" > "$dir/app/.tag"
                ALDERPROOF_BIN="$dir/app/AlderProof.app/Contents/MacOS/AlderProof"; say "app $apptag installed"
            else
                say "app could not be copied from the dmg; using the one in Applications if present"
            fi
            hdiutil detach "$dir/mnt" -force >/dev/null 2>&1
        fi
        rm -f "$dir/AlderProof.dmg"
        [ -f "$dir/app/.tag" ] || rm -rf "$dir/app"
    fi
fi
if [ ! -x "$ALDERPROOF_BIN" ]; then
    say "the AlderProof app is missing at $ALDERPROOF_BIN"
    echo "AlderProof is not in Applications. Install it (steps 2 to 4 of the steps page), then run this line again."
    return 1
fi

# Strip keys and anything URL-like (with or without a query string) from the report before it leaves the Air.
strip() {
    sed -E -e 's#[A-Za-z][A-Za-z0-9+.-]*://[^[:space:]]*#[link]#g' \
        -e 's#([Aa]uth_?[Kk]ey|[Pp]assword|[Tt]oken|[Aa]pi_?[Kk]ey)(["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"']?)[^[:space:],;"'"'"']+#\1\2[removed]#g'
}
rep="$dir/ui-report.txt"
rm -f "$rep"
if [ "$mode" = "probe" ]; then
    for n in 1 2; do
        echo "== probe $n ==" >> "$rep"
        say "probe $n: running (the window closes by itself, after 90 s at most)"
        "$ALDERPROOF_BIN" --page "proof.html?probe=$n" --report "$rep" --quit-after 90 </dev/null >/dev/null 2>&1
        say "probe $n: exit $?"
    done
else
    say "opening the app; use it, then quit it with Cmd-Q"
    "$ALDERPROOF_BIN" --page index.html --report "$rep" </dev/null >/dev/null 2>&1  # was proof.html: the 1.1 bar, black with no video (T9 Air walk)
    say "app closed: exit $?"
fi
[ -f "$rep" ] || echo "(the app wrote no report)" > "$rep"
strip < "$rep" > "$dir/ui-report.clean"
if curl -fsS -m 60 --data-binary @"$dir/ui-report.clean" "$base/ui-report" >/dev/null </dev/null; then
    say "report sent"
else
    say "report could not be sent"
fi
cleanup
echo
echo "Finished. You can close this window."
}
main "$@"
'''


def air_script(base, labels, template=AIR_SCRIPT, app_url="", app_tag=""):
    return (template.replace("__BASE__", base).replace("__LABELS__", " ".join(labels))
            .replace("__APPURL__", app_url).replace("__APPTAG__", app_tag))


RELEASES_API = "https://api.github.com/repos/esedmemmed/Alder-mac/releases"


def newest_app_release(releases):
    """(tag, dmg url) of the newest app-* release with AlderProof.dmg (by created_at), else None."""
    best = None
    for r in releases or []:
        tag = r.get("tag_name") or ""
        if not tag.startswith("app-"):
            continue
        for asset in r.get("assets") or []:
            if asset.get("name") == "AlderProof.dmg" and asset.get("browser_download_url"):
                if best is None or (r.get("created_at") or "") > best[0]:
                    best = (r.get("created_at") or "", tag, asset["browser_download_url"])
    return best[1:] if best else None


def find_app_release(url=RELEASES_API):
    try:
        req = urllib.request.Request(url + "?per_page=100", headers={"Accept": "application/vnd.github+json", "User-Agent": "alder-air"})
        with urllib.request.urlopen(req, timeout=20) as f:
            return newest_app_release(json.load(f))
    except Exception:
        return None


# ---------------------------------------------------------------- server and results
class State:
    def __init__(self, token, links, script_text, out_dir, say, sources=None, ask=ask_addon):
        self.token, self.links, self.script, self.out_dir, self.say = token, links, script_text, out_dir, say
        self.sources = sources if sources is not None else {}
        self.ask = ask
        self.contact = time.time()
        self.done = threading.Event()
        self.kept = None
        self.ui_check = False

    def fresh(self, label):
        """The url for `label` asked of its add-on again now: the one whose release text matches, else the stored one.
        Logs only whether that worked, never a link."""
        url, got = self.links[label], False
        src = self.sources.get(label)
        if src:
            base, kind, vid, text = src
            for t, u in self.ask(base, kind, vid):
                if t == text:
                    url, got = u, True
                    break
        self.say("resolved fresh: " + ("yes" if got else "no"))
        return url


def keep_results(data, out_dir):
    """Unpack the posted tar of results/ into out_dir: plain .tsv/.txt files only, links stripped.
    Returns (files kept, links removed)."""
    os.makedirs(out_dir, exist_ok=True)
    files = removed = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as tf:
        for m in tf.getmembers():
            name = m.name.replace("\\", "/")
            parts = [p for p in name.split("/") if p not in ("", ".")]
            if not m.isreg() or ".." in parts or not parts or parts[0] != "results" or len(parts) != 2 \
                    or not re.fullmatch(r"[A-Za-z0-9._-]+\.(tsv|txt)", parts[1]) or m.size > 5_000_000:
                continue
            text = tf.extractfile(m).read().decode("utf-8", "replace")
            text, n = LINK_RE.subn("[link removed]", text)
            removed += n
            with open(os.path.join(out_dir, parts[1]), "w", encoding="utf-8", newline="") as f:
                f.write(text)
            files += 1
    return files, removed


def keep_ui_report(data, out_dir):
    """Write the posted --ui-check report to out_dir/ui-report.txt, links and keys stripped a second time.
    Returns (files kept, items removed)."""
    os.makedirs(out_dir, exist_ok=True)
    text = data.decode("utf-8", "replace")
    text, n = LINK_RE.subn("[link removed]", text)
    text, k = KEY_RE.subn(r"\1\2[removed]", text)
    with open(os.path.join(out_dir, "ui-report.txt"), "w", encoding="utf-8", newline="") as f:
        f.write(text)
    return 1, n + k


def make_handler(st):
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body=b"", ctype="text/plain"):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _route(self):
            parts = self.path.split("?")[0].strip("/").split("/")
            if not parts[0] or not hmac.compare_digest(parts[0].encode(), st.token.encode()):
                return None
            st.contact = time.time()
            return parts[1:]

        def do_GET(self):
            r = self._route()
            if r is None:
                return self._send(404)
            if r == []:
                return self._send(200, st.script.encode())
            if len(r) == 1 and r[0] in ("measure.sh", "measure.lua"):
                with open(os.path.join(HERE, r[0]), "rb") as f:
                    return self._send(200, f.read())
            if len(r) == 2 and r[0] == "link" and r[1] in st.links:
                if "fresh=1" in self.path.partition("?")[2].split("&"):
                    return self._send(200, st.fresh(r[1]).encode())
                return self._send(200, st.links[r[1]].encode())
            self._send(404)

        def do_POST(self):
            r = self._route()
            n = int(self.headers.get("Content-Length") or 0)
            if r is None or n > 50_000_000:
                return self._send(404)
            body = self.rfile.read(n)
            if r == ["status"]:
                st.say("Air: " + scrub(body.decode("utf-8", "replace"))[:300])
                return self._send(200)
            if r == ["results"]:
                try:
                    st.kept = keep_results(body, st.out_dir)
                except Exception as e:
                    st.say("results could not be read (%s)" % type(e).__name__)
                    return self._send(400)
                st.done.set()
                return self._send(200)
            if r == ["ui-report"] and st.ui_check:
                try:
                    st.kept = keep_ui_report(body, st.out_dir)
                except Exception as e:
                    st.say("report could not be read (%s)" % type(e).__name__)
                    return self._send(400)
                st.done.set()
                return self._send(200)
            self._send(404)
    return H


# ---------------------------------------------------------------- network facts
def lan_addresses():
    """(best guess, all private addresses): the guess is the address the default route uses."""
    best = None
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))  # no packet is sent; it only picks the route
        best = s.getsockname()[0]
        s.close()
    except OSError:
        pass
    found = set()
    try:
        found.update(socket.gethostbyname_ex(socket.gethostname())[2])
    except OSError:
        pass
    found = sorted(a for a in found if not a.startswith(("127.", "169.254.")))
    if best and best not in found:
        found.insert(0, best)
    return best or (found[0] if found else None), found


def main(argv=None, creds=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--host", help="address to serve on (default: the Wi-Fi address)")
    ap.add_argument("--api", default=API, help="Stremio API base (tests)")
    ap.add_argument("--cooldown", type=int, default=180, help="seconds between files on the Air")
    ap.add_argument("--end", type=int, help="seconds each file plays (default 600; tests use a few)")
    ap.add_argument("--out", default=os.path.join(ROOT, ".run", "1.1", "air-results"))
    ap.add_argument("--idle", type=int, default=3 * 3600, help="give up after this many seconds without the Air")
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--ui-check", action="store_true", help="T2: install the app on the Air and check its page (no login)")
    ap.add_argument("--probe", action="store_true", help="with --ui-check: run the page probe twice instead of opening the app")
    ap.add_argument("--shell-check", action="store_true", help="T7.1: the AlderProof shell check (webview-1.1 steps 7-11)")
    a = ap.parse_args(argv)

    def say(s):
        print(scrub(s), flush=True)

    if a.probe and not a.ui_check:
        ap.error("--probe goes with --ui-check")
    wanted = SHELL_LABELS if a.shell_check else LABELS
    if a.ui_check:
        links, sources, found = {}, {}, []  # no login, no links: nothing to find
    else:
        email, password = creds or (input("Stremio email: ").strip(), getpass.getpass("Stremio password (not shown): "))
        try:
            say("Logging in to Stremio...")
            key = login(a.api, email, password)
            say("Logged in. Looking for files; this takes a few minutes.")
            sources = {}
            links = find_links(a.api, key, say, labels=wanted, sources=sources)
        except Exception as e:
            say("Stopped: %s. Nothing was started." % (scrub(e) if isinstance(e, RuntimeError) else type(e).__name__))
            return 1
        finally:
            password = key = None
        found = [l for l in wanted if l in links]
        say("Found: " + (", ".join(found) or "nothing"))
        say("Missing: " + (", ".join(l for l in wanted if l not in links) or "none"))
        if not found:
            say("No playable file was found, so there is nothing to measure.")
            return 1
        if a.shell_check and "1080p-h264" not in links:
            say("The check needs a 1080p-h264 file and none was found. Nothing was started.")
            return 1

    host, others = (a.host, [a.host]) if a.host else lan_addresses()
    if not host:
        say("No network address found. Is the Windows computer on Wi-Fi?")
        return 1
    token = "".join(secrets.choice(TOKEN_CHARS) for _ in range(5))
    server = None
    holder = {}
    for port in range(a.port, a.port + 10):
        try:
            server = http.server.ThreadingHTTPServer((host, port), lambda *x, **k: holder["h"](*x, **k))
            break
        except OSError:
            continue
    if not server:
        say("Could not open a port. Close other programs and run again.")
        return 1
    base = "http://%s:%d/%s" % (host, server.server_address[1], token)
    app_tag, app_url = "", ""
    if a.shell_check or a.ui_check:
        rel = find_app_release()
        if rel:
            app_tag, app_url = rel
            say("Newest AlderProof build: %s (the Air will fetch it)." % app_tag)
        else:
            say("Could not look up the newest AlderProof build; the Air will use the app in Applications.")
    template = UI_SCRIPT if a.ui_check else SHELL_SCRIPT if a.shell_check else AIR_SCRIPT
    script = air_script(base, found, template, app_url, app_tag).replace("__UIMODE__", "probe" if a.probe else "open")
    if a.end:
        script = script.replace('main "$@"', 'MEASURE_END=%d; export MEASURE_END\nmain "$@"' % a.end)
    script = script.replace("cool=${ALDER_COOLDOWN:-180}", "cool=${ALDER_COOLDOWN:-%d}" % a.cooldown)
    st = State(token, links, script, a.out, say, sources=sources)
    st.ui_check = a.ui_check
    holder["h"] = make_handler(st)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    print()
    print("On the Air: press Cmd-Space, type Terminal, press Return, then type this line and press Return:")
    print()
    print("    curl -sS http://%s:%d/%s | bash" % (host, server.server_address[1], token))
    print()
    if len(others) > 1:
        print("If that cannot connect, the Windows computer has other addresses: " + ", ".join(x for x in others if x != host))
    print("The Air must be on the same Wi-Fi. If Windows asks about the firewall, press Allow.")
    if a.ui_check:
        if a.probe:
            print("The Air opens the app twice for a few seconds each. Leave both computers alone; this window ends by itself.")
        else:
            print("The Air opens the app for you to use. Quit it with Cmd-Q when done; this window then ends by itself.")
    elif a.shell_check:
        print("The check takes about an hour. Leave both computers alone; this window ends by itself.")
    else:
        print("The run takes about two hours. Leave both computers alone; this window ends by itself.")
    print()
    try:
        while not st.done.wait(5):
            if time.time() - st.contact > a.idle:
                say("No word from the Air for a long time. Stopping; nothing was kept.")
                return 1
    finally:
        server.shutdown()
        server.server_close()
        st.links.clear()
        links.clear()
        sources.clear()
    files, removed = st.kept
    say("Results kept: %d file(s), %d link(s) stripped." % (files, removed))
    say("They are in " + os.path.abspath(a.out))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("Stopped.")
        sys.exit(1)
