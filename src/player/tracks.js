/*
 * What the audio & subtitles panel shows, from AVPlay's track list: Alder's trackName() ("English  ·  Dolby Digital 5.1"),
 * the rows of the panel, the file's own text tracks and the rule for which subtitles start with the video.
 * Pure functions: no DOM, no AVPlay.
 */
import { parseExtraInfo } from '../core/audio.js';
import { toIso1, languageOfLocale } from '../core/lang.js';
import { languageName } from '../lib/i18n-lang.js';
import { NO_SOUND_TAG } from '../core/audio.js';

/** Alder writes its two-part labels as "name  ·  tag"; the panel splits them again. */
export const SEP = '  ·  ';

const FORMAT_NAMES = {
  AC3: 'Dolby Digital', EAC3: 'Dolby Digital Plus', TRUEHD: 'Dolby TrueHD', DTS: 'DTS', 'DTS-HD': 'DTS-HD', 'DTS:X': 'DTS:X',
  AAC: 'AAC', OPUS: 'Opus', FLAC: 'FLAC', MP3: 'MP3', VORBIS: 'Vorbis', PCM: 'PCM',
};

/** "Mono", "Stereo", "5.1", "7.1", "N ch", or null when AVPlay did not say (Alder: Format.NO_VALUE). */
export function channelName(channels) {
  if (!channels) return null;
  return channels === 1 ? 'Mono' : channels === 2 ? 'Stereo' : channels === 6 ? '5.1' : channels === 8 ? '7.1' : channels + ' ch';
}

/** The release's own name for a track when it has one ("Dub [Netflix]"), unless that only repeats the language. */
function ownLabel(track, language) {
  const label = (track.label || '').trim();
  return label && label.toLowerCase() !== (language || '').toLowerCase() ? label : '';
}

/** The language of a parsed track as people read it ("English"), '' for und / unknown. */
export function trackLanguage(track) {
  return track.language ? languageName(track.language) : '';
}

/**
 * Alder's trackName(): "English  ·  Dolby Digital 5.1" for audio, "English  ·  Forced" for text. The release's own label
 * replaces the format when there is one (as in tracks.jpg: "Russian  ·  Dub [Netflix]").
 * [track]: a parseAudioTracks() item or a parseTextTracks() item.
 */
export function trackName(track, audio) {
  const language = trackLanguage(track);
  let format = null;
  if (audio) {
    const known = FORMAT_NAMES[track.codec];
    const atmos = track.codec === 'EAC3' && /atmos|joc/i.test(typeof track.raw === 'string' ? track.raw : JSON.stringify(track.raw || ''));
    format = [atmos ? 'Dolby Atmos' : known || (track.codec ? track.codec : null), channelName(track.channels)].filter(Boolean).join(' ') || null;
  }
  const label = ownLabel(track, language);
  const parts = [language, label || format].filter(Boolean);
  return parts.length ? parts.join(SEP) : 'Track ' + track.index;
}

/**
 * The rows of the Audio section: { index, name, tag, playable, label }. A track this TV cannot decode stays in the list,
 * greyed, tagged "No sound on this TV" (PLAN.md section 5); picking it does nothing.
 */
export function audioRows(tracks) {
  return tracks.map((t) => {
    const full = trackName(t, true);
    const cut = full.indexOf(SEP);
    const name = cut < 0 ? full : full.slice(0, cut);
    let tag = cut < 0 ? '' : full.slice(cut + SEP.length);
    const playable = t.playable !== 'no';
    if (!playable) tag = tag ? tag + SEP + NO_SOUND_TAG : NO_SOUND_TAG;
    return { index: t.index, name, tag, playable, label: tag ? name + SEP + tag : name };
  });
}

// --- the file's own text tracks ---------------------------------------------------------------------------------------

const TEXT_LANG_KEYS = ['track_lang', 'language', 'lang', 'Language'];
const TEXT_LABEL_KEYS = ['track_name', 'name', 'title', 'label', 'handler_name', 'subtitle_name'];
const first = (info, keys) => {
  for (const k of keys) {
    const v = info[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
};

/**
 * getTotalTrackInfo() -> the TEXT tracks as { index, language ("en", '' when unknown), label, forced, raw }.
 * Samsung documents only that extra_info is JSON; the mock and forum posts use track_lang. Parsed defensively.
 */
export function parseTextTracks(totalTrackInfo) {
  const list = Array.isArray(totalTrackInfo) ? totalTrackInfo : [];
  return list
    .filter((t) => t && String(t.type).toUpperCase() === 'TEXT')
    .map((t) => {
      const info = parseExtraInfo(t.extra_info !== undefined ? t.extra_info : t.extraInfo);
      const language = first(info, TEXT_LANG_KEYS);
      const label = first(info, TEXT_LABEL_KEYS);
      return {
        index: Number(t.index),
        language: language && language.toLowerCase() !== 'und' && language.toLowerCase() !== 'notset' ? toIso1(language) : '',
        label,
        forced: /forced/i.test(label) || /forced/i.test(String(t.extra_info || '')),
        raw: t.extra_info,
      };
    });
}

/**
 * The subtitles that start with the video, as Alder does it: releases flag foreign subtitles as forced or default (Lanterns
 * came up with Russian "Forced" under English audio), so a track starts only when it is in the TV's language and Settings
 * has subtitles on; otherwise none. Flags are ignored; among several in the TV's language a full track beats a forced one.
 * Returns the track to select, or null for "none".
 */
export function startSubtitle(textTracks, { enabled, tvLanguage }) {
  if (!enabled || !textTracks.length) return null;
  const tv = languageOfLocale(tvLanguage);
  const mine = textTracks.filter((t) => t.language && t.language === tv);
  return mine.find((t) => !t.forced) || mine[0] || null;
}

/** The rows of the Subtitles section: "Off", the file's own ("English  ·  in the file"), then the add-on's. */
export function subtitleRows(textTracks, addonSubs) {
  const rows = [{ kind: 'off', name: 'Off', tag: '', label: 'Off' }];
  textTracks.forEach((t) => {
    const full = trackName(t, false) + SEP + 'in the file';
    const cut = full.indexOf(SEP);
    rows.push({ kind: 'file', index: t.index, name: full.slice(0, cut), tag: full.slice(cut + SEP.length), label: full });
  });
  addonSubs.forEach((s, i) => rows.push({ kind: 'addon', sub: s, addonIndex: i, name: s.language, tag: s.addon, label: s.language + SEP + s.addon }));
  return rows;
}

/** The steps of the Subtitle timing section: Alder's list, and the words for each. */
export const TIMING_STEPS = Object.freeze([-2000, -1000, -500, 0, 500, 1000, 2000]);

export function timingLabel(ms) {
  if (ms === 0) return 'On time';
  const seconds = (Math.abs(ms) / 1000).toFixed(1);
  return (ms < 0 ? '-' : '+') + seconds + ' s' + (ms < 0 ? '  earlier' : '  later');
}
