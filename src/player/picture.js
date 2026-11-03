/*
 * Picture size and "what shape is the film?": pure functions, no DOM and no AVPlay.
 *
 * Why this exists. On the owner's TV some films "didn't fill the whole screen". A 2.39:1 film on a 16:9 screen has black
 * bars above and below, and those bars are very often in the file itself, but nothing told the owner so. Two parts:
 *
 *   1. The source's shape, read from the VIDEO track's extra_info (Width, Height and, when AVPlay says, the pixel or display
 *      aspect), written as "1920×800 · 2.40:1" with a plain sentence when the film is wider than the TV.
 *   2. A choice of Fit (the whole picture, bars when the shapes differ) or Fill (zoomed until the picture covers the
 *      screen, the overflow cropped, never stretched). How each is asked of AVPlay is in avplay.js (setPicture); the geometry
 *      that Fill needs is here (fillRoi). Fill is built but OFF in the shipped build (avplay.js FILL_ENABLED): see DECISIONS.md.
 *
 * Samsung documents no field names for the VIDEO extra_info, so every spelling seen in forum posts is read, and nothing
 * here throws on a value it does not understand: an unknown shape just means no text and Fill behaving as Fit.
 */
import { parseExtraInfo } from '../core/audio.js';

/** The two choices, as stored in Settings ('pictureSize') and used by the engine and the panel. */
export const PICTURE = Object.freeze({ FIT: 'fit', FILL: 'fill' });
export const PICTURE_NAMES = Object.freeze({ fit: 'Fit', fill: 'Fill' });

/** The screen's own shape: 16:9. AVPlay's coordinates are always 1920 x 1080 (avplay.js SCREEN). */
export const SCREEN_RATIO = 16 / 9;

/** A film this much wider (or narrower) than the screen is said to have bars: 1.85:1 has 2% bars, 2.00:1 has 11%. */
const BARS_FROM = 1.04;

export function normalisePicture(value) {
  return value === PICTURE.FILL ? PICTURE.FILL : PICTURE.FIT;
}

// --- reading the VIDEO track ------------------------------------------------------------------------------------------

const WIDTH_KEYS = ['Width', 'width', 'video_width', 'Video_width', 'frame_width', 'coded_width', 'pixel_width', 'resolution_width'];
const HEIGHT_KEYS = ['Height', 'height', 'video_height', 'Video_height', 'frame_height', 'coded_height', 'pixel_height', 'resolution_height'];
const DISPLAY_KEYS = ['display_aspect_ratio', 'Display_aspect_ratio', 'dar', 'DAR', 'aspect_ratio', 'Aspect_ratio', 'aspectRatio', 'AspectRatio', 'aspect', 'Aspect', 'video_aspect', 'Video_aspect'];
const PIXEL_KEYS = ['pixel_aspect_ratio', 'Pixel_aspect_ratio', 'par', 'PAR', 'sample_aspect_ratio', 'Sample_aspect_ratio', 'sar', 'SAR'];

function pick(info, keys) {
  const lowered = {};
  Object.keys(info).forEach((k) => { lowered[k.toLowerCase().replace(/[\s-]+/g, '_')] = info[k]; });
  for (const k of keys) {
    const v = info[k] !== undefined ? info[k] : lowered[k.toLowerCase()];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/** "1920" or "1920 px" or 1920 -> 1920, else 0. */
function pixels(value) {
  const m = /\d+/.exec(String(value));
  const n = m ? Number(m[0]) : 0;
  return n >= 16 && n <= 16384 ? n : 0;
}

/** "16:9", "16/9", "2.40:1", "1.7778", "2.39" -> a number; 0 when it is not a plausible shape (0.4 .. 4.5). */
export function parseRatio(value) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (!text) return 0;
  const pair = /^(\d+(?:\.\d+)?)\s*[:/x×]\s*(\d+(?:\.\d+)?)$/.exec(text);
  const n = pair ? Number(pair[1]) / Number(pair[2]) : /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : 0;
  return Number.isFinite(n) && n >= 0.4 && n <= 4.5 ? n : 0;
}

/**
 * getTotalTrackInfo() (or getCurrentStreamInfo()) -> the video's shape, or null when no VIDEO track says its size:
 *   { width, height, stored (width / height), pixel (the pixel aspect, 1 when not reported), ratio (the shape people see:
 *     the display aspect when AVPlay reports one, else stored x pixel), reported ('display' | 'pixel' | 'none') }
 * [currentIndex]: the VIDEO track in use when there are several.
 */
export function parseVideoShape(tracks, { currentIndex = null } = {}) {
  const list = (Array.isArray(tracks) ? tracks : []).filter((t) => t && String(t.type).toUpperCase() === 'VIDEO');
  const ordered = currentIndex === null ? list : list.filter((t) => Number(t.index) === currentIndex).concat(list.filter((t) => Number(t.index) !== currentIndex));
  for (const track of ordered) {
    const info = parseExtraInfo(track.extra_info !== undefined ? track.extra_info : track.extraInfo);
    const width = pixels(pick(info, WIDTH_KEYS));
    const height = pixels(pick(info, HEIGHT_KEYS));
    if (!width || !height) continue;
    const stored = width / height;
    const display = parseRatio(pick(info, DISPLAY_KEYS));
    const pixel = parseRatio(pick(info, PIXEL_KEYS));
    // A display aspect that only repeats the stored shape (1.78 for 1920x1080) is as good as none; a different one is the
    // file saying its pixels are not square, and it wins over the stored shape.
    const ratio = display || (pixel ? stored * pixel : stored);
    return { width, height, stored, pixel: pixel || 1, ratio, reported: display ? 'display' : pixel ? 'pixel' : 'none' };
  }
  return null;
}

// --- words ------------------------------------------------------------------------------------------------------------

/** 2.4 -> "2.40:1", 1.7778 -> "1.78:1", 1.333 -> "1.33:1". */
export function ratioText(ratio) {
  return ratio > 0 ? ratio.toFixed(2) + ':1' : '';
}

/** "1920×800 · 2.40:1", or '' when the shape is unknown. */
export function shapeText(shape) {
  return shape ? shape.width + '×' + shape.height + ' · ' + ratioText(shape.ratio) : '';
}

/** How far the film's shape is from the screen's: > 1 wider (bars above and below), < 1 taller (bars at the sides). */
export function relativeShape(shape) {
  return shape ? shape.ratio / SCREEN_RATIO : 1;
}

/** Bars from the shapes differing at all, as opposed to the picture just being the screen's shape. */
export function hasBars(shape) {
  const r = relativeShape(shape);
  return r >= BARS_FROM || r <= 1 / BARS_FROM;
}

/**
 * The plain-language note shown with the shape. Wider than 16:9: the bars are in the film (the file is the shape it is;
 * no TV setting can add picture that was never recorded). Narrower: bars at the sides, same reason. Empty for 16:9.
 */
export function shapeNote(shape) {
  if (!shape || !hasBars(shape)) return '';
  if (relativeShape(shape) > 1) return 'This film is wider than your TV (16:9), so the black bars above and below are part of the film.';
  return 'This video is taller than your TV (16:9), so the black bars at the sides are part of the video.';
}

/** The share of the picture Fill cuts off, as a whole percent: 0 for a 16:9 film, 26 for 2.39:1 (which is how much of it Fit leaves as bars). */
export function cropPercent(shape) {
  if (!shape) return 0;
  const r = relativeShape(shape);
  const kept = r >= 1 ? 1 / r : r;
  return Math.round((1 - kept) * 100);
}

/** What the Picture rows say about themselves: { fit, fill } sub-texts. */
export function pictureHints(shape, fillSupported = true) {
  if (!fillSupported) return { fit: 'The whole picture', fill: 'Not available on this TV' };
  const crop = cropPercent(shape);
  return {
    fit: shape && hasBars(shape) ? 'The whole picture, with bars' : 'The whole picture',
    fill: !shape ? 'Zooms in, cuts the edges' : crop >= 1 ? 'Zooms in, cuts ' + crop + '% of the picture' : 'Same as Fit for this film',
  };
}

// --- Fill, as a crop of the source --------------------------------------------------------------------------------------

/**
 * Fill is a crop of the source, then Fit: AVPlay's setVideoRoi(x, y, w, h) takes the part of the frame to show as ratios
 * of the whole frame, and LETTER_BOX then fits that part to the screen. The part is the largest one that has the screen's
 * shape, centred: a 2.39:1 film keeps its middle 74% of the width, a 4:3 film its middle 75% of the height. Returns
 * [x, y, w, h] (0..1), or null when the shape is unknown or already the screen's (nothing to cut).
 * (setDisplayRect cannot do this: it takes unsigned numbers, so a rect larger than the screen cannot be centred; see DECISIONS.md.)
 */
export function fillRoi(shape) {
  if (!shape || !(shape.ratio > 0)) return null;
  const r = shape.ratio / SCREEN_RATIO;
  if (r > 1 - 1e-3 && r < 1 + 1e-3) return null;
  const round = (v) => Math.round(v * 10000) / 10000;
  if (r > 1) { const w = 1 / r; return [round((1 - w) / 2), 0, round(w), 1]; }
  return [0, round((1 - r) / 2), 1, round(r)];
}

// --- Diagnostics ------------------------------------------------------------------------------------------------------

/** The PICTURE section of Diagnostics, from the engine's pictureInfo(): what the file says and what the player did about it. */
export function pictureLines(info) {
  if (!info) return ['Nothing has been played yet'];
  const lines = [];
  lines.push('source   ' + (info.shape ? shapeText(info.shape) + (info.shape.reported === 'none' ? '' : '  (' + info.shape.reported + ' aspect from the file)') : 'size not reported by the TV'));
  if (info.shape && info.shape.reported === 'none' && Math.abs(info.shape.pixel - 1) > 0.001) lines.push('pixels   ' + info.shape.pixel.toFixed(3) + ':1');
  if (info.note) lines.push(info.note);
  lines.push('asked    ' + PICTURE_NAMES[info.mode] + (info.fillSupported ? '' : '  (Fill is not offered on this TV)'));
  lines.push('showing  ' + PICTURE_NAMES[info.showing] + (info.method ? ' via ' + info.method.replace('PLAYER_DISPLAY_MODE_', '') : '') + (info.roi ? '  crop ' + info.roi.join(', ') : ''));
  if (info.reason) lines.push('note     ' + info.reason);
  return lines;
}
