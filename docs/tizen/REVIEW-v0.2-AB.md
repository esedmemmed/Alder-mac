# Review — v0.2 A (focus treatment) + B (picture size)

Verdict: **PASS** (desktop Chromium; TV check in TV-TEST after 0.2.0).

- `npm test` 491/491, compat 0 errors, shots 110/110 (run independently).
- A: filled focus everywhere except cards; one sliding nav highlight (transform only); current page = softer fill + dot; round buttons fill, grow 1.10 and name themselves; ≥7:1 contrast measured (min 8.13:1); focus move ≤ 15 ms at 4× on all surfaces measured.
- B: Fit = LETTER_BOX (unchanged); Fill implemented via setVideoRoi but gated off (FILL_ENABLED=false) — AVPlay has no documented crop on 2020 TVs and stretch is not acceptable; Info card + Diagnostics show the film's shape and explain bars wider than 16:9.
- Info button now opens an Info card (Title page one press further) — accepted: it is where the shape text lives.

For the TV checklist: icons render (section D fixes), dark-on-dark flash during focus fade, -webkit-text-stroke on the current tab, VIDEO extra_info field names, AUTO_ASPECT_RATIO on an anamorphic file.
