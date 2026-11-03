// Picture size and the source's shape: the pure functions (picture.js), the AVPlay wrapper's setPicture, and the engine's
// handling of Fit / Fill on the AVPlay mock. No DOM, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRatio, parseVideoShape, ratioText, shapeText, shapeNote, hasBars, cropPercent, fillRoi, pictureHints, pictureLines, normalisePicture, relativeShape,
} from '../../src/player/picture.js';
import { createAvplay, FIT_METHOD, FILL_ENABLED, fillOffered } from '../../src/player/avplay.js';
import { createAvplayMock, createRegistry, DISPLAY_METHODS, buildTrackInfo, resolveTracks } from '../../dev/mock-tizen.js';
import { createFakeClock } from '../../dev/fake-clock.js';
import { makeEngine, stream } from './helpers.js';

const video = (info, index = 0) => ({ index, type: 'VIDEO', extra_info: typeof info === 'string' ? info : JSON.stringify(info) });
const shapeOf = (width, height, extra = {}) => parseVideoShape([video(Object.assign({ Width: String(width), Height: String(height) }, extra))]);
const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, a + ' is not ' + b);

// ---- reading the shape -----------------------------------------------------------------------------------------------

test('parseRatio: pairs, decimals and nonsense', () => {
  near(parseRatio('16:9'), 16 / 9);
  near(parseRatio('16/9'), 16 / 9);
  near(parseRatio('2.40:1'), 2.4);
  near(parseRatio('2.39'), 2.39);
  near(parseRatio(1.7778), 1.7778);
  for (const bad of ['', null, undefined, 'wide', '0:0', '0', '99', '1:0', '-2']) assert.equal(parseRatio(bad), 0, String(bad));
});

test('a 1920x800 file is 2.40:1, a 1920x1080 file is 1.78:1; the text is "1920×800 · 2.40:1"', () => {
  const wide = shapeOf(1920, 800);
  near(wide.ratio, 2.4);
  assert.equal(wide.reported, 'none');
  assert.equal(shapeText(wide), '1920×800 · 2.40:1');
  assert.equal(shapeText(shapeOf(1920, 1080)), '1920×1080 · 1.78:1');
  assert.equal(shapeText(shapeOf(3840, 1608)), '3840×1608 · 2.39:1');
  assert.equal(shapeText(shapeOf(1440, 1080)), '1440×1080 · 1.33:1');
  assert.equal(shapeText(null), '');
  assert.equal(ratioText(0), '');
});

test('other spellings of the size are read (the field names are a guess until the TV is asked)', () => {
  assert.equal(shapeText(parseVideoShape([video({ width: 1920, height: 800 })])), '1920×800 · 2.40:1');
  assert.equal(shapeText(parseVideoShape([video({ video_width: '1280', video_height: '720' })])), '1280×720 · 1.78:1');
  assert.equal(shapeText(parseVideoShape([video('{"Width":"1920 px","Height":"816 px"}')])), '1920×816 · 2.35:1');
  assert.equal(shapeText(parseVideoShape([{ index: 0, type: 'video', extra_info: { Width: 1920, Height: 1080 } }])), '1920×1080 · 1.78:1', 'an object, lower-case type');
  // the lenient reader of core/audio.js parseExtraInfo copes with text that is not JSON
  assert.equal(shapeText(parseVideoShape([video('Width=1920, Height=800')])), '1920×800 · 2.40:1');
});

test('a reported display aspect wins over the stored shape; a pixel aspect widens it (anamorphic, non-square pixels)', () => {
  const dar = shapeOf(1440, 1080, { display_aspect_ratio: '16:9' });
  near(dar.ratio, 16 / 9);
  assert.equal(dar.reported, 'display');
  assert.equal(shapeText(dar), '1440×1080 · 1.78:1');
  const anamorphic = shapeOf(1920, 1080, { display_aspect_ratio: '2.39:1' });
  assert.equal(shapeText(anamorphic), '1920×1080 · 2.39:1', 'the file says its pixels are not square');
  const pixel = shapeOf(720, 576, { pixel_aspect_ratio: '16:11' });
  near(pixel.ratio, (720 / 576) * (16 / 11));
  assert.equal(pixel.reported, 'pixel');
  assert.equal(shapeOf(1920, 1080, { display_aspect_ratio: 'garbage' }).reported, 'none', 'an unreadable aspect is ignored');
});

test('no VIDEO track, no size, or a silly one: null, never a throw', () => {
  assert.equal(parseVideoShape(null), null);
  assert.equal(parseVideoShape([]), null);
  assert.equal(parseVideoShape([{ index: 0, type: 'AUDIO', extra_info: '{"Width":"1920","Height":"800"}' }]), null, 'audio tracks are not video');
  assert.equal(parseVideoShape([video({ fourCC: 'V_MPEGH/ISO/HEVC' })]), null);
  assert.equal(parseVideoShape([video({ Width: '0', Height: '0' })]), null);
  assert.equal(parseVideoShape([video('notSet')]), null);
});

test('with several video tracks the one in use is read first, then any that says its size', () => {
  const tracks = [video({ Width: '1920', Height: '1080' }, 0), video({ Width: '1920', Height: '800' }, 1)];
  assert.equal(shapeText(parseVideoShape(tracks)), '1920×1080 · 1.78:1');
  assert.equal(shapeText(parseVideoShape(tracks, { currentIndex: 1 })), '1920×800 · 2.40:1');
  assert.equal(shapeText(parseVideoShape([video({ fourCC: 'x' }, 0), video({ Width: '1280', Height: '536' }, 1)], { currentIndex: 0 })), '1280×536 · 2.39:1');
});

// ---- the plain words -------------------------------------------------------------------------------------------------

test('bars: a film wider than 16:9 says the bars are part of the film; 16:9 and 1.85 are not worth a note', () => {
  const wide = shapeOf(1920, 800);
  assert.equal(hasBars(wide), true);
  assert.match(shapeNote(wide), /wider than your TV/);
  assert.match(shapeNote(wide), /black bars above and below are part of the film/);
  assert.equal(shapeNote(shapeOf(1920, 1080)), '');
  assert.equal(hasBars(shapeOf(1920, 1040)), false, '1.85:1 is within 4% of the screen');
  assert.equal(hasBars(shapeOf(1920, 1000)), true, '1.92:1 has real bars');
  assert.match(shapeNote(shapeOf(1440, 1080)), /black bars at the sides are part of the video/);
  assert.equal(shapeNote(null), '');
  assert.equal(hasBars(null), false);
  near(relativeShape(shapeOf(1920, 1080)), 1);
});

test('cropPercent is the share Fill would cut: 0 for 16:9, 26% for 2.40:1, 25% for 4:3', () => {
  assert.equal(cropPercent(shapeOf(1920, 1080)), 0);
  assert.equal(cropPercent(shapeOf(1920, 800)), 26);
  assert.equal(cropPercent(shapeOf(1440, 1080)), 25);
  assert.equal(cropPercent(null), 0);
});

test('pictureHints: what each row says about itself', () => {
  assert.equal(pictureHints(shapeOf(1920, 800)).fit, 'The whole picture, with bars');
  assert.equal(pictureHints(shapeOf(1920, 800)).fill, 'Zooms in, cuts 26% of the picture');
  assert.equal(pictureHints(shapeOf(1920, 1080)).fit, 'The whole picture');
  assert.equal(pictureHints(shapeOf(1920, 1080)).fill, 'Same as Fit for this film');
  assert.equal(pictureHints(null).fill, 'Zooms in, cuts the edges');
  assert.equal(pictureHints(null, false).fill, 'Not available on this TV');
});

test('normalisePicture: only "fill" is Fill', () => {
  assert.deepEqual(['fill', 'fit', '', 'stretch', null, undefined, 'FILL'].map(normalisePicture), ['fill', 'fit', 'fit', 'fit', 'fit', 'fit', 'fit']);
});

// ---- Fill as a crop, never a stretch ---------------------------------------------------------------------------------

test('fillRoi: the middle of the frame that has the screen\'s shape', () => {
  const [x, y, w, h] = fillRoi(shapeOf(1920, 800));
  assert.equal(y, 0);
  assert.equal(h, 1);
  near(w, (16 / 9) / 2.4);
  near(x, (1 - w) / 2);
  // the cropped part has the screen's shape: width * 2.4 : height * 1 equals 16:9
  near((w * 2.4) / (h * 1), 16 / 9);
  const [x2, y2, w2, h2] = fillRoi(shapeOf(1440, 1080));
  assert.equal(x2, 0);
  assert.equal(w2, 1);
  near(h2, (4 / 3) / (16 / 9));
  near(y2, (1 - h2) / 2);
  assert.equal(fillRoi(shapeOf(1920, 1080)), null, '16:9 has nothing to cut');
  assert.equal(fillRoi(shapeOf(3840, 2160)), null);
  assert.equal(fillRoi(null), null);
});

test('anamorphic: the crop follows the display shape, not the stored pixels', () => {
  const [x, , w] = fillRoi(shapeOf(1920, 1080, { display_aspect_ratio: '2.39:1' }));
  near(w, (16 / 9) / 2.39);
  near(x, (1 - w) / 2);
});

// ---- the AVPlay wrapper ----------------------------------------------------------------------------------------------

function wrapper({ fill = true, mockOptions = {} } = {}) {
  const clock = createFakeClock(0);
  const av = createAvplayMock({ clock, registry: createRegistry() });
  const avplay = createAvplay({ webapis: { avplay: av }, fill });
  avplay.open('https://media.fixture.test/a.mkv', {}, {});
  av.prepare();
  return { av, avplay, roiCalls: () => av.__mock.calls.filter((c) => c.method === 'setVideoRoi') };
}

test('Fit is LETTER_BOX with the whole frame; open() asks for nothing else and never FULL_SCREEN', () => {
  const { av, avplay, roiCalls } = wrapper();
  assert.equal(FIT_METHOD, 'PLAYER_DISPLAY_MODE_LETTER_BOX');
  assert.equal(av.__mock.display.method, 'PLAYER_DISPLAY_MODE_LETTER_BOX');
  assert.deepEqual(av.__mock.display.rect, [0, 0, 1920, 1080], 'the rect is always the screen: setDisplayMethod only works with it');
  const got = avplay.setPicture('fit', shapeOf(1920, 800));
  assert.deepEqual(got, { mode: 'fit', method: FIT_METHOD, roi: null, reason: '' });
  assert.equal(roiCalls().length, 0, 'Fit never touches the ROI');
  assert.ok(!av.__mock.calls.some((c) => c.method === 'setDisplayMethod' && c.args[0] !== FIT_METHOD));
});

test('Fill crops through setVideoRoi and keeps LETTER_BOX, so nothing is stretched', () => {
  const { av, avplay, roiCalls } = wrapper();
  const shape = shapeOf(1920, 800);
  const got = avplay.setPicture('fill', shape);
  assert.equal(got.mode, 'fill');
  assert.equal(got.method, FIT_METHOD);
  assert.deepEqual(got.roi, fillRoi(shape));
  assert.equal(roiCalls().length, 1);
  assert.deepEqual(av.__mock.display.roi, fillRoi(shape));
  assert.equal(av.__mock.display.method, 'PLAYER_DISPLAY_MODE_LETTER_BOX');
  assert.deepEqual(av.__mock.display.rect, [0, 0, 1920, 1080]);
  // back to Fit: the whole frame again
  assert.equal(avplay.setPicture('fit', shape).mode, 'fit');
  assert.deepEqual(av.__mock.display.roi, [0, 0, 1, 1]);
  assert.equal(roiCalls().length, 2);
  // Fit again changes nothing more
  avplay.setPicture('fit', shape);
  assert.equal(roiCalls().length, 2);
});

test('Fill with nothing to cut (a 16:9 film) is Fill with no call; with no shape it is Fit and says why', () => {
  const { av, avplay, roiCalls } = wrapper();
  assert.deepEqual(avplay.setPicture('fill', shapeOf(1920, 1080)), { mode: 'fill', method: FIT_METHOD, roi: null, reason: '' });
  assert.equal(roiCalls().length, 0);
  const unknown = avplay.setPicture('fill', null);
  assert.equal(unknown.mode, 'fit');
  assert.match(unknown.reason, /doesn't say its shape/);
  assert.equal(roiCalls().length, 0);
  assert.deepEqual(av.__mock.display.roi, [0, 0, 1, 1]);
});

test('Fill when the build does not offer it, or the firmware has no setVideoRoi, is Fit with a reason and no crop call', () => {
  const off = wrapper({ fill: false });
  assert.equal(off.avplay.fillSupported, false);
  const got = off.avplay.setPicture('fill', shapeOf(1920, 800));
  assert.equal(got.mode, 'fit');
  assert.match(got.reason, /cannot crop/);
  assert.equal(off.roiCalls().length, 0);

  const av = createAvplayMock({ clock: createFakeClock(0), registry: createRegistry() });
  delete av.setVideoRoi; // an older firmware
  const old = createAvplay({ webapis: { avplay: av }, fill: true });
  assert.equal(old.fillSupported, false);
  assert.equal(old.setPicture('fill', shapeOf(1920, 800)).mode, 'fit');
});

test('the TV refusing the crop leaves Fit on screen and says so; a new session starts whole', () => {
  const { av, avplay } = wrapper();
  av.setVideoRoi = () => { throw new Error('InvalidValuesError'); };
  const got = avplay.setPicture('fill', shapeOf(1920, 800));
  assert.equal(got.mode, 'fit');
  assert.match(got.reason, /refused/);

  const t = wrapper();
  t.avplay.setPicture('fill', shapeOf(1920, 800));
  assert.notDeepEqual(t.av.__mock.display.roi, [0, 0, 1, 1]);
  t.avplay.open('https://media.fixture.test/b.mkv', {}, {});
  assert.deepEqual(t.av.__mock.display.roi, [0, 0, 1, 1], 'open() starts a session whole, and the wrapper knows');
  t.av.prepare();
  t.avplay.setPicture('fit', null);
  assert.equal(t.av.__mock.calls.filter((c) => c.method === 'setVideoRoi').length, 1, 'nothing to undo on the new session');
});

test('the shipped build does not offer Fill, the dev build only with ?fill=1', () => {
  assert.equal(FILL_ENABLED, false);
  assert.equal(fillOffered(), false, 'under Node (no dev define) nothing is offered');
});

test('the mock knows the three display methods Samsung lists, and refuses a cropped one that is not AVPlay\'s', () => {
  assert.deepEqual(DISPLAY_METHODS, ['PLAYER_DISPLAY_MODE_LETTER_BOX', 'PLAYER_DISPLAY_MODE_FULL_SCREEN', 'PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO']);
  const { av } = wrapper();
  av.setDisplayMethod('PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO');
  assert.equal(av.__mock.display.method, 'PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO');
  assert.throws(() => av.setDisplayMethod('PLAYER_DISPLAY_MODE_CROPPED_FULL'), /unknown display method/);
  assert.throws(() => av.setVideoRoi(0.5, 0, 0.8, 1), /inside the frame/);
  assert.throws(() => av.setVideoRoi(-0.1, 0, 1, 1), /inside the frame/);
});

test('the mock reports a video\'s shape the way a scenario says', () => {
  const info = (opts) => JSON.parse(buildTrackInfo(resolveTracks('eac3', opts)).find((t) => t.type === 'VIDEO').extra_info);
  assert.deepEqual([info({ width: 1920, height: 800 }).Width, info({ width: 1920, height: 800 }).Height], ['1920', '800']);
  assert.equal(info({ dar: '2.39:1' }).display_aspect_ratio, '2.39:1');
  assert.equal(info({ par: '16:11' }).pixel_aspect_ratio, '16:11');
  assert.equal(info({ noshape: true }).Width, undefined);
});

// ---- the engine ------------------------------------------------------------------------------------------------------

const WIDE = { res: '1920x800' };

test('the engine reads the shape after prepare, starts in Fit by default and logs it for Diagnostics', async () => {
  const t = makeEngine({ sources: [stream('Dune 1080p DDP5.1', WIDE)], fill: true });
  await t.start();
  await t.advance(3000);
  const info = t.engine.pictureInfo();
  assert.equal(info.mode, 'fit');
  assert.equal(info.showing, 'fit');
  assert.equal(info.text, '1920×800 · 2.40:1');
  assert.equal(info.bars, true);
  assert.match(info.note, /black bars above and below are part of the film/);
  assert.equal(info.crop, 26);
  assert.equal(t.callsOf('setVideoRoi').length, 0);
  assert.equal(t.av.__mock.display.method, 'PLAYER_DISPLAY_MODE_LETTER_BOX');
  assert.ok(t.log.some((l) => /picture: source 1920×800 · 2\.40:1/.test(l)), t.log.join('\n'));
  const snap = t.diag.snapshot();
  assert.equal(snap.picture.text, '1920×800 · 2.40:1');
  assert.match(pictureLines(snap.picture).join('\n'), /source {3}1920×800 · 2\.40:1/);
  assert.match(pictureLines(snap.picture).join('\n'), /asked {4}Fit/);
  assert.match(pictureLines(snap.picture).join('\n'), /showing {2}Fit via LETTER_BOX/);
});

test('a 16:9 file has no note, and a TV that does not say its size gets text saying nothing and Fit', async () => {
  const a = makeEngine({ sources: [stream('A 1080p DDP5.1', { res: '1920x1080' })] });
  await a.start(); await a.advance(3000);
  assert.equal(a.engine.pictureInfo().text, '1920×1080 · 1.78:1');
  assert.equal(a.engine.pictureInfo().note, '');
  const b = makeEngine({ sources: [stream('B 1080p DDP5.1', { noshape: '1' })], fill: true, settings: { pictureSize: 'fill' } });
  await b.start(); await b.advance(3000);
  const info = b.engine.pictureInfo();
  assert.equal(info.shape, null);
  assert.equal(info.text, '');
  assert.equal(info.showing, 'fit');
  assert.match(info.reason, /doesn't say its shape/);
  assert.match(pictureLines(info).join('\n'), /size not reported by the TV/);
});

test('the profile\'s default starts the film in Fill: the crop is set before play, at the start', async () => {
  const t = makeEngine({ sources: [stream('Dune 1080p DDP5.1', WIDE)], fill: true, settings: { pictureSize: 'fill' } });
  await t.start();
  await t.advance(3000);
  assert.equal(t.engine.pictureInfo().showing, 'fill');
  const roi = t.callsOf('setVideoRoi');
  assert.equal(roi.length, 1);
  assert.ok(roi[0].t <= t.callsOf('play')[0].t, 'set before the picture starts');
  assert.deepEqual(t.av.__mock.display.roi, fillRoi(shapeOf(1920, 800)));
  assert.equal(t.av.__mock.display.method, 'PLAYER_DISPLAY_MODE_LETTER_BOX');
  assert.equal(t.events.started.length, 1);
});

test('choosing Fill or Fit while watching applies at once, at the same second: no reload, no seek, remembered', async () => {
  const t = makeEngine({ sources: [stream('Dune 1080p DDP5.1', WIDE)], fill: true, params: { resumeAt: 60000 } });
  await t.start();
  await t.advance(3000);
  const opens = t.opens().length;
  const seeks = t.callsOf('seekTo').length;
  const here = t.av.__mock.position;
  const before = t.events.picture.length;

  assert.equal(t.engine.setPicture('fill'), true);
  assert.equal(t.engine.pictureInfo().showing, 'fill');
  assert.equal(t.engine.pictureInfo().mode, 'fill');
  assert.deepEqual(t.av.__mock.display.roi, fillRoi(shapeOf(1920, 800)), 'on the screen immediately, without advancing the clock');
  assert.equal(t.opens().length, opens, 'the source is not reopened');
  assert.equal(t.callsOf('seekTo').length, seeks, 'and not sought');
  assert.equal(t.av.__mock.position, here, 'the film is where it was');
  assert.equal(t.events.picture.length, before + 1, 'the panel is told');
  assert.equal(t.store.get('settings/pictureSize@p1'), 'fill', 'kept as this profile\'s default');

  t.engine.setPicture('fit');
  assert.deepEqual(t.av.__mock.display.roi, [0, 0, 1, 1]);
  assert.equal(t.engine.pictureInfo().showing, 'fit');
  assert.equal(t.store.get('settings/pictureSize@p1'), 'fit');
  assert.equal(t.opens().length, opens);
});

test('with Fill not offered the choice falls back to Fit and says why; the crop call never happens', async () => {
  const t = makeEngine({ sources: [stream('Dune 1080p DDP5.1', WIDE)] }); // the shipped flag: off
  await t.start();
  await t.advance(3000);
  assert.equal(t.engine.pictureInfo().fillSupported, false);
  t.engine.setPicture('fill');
  const info = t.engine.pictureInfo();
  assert.equal(info.mode, 'fill');
  assert.equal(info.showing, 'fit');
  assert.match(info.reason, /cannot crop/);
  assert.equal(t.callsOf('setVideoRoi').length, 0);
  assert.ok(t.log.some((l) => /Fill not applied/.test(l)));
  assert.match(pictureLines(info).join('\n'), /Fill is not offered on this TV/);
});

test('a choice made before AVPlay has prepared is applied when it has; a suspend and restore say it again', async () => {
  const t = makeEngine({ sources: [stream('Dune 1080p DDP5.1', WIDE)], fill: true });
  t.engine.setPicture('fill'); // before start(): only kept
  assert.equal(t.callsOf('setVideoRoi').length, 0);
  await t.start();
  await t.advance(3000);
  assert.equal(t.callsOf('setVideoRoi').length, 1);
  assert.equal(t.engine.pictureInfo().showing, 'fill');
  t.engine.suspend();
  t.engine.resume();
  assert.equal(t.callsOf('setVideoRoi').length, 2, 'applied again after the app comes back');
  assert.deepEqual(t.av.__mock.display.roi, fillRoi(shapeOf(1920, 800)));
});

test('a failed source gives way to the next, and the picture follows the new file\'s own shape', async () => {
  const t = makeEngine({
    sources: [stream('A 1080p DDP5.1', { res: '1920x800', start: 'never' }), stream('B 1080p DDP5.1', { res: '1920x1080' })],
    fill: true, settings: { pictureSize: 'fill' },
  });
  await t.start();
  await t.advance(16000);
  assert.equal(t.engine.state.at, 1);
  assert.equal(t.engine.pictureInfo().text, '1920×1080 · 1.78:1');
  assert.equal(t.engine.pictureInfo().showing, 'fill');
  assert.deepEqual(t.av.__mock.display.roi, [0, 0, 1, 1], 'a 16:9 film has nothing to cut, and the new session is whole');
});
