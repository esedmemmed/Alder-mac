# Measuring files on the Air

## The easy way (from Windows)

You need the Air on the same Wi-Fi as this Windows computer, plugged in, with its lid open. Everything else is automatic and takes about two hours.

1. On Windows, in the project folder, run `python air/run_from_windows.py` (use the Python named in `.claude/pa.json`). Type your Stremio email and password when asked. They are never saved or shown.
2. After a few minutes it prints which kinds of file it found and which are missing (missing ones are skipped), then one line starting `curl -sS http://`. If Windows asks about its firewall, tick Public networks and press Allow.
3. On the Air press Cmd-Space, type Terminal, press Return, type that line exactly and press Return.
4. Leave both computers alone. The Air plays each file for 10 minutes with a cool-down in between, installs the player itself if needed (it never asks for a password), and sends the results back. At the end the Air says it has finished and the Windows window prints where the results are (`.run/1.1/air-results/`). The links are deleted from both computers. Fan noise: tell Claude by ear, quiet, audible or loud.

If the Air says the player would not start, tell Claude; the status is already on the Windows window.

## The manual way (fallback)

This takes one 10-minute run per file, plus a few minutes of cooling between files. Each step says where to type. "Air Terminal" means press Cmd-Space on the Air, type Terminal, press Return.

Before step 1, the kit must be on GitHub (`bash scripts/publish.sh` on Windows, then the push command it prints).

## 1. Get the kit

In the Air Terminal, paste:

```
mkdir -p ~/AlderProof/mpv && cd ~/AlderProof
curl -fsSLO https://raw.githubusercontent.com/esedmemmed/Alder-mac/main/air/measure.sh
curl -fsSLO https://raw.githubusercontent.com/esedmemmed/Alder-mac/main/air/measure.lua
ls
```

You should see `measure.lua  measure.sh  mpv`. A `curl: (22)` error means the kit is not on GitHub yet.

## 2. Get mpv

In the Air Terminal, paste:

```
cd ~/AlderProof/mpv
curl -fsSLO https://laboratory.stolendata.net/~djinn/mpv_osx/mpv-latest.tar.gz
tar xzf mpv-latest.tar.gz
xattr -dr com.apple.quarantine mpv.app
./mpv.app/Contents/MacOS/mpv --version
```

You should see a first line starting `mpv v0.39.0`. If the Mac refuses to open it instead, open System Preferences, Security & Privacy, General, click Open Anyway, and run the last line again.

If mpv still does not run, try MacPorts: install it from macports.org, run `sudo port install mpv`, and go on; the kit finds `mpv` on your path. If that fails too, install IINA 1.5.0 from iina.io and watch each file there. IINA cannot run this kit, so you would send watch notes only, and say so.

## 3. Put the links on the Air

Links never go into the repository. They stay in one file on the Air, one per line: the label, one space, the link. Use these labels:

```
720p-h264 <link>
1080p-h264 <link>
1080p-hevc8 <link>
1080p-hevc10 <link>
4k-hevc <link>
4k-h264 <link>
dts <link>
truehd <link>
```

The HEVC files are one 8-bit and one 10-bit. `4k-h264` only if one exists. `dts` and `truehd` are any title whose audio is that format.

To write the file, in the Air Terminal paste `nano ~/AlderProof/links.txt`, paste your lines (mail them to yourself, or copy them from a USB stick), press Ctrl-O, Return, Ctrl-X. Then:

```
chmod 600 ~/AlderProof/links.txt
cut -d' ' -f1 ~/AlderProof/links.txt
```

You should see your labels, one per line. Delete that mail afterwards.

## 4. Prepare the Air

Plug in the charger. Quit every other app (Cmd-Q), Safari included: its pages count towards the CPU figure. Leave the Air on a hard surface with the lid open.

## 5. Check the kit with one short run

In the Air Terminal, paste:

```
MEASURE_END=30 bash ~/AlderProof/measure.sh check "$(grep '^1080p-h264 ' ~/AlderProof/links.txt | cut -d' ' -f2-)"
```

The video plays fullscreen for 30 seconds, then the Terminal prints a line starting `label=check mode=bare seconds=` and the macOS version and model. Then paste `cut -f8 ~/AlderProof/results/check.bare.tsv`: below the header you should see CPU numbers, not `unavailable`. If anything is different, stop and send what you see.

## 6. Measure each file

For each label, paste this in the Air Terminal, changing the label in both places:

```
bash ~/AlderProof/measure.sh 1080p-h264 "$(grep '^1080p-h264 ' ~/AlderProof/links.txt | cut -d' ' -f2-)"
```

The video plays fullscreen for 10 minutes and quits on its own. Press no keys, so that pauses are not measured.

During the run, once around minute 5, read the fan. Swipe left with three fingers to reach the Terminal, press Cmd-N for a new window, and paste this; it asks for your Air password, which shows nothing as you type. Then swipe back to the video.

```
sudo powermetrics --samplers smc -n 1 | grep -i fan
```

If that prints no fan speed or an error, use your ear instead: quiet, audible or loud. This command is untested on this Air, and the ear is a fine answer.

Then write your watch notes for that file in `~/AlderProof/notes.txt`, with `nano ~/AlderProof/notes.txt`, one line per file: the label, the fan, whether there was sound, whether it looked smooth, and any stutter you saw. Sound matters most for `dts` and `truehd`.

Wait a few minutes for the Air to cool before the next file.

## 7. Send the results back

In the Air Terminal, paste:

```
cd ~/AlderProof && rm -f results/check.* && zip -r ~/Desktop/alder-results.zip results notes.txt
```

`alder-results.zip` is now on the Desktop. Move it to Windows on a USB stick, or mail it to yourself, and tell Claude where it is on Windows.

Send only that zip. Never send `links.txt` or the `logs` folder: both hold your links.
