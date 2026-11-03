# Air decisions, phase 1.1

Input for the 1.2 and 1.3 work and the 1.3 device profile. No links, ever. Source: the committed table in
`docs/air/results-1.1.md` (T7 rows, run 2026-11-03, app `app-7f04732`, stack `stack-158edb7e678b`); per-interval
pace read from the same run's row files (`*.tsv`, kept off the repo because they sit beside link-bearing logs).
Status: written by T8; approved by the developer 2026-11-03 (pace: accept for 1.1, 1.3 fixes; source limit: as below).

## Wrapper verdict

binding: The wrapper is native AppKit (deployment target 11.0) with the libmpv render API on OpenGL/CGL and a
transparent WKWebView drawn on top. Settled; no way out taken (web view hidden while idle, mpv `wid`, child window,
Tauri v2 all stay unused).
- Evidence, 1080p H.264, 10 min, same file: drop_pct is 0.07 bare, 0.15 hidden, 0.06 shown. All are under 1, and
  shown is lower than hidden, so the drops show no compositing cost. hwdec is `videotoolbox` and stalls are 0 in
  all three.
- Way out 1 (hidden while idle) would gain nothing: hidden and shown measure the same.

## Compositing cost: bare against hidden against shown

binding: For 1080p H.264 on the Air, the HTML bar costs no smoothness and some CPU. cpu_avg is 39.3 bare, 41.0
hidden (+1.7) and 45.3 shown (+6.0); 100 means one logical core, out of 4. drop_pct is 0.07, 0.15 and 0.06.
realtime is 0.999, 0.992 and 0.992.
- Conditions: a 1280x720 window, not fullscreen (the shell has no fullscreen launch). Bare is CI mpv
  `--vo=libmpv` (cocoa-cb); the shell is our own render loop (`mac/shell/VideoView.swift`). Fan not noted in any
  run. The developer watched only the bare run (smooth) and accepted the shell numbers without watching or
  listening.

## Pace finding (not compositing)

- Both shell runs lose time steadily: about 0.07 s per 10 s interval, in all 59 intervals, both modes. Bare
  intervals scatter around 0 (from -0.13 to +0.09). The 0.8% deficit is real, not sampling noise.
- Same deficit hidden and shown, so it is not the overlay. It comes from the shell's player path: our render loop,
  or the web view's process merely being present. With audio as the master clock, a steady lag means short audio
  gaps (about one frame every 6 s) or audio not driving the clock. The shell's sound was never confirmed in a
  measured run. Unverified: the diag filter in `air/measure.sh` drops `audio`/underrun lines.
- Owner: 1.3's libmpv adapter replaces this prototype's player path; see the pace check in the bar.

## Smooth bar, as finally set

binding: A play is smooth when, over 10 minutes of the same file: drop_pct is under 1; `hwdec-current` is
`videotoolbox` for H.264; stalls are 0 (cache pauses excluded, as in the table); realtime is at least 0.99. And
the developer's eyes and ears on the Air outrank the counter.
- Why not the proposed realtime ≥ 1.0: the bare run he watched and called smooth scored 0.999, so that threshold
  failed a play his eyes passed. 0.99 is meant to catch an Air that cannot keep up (4K HEVC: 0.952).
- Openly: 0.99 was set after seeing the shell's 0.992. The shell passes it narrowly, which is weak evidence.
binding: Pace check for the app's player, from 1.3 on: on the same file, the app's realtime is within 0.002 of
bare mpv's, and a 10-minute watch-and-listen with the bar shown is clean. The 1.1 shell fails this today (0.992
against 0.999); 1.3 fixes it.
- Bar met by: 1080p H.264 bare, shell-hidden and shell-shown. Missed by: 4K HEVC (drop_pct 54.24, realtime
  0.952, shell-shown, 120 s).
- 1080p H.264 passes on bare mpv, so the stop rule (REPLAN) does not trigger.

## Default source limit and manual picks (1.3 device profile)

binding: Default sources are H.264 (AVC) 8-bit, up to 1920x1080, up to 30 fps. Ranking picks the best source
inside that limit.
binding: Manual picks are always offered, never hidden: any HEVC; any 4K (above 1920x1080); H.264 above 30 fps;
H.264 10-bit.
binding: Audio codec is not a ranking filter. DTS and TrueHD are expected to play through FFmpeg downmixed;
1.3's developer run settles it.
- Measured: 1080p H.264 23.976 fps passes (all three modes); 4K HEVC fails badly.
- Inferred, not measured (T3's bare rows were never filled): 720p H.264 is lighter than the measured 1080p. 1080p
  HEVC and 4K H.264 are unmeasured. Haswell's HD 5000 has no HEVC hardware decoder, so VideoToolbox HEVC likely
  decodes in software (general knowledge, unverified). 10-bit H.264 has no hardware path. 50/60 fps doubles the
  frame rate that was measured.
- Fullscreen at 1440x900 is unmeasured (all runs used a 1280x720 window); 1.3's developer run plays fullscreen.

## For 1.2: web view facts

- Big Sur's WebKit version: not recorded. The probe was dropped from the T7 run (`webview-1.1.md`, Probe output).
- Origin and `fetch` to `api.strem.io` and add-on hosts from the custom scheme: not recorded.
- Recommendation: the custom scheme stays for loading the page. 1.2's first Air check runs the probe (one click)
  and records `navigator.userAgent` plus one `fetch` each to `api.strem.io` and to one of her add-ons. Requests
  move to a native fetch through the bridge only if that `fetch` is refused (CORS from a custom-scheme origin).
