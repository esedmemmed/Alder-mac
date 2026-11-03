# mac/test

`clip.mp4`: 5 s, 320x240, 25 fps H.264 (High) + AAC-LC mono 44.1 kHz, 127530 bytes.
Synthetic: lavfi `testsrc2` pattern and a 440 Hz `sine` tone. It holds no third-party content.
Used by `mac/ci/check-bundle.sh --features` as the smoke-play input.

Generated on Windows with a static gyan.dev ffmpeg build (libx264), command:

```
ffmpeg -hide_banner -y -f lavfi -i "testsrc2=size=320x240:rate=25:duration=5" -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=5" -c:v libx264 -preset medium -crf 30 -pix_fmt yuv420p -c:a aac -b:a 48k -ac 1 -movflags +faststart -map_metadata -1 -fflags +bitexact -flags:v +bitexact -flags:a +bitexact -shortest mac/test/clip.mp4
```
