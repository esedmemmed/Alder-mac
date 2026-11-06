// Subtitle name match (T3.c1): scoring an add-on subtitle's id + label against the playing release, ranking with ties kept in add-on order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THRESHOLD, nameLike, scoreSubtitle, rankByMatch, rankRuns, matchStats } from '../../src/core/subtitle-match.js';

const ctx = { filename: 'Show.S01E02.1080p.WEB-DL.x264-GRP.mkv', sig: '1080p|web|avc|grp' }; // signature() of that file name
const sub = (id, label, language = 'English') => ({ id, label, language });

test('nameLike: numbers only or no words is not a name', () => {
  assert.equal(nameLike('1954712345'), false);
  assert.equal(nameLike('12 34'), false);
  assert.equal(nameLike(''), false);
  assert.equal(nameLike('Show.S01E02.1080p.WEB-DL.x264-GRP'), true);
});

test('score: the same release scores well above the threshold, another group and 720p stays under it', () => {
  const same = scoreSubtitle(sub('1954712345', 'Show.S01E02.1080p.WEB-DL.x264-GRP'), ctx);
  const other = scoreSubtitle(sub('1954712346', 'Show.S01E02.720p.WEB-DL.x264-OTHER'), ctx);
  assert.equal(same, 13);
  assert.equal(other, 5);
  assert.ok(same >= THRESHOLD && other < THRESHOLD);
});

test('score: an OpenSubtitles id alone, an empty label and a bare language say nothing (0)', () => {
  assert.equal(scoreSubtitle({ id: '1954712345' }, ctx), 0);
  assert.equal(scoreSubtitle(sub('1954712345', ''), ctx), 0);
  assert.equal(scoreSubtitle(sub('1954712345', 'English'), ctx), 0);
  assert.equal(scoreSubtitle({}, ctx), 0);
  assert.equal(scoreSubtitle(sub('1', 'x'), { filename: null, sig: null }), 0);
});

test('score: the group counts on its own words, and a different episode is 0', () => {
  assert.ok(scoreSubtitle(sub('9', 'Show S01E02 1080p grp'), ctx) >= THRESHOLD);
  assert.equal(scoreSubtitle(sub('9', 'Show.S01E03.1080p.WEB-DL.x264-GRP'), ctx), 0);
  assert.ok(scoreSubtitle(sub('9', 'Show.1080p.WEB-DL.x264-GRP'), ctx) >= THRESHOLD, 'no episode marker in the label: not a conflict');
});

test('rankByMatch: a match first, the rest and ties keep the add-on order; the input is not changed', () => {
  const a = sub('1', 'English');
  const b = sub('2', 'Show.S01E02.1080p.WEB-DL.x264-GRP');
  const c = sub('3', 'Show.S01E02.720p.WEB-DL.x264-OTHER');
  const d = sub('4', 'Show.S01E02.1080p.WEB-DL.x264-GRP');
  const input = [a, c, b, d];
  assert.deepEqual(rankByMatch(input, ctx).map(s => s.id), ['2', '4', '1', '3']);
  assert.deepEqual(input.map(s => s.id), ['1', '3', '2', '4']);
  assert.deepEqual(rankByMatch([a, c], ctx).map(s => s.id), ['1', '3'], 'nothing matches: the order stays');
  const many = Array.from({ length: 30 }, (_, i) => sub(String(i), i % 3 ? 'English' : 'Show.S01E02.1080p.WEB-DL.x264-GRP'));
  const ids = rankByMatch(many, ctx).map(s => Number(s.id));
  assert.deepEqual(ids, many.filter((_, i) => i % 3 === 0).map(s => Number(s.id)).concat(many.filter((_, i) => i % 3).map(s => Number(s.id))), 'stable beyond 10 items');
});

test('rankRuns: each language run is ranked inside itself, the runs keep their order', () => {
  const list = [sub('1', 'English'), sub('2', 'Show.S01E02.1080p.WEB-DL.x264-GRP'), sub('3', 'Turkish', 'Turkish'), sub('4', 'Show.S01E02.1080p.WEB-DL.x264-GRP', 'Turkish')];
  assert.deepEqual(rankRuns(list, ctx).map(s => s.id), ['2', '1', '4', '3']);
  assert.deepEqual(rankRuns([], ctx), []);
});

test('matchStats: best score, how many are name-like, how many', () => {
  const list = [sub('1954712345', undefined), sub('2', 'English'), sub('3', 'Show.S01E02.1080p.WEB-DL.x264-GRP')];
  assert.deepEqual(matchStats(list, ctx), { best: 13, named: 2, n: 3 });
  assert.deepEqual(matchStats([], ctx), { best: 0, named: 0, n: 0 });
});
