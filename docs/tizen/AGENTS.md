# AGENTS.md — rules for coding agents on Alder Tizen

Read `PLAN.md` first. It is the source of truth. The manager (Opus) reviews everything you commit.

## Non-negotiable
1. **Port, don't invent.** Behaviour, constants, regexes, thresholds and wording come from Alder's Kotlin at
   `/home/claude/esedmemmed/alder/app/src/main/java/dev/alder/`. Open the matching file before writing its port.
   Keep Alder's explanatory comments (adapted) next to the ported logic: they explain *why*.
2. **Stay in your paths.** Only create/edit files listed for your phase in PLAN.md section 6. Need a change elsewhere?
   Write it under "Requests" in your final report instead.
3. **Tizen 5.5 / Chromium 69 compatibility** (PLAN.md section 2). Run `npm run compat` before every commit once it exists.
4. **No new dependencies** beyond `esbuild`, `pako`, `qrcode-generator` (and `playwright`, already installed, dev only).
   Node built-ins only for scripts and tests (`node:test`, `node:assert`, `node:http`, `node:fs`, `node:zlib` in tests).
5. **No frameworks, no TypeScript, no CSS preprocessors.** Vanilla ES modules, plain CSS with variables.
6. **Pure core.** `src/core/**` must not touch `window`, `document`, `localStorage` or `fetch` directly: take them via injected deps.
7. **Tests:** `node --test test/` must pass. Add tests for every core function you write. No network in tests (the workspace can't reach Stremio anyway).
8. **Never** put secrets, real auth keys, emails or IPs in fixtures or commits.
9. **Commits:** small, one topic, message `area: what changed` (areas: build, lib, ui, core, player, screens, dev, docs, test).
   End every commit message with:
   ```
   Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_01DkeRJLSpoDywtrL5j34y7n
   ```
   Commit with the repo's configured identity (plain `git commit`; do not override user.name or user.email).
10. **Decisions:** any deviation from Alder or from PLAN.md → one entry in `docs/DECISIONS.md` (date, what, why, alternative).

## Environment facts
- Node 22, npm works (registry reachable). Outbound internet otherwise blocked: no Stremio, no add-ons, no CDNs at runtime.
  Samsung docs can be read with WebFetch/WebSearch if your tools include them.
- Headless Chromium: set `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; Python and Node Playwright are available
  (`npm i -D playwright@1.63` matches the installed browsers; do not run `playwright install`).
- Reference repos (read only): Alder `/home/claude/esedmemmed/alder`, Apps2Samsung `/home/claude/refs/Apps2Samsung`.

## Final report format (your last message)
- Built: files and what each does (short).
- Ported from: Alder file → JS file, anything not ported and why.
- Tests: command + pass/fail counts. Compat: result. Build: result.
- Decisions logged. Open questions. Requests for other paths.
