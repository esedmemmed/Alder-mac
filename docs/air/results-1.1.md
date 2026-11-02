# Air results, phase 1.1

Input for the 1.3 device profile. No links, ever. Machine facts, copied once from a `*.machine.txt`:

- product_version:
- build:
- model:
- ram_bytes:

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
| 1080p-h264 (T7, 1280x720 window, CI mpv) | bare | | | | | | | | | | | | |
| 1080p-h264 (T7, 1280x720 window) | shell-hidden | | | | | | | | | | | | |
| 1080p-h264 (T7, 1280x720 window) | shell-shown | | | | | | | | | | | | |
| 4k-hevc (T7, 120 s counter check) | shell-shown | | | | | | | | | | | | |

## What the columns mean

- Row file `~/AlderProof/results/<label>.<mode>.tsv`, one header line, then one row per 10 s: `wall_s  time_pos  frame_drops  decoder_drops  hwdec  fps_est  paused_for_cache  cpu_total_pct`. `paused_for_cache` is `yes` or `no`. A property that does not exist writes `unavailable`, never 0.
- `drop_pct`: `frame_drops / (time_pos advance * fps)`, as a percentage.
- `fps`: the median `estimated-vf-fps`, replaced by `container-fps` when the two agree within 5%, since the container's value is exact when true and can be bogus.
- `realtime`: `time_pos` advance over wall seconds, not counting time in `paused-for-cache`, so a slow link is not read as a slow Air.
- `stalls`: times playback paused for cache after it began.
- `cpu_avg`: mean of `cpu_total_pct`, summed over mpv or AlderProof, `com.apple.WebKit.WebContent` and `WindowServer`. 100 means one logical core.
- `fan`: `powermetrics` rpm if it worked, else quiet, audible or loud by ear.
