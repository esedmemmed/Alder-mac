#!/usr/bin/env python
"""Run the whole Air measurement from Windows: one command here, one short line typed on the Air.

Usage:  python air/run_from_windows.py        (see air/RECIPE.md, "The easy way")

1. Asks for the Stremio email and password (password with getpass). They are held in memory only.
2. Logs in, reads the add-on collection, asks the stream add-ons about popular titles, keeps direct links,
   labels them by name, checks each answers, and prints only which labels were found. Never a link.
3. Serves the kit and a script on the LAN and prints the line to type on the Air. Every path needs the token.
4. Collects status lines and the results archive, unpacks `results/` to .run/1.1/air-results/ with anything
   that looks like a link stripped, forgets the links and exits.
With --links-only (T7's setup): steps 1 and 2 for SETUP_LABELS only, then the line typed on the Air writes
~/AlderProof/links.txt and the kit, and nothing plays. Links go only to that file on the Air.
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
SETUP_LABELS = ["1080p-h264", "4k-hevc"]  # what docs/air/webview-1.1.md plays
LINK_RE = re.compile(r"(?i)\b(?:https?|ftp)://\S*")
TOKEN_CHARS = "abcdefghjkmnpqrstuvwxyz23456789"  # no 0/o/1/l/i: it is typed by hand

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


def find_links(api, key, say, movies=MOVIES, series=SERIES, deadline=MAX_SECONDS, check=link_answers, labels=LABELS):
    """{label: url}. Movies first; series only for labels still missing. Deterministic order and tie-break."""
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
                jobs = [(ai, vid, ex.submit(ask_addon, base, kind, vid)) for vid in batch for ai, base in enumerate(addons)]
                for ai, vid, f in jobs:  # collected in submission order, not completion order
                    for text, url in f.result():
                        for label, explicit in classify(text).items():
                            order += 1
                            rank = audio_rank(text) if label in ("dts", "truehd") else 0
                            remux = 1 if re.search(r"remux", text.lower()) else 0
                            cands.setdefault(label, []).append((rank, not explicit, remux, ai, order, url))
            say("looked at %d of %d titles; found %d of %d labels" % (
                min(i + 4, len(ids)), len(ids), sum(1 for l in labels if l in cands), len(labels)))

    if addons:
        sweep("movie", movies)
        if any(l not in cands for l in labels):
            sweep("series", series)
    chosen = {}
    for label in labels:
        for c in sorted(cands.get(label, []))[:5]:
            if check(c[-1]):
                chosen[label] = c[-1]
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


SETUP_SCRIPT = r'''#!/bin/bash
# Alder Air setup: the kit and links.txt, nothing plays. Served by run_from_windows.py --links-only; bash 3.2.
main() {
base="__BASE__"
labels="__LABELS__"
dir=${ALDERPROOF_DIR:-$HOME/AlderProof}
umask 077
say() { curl -s -m 20 -X POST --data-binary "$1" "$base/status" >/dev/null 2>&1 </dev/null; echo "$1"; }
mkdir -p "$dir/results" "$dir/logs" || { say "cannot make $dir"; return 1; }
say "air connected: $(sw_vers -productVersion 2>/dev/null) $(sysctl -n hw.model 2>/dev/null)"
curl -fsS -m 60 "$base/measure.sh" -o "$dir/measure.sh" </dev/null && curl -fsS -m 60 "$base/measure.lua" -o "$dir/measure.lua" </dev/null \
    || { say "could not fetch the kit from Windows"; return 1; }
tmp="$dir/.links"
: > "$tmp"
for label in $labels; do
    link=$(curl -fsS -m 30 "$base/link/$label" </dev/null) || { rm -f "$tmp"; say "could not fetch the $label link"; return 1; }
    printf '%s %s\n' "$label" "$link" >> "$tmp"
done
chmod 600 "$tmp" && mv -f "$tmp" "$dir/links.txt" || { rm -f "$tmp"; say "could not save links.txt"; return 1; }
say "links saved for: $labels"
curl -s -m 20 -X POST "$base/saved" >/dev/null 2>&1 </dev/null
echo
echo "Done. Go on to step 2 of the steps page."
}
main "$@"
'''


def air_script(base, labels, template=AIR_SCRIPT):
    return template.replace("__BASE__", base).replace("__LABELS__", " ".join(labels))


# ---------------------------------------------------------------- server and results
class State:
    def __init__(self, token, links, script_text, out_dir, say, links_only=False):
        self.token, self.links, self.script, self.out_dir, self.say = token, links, script_text, out_dir, say
        self.links_only = links_only
        self.contact = time.time()
        self.done = threading.Event()
        self.kept = None


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
            if r == ["saved"] and st.links_only:
                st.done.set()
                return self._send(200)
            if r == ["results"]:
                try:
                    st.kept = keep_results(body, st.out_dir)
                except Exception as e:
                    st.say("results could not be read (%s)" % type(e).__name__)
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
    ap.add_argument("--links-only", action="store_true", help="only put the kit and links.txt on the Air; nothing plays")
    a = ap.parse_args(argv)

    def say(s):
        print(scrub(s), flush=True)

    wanted = SETUP_LABELS if a.links_only else LABELS
    email, password = creds or (input("Stremio email: ").strip(), getpass.getpass("Stremio password (not shown): "))
    try:
        say("Logging in to Stremio...")
        key = login(a.api, email, password)
        say("Logged in. Looking for files; this takes a few minutes.")
        links = find_links(a.api, key, say, labels=wanted)
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
    if a.links_only and "1080p-h264" not in links:
        say("The test needs a 1080p-h264 file and none was found. Nothing was put on the Air.")
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
    script = air_script(base, found, SETUP_SCRIPT if a.links_only else AIR_SCRIPT)
    if a.end:
        script = script.replace('main "$@"', 'MEASURE_END=%d; export MEASURE_END\nmain "$@"' % a.end)
    script = script.replace("cool=${ALDER_COOLDOWN:-180}", "cool=${ALDER_COOLDOWN:-%d}" % a.cooldown)
    st = State(token, links, script, a.out, say, links_only=a.links_only)
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
    if a.links_only:
        print("This takes seconds and nothing plays. This window ends by itself.")
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
    if a.links_only:
        say("The links are saved on the Air and forgotten here.")
        return 0
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
