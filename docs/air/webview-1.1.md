# Shell check and web view, phase 1.1

Input for the 1.3 device profile. No links and no keys, ever. Status: not run yet; every slot below is waiting for the Air.

## Steps (about 50 minutes, plugged in, lid open, every other app quit)

"Terminal" means the Air's Terminal: Cmd-Space, type Terminal, press Return. Do it all in one sitting on the same Wi-Fi.

1. Links. If `~/AlderProof/links.txt` or `~/AlderProof/measure.sh` is missing, follow `air/RECIPE.md` steps 1 and 3; only `1080p-h264` and `4k-hevc` are needed here. If the `1080p-h264` link has expired, replace it now and use that one link for all three runs.
2. Download in Safari on the Air: https://github.com/esedmemmed/Alder-mac/releases/download/app-e585081/AlderProof.dmg
3. Open the DMG and drag the app to Applications. Double-click it there. Expect it to be blocked; write down the exact message.
4. Right-click the app, Open. If that does not offer Open: System Preferences, Security & Privacy, General, Open Anyway. Last resort, in Terminal, and say you used it: `xattr -dr com.apple.quarantine /Applications/AlderProof.app`

   If it will not start at all, run this in Terminal, send what it prints, and stop: `/Applications/AlderProof.app/Contents/MacOS/AlderProof 2>&1 | head -30`
5. Paste-link play. With the app closed, in Terminal: `grep '^1080p-h264 ' ~/AlderProof/links.txt | cut -d' ' -f2- | pbcopy`. Double-click the app, click the link box and try Cmd-V; if nothing appears, right-click the box and choose Paste. Press Load and let it play for a minute. Note which paste worked. If neither did, say so, and start it instead with `/Applications/AlderProof.app/Contents/MacOS/AlderProof --url "$(grep '^1080p-h264 ' ~/AlderProof/links.txt | cut -d' ' -f2-)"`.
6. Probe, while the app is open: click Probe, wait until "Running..." is replaced, click Copy. Then in Terminal: `pbpaste > ~/AlderProof/results/probe.txt; wc -l ~/AlderProof/results/probe.txt`. It should count more than one line. Quit the app with Cmd-Q and clear the clipboard with `echo | pbcopy`.
7. Fetch our CI mpv, in Terminal. The last command's first line should start `mpv v0.41.0`.

   ```
   mkdir -p ~/AlderProof/ci-mpv && cd ~/AlderProof/ci-mpv
   curl -fsSL https://github.com/esedmemmed/Alder-mac/releases/download/stack-158edb7e678b/mpv-cli-158edb7e678b.tar.gz | tar xz
   ./mpv --version
   ```
8. Set up this Terminal window. If you open a new window, paste this there again.

   ```
   L=$(grep '^1080p-h264 ' ~/AlderProof/links.txt | cut -d' ' -f2-)
   H=$(grep '^4k-hevc ' ~/AlderProof/links.txt | cut -d' ' -f2-)
   export ALDERPROOF_BIN=/Applications/AlderProof.app/Contents/MacOS/AlderProof
   M=~/AlderProof/measure.sh
   ```
9. Three 10-minute runs, one line at a time, with a few minutes' cooling between them and no keys pressed. Each prints a line starting `label=` when it ends. Watch the last two closely, and around minute 5 of each read the fan as in `air/RECIPE.md` step 6.

   ```
   MPV_BIN=~/AlderProof/ci-mpv/mpv MEASURE_EXTRA="--no-fs --geometry=1280x720" bash $M 1080p-h264 "$L" bare
   bash $M 1080p-h264 "$L" shell-hidden
   bash $M 1080p-h264 "$L" shell-shown
   ```
10. Does the drop counter work in the shell? A 2-minute heavy run with the bar shown: `MEASURE_END=120 bash $M 4k-hevc "$H" shell-shown`. Note whether it visibly struggled.
11. Read the decoder: `grep -ho 'hwdec=[^ ]*' ~/AlderProof/results/1080p-h264.shell-*.summary.txt`. If either does not say `videotoolbox`, run this once more (10 minutes):

    ```
    "$ALDERPROOF_BIN" --url "$L" --overlay shown --end 600 --hwdec videotoolbox-copy --measure ~/AlderProof/measure.lua --label 1080p-h264-copy > ~/AlderProof/logs/copy.player.log 2>&1
    ```
12. Notes: `nano ~/AlderProof/notes.txt`, then Ctrl-O, Return, Ctrl-X. Write what really happened in steps 3 to 5, and for the two watched runs and the heavy run: stutter, tearing, a white or black web view, audio slips, fan.
13. Send back: `cd ~/AlderProof && zip -r ~/Desktop/alder-shell-check.zip results notes.txt`. Move that zip to Windows on a USB stick or by mail and say where it is. Never send `links.txt` or the `logs` folder: both hold links.

## First open on Big Sur, as it really went

(not run yet)

## Conditions

All three runs use a 1280x720 window, because the shell has no fullscreen launch, so only the player path and the web view differ. This is lighter than a fullscreen picture, and the runs are not comparable with T3's fullscreen `bare` rows.

## Probe output

Run with no key. To be checked for links and keys before committing.

```
(not run yet)
```

## Watch notes

(not run yet)
