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

## Walk 3: app-27da36d, 2026-11-05 (push 4)
Command: `PY air/run_from_windows.py --ui-check --out .run/1.3/walk3`, then he uses the app.
Report: none arrived (`.run/1.3/walk3` absent on 2026-11-05); nothing filed in `docs/air/raw-1.3/`.
Walk-2 defects to check: subtitle pick by mouse; screen kept awake while playing; Up/Down volume keys; home-row hover scroll speed; Back button top-left.
His words:
- row scroll on home and the library is slower now: fixed
- subtitle pick by mouse works: fixed
- scrolling a row right or left splits the screen in two and cuts the side menu (Home, Movies, My list) in half: defect -> T12.1.1 (side menu stays whole and fixed, only the row moves)
- with the subtitle or audio menu open, a click on the video does not close it: defect -> T12.1.1 (closes like Esc, no play/pause toggle)
- subtitle delay steps of 0.25 s are too coarse: defect -> T12.1.1 (0.1 s on the Mac; Tizen unchanged)

Fixing task: T12.1.1. Walk 4 follows on the T12.1.1 build (push 5).

## Walk 4: app-d380b3d, 2026-11-05 (push 5)
His words:
- the side menu no longer splits when a row scrolls: fixed
- the screen stays awake while playing: fixed
- Up and Down change the volume: works
- the Back button works
- subtitle delay steps of 0.1 s work
- with the subtitle or audio menu open, a click on the video still does not close it: defect -> T12.1.1.1

Cause found (from code): the full-size `.pl-options` root swallowed the click as a 'panel' hit, so the close never ran. Fixing task: T12.1.1.1 (only the visible panel and bar count as the menu; cards close the same way; each click while a menu or card is open logs a `menu-click:` line). Walk 5 checks the `menu-click:` lines in the ui-check report.

## Walk 5: app-780cc28, 2026-11-05 (push 6)
His words:
- a click on the video now closes the subtitle menu: works
- the detail page with Resume, Start over and Add to list has no Back button; only Esc goes back: defect -> T12.1.1.1.1 (a Back button, top left, on every screen above Home except the player, which has its own; a click is the Esc press)
- some add-ons' subtitles show up late in the menu: defect -> T12.1.1.1.1 (all add-ons asked at once, the menu fills as each answers, answers kept per video id; each request logs `subs-addon:` start, ms and count, and the ui-check report gets a line per add-on and a `slow add-on` line at 3000 ms or more)
- the mouse wheel and trackpad do not scroll the audio and subtitle menus, only Up/Down keys: defect -> T12.1.1.1.1 (the wheel steps the open list like Up/Down and is consumed, so volume and seek never change)

Fixing task: T12.1.1.1.1. Walk 6 follows on its build. Nothing measured on the Air yet.
