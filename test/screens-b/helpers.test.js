import test from 'node:test';
import assert from 'node:assert/strict';
import {
  episodeDate, seasonLabel, minutesLeft, seasonsText, playTarget, synopsisAtSentence, sourcesHeader, sourceCount, playerParams,
  isAddonMessage, rankSearchTitles, searchAnswersInAddonOrder, parseRecent, rememberRecent, searchFacts,
  addonShortName, addonRoleOf, addonRole, addonHost, ordinal, addonHelp, installUrl, isManifest, moved,
} from '../../src/ui/screens-b/helpers.js';

test('episodeDate: ISO dates read d MMM yyyy, nonsense reads nothing', () => {
  assert.equal(episodeDate('2025-03-21T00:00:00.000Z'), '21 Mar 2025');
  assert.equal(episodeDate('2022-02-18'), '18 Feb 2022');
  assert.equal(episodeDate('2022-02-30'), null);
  assert.equal(episodeDate('soon'), null);
  assert.equal(episodeDate(null), null);
});

test('season chips: Specials for 0, "Season N" when selected, else the number', () => {
  assert.equal(seasonLabel(0, false), 'Specials');
  assert.equal(seasonLabel(0, true), 'Specials');
  assert.equal(seasonLabel(2, true), 'Season 2');
  assert.equal(seasonLabel(2, false), '2');
  assert.equal(seasonsText(1), '1 season');
  assert.equal(seasonsText(3), '3 seasons');
});

test('minutesLeft needs a known duration beyond the position', () => {
  assert.equal(minutesLeft(66 * 60000, 166 * 60000), '100 min left');
  assert.equal(minutesLeft(0, 100), null);
  assert.equal(minutesLeft(500, 400), null);
  assert.equal(minutesLeft(60000, 0), null);
});

test('playTarget: the movie itself; the episode Continue Watching points at; else the first real episode', () => {
  assert.deepEqual(playTarget(null, null, 'tt1'), { videoId: 'tt1', video: null });
  assert.deepEqual(playTarget({ videos: [] }, null, 'tt1'), { videoId: 'tt1', video: null });
  const videos = [{ id: 'a:1:1', season: 1, episode: 1 }, { id: 'a:1:2', season: 1, episode: 2 }, { id: 'a:0:1', season: 0, episode: 1 }];
  assert.equal(playTarget({ videos }, { state: { video_id: 'a:1:2' } }, 'a').videoId, 'a:1:2');
  assert.equal(playTarget({ videos }, { state: { video_id: 'gone' } }, 'a').videoId, 'a:1:1');
  assert.equal(playTarget({ videos: [videos[2], videos[0]] }, null, 'a').videoId, 'a:1:1'); // specials are not the start
  assert.equal(playTarget({ videos: [videos[2]] }, null, 'a').videoId, 'a:0:1'); // only specials: those
});

test('synopsisAtSentence: whole sentences, not after abbreviations, else a word and an ellipsis', () => {
  const t = 'Sgt. Rock leads the unit. They meet the enemy at dawn and nobody is ready for it';
  assert.equal(synopsisAtSentence(t, 200), t);
  assert.equal(synopsisAtSentence(t, 40), 'Sgt. Rock leads the unit.');
  assert.equal(synopsisAtSentence('Sgt. Rock leads the unit', 10), 'Sgt. Rock…');
  assert.equal(synopsisAtSentence('One long run of words with no stops at all', 20), 'One long run of…');
  assert.equal(synopsisAtSentence('The U.S. army arrives. Then more', 15), 'The U.S. army…');
});

test('sourcesHeader: episode parts, the label fallback, the title falls back to the name', () => {
  const h = sourcesHeader({ name: 'Severance', episode: 'S1 E4  ·  The You You Are', runtime: '57 min' });
  assert.deepEqual(h.where, ['S1 E4', 'The You You Are']);
  assert.equal(h.eyebrow, 'S1 E4 · 57 min');
  assert.equal(h.title, 'The You You Are');
  const m = sourcesHeader({ name: 'Dune: Part Two', runtime: '2h 46m' });
  assert.equal(m.eyebrow, '2h 46m');
  assert.equal(m.title, 'Dune: Part Two');
  const l = sourcesHeader({ name: 'Severance', label: 'Severance  ·  S1 E4' });
  assert.deepEqual(l.where, ['S1 E4']);
  assert.equal(l.title, 'Severance');
  assert.equal(sourceCount(1), '1 source');
  assert.equal(sourceCount(52), '52 sources');
});

test('playerParams maps the sources page params onto the player', () => {
  const p = playerParams({ type: 'series', id: 'tt1', videoId: 'tt1:1:4', name: 'S', afterVideoId: 'tt1:1:6', resumeAt: 5000, episode: 'S1 E4' }, [1, 2]);
  assert.equal(p.metaId, 'tt1');
  assert.equal(p.nextVideoId, 'tt1:1:6');
  assert.equal(p.resumeAt, 5000);
  assert.equal(p.picked, undefined);
  assert.deepEqual(p.sources, [1, 2]);
  assert.equal(playerParams({ id: 'x', videoId: 'x', nextVideoId: 'n', afterVideoId: 'a' }, [], { picked: true }).nextVideoId, 'n');
  assert.equal(playerParams({ id: 'x', videoId: 'x' }, [], { picked: true }).picked, true);
  assert.equal('resumeAt' in playerParams({ id: 'x', videoId: 'x' }, []), false);
  assert.equal(playerParams({ id: 'x', videoId: 'x', startOver: true }, []).startOver, true);
});

test('rankSearchTitles: exact, then prefix, then all words, then phrase, ties in add-on order', () => {
  const names = ['Dune: Part Two', 'The Dune Encyclopedia', 'Dune', 'Children of Dune', 'Dune Drifter', 'Sand'];
  const out = rankSearchTitles(names.map((name) => ({ name })), 'dune').map((x) => x.name);
  assert.deepEqual(out, ['Dune', 'Dune: Part Two', 'Dune Drifter', 'The Dune Encyclopedia', 'Children of Dune', 'Sand']);
  assert.deepEqual(rankSearchTitles([{ name: 'b' }, { name: 'a' }], '   ').map((x) => x.name), ['b', 'a']);
  assert.equal(rankSearchTitles([{ name: 'Amélie' }, { name: 'Amelie 2' }], 'amelie')[0].name, 'Amélie'); // accents fold
});

test('search answers keep add-on order and skip the ones not in yet', () => {
  assert.deepEqual(searchAnswersInAddonOrder([null, [1, 2], [], [3], null]), [1, 2, 3]);
  assert.equal(isAddonMessage('Authentication Required'), true);
  assert.equal(isAddonMessage('Dune'), false);
});

test('recent searches: newest first, deduplicated ignoring case, at most six', () => {
  assert.deepEqual(parseRecent('dune\n\n  \nalien'), ['dune', 'alien']);
  assert.deepEqual(parseRecent(null), []);
  assert.deepEqual(rememberRecent(['a', 'b', 'c'], 'B'), ['B', 'a', 'c']);
  assert.deepEqual(rememberRecent(['1', '2', '3', '4', '5', '6'], 'new'), ['new', '1', '2', '3', '4', '5']);
  assert.deepEqual(rememberRecent(['a'], '   '), ['a']);
  assert.equal(searchFacts({ year: '2021', genres: ['Sci-Fi'], runtime: '155 min' }, (r) => r + '!'), '2021  ·  Sci-Fi  ·  155 min!');
  assert.equal(searchFacts({ year: null, genres: [], runtime: null }, (r) => r), '');
});

const addon = (name, id, resources, extra = {}) => ({ name, id, manifest: { resources }, transportUrl: 'https://x.example.org/manifest.json', locked: false, ...extra });

test('addon names, roles, tags and help read as in Alder', () => {
  assert.equal(addonShortName('torrentio | ElfHosted'), 'Torrentio');
  assert.equal(addonShortName('OpenSubtitles v3'), 'OpenSubtitles');
  assert.equal(addonShortName('AIOStreams (example)'), 'AIOStreams');
  assert.equal(addonRole(addon('Cinemeta', 'com.linvo.cinemeta', ['meta', 'catalog'])), 'Titles and details');
  assert.equal(addonRole(addon('Torrentio', 'x', ['stream'])), 'Streams');
  assert.equal(addonRole(addon('Mix', 'x', [{ name: 'stream' }, 'subtitles', 'catalog'])), 'Streams · Subtitles');
  assert.equal(addonRole(addon('Nothing', 'x', [])), 'Add-on');
  assert.equal(addonRoleOf('Local Files', 'a', new Set()), 'Files on this network');
  assert.equal(addonRole(addon('Watchly (example)', 'org.watchly.x', ['catalog'])), 'Recommendations · Top Picks on Home');
  assert.equal(addonHost(addon('Cinemeta', 'c', [], { locked: true })), 'Built-in');
  assert.equal(addonHost(addon('Torrentio | ElfHosted', 'x', ['stream'])), 'ElfHosted');
  assert.equal(addonHost(addon('OpenSubtitles v3', 'org.opensubtitles', ['subtitles'])), 'v3');
  assert.equal(addonHost(addon('Thing', 'x', [], { transportUrl: 'https://my.elfhosted.com/x/manifest.json' })), 'ElfHosted');
  assert.equal(addonHost(addon('Thing', 'x', [])), '');
  assert.equal(addonHelp(addon('Torrentio', 'x', ['stream']), 1), 'Streams. It answers second.');
  assert.match(addonHelp(addon('W', 'watchly', []), 0), /^Makes your own Top Picks .* first\.$/);
});

test('ordinals: words to tenth, then 11th, 21st, 22nd, 23rd', () => {
  assert.deepEqual([1, 2, 10].map(ordinal), ['first', 'second', 'tenth']);
  assert.deepEqual([11, 12, 13, 21, 22, 23, 24, 111].map(ordinal), ['11th', '12th', '13th', '21st', '22nd', '23rd', '24th', '111th']);
});

test('installUrl: stremio:// links, bare hosts, trailing slashes and manifest.json', () => {
  assert.equal(installUrl(''), '');
  assert.equal(installUrl('  stremio://a.example.org/x/manifest.json '), 'https://a.example.org/x/manifest.json');
  assert.equal(installUrl('a.example.org'), 'https://a.example.org/manifest.json');
  assert.equal(installUrl('https://a.example.org/conf/'), 'https://a.example.org/conf/manifest.json');
  assert.equal(installUrl('http://a.example.org/manifest.json'), 'http://a.example.org/manifest.json');
  assert.equal(isManifest({ id: 'x', resources: [] }), true);
  assert.equal(isManifest({ id: 'x' }), false);
  assert.equal(isManifest([]), false);
});

test('moved reorders a copy', () => {
  const a = ['a', 'b', 'c'];
  assert.deepEqual(moved(a, 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(moved(a, 0, 1), ['b', 'a', 'c']);
  assert.deepEqual(a, ['a', 'b', 'c']);
});
