/*
 * The TV's language as a two-letter code, for Alder's rule "Settings' audio language, else the TV's" (core/settings.js
 * audioLanguage() calls the `tvLanguage` it is given: this makes one).
 *
 * Alder reads Locale.getDefault(). On Tizen the choices are tizen.systeminfo LOCALE (the menu language, asynchronous, and
 * it needs the systeminfo privilege, which config.xml does not declare today: see "Requests" in the Phase 3 report) and
 * navigator.language (Tizen sets the web view's language to the TV's menu language). get() answers at once from
 * navigator.language; once LOCALE has answered, it answers from that.
 */
import { toIso1, languageOfLocale } from '../core/lang.js';

/** "en_US" / "de-DE" / "pt-BR" -> "en" / "de" / "pt"; '' when there is nothing to read. */
export function twoLetters(locale) {
  const text = String(locale || '').trim();
  if (!text) return '';
  return toIso1(languageOfLocale(text));
}

/**
 * createTvLanguage({ tizen, navigator, log }) -> { get(): "en", ready: Promise<string> }
 * `ready` resolves when tizen.systeminfo has answered or failed (never rejects), so a caller may wait for it before the
 * first audio decision if it wants the exact answer.
 */
export function createTvLanguage({ tizen = typeof window !== 'undefined' ? window.tizen : undefined, navigator: nav = typeof navigator !== 'undefined' ? navigator : undefined, log = null } = {}) {
  const fromBrowser = twoLetters(nav && (nav.language || (nav.languages && nav.languages[0])));
  let value = fromBrowser || 'en';
  const say = (m) => { if (log) log.info('lang', m); };

  const ready = new Promise((resolve) => {
    const info = tizen && tizen.systeminfo;
    if (!info || typeof info.getPropertyValue !== 'function') { say('TV language from navigator.language: ' + value); resolve(value); return; }
    try {
      info.getPropertyValue('LOCALE', (locale) => {
        const fromTv = twoLetters(locale && (locale.language || locale));
        if (fromTv) { value = fromTv; say('TV language from systeminfo LOCALE: ' + value); } else say('systeminfo LOCALE had no language; using ' + value);
        resolve(value);
      }, (e) => { say('systeminfo LOCALE failed (' + (e && e.name ? e.name : e) + '); using navigator.language: ' + value); resolve(value); });
    } catch (e) {
      say('systeminfo LOCALE threw (' + (e && e.name ? e.name : e) + '); using navigator.language: ' + value);
      resolve(value);
    }
  });

  return { get: () => value, ready };
}
