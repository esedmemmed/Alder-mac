/*
 * Mac language, for the module swap in scripts/build.mjs (npm run build:mac): same exports as src/player/language.js.
 * The language is navigator.language, two letters; 'en' when there is nothing to read.
 */
import { toIso1, languageOfLocale } from '../../core/lang.js';

/** "en_US" / "de-DE" / "pt-BR" -> "en" / "de" / "pt"; '' when there is nothing to read. */
export function twoLetters(locale) {
  const text = String(locale || '').trim();
  if (!text) return '';
  return toIso1(languageOfLocale(text));
}

/** createTvLanguage({ navigator, log }) -> { get(): "en", ready: Promise<string> } (ready is already settled). */
export function createTvLanguage({ navigator: nav = typeof navigator !== 'undefined' ? navigator : undefined, log = null } = {}) {
  const value = twoLetters(nav && (nav.language || (nav.languages && nav.languages[0]))) || 'en';
  if (log) log.info('lang', 'language from navigator.language: ' + value);
  return { get: () => value, ready: Promise.resolve(value) };
}
