# Shell check and web view, phase 1.1

Input for the 1.3 device profile. No links and no keys, ever. Status: not run yet; every slot below is waiting for the Air.

## Steps (about 50 minutes, plugged in, lid open, every other app quit, same Wi-Fi)

The helper fetches the newest CI build of AlderProof onto the Air itself (no DMG to install; if the fetch fails it uses the app in Applications). You never handle a link: Windows finds them, and the Air asks for each one fresh just before it plays.

1. On Windows, in `D:\Adler\Macbook`, run `C:/Users/MSI/AppData/Local/Programs/Python/Python315/python.exe air/run_from_windows.py --shell-check` and type your Stremio email and password. After a few minutes it prints one line starting `curl -sS http://`.
2. On the Air: Cmd-Space, type Terminal, press Return, type that line, press Return. If Windows asks about network access, allow it. Then do not press keys on the Air.

It plays five times with a few minutes' cooling between them: 1080p in mpv (10 min), 1080p in AlderProof with the bar hidden (10 min), then shown (10 min), 4K in AlderProof with the bar shown (2 min), and a fifth 10-minute 1080p run only if the decoder was not the hardware one. Both windows say what is playing; when a play fails they say why (HTTP status or the player's error), never the link. When the Windows window ends, the results are on Windows and the links are deleted from the Air.

## What to watch and send back

Tell Claude in plain words, during or after:
- The two AlderProof 1080p runs and the 4K run: stutter, tearing, a white or black area where the web view is, audio slips, and how loud the fan got around minute 5.
- Any line in either window saying `failed`, as written.

## First open on Big Sur, as it really went

(not run yet)

## Conditions

All 1080p runs use a 1280x720 window, because the shell has no fullscreen launch, so only the player path and the web view differ. This is lighter than a fullscreen picture, and the runs are not comparable with T3's fullscreen `bare` rows.

## Probe output

Dropped from this run: the Probe button needs clicks. Run later if 1.3 needs it.

## Watch notes

(not run yet)
