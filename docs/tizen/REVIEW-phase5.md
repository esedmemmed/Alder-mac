# Review — Phase 5 (integration, performance, release)

Verdict: **PASS** — v0.1.0 released for the first on-TV test.

Checked by the manager:
- `npm test` 463/463, compat 0 errors, `npm run shots` 69/69 (incl. the full sign-in → play → failover → progress → Up Next → Diagnostics journey), build + verify-wgt OK, no dev code in dist (checked independently).
- Journey bugs fixed: title page focus from Home; progress written to the matching library item only (`_id` must equal the title — important for real accounts); upstream credit to aradhyas8/Alder.
- Fast-Back race: closed sessions ignore late AVPlay callbacks; engine starts no timers after shutdown; 7 new tests.
- Perf at 4× throttle well inside budget (first Home paint 0.4–0.8 s from kept answers, focus 2.7 ms, screen changes 106–229 ms).
- SETUP.md checked against Apps2Samsung's real button names; releases link filled in.

Alder.wgt v0.1.0: 452.7 KB, sha256 075e77e9298be09dc2e0c95045f96a455b33e97add3d7ef747bb23eea5566f12.

Next: owner installs and runs docs/TV-TEST.md; Diagnostics photos drive v0.1.x fixes (first unknowns: AVPlay extra_info shape, picture/time events, HTTP error data, add-on CORS).
