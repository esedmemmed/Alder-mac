# Changelog

## 0.2.0 — 2026-10-30
From the owner's first week on the TV (2020 Samsung TU8000).
- **Focus you can follow from the sofa:** solid light fill on the focused tab, button, row, chip, key and PIN box; one highlight pill slides between the top-menu tabs; the page you're on keeps a softer fill.
- **Player icons render on the TV** (they were empty circles): every icon is built with a fixed size inside a sized box; Diagnostics draws every icon so one photo proves it.
- **Player:** focus returns to Play/Pause after menus, Info and seeking; Play/Pause key toggles instantly; Left/Right seek 10 s at once; Netflix-style centre pause/play sign.
- **"Exit Alder?"** (Stay / Exit) instead of closing on Back.
- **Faster page switching:** pages are kept after the first visit and pre-built after Home settles; revisiting a page paints in ~0.1 s instead of ~0.35–0.58 s (4× slowed CPU).
- **Black bars explained:** Info shows the film's shape (e.g. 1920×800 · 2.40:1) and says when bars are part of the film. A crop-to-fill mode is built but off until it is tested on the TV.
- Audio & subtitles panel no longer jumps to the top after a pick.

## 0.1.0 — 2026-10-29
First TV build: Alder ported to Tizen (sign-in, profiles, Home, title page, sources, player with failover and DTS/TrueHD avoidance, Search, Settings, Add-ons, Diagnostics).
