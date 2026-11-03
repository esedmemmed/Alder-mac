# Phase 4 contract: app context, screens, navigation

Two agents build Phase 4 in parallel. This file is the contract between them; neither changes it without the manager.

## Ownership
| Path | Owner |
|---|---|
| `src/app/session.js` (services), `src/main.js`, `src/screens/{profiles,signin,home}.js`, `src/ui/` additions they need, deleting TEMP (`src/player/demo.js`, `src/ui/demo.js`, TEMP lines), `dev/scenarios/phase4a*.mjs` | **4A** |
| `src/screens/{details,streams,search,settings,addons}.js`, `src/screens/index.js`, `src/ui/` additions they need (new files only, prefixed `ui/4b-` or in `ui/screens-b/`), `dev/scenarios/phase4b*.mjs`, missing fixtures | **4B** |
| Shared existing `src/ui/*.js`, `src/lib/*`, `src/core/*`, `src/player/*` | Nobody edits without listing it in the report; smallest change, tests green |

## `context.session` (built by 4A in `src/app/session.js`, available on `context.session`)
```
session.store                     lib/store app store
session.http                      lib/http appHttp()
session.device                    core/device profile (webapis or static TU8000)
session.stremio                   core/stremio createStremio({http})
session.profiles                  core/profiles bound to store: all(), active(), setActive(id), add(), remove(), update(), sharesStreams(), setSharesStreams(), streamLenders()
session.profile()                 active Profile or null
session.authKey()                 active profile's authKey or null
session.settings                  core/settings for the active profile (re-bound on profile switch)
session.addons({refresh}) -> Promise<Addon[]>      saved list first when available, then fresh (Stremio.savedAddons / addons)
session.meta(type, id) -> Promise<Meta|null>       first add-on serving "meta" for type/id, in account order (Alder DetailsActivity)
session.savedMeta(type, id) -> Meta|null
session.library({refresh}) -> Promise<object[]>    library items (Stremio.library / savedLibrary)
session.saveLibrary(items) -> Promise
session.finder({type, id, videoId}) -> SourceFinder   core/finder with household lenders (Profiles.streamLenders)
session.ranker({videoId, metaId, maxHeight}) -> core/ranking createRanker bound to settings/device/memory
session.memory                    core/ranking createSourceMemory(store)
session.onProfileChange(fn)       subscribe; returns unsubscribe
```
4A fills `context.player` from the session (the services `src/player/screen.js` reads) and removes the TEMP demo services.

## Screens (router names and params)
| Name | Params | Owner |
|---|---|---|
| `profiles` | `{}` | 4A |
| `signin` | `{ addProfile?: boolean }` | 4A |
| `home` | `{ page?: 'Home'|'Shows'|'Movies'|'Live'|'My List' }` | 4A |
| `details` | `{ type, id, name?, poster?, background?, logo? }` | 4B |
| `streams` | `{ type, id, videoId, name, episode?, pick?, resumeAt?, maxHeight?, message?, afterVideoId? }` (Alder StreamsActivity extras) | 4B |
| `search` | `{}` | 4B |
| `settings` | `{}` | 4B |
| `addons` | `{}` | 4B |
| `player` | as `src/player/screen.js` defines | done (Phase 3) |
| `diagnostics` | as `src/screens/diagnostics.js` | done (Phase 3) |

- 4B exports all its screens from `src/screens/index.js` as `export const screensB = { details, streams, search, settings, addons }` (factories). **4B creates this file with stub factories in its first commit** so 4A can import it from `main.js` at once.
- `streams` starts playback itself (Alder): `router.push('player', ...)` with the TRY sources, or shows the list (`pick`, or after failures).
- Player `onNavigate(nav, context)` is wired by 4A in `main.js`: `exit` → pop; `sources` → replace with `streams` + `{pick, resumeAt, maxHeight, message}`; `next` → `streams` for the next video (starts it, preferring the previous release's bingeGroup); `details` → `details`.
- Settings → About → Diagnostics row calls `openDiagnostics(context)` (4B).
- Profile switch (4A) calls `session.profiles.setActive` then resets the stack to `home`.
