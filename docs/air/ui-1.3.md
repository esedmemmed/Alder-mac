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

## Walk 2: app-46744f8, 2026-11-04 (push 3)
Command: `PY air/run_from_windows.py --ui-check --out .run/1.3/walk`, then he uses the app.
Report: none arrived in `.run/1.3/walk` (not filed).
His words, summarised:
- newly added add-on subtitles load: ok (T11.1)
- click plays and pauses; double-click toggles fullscreen: ok (T12)
- control bar shows on mouse movement: ok (T12)
- volume buttons and M mute work: ok (T12)
- Settings is fixed, readable: ok (T12)
- clicking a subtitle (or audio) entry in the player menu does not select it; arrows and OK do: defect -> T12.1
- the display/system sleeps during playback: defect -> T12.1 (power assertion while playing)
- wants Up/Down to change volume during playback when no menu has focus: request -> T12.1
- hovering a row on home and the library races it sideways: defect -> T12.1 (edge-only, calm scroll)
- during playback only Esc goes back; no way back with the mouse: defect -> T12.1 (Back button top-left, with the control bar, same as Esc)
- wants the subtitle language remembered across episodes: scope of phase 1.4, not 1.3

Fixing task: T12.1. Walk 3 follows on the T12.1 build (push 4).

## Walk 3: push 4 (pending his walk)
Command: `PY air/run_from_windows.py --ui-check --out .run/1.3/walk3`, then he uses the app.
Report: to be filed stripped as `docs/air/raw-1.3/ui-check-walk3.json` (walk 2 filed none).
Walk-2 defects to check: subtitle pick by mouse; screen kept awake while playing; Up/Down volume keys; home-row hover scroll speed; Back button top-left.
His words: (pending)
