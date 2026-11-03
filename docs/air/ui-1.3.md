# Air use 1.3 (T9.1.1 milestone)

Milestone: his use of the app on the Air and his word, not a measured round (decision 2026-11-04).
Pace and file measurements: `docs/air/results-1.3.md`. Raw reports: `docs/air/raw-1.3/` (stripped, never edited).

## Walk 1: app-c05ccac, 2026-11-04 (push 2)
His words, summarised:
- videos play correctly: ok
- click on the video does not play/pause; only Space does: defect -> T12
- control bar shows only on arrow keys; should show on mouse movement, like Netflix: defect -> T12
- newly added subtitle add-ons not loaded; only the old subtitles appear: defect -> T11.1
- Settings background turns white, text unreadable: defect -> T12
- wants mute and volume up/down: request -> T12

Fixing tasks:
- T11.1 subtitles from every add-on, every language (`src/core/playback.js` chooseAddonSubtitles cap and language filter)
- T12 player mouse, control bar on hover, volume, readable settings

## Walk 2: push 3 (after T11.1, T12 and a green app.yml)
Command: `PY air/run_from_windows.py --ui-check --out .run/1.3/walk`, then he uses the app.
Report: `docs/air/raw-1.3/ui-report-walk2.txt` (pending).
His words: pending.
