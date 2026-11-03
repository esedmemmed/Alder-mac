# Air UI check 1.2 (T9 milestone)

Raw report: `docs/air/raw-1.2/ui-report-walk.txt` (from `PY air/run_from_windows.py --ui-check --out .run/1.2/walk`; never edited). `ui-report.txt` there is T2.1's probe.
Build checked: app.yml run 41677900092 (green), release `app-889a298` (main 3f322d2). Earlier walks on app-ad19ea1: black window (wrong page, then lookbehind regex; fixed 7e4f4a8, T3.1).

## Walk (tick or note)
- opens at full size: ok (developer: all good)
- sign-in with her account: ok
- home / library / add-ons: ok (Stremio movies shown)
- movie details: ok
- series episodes: ok (developer: all good)
- source list; press a source (stub state shows): ok (report: `player stub: playback not available yet`)
- trackpad / mouse / keyboard: ok (developer: all good)
- Cmd-Q quits: ok (exit 0)

## What looks or feels wrong (developer notes; one line each, owner task when known)
- none (developer, 2026-11-03: "all good"); report: boot stages to first screen, no JS errors 
