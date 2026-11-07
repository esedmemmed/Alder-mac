# Air UI walk 1.5

## Walk 1 (public f4acd56, from main 4a75f56)
Pre-push gates (Windows, 2026-11-06): npm test, compat, build, build:mac, check:mac, node --test mac/web/test/, unittest air: all exit 0.
CI app.yml: green, app-f4acd56 (pushed 2026-11-06).
Steps: (a) movie + file subtitle, episode + add-on subtitle, delay moved by stepper and keys; (b) replay same release+subtitle keeps delay, other subtitle at 0; (c) start pick, report `match:` line.
Verdict (2026-11-07, his words): "Everything works but there is one problem -- when you watch movie and press return to a page where shows resume and when you press resume it looks for other resources ... That does not usually happen when you return back all the way to home screen ... subtitles are working right i guess - they match with the timing."
- delay live + memory: ok (report: delay remembered/forgotten lines match steps a, b)
- match: ok by his eye; report `match: best=2 named=6/6`, `named=4/4` (every add-on subtitle carried a comparable name)
- defect: Back to the title page then Resume re-searches sources instead of starting the remembered one; from Home it does. Owner: new fix task (source memory on the Resume path, from 1.4).
Report: arrived; `docs/air/raw-1.5/ui-report-walk1.txt` (0 links, unchanged).
