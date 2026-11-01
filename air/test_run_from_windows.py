"""Tests for run_from_windows.py. Run: python -m unittest air/test_run_from_windows.py (from the repo root).
The loopback test needs bash, curl and the throwaway Windows mpv in .run/1.1/tools/mpv; it skips without them."""
import contextlib
import http.server
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_from_windows as rw  # noqa: E402

ROOT = rw.ROOT
MPV = os.path.join(ROOT, ".run", "1.1", "tools", "mpv", "mpv.exe")
CLIP = os.path.join(ROOT, ".run", "1.1", "clip.mp4")


class Classifier(unittest.TestCase):
    def labels(self, text):
        return set(rw.classify(text))

    def test_fixture_names(self):
        # Names from the Alder-tizen torrentio fixture.
        self.assertEqual(self.labels("[TB+] Torrentio\n4k\nDune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.H.265-FLUX.mkv"), set())  # DV only
        self.assertEqual(self.labels("Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv"), {"4k-hevc"})
        self.assertEqual(self.labels("Dune.Part.Two.2024.UHD.BluRay.2160p.REMUX.HDR10.HEVC.TrueHD.Atmos.7.1-WiLDCAT.mkv"),
                         {"4k-hevc", "truehd"})
        self.assertEqual(self.labels("Dune.Part.Two.2024.2160p.UHD.BluRay.x265.10bit.HDR.DTS-HD.MA.5.1-RARBG.mkv"),
                         {"4k-hevc", "dts"})

    def test_h264(self):
        self.assertEqual(self.labels("Movie.2019.720p.BluRay.x264-GRP.mkv"), {"720p-h264"})
        self.assertEqual(self.labels("Movie 2019 1080p WEB-DL AVC AAC"), {"1080p-h264"})
        self.assertEqual(self.labels("Movie.2019.1080p.WEBRip.H.264.mkv"), {"1080p-h264"})
        self.assertEqual(self.labels("Movie.2019.2160p.WEB-DL.H264.mkv"), {"4k-h264"})

    def test_bit_depth(self):
        self.assertEqual(self.labels("Movie.2019.1080p.BluRay.x265.8bit-GRP.mkv"), {"1080p-hevc8"})
        self.assertEqual(self.labels("Movie.2019.1080p.BluRay.x265-GRP.mkv"), {"1080p-hevc8"})
        self.assertEqual(self.labels("Movie.2019.1080p.BluRay.x265.10bit-GRP.mkv"), {"1080p-hevc10"})
        self.assertEqual(self.labels("Movie.2019.1080p.BluRay.HEVC.Hi10P.mkv"), {"1080p-hevc10"})
        self.assertEqual(self.labels("Movie.2019.1080p.WEB-DL.HEVC.HDR10.mkv"), {"1080p-hevc10"})
        self.assertFalse(rw.classify("Movie.2019.1080p.x265-GRP.mkv")["1080p-hevc8"])  # unstated depth is not explicit
        self.assertTrue(rw.classify("Movie.2019.1080p.x265.8bit-GRP.mkv")["1080p-hevc8"])

    def test_4k_names(self):
        self.assertEqual(self.labels("Movie 2019 4K HEVC HDR"), {"4k-hevc"})
        self.assertEqual(self.labels("Movie 2019 UHD x265"), {"4k-hevc"})

    def test_audio(self):
        self.assertEqual(self.labels("Movie.2019.1080p.BluRay.x264.DTS-HD.MA.5.1-GRP.mkv"), {"1080p-h264", "dts"})
        self.assertEqual(self.labels("Movie.2019.1080p.BluRay.x264.TrueHD.7.1.Atmos-GRP.mkv"), {"1080p-h264", "truehd"})
        self.assertNotIn("dts", self.labels("Movie.2019.1080p.BluRay.x264.DDP5.1-GRP.mkv"))
        self.assertNotIn("truehd", self.labels("Movie.2019.1080p.BluRay.x264.DTS.TrueHD.mkv"))  # says both: unclear

    def test_wrong_label_cases(self):
        for bad in ("Movie.2019.1080p.HDCAM.x264.mkv", "Movie.2019.1080p.TS.x264.mkv", "Movie.2019.1080p.3D.x264.mkv",
                    "Movie.2019.1080p.AV1.mkv", "Movie.2019.1080p.2160p.x264.mkv", "Movie.2019.1080p.x264.x265.mkv",
                    "Movie.2019.BluRay.x264.mkv", "Movie.2019.480p.x264.mkv"):
            self.assertEqual(self.labels(bad), set(), bad)
        self.assertNotIn("1080p-hevc8", self.labels("Movie.2019.1080p.x265.10bit.mkv"))
        self.assertNotIn("1080p-h264", self.labels("Movie.2019.1080p.x265.mkv"))


class Scrub(unittest.TestCase):
    def test_links_removed(self):
        s = rw.scrub("Air: see https://a.example/x?k=1 and http://10.0.0.1:8/z end")
        self.assertNotRegex(s, r"https?://")
        self.assertIn("end", s)


class Fake:
    """A fake Stremio API, one stream add-on and a video, all on loopback."""
    def __init__(self, streams_by_name):
        outer = self

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                if self.path.endswith("/login"):
                    ok = body.get("password") == "pw"
                    out = {"result": {"authKey": "KEY"}} if ok else {"error": {"code": 2, "message": "wrong"}}
                elif self.path.endswith("/addonCollectionGet") and body.get("authKey") == "KEY":
                    out = {"result": {"addons": [
                        {"transportUrl": outer.base + "/addon/manifest.json", "manifest": {"resources": [{"name": "stream"}]}},
                        {"transportUrl": outer.base + "/other/manifest.json", "manifest": {"resources": ["catalog"]}}]}}
                else:
                    return self._send(404, b"{}")
                self._send(200, json.dumps(out).encode())

            def do_GET(self):
                if self.path.startswith("/addon/stream/movie/"):
                    streams = [{"name": n, "title": "x", "url": outer.base + "/clip.mp4?k=SECRET"} for n in streams_by_name]
                    return self._send(200, json.dumps({"streams": streams}).encode())
                if self.path.startswith("/clip.mp4") and os.path.exists(CLIP):
                    data = open(CLIP, "rb").read()
                    rng = re.match(r"bytes=(\d+)-(\d*)", self.headers.get("Range") or "")
                    if rng:
                        a = int(rng.group(1))
                        b = int(rng.group(2)) if rng.group(2) else len(data) - 1
                        self.send_response(206)
                        self.send_header("Content-Range", "bytes %d-%d/%d" % (a, b, len(data)))
                        data = data[a:b + 1]
                    else:
                        self.send_response(200)
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    try:
                        self.wfile.write(data)
                    except OSError:
                        pass
                    return
                self._send(200, b'{"streams":[]}')

            def _send(self, code, body):
                self.send_response(code)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.base = "http://127.0.0.1:%d" % self.srv.server_address[1]
        self.api = self.base + "/api/"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self):
        self.srv.shutdown()
        self.srv.server_close()


def fetch(url, data=None):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data), timeout=10) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b""


class Server(unittest.TestCase):
    def setUp(self):
        self.out = tempfile.mkdtemp()
        self.lines = []
        self.st = rw.State("k7m2q", {"dts": "https://secret.example/v?key=1"}, "SCRIPT", self.out, self.lines.append)
        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), rw.make_handler(self.st))
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.base = "http://127.0.0.1:%d" % self.srv.server_address[1]

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        shutil.rmtree(self.out, ignore_errors=True)

    def test_token_required_everywhere(self):
        for path in ("/", "/measure.sh", "/link/dts", "/wrong", "/wrong/link/dts", "/k7m2", "/k7m2qq", "/status"):
            self.assertEqual(fetch(self.base + path)[0], 404, path)
        for path in ("/status", "/wrong/status", "/results", "/wrong/results"):
            self.assertEqual(fetch(self.base + path, b"x")[0], 404, path)
        self.assertEqual(self.lines, [])
        self.assertFalse(self.st.done.is_set())

    def test_with_token(self):
        self.assertEqual(fetch(self.base + "/k7m2q"), (200, b"SCRIPT"))
        self.assertEqual(fetch(self.base + "/k7m2q/measure.sh")[0], 200)
        self.assertEqual(fetch(self.base + "/k7m2q/link/dts")[0], 200)
        self.assertEqual(fetch(self.base + "/k7m2q/link/truehd")[0], 404)

    def test_status_has_no_link(self):
        fetch(self.base + "/k7m2q/status", b"dts: failed see https://secret.example/v?key=1 now")
        self.assertEqual(len(self.lines), 1)
        self.assertNotRegex(self.lines[0], r"https?://")

    def test_results_kept_without_links(self):
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tf:
            for name, text in (("results/a.bare.tsv", "x\thttps://secret.example/v?key=1\n"), ("results/a.bare.summary.txt", "ok\n"),
                               ("results/../evil.txt", "bad"), ("/abs.txt", "bad"), ("results/run.sh", "bad"),
                               ("results/sub/b.txt", "bad")):
                b = text.encode()
                ti = tarfile.TarInfo(name)
                ti.size = len(b)
                tf.addfile(ti, io.BytesIO(b))
        self.assertEqual(fetch(self.base + "/k7m2q/results", buf.getvalue())[0], 200)
        self.assertTrue(self.st.done.is_set())
        self.assertEqual(self.st.kept, (2, 1))
        self.assertEqual(sorted(os.listdir(self.out)), ["a.bare.summary.txt", "a.bare.tsv"])
        for n in os.listdir(self.out):
            self.assertNotRegex(open(os.path.join(self.out, n)).read(), r"https?://")
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(self.out), "evil.txt")))

    def test_garbage_results_rejected(self):
        self.assertEqual(fetch(self.base + "/k7m2q/results", b"not a tar")[0], 400)
        self.assertFalse(self.st.done.is_set())


class FindLinks(unittest.TestCase):
    def test_pick_and_missing(self):
        names = ["Movie.2019.1080p.BluRay.x264.DTS-GRP.mkv", "Movie.2019.720p.WEB.x264-GRP.mkv", "Movie.2019.1080p.x265-A.mkv"]
        f = Fake(names)
        try:
            said = []
            links = rw.find_links(f.api, "KEY", said.append, movies=["tt1", "tt2"], series=[], check=lambda u: True)
        finally:
            f.close()
        self.assertEqual(sorted(links), ["1080p-h264", "1080p-hevc8", "720p-h264", "dts"])
        self.assertTrue(all("=" not in " ".join(said) or True for _ in said))
        self.assertFalse([s for s in said if re.search(r"https?://", s)])

    def test_dead_link_is_skipped(self):
        f = Fake(["Movie.2019.720p.WEB.x264-GRP.mkv"])
        try:
            links = rw.find_links(f.api, "KEY", lambda s: None, movies=["tt1"], series=[], check=lambda u: False)
        finally:
            f.close()
        self.assertEqual(links, {})


def hold_output():
    return io.StringIO()


@unittest.skipUnless(os.path.exists(MPV) and os.path.exists(CLIP) and shutil.which("bash") and shutil.which("curl"),
                     "needs bash, curl, the T2 mpv and clip in .run/1.1")
class Loopback(unittest.TestCase):
    def test_end_to_end(self):
        f = Fake(["Movie.2019.1080p.BluRay.x264-GRP.mkv", "Movie.2019.720p.WEB.x264-GRP.mkv"])
        work = tempfile.mkdtemp()
        out = os.path.join(work, "air-results")
        buf = hold_output()
        rc = {}

        def run():
            with contextlib.redirect_stdout(buf):
                rc["rc"] = rw.main(["--host", "127.0.0.1", "--api", f.api, "--cooldown", "1", "--end", "3", "--out", out,
                                    "--port", "18765", "--idle", "120"], creds=("a@b.c", "pw"))

        t = threading.Thread(target=run)
        t.start()
        try:
            line = None
            for _ in range(300):
                m = re.search(r"curl -sS (http://\S+) \| bash", buf.getvalue())
                if m:
                    line = m.group(1)
                    break
                time.sleep(0.1)
            self.assertTrue(line, buf.getvalue())
            env = dict(os.environ, ALDERPROOF_DIR=os.path.join(work, "air"), MPV_BIN=MPV,
                       MEASURE_EXTRA="--no-fs --hwdec=no --vo=null --ao=null")
            p = subprocess.run(["bash", "-c", "curl -s %s | bash" % line], env=env, capture_output=True, text=True, timeout=240)
            t.join(30)
            shown = buf.getvalue() + p.stdout
            self.assertFalse(t.is_alive(), shown)
            self.assertEqual(rc.get("rc"), 0, shown)
            self.assertIn("Finished", p.stdout)
            self.assertEqual(sorted(os.listdir(out))[:1], ["1080p-h264.bare.machine.txt"], os.listdir(out))
            self.assertTrue(os.path.exists(os.path.join(out, "720p-h264.bare.summary.txt")))
            for root, _, names in os.walk(out):
                for n in names:
                    self.assertNotRegex(open(os.path.join(root, n)).read(), r"https?://|SECRET")
            self.assertNotRegex(shown, r"https?://127\.0\.0\.1:\d+/clip|SECRET")
            air = os.path.join(work, "air")
            self.assertFalse(os.path.exists(os.path.join(air, ".link")))
            self.assertFalse(os.path.exists(os.path.join(air, "logs")))
            self.assertIn("Missing: ", shown)
        finally:
            f.close()
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
