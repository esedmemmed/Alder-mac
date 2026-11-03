# Fixtures

Realistic Stremio API and add-on answers for the dev harness and the Node tests. Shapes follow what Alder reads
(`Stremio.kt`, `Addon.kt`, `Library.kt`, `PlayerActivity.kt` for IntroDB). Nothing here is a real account: the auth key is
`FIXTURE-AUTH-KEY-0001`, debrid links use `FIXTUREKEY`, and media / subtitle hosts end in `.fixture.test`.

## URL to file rule

`dev/fixture-server.mjs` answers `/__fx/<host>/<path>` from `dev/fixtures/<host>/<path>`: one folder per **host name**, the
URL path below it, `.json` appended when the path has no extension, the query string ignored, the path percent-decoded (so
`tt11280740:1:4` is a file name with colons). POST bodies are not matched: one file per endpoint (the server also accepts
`<endpoint>.<collection>.json` variants). The Node tests use the same rule (`fixturePath` in `test/core/helpers.js`).

| Request | File |
|---|---|
| `POST https://api.strem.io/api/addonCollectionGet` | `api.strem.io/api/addonCollectionGet.json` (6 add-ons) |
| `POST https://api.strem.io/api/addonCollectionSet` | `api.strem.io/api/addonCollectionSet.json` (`{"result":{"success":true}}`) |
| `POST https://api.strem.io/api/datastoreGet` | `api.strem.io/api/datastoreGet.json` (7 library items) |
| `POST https://api.strem.io/api/datastorePut` | `api.strem.io/api/datastorePut.json` |
| `POST https://api.strem.io/api/logout` | `api.strem.io/api/logout.json` |
| `GET https://link.stremio.com/api/v2/create?type=Create` | `link.stremio.com/api/v2/create.json` (code `ALDR-7K2Q`) |
| `GET https://link.stremio.com/api/v2/read?type=Read&code=…` | `link.stremio.com/api/v2/read.json` (approved: auth key). `read-waiting.json` is the "waiting / expired" answer (error 101): serve it first to show the code screen, then `read.json`. |
| `GET https://api.introdb.app/segments?imdb_id=…&season=…&episode=…` | `api.introdb.app/segments.json` (recap 0-41.5 s, intro 52-128.4 s, outro 2958 s). `segments-empty.json`: an episode IntroDB does not know. |
| `GET https://v3-cinemeta.strem.io/<path>.json` (Cinemeta) | `v3-cinemeta.strem.io/<path>.json` |
| `GET https://torrentio.strem.fun/<path>.json` (Torrentio-like streams) | `torrentio.strem.fun/<path>.json` |
| `GET https://aio.example.org/<path>.json` (AIOStreams-like streams) | `aio.example.org/<path>.json` |
| `GET https://opensubtitles-v3.strem.io/<path>.json` (subtitles) | `opensubtitles-v3.strem.io/<path>.json` |
| `GET https://catalogs.example.org/<path>.json` (catalogs, search, similar) | `catalogs.example.org/<path>.json` |
| `GET https://watchly.example.org/<path>.json` (personal add-on) | `watchly.example.org/<path>.json` |
| `GET https://subs.fixture.test/<path>` | `subs.fixture.test/<path>` (two small subtitle files: `dune2/eng-1.srt`, `dune2/eng-2.vtt`) |
| `GET https://media.fixture.test/stream/<name>.mkv` | **no files here**: the stream URLs of the demo titles. The dev server should answer `media.fixture.test/**` with its test clip (`_media/test.webm`); the mock AVPlay plays whatever it is given. |
| posters, backgrounds, logos (`images.metahub.space`, `episodes.metahub.space`) | none: the dev server draws a placeholder |

A path with no file answers 404 (the app must cope: add-ons do that too).

## The demo account

- **Add-ons (in order):** Cinemeta (official, protected), Torrentio, AIOStreams (example), OpenSubtitles v3, Example Catalogs
  (own search catalog and a `similar` catalog), Watchly (example) (a personal add-on that is never shared between profiles).
- **Cinemeta catalogs** (movie and series): `top`, `imdbRating` with genre options and paging, a "New" catalog that needs a genre
  (so it is not a Home row), and search catalogs. Files: `catalog/<type>/<id>.json`, `…/<id>/genre=<Genre>.json`,
  `…/<id>/skip=<n>.json`, `…/<id>/search=<query>.json` (only `dune` and `severance` have search answers).
- **Metas:** 10 movies and 8 series. `v3-cinemeta.strem.io/meta/series/tt11280740.json` (Severance) has **2 seasons plus a special** (S0E1), 20 videos,
  listed out of order on purpose.
- **Library (`datastoreGet`):** Dune: Part Two **in progress** (1h06 of 2h46); Severance **mid-season** (S1E4 at 14:00, S1E1-S1E3
  ticked in `state.watched`, a bitfield built with `node:zlib`, independent of the app); Interstellar finished, in My List;
  Oppenheimer in My List, never started; Top Gun: Maverick only remembered for Continue Watching (`temp`); The Dark Knight removed from
  My List with history; one `other` item (never in Continue Watching).

## Streams for Dune: Part Two (`tt15239678`): 20 playable + 2 torrent-only

Torrentio-like (`torrentio.strem.fun/stream/movie/tt15239678.json`, 16 playable + 2 `infoHash`-only that Alder skips):

| # | Release | What it exercises |
|---|---|---|
| 1 | 2160p WEB-DL DDP5.1 Atmos **DV** H.265 | Dolby Vision without an HDR10 base (profile 5): not playable on the TU8000, left out |
| 2 | 2160p WEB-DL DDP5.1 Atmos DV **HDR** H.265 | 4K DV with an HDR10 base: plays as HDR10, the usual BEST MATCH |
| 3 | UHD BluRay 2160p REMUX HDR10 HEVC **TrueHD** Atmos 7.1 | audio `bad` ("No sound on this TV"), 68 GB |
| 4 | 2160p UHD BluRay x265 HDR **DTS-HD MA** 5.1 | audio `bad` |
| 5 | 1080p WEB-DL **DDP5.1** Atmos H.264 | the dependable one |
| 6 | 1080p WEB-DL DDP5.1 x265 | HEVC, small |
| 7 | 1080p BluRay x264 **DTS-HD MA** 7.1 | audio `bad` at 1080p |
| 8 | MULTi 1080p BluRay **DTS AC3** x264 | audio `mixed`: playable after the track check |
| 9 | 720p WEB h264 AAC | low resolution (listed dimmed) |
| 10 | HDCAM x264 AAC | cam: never picked |
| 11 | TELESYNC 720p AC3 | cam (telesync) |
| 12 | 3D 1080p BluRay Half-SBS DD5.1 | `awkward`: last resort |
| 13 | 1080p WEBRip **HC** KORSUB AAC | hard subs: `awkward` |
| 14 | 1080p WEB-DL **AV1** Opus | AV1: not playable unless the Settings toggle is on |
| 15 | 1080p WEB-DL Hindi **DUB** DD5.1 | dubbed |
| 16 | 1080p WEB-DL x264 | audio not named: `unknown` |

AIOStreams-like (`aio.example.org/stream/movie/tt15239678.json`):

| # | Stream | What it exercises |
|---|---|---|
| 17 | "Mark Watched" action, 27 KB | add-on action dressed up as a stream (below 50 MB: listed, never picked) |
| 18 | 2160p WEB-DL DDP5.1 HDR10 with `proxyHeaders` **User-Agent + Referer** | AVPlay cannot send Referer: "May not play", ranked after plain releases |
| 19 | 1080p WEB-DL AAC2.0 with only a **User-Agent** header | AVPlay can set that one |
| 20 | `….1080p.sample.mkv`, 38 MB | a sample file (below 50 MB) |

Series streams for Severance S1E4 and S1E5: `torrentio.strem.fun/stream/series/tt11280740:1:4.json` and `…:1:5.json` (1080p, 4K DV HDR, 720p;
the AIOStreams files are empty). Subtitles: `opensubtitles-v3.strem.io/subtitles/movie/tt15239678.json` (ten files: four `eng`, `spa`, `fre`,
`ger`, `hin`, two-letter `en`, `tur` as `.ass`) and `…/series/tt11280740:1:4.json` / `:1:5.json`.

## Regenerating

These files were written by a one-off generator script (not kept in the repo); edit the JSON directly. Keep them free of real keys,
e-mail addresses and IPs (AGENTS.md rule 8).
