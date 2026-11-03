// Icons on the TV's Chromium M69: every icon has a size of its own, sits in a sized .icon wrapper, and the scripts that draw
// them cannot regress (docs/DECISIONS.md "Icons on the TV"). The DOM side (a non-zero box for every <svg> on screen) is
// checked in dev/scenarios/v02-player.mjs; here, the strings, the reader of the paths and a scan of the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iconSvg, iconDataUri, parseBody, ICON_NAMES, INK_DARK, INK_LIGHT } from '../../src/ui/icons.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url)); // not .pathname: it keeps the leading / of a Windows drive path

test('every icon is an <svg> with xmlns, a numeric width and height, a viewBox and an explicit fill', () => {
  assert.ok(ICON_NAMES.length >= 18);
  for (const name of ICON_NAMES) {
    const svg = iconSvg(name);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"/, name);
    assert.match(iconSvg(name, 40), /width="40" height="40" viewBox="0 0 24 24"/, name + ' at 40 px: the box is the size, the drawing scales by its viewBox');
    assert.ok(svg.endsWith('</svg>'));
  }
  assert.equal(iconSvg('nope'), '', 'an unknown icon is nothing');
  assert.match(iconSvg('play', 0), /width="24"/, 'a size of zero or less falls back to the drawing\'s own');
  assert.match(iconSvg('play', 'x'), /width="24"/);
});

test('a colour value is baked in everywhere, strokes included (the mic is drawn with one)', () => {
  const mic = iconSvg('mic', 24, '#15110E');
  assert.ok(!/currentColor/.test(mic), 'no currentColor is left when a colour is given');
  assert.match(mic, /fill="#15110E"/);
  assert.match(mic, /stroke="#15110E"/);
  assert.match(iconSvg('mic'), /stroke="currentColor"/, 'with no colour it follows the CSS colour');
});

test('parseBody reads every <path> and <g> of every icon (the script builds the same shapes with createElementNS)', () => {
  const count = (nodes) => nodes.reduce((n, x) => n + 1 + count(x.children), 0);
  for (const name of ICON_NAMES) {
    const body = iconSvg(name).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    const tags = (body.match(/<(path|g)\b/g) || []).length;
    assert.equal(count(parseBody(body)), tags, name);
    parseBody(body).forEach(function check(node) {
      assert.ok(node.tag === 'path' || node.tag === 'g', name + ' has only paths and groups');
      if (node.tag === 'path') assert.ok(node.attrs.d && node.attrs.d.length > 5, name + ': a path has its data');
      node.children.forEach(check);
    });
  }
  const fwd = parseBody(iconSvg('forward10').replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, ''));
  assert.equal(fwd[0].tag, 'g');
  assert.match(fwd[0].attrs.transform, /scale\(-1 1\)/);
  assert.equal(fwd[0].children[0].tag, 'path', 'the mirrored arrow is a path inside the group');
  assert.equal(fwd[1].tag, 'path', 'and the "10" follows it outside the group');
});

test('the data: URI of an icon is an SVG with the colour baked in and nothing a URL would break on', () => {
  const uri = iconDataUri('play', INK_LIGHT, 48);
  assert.match(uri, /^data:image\/svg\+xml;charset=utf-8,/);
  const payload = uri.slice(uri.indexOf(',') + 1);
  assert.ok(!/[#<> "]/.test(payload), 'the # of the colour, the < > and the spaces are percent-encoded');
  const svg = decodeURIComponent(payload);
  assert.match(svg, /width="48" height="48"/);
  assert.match(svg, new RegExp('fill="' + INK_LIGHT + '"'));
  assert.notEqual(INK_LIGHT, INK_DARK);
  assert.equal(iconDataUri('nope'), '');
});

/** The .js files under src/ (not icons.js: it is where the rule lives). */
function sources(dir = join(ROOT, 'src')) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : f.endsWith('.js') && relative(ROOT, p) !== 'src/ui/icons.js' ? [p] : [];
  });
}

test('no source puts an icon in an element that is not a sized .icon wrapper (the 0.1.0 player buttons)', () => {
  const bad = [];
  for (const file of sources()) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      const puts = /(\bhtml\s*:|\.innerHTML\s*=)[^\n]*(iconSvg\(|REPLAY_SVG)/.test(line);
      if (!puts) return;
      // markup may only go inside an element whose class list has `icon` (the stylesheet gives that wrapper its px size)
      if (!/class\s*:\s*'[^']*\bicon\b/.test(line)) bad.push(relative(ROOT, file) + ':' + (i + 1) + '  ' + line.trim().slice(0, 120));
    });
  }
  assert.deepEqual(bad, [], 'icon markup outside an .icon wrapper:\n' + bad.join('\n'));
});

test('the stylesheet sizes an icon by inheriting its wrapper\'s px size, not by a percentage', () => {
  const css = readFileSync(join(ROOT, 'src/ui/styles/base.css'), 'utf8');
  const rule = /\.icon svg\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'base.css has a rule for .icon svg');
  assert.match(rule[1], /width:\s*inherit/);
  assert.match(rule[1], /height:\s*inherit/);
  assert.ok(!/%/.test(rule[1]), 'no percentage sizes');
  assert.match(/\.icon\s*\{([^}]*)\}/.exec(css)[1], /width:\s*\d+px/, 'the wrapper has a width in px');
});
