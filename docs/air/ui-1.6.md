# Air walk 1.6 (beta)

## Walk 1: beta 0.2.0, her first install (public 972247f, from main f7a3f2f)
Pre-push gates (Windows): npm test, compat, air unittest: all exit 0.
CI app.yml: green (run 42354723773, 3m44s); release `beta-0.2.0` with `Alder-0.2.0.dmg`.
Steps: AlderProof removed; DMG downloaded from the release page; installed and opened by `mac/release/FIRST-OPEN.md`; `--ui-check --installed --out .run/1.6/walk1`.
Verdict (2026-11-07, his words): "everything is okay - there is not app icon by the way".
- report: `app: /Applications/Alder.app`, `app version: 0.2.0`; memory lines found (source and subtitle), so 1.4/1.5 memory carried over the reinstall
- defect: Alder.app has no icon (generic app icon in Finder and the Dock). Owner: new task before T7, rides push 2.
Report: `docs/air/raw-1.6/ui-report-walk1.txt` (0 links, unchanged).
