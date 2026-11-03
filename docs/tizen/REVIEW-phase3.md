# Review — Phase 3 (player)

Verdict: **PASS** after one round of fixes.

Checked by the manager:
- `npm test` 393/393, compat 0 errors, build OK, shots 19 (run independently).
- Engine vs PlayerActivity.kt: constants, failover order, retries (fresh START_WAIT per retry), audio decision before play, mid-film audio fallback, stall offer, resume slack, nothing saved before a picture.
- Options panel vs Alder docs/tracks.jpg: matches; unplayable DTS track greyed "No sound on this TV", AC3 ticked.
- Diagnostics shows raw AVPlay track info and decisions — the evidence we need from the first TV run.

Fixes made in review round:
1. Picture signal tightened: time advancing after play() (≥ start + 500 ms or two increasing reports), not buffering completion — otherwise a decoder that refuses the video would never fail over.
2. Controls title: logo → name → nothing, never an id.

Carry into Phase 4:
- Replace TEMP hooks (`src/player/demo.js`, TEMP lines in main.js and ui/demo.js); wire `context.player` and `onNavigate` (exit, sources, next, details).
- Settings → About: Diagnostics row calling `openDiagnostics(context)`.
- Add missing subtitle fixtures `subs.fixture.test/sev104/*.srt`.
