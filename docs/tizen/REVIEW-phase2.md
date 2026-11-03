# Review — Phase 2 (core logic port)

Verdict: **PASS**.

Checked by the manager:
- `node --test "test/core/**/*.test.js"`: 183 pass, 0 fail (run independently).
- `ranking.js rank()` vs `StreamsActivity.kt rank()`: same keys and order; Tizen keys inserted per PLAN §5. `preferenceScore` matches `preference()` minus the receiver term.
- `addon.js Stream` regexes vs `Addon.kt`: verbatim (height, DV, HDR, AV1, remux/bluray/web, cam, 3D, hard subs, bigAudio, multi, dub, isVideo 50 MiB).
- `audio.js bestAudio` vs `PlayerActivity.kt bestAudio`: same tie-breaking (first max wins); playable-first key added.
- Bitfield deviation reviewed against stremio-core's resize semantics: accepted.

Carry into Phase 3:
- Pass the audio language as Alder does: Settings' audio language, else the TV's language (`tizen.systeminfo` LOCALE / `navigator.language`), never empty when one is known.
- Real AVPlay `extra_info` shape is unknown: Diagnostics must show raw track info.
