# Air results, phase 1.1

Input for the 1.3 device profile. No links, ever. Machine facts, copied once from a `*.machine.txt`:

- product_version: 11.7.11
- build: 20G1443
- model: MacBookAir6,2
- ram_bytes: 4294967296 (AC power at every T7 run start)

## Results

Values come from each file's `*.summary.txt`. Bar proposed in R0-005, confirmed or changed by T8: 10 minutes, realtime at least 1.0, drop_pct under 1, hwdec `videotoolbox`.

| label | mode | seconds | drops | decoder_drops | drop_pct | hwdec | realtime | stalls | fps | cpu_avg | fan | sound | watch notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 720p-h264 | bare | | | | | | | | | | | | |
| 1080p-h264 | bare | | | | | | | | | | | | |
| 1080p-hevc8 | bare | | | | | | | | | | | | |
| 1080p-hevc10 | bare | | | | | | | | | | | | |
| 4k-hevc | bare | | | | | | | | | | | | |
| 4k-h264 | bare | | | | | | | | | | | | |
| dts | bare | | | | | | | | | | | | |
| truehd | bare | | | | | | | | | | | | |
| 1080p-h264 (T7, 1280x720 window, CI mpv) | bare | 599.9 | 10 | 0 | 0.07 | videotoolbox | 0.999 | 0 | 23.976 | 39.3 | not noted | yes | smooth (developer watched) |
| 1080p-h264 (T7, 1280x720 window) | shell-hidden | 599.9 | 21 | 0 | 0.15 | videotoolbox | 0.992 | 0 | 23.976 | 41.0 | not noted | not noted | not watched |
| 1080p-h264 (T7, 1280x720 window) | shell-shown | 599.9 | 9 | 0 | 0.06 | videotoolbox | 0.992 | 0 | 23.976 | 45.3 | not noted | not noted | not watched |
| 4k-hevc (T7, 120 s counter check) | shell-shown | 120.0 | 1560 | 0 | 54.24 | videotoolbox | 0.952 | 0 | 23.976 | 48.8 | not noted | not noted | not watched; T7.1 run (no numbers) froze a bit |

T7 rows: run 2026-11-03, app `app-7f04732`, stack `stack-158edb7e678b`; source `docs/air/raw-1.1/*.summary.txt` (raw outputs, never edited).
- 1080p shell vs bare: drop_pct within 0.1, hwdec videotoolbox in the shell, so the web view costs ~2-6 cpu points and no smoothness. realtime 0.992 is under the 1.0 bar by 0.8%; T8 judges it (stalls 0).
- 4k-hevc: unwatchable (54% drops). The frame-drop counter moves under `vo=libmpv`, so the shell's drop counts are evidence. `hwdec=videotoolbox` for HEVC on this GPU is likely VideoToolbox's software decoder (unverified).
- Developer accepted the numbers without watching the shell plays (2026-11-03).

## What the columns mean

- Row file `~/AlderProof/results/<label>.<mode>.tsv`, one header line, then one row per 10 s: `wall_s  time_pos  frame_drops  decoder_drops  hwdec  fps_est  paused_for_cache  cpu_total_pct`. `paused_for_cache` is `yes` or `no`. A property that does not exist writes `unavailable`, never 0.
- `drop_pct`: `frame_drops / (time_pos advance * fps)`, as a percentage.
- `fps`: the median `estimated-vf-fps`, replaced by `container-fps` when the two agree within 5%, since the container's value is exact when true and can be bogus.
- `realtime`: `time_pos` advance over wall seconds, not counting time in `paused-for-cache`, so a slow link is not read as a slow Air.
- `stalls`: times playback paused for cache after it began.
- `cpu_avg`: mean of `cpu_total_pct`, summed over mpv or AlderProof, `com.apple.WebKit.WebContent` and `WindowServer`. 100 means one logical core.
- `fan`: `powermetrics` rpm if it worked, else quiet, audible or loud by ear.
