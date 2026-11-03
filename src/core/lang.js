// Language names and codes for the places Alder leans on java.util.Locale:
//   Subtitle.language          Locale(lang).displayLanguage
//   Stream.mentions(language)  Locale(language).getDisplayLanguage(ENGLISH)
//   Subtitle.local             lang == Locale.getDefault().language / .isO3Language
//   AVPlay track languages     ISO 639-2 ("eng") compared with Settings' two-letter audio language
// PLAN.md puts the full table in src/lib/i18n-lang.js (Phase 1). Core stays standalone and pure, so it carries this
// compact table of the languages add-ons and releases actually use; callers can inject a fuller `languageName`.

// [ISO 639-1, ISO 639-2/B, ISO 639-2/T (when different), English name]
const TABLE = [
  ['ar', 'ara', '', 'Arabic'], ['az', 'aze', '', 'Azerbaijani'], ['bg', 'bul', '', 'Bulgarian'], ['bn', 'ben', '', 'Bengali'],
  ['bs', 'bos', '', 'Bosnian'], ['ca', 'cat', '', 'Catalan'], ['cs', 'cze', 'ces', 'Czech'], ['da', 'dan', '', 'Danish'],
  ['de', 'ger', 'deu', 'German'], ['el', 'gre', 'ell', 'Greek'], ['en', 'eng', '', 'English'], ['es', 'spa', '', 'Spanish'],
  ['et', 'est', '', 'Estonian'], ['eu', 'baq', 'eus', 'Basque'], ['fa', 'per', 'fas', 'Persian'], ['fi', 'fin', '', 'Finnish'],
  ['fr', 'fre', 'fra', 'French'], ['gl', 'glg', '', 'Galician'], ['he', 'heb', '', 'Hebrew'], ['hi', 'hin', '', 'Hindi'],
  ['hr', 'hrv', '', 'Croatian'], ['hu', 'hun', '', 'Hungarian'], ['hy', 'arm', 'hye', 'Armenian'], ['id', 'ind', '', 'Indonesian'],
  ['is', 'ice', 'isl', 'Icelandic'], ['it', 'ita', '', 'Italian'], ['ja', 'jpn', '', 'Japanese'], ['ka', 'geo', 'kat', 'Georgian'],
  ['kk', 'kaz', '', 'Kazakh'], ['km', 'khm', '', 'Khmer'], ['kn', 'kan', '', 'Kannada'], ['ko', 'kor', '', 'Korean'],
  ['lt', 'lit', '', 'Lithuanian'], ['lv', 'lav', '', 'Latvian'], ['mk', 'mac', 'mkd', 'Macedonian'], ['ml', 'mal', '', 'Malayalam'],
  ['mn', 'mon', '', 'Mongolian'], ['mr', 'mar', '', 'Marathi'], ['ms', 'may', 'msa', 'Malay'], ['my', 'bur', 'mya', 'Burmese'],
  ['nb', 'nob', '', 'Norwegian Bokmål'], ['ne', 'nep', '', 'Nepali'], ['nl', 'dut', 'nld', 'Dutch'], ['no', 'nor', '', 'Norwegian'],
  ['pa', 'pan', '', 'Punjabi'], ['pl', 'pol', '', 'Polish'], ['pt', 'por', '', 'Portuguese'], ['ro', 'rum', 'ron', 'Romanian'],
  ['ru', 'rus', '', 'Russian'], ['si', 'sin', '', 'Sinhala'], ['sk', 'slo', 'slk', 'Slovak'], ['sl', 'slv', '', 'Slovenian'],
  ['sq', 'alb', 'sqi', 'Albanian'], ['sr', 'srp', '', 'Serbian'], ['sv', 'swe', '', 'Swedish'], ['sw', 'swa', '', 'Swahili'],
  ['ta', 'tam', '', 'Tamil'], ['te', 'tel', '', 'Telugu'], ['th', 'tha', '', 'Thai'], ['tl', 'tgl', '', 'Tagalog'],
  ['tr', 'tur', '', 'Turkish'], ['uk', 'ukr', '', 'Ukrainian'], ['ur', 'urd', '', 'Urdu'], ['uz', 'uzb', '', 'Uzbek'],
  ['vi', 'vie', '', 'Vietnamese'], ['zh', 'chi', 'zho', 'Chinese'], ['la', 'lat', '', 'Latin'], ['af', 'afr', '', 'Afrikaans'],
]

const BY_CODE = {}
for (const [c1, b, t, name] of TABLE) {
  const entry = { c1, c3: b, name }
  BY_CODE[c1] = entry
  BY_CODE[b] = entry
  if (t) BY_CODE[t] = entry
}
// Names some add-ons and AVPlay put in the language field, and common 639-2 oddities.
const ALIASES = {
  pob: 'pt', pom: 'pt', 'pt-br': 'pt', 'pt-pt': 'pt', zht: 'zh', 'zh-cn': 'zh', 'zh-tw': 'zh', zhs: 'zh',
  scc: 'sr', hbs: 'sr', fil: 'tl', nob: 'nb', nno: 'no', nn: 'no',
}

function entryOf(code) {
  if (!code) return null
  const key = String(code).trim().toLowerCase().replace(/_/g, '-')
  if (BY_CODE[key]) return BY_CODE[key]
  if (ALIASES[key]) return BY_CODE[ALIASES[key]]
  const base = key.split('-')[0] // "en-US" -> "en"
  if (BY_CODE[base]) return BY_CODE[base]
  if (ALIASES[base]) return BY_CODE[ALIASES[base]]
  for (const e of Object.values(BY_CODE)) if (e.name.toLowerCase() === key) return e // "English"
  return null
}

/** Locale(code).getDisplayLanguage(ENGLISH): "English" for "en" or "eng"; unknown codes come back as they were given. */
export function languageName(code) {
  const e = entryOf(code)
  return e ? e.name : String(code == null ? '' : code)
}

/** Two-letter code for any code or name we know ("eng" -> "en"), else the lowercased input. */
export function toIso1(code) {
  const e = entryOf(code)
  return e ? e.c1 : String(code == null ? '' : code).trim().toLowerCase()
}

/** Three-letter (ISO 639-2/B) code, or "" when unknown. */
export function toIso3(code) {
  const e = entryOf(code)
  return e ? e.c3 : ''
}

/** The two-letter language of a locale string such as "en_US" or "de-DE" (Kotlin's Locale.language). */
export function languageOfLocale(locale) {
  const base = String(locale || '').split(/[-_]/)[0].toLowerCase()
  return base || 'en'
}
