/*
 * Language names and codes (what Alder gets from java.util.Locale): ISO 639-1 (en), ISO 639-2 bibliographic and
 * terminologic (fre / fra), with region or script tags ignored (pt-BR, zh_Hant). Add-ons and AVPlay tracks mix all
 * of these ("eng", "ENG", "en", "en-US", "English").
 *
 * languageName('fre') -> 'French'       Locale(lang).displayLanguage.ifBlank { lang }
 * iso2('eng')         -> 'en'
 * sameLanguage('en-GB', 'eng') -> true
 */

// iso1  iso2(B)  [iso2(T) when different]  English name
const TABLE = `
aa aar Afar|ab abk Abkhazian|af afr Afrikaans|ak aka Akan|am amh Amharic|an arg Aragonese|ar ara Arabic|as asm Assamese
az aze Azerbaijani|ba bak Bashkir|be bel Belarusian|bg bul Bulgarian|bn ben Bengali|bo tib bod Tibetan|br bre Breton
bs bos Bosnian|ca cat Catalan|ce che Chechen|co cos Corsican|cs cze ces Czech|cv chv Chuvash|cy wel cym Welsh
da dan Danish|de ger deu German|dv div Divehi|el gre ell Greek|en eng English|eo epo Esperanto|es spa Spanish
et est Estonian|eu baq eus Basque|fa per fas Persian|fi fin Finnish|fo fao Faroese|fr fre fra French|fy fry Western Frisian
ga gle Irish|gd gla Scottish Gaelic|gl glg Galician|gn grn Guarani|gu guj Gujarati|gv glv Manx|ha hau Hausa
he heb Hebrew|hi hin Hindi|hr hrv Croatian|ht hat Haitian Creole|hu hun Hungarian|hy arm hye Armenian|id ind Indonesian
ig ibo Igbo|is ice isl Icelandic|it ita Italian|iu iku Inuktitut|ja jpn Japanese|jv jav Javanese|ka geo kat Georgian
kk kaz Kazakh|kl kal Kalaallisut|km khm Khmer|kn kan Kannada|ko kor Korean|ku kur Kurdish|ky kir Kyrgyz|la lat Latin
lb ltz Luxembourgish|lo lao Lao|lt lit Lithuanian|lv lav Latvian|mg mlg Malagasy|mi mao mri Maori|mk mac mkd Macedonian
ml mal Malayalam|mn mon Mongolian|mr mar Marathi|ms may msa Malay|mt mlt Maltese|my bur mya Burmese|nb nob Norwegian Bokmål
ne nep Nepali|nl dut nld Dutch|nn nno Norwegian Nynorsk|no nor Norwegian|oc oci Occitan|or ori Odia|pa pan Punjabi
pl pol Polish|ps pus Pashto|pt por Portuguese|qu que Quechua|rm roh Romansh|ro rum ron Romanian|ru rus Russian
rw kin Kinyarwanda|sa san Sanskrit|sd snd Sindhi|se sme Northern Sami|si sin Sinhala|sk slo slk Slovak|sl slv Slovenian
sm smo Samoan|sn sna Shona|so som Somali|sq alb sqi Albanian|sr srp Serbian|st sot Southern Sotho|su sun Sundanese
sv swe Swedish|sw swa Swahili|ta tam Tamil|te tel Telugu|tg tgk Tajik|th tha Thai|ti tir Tigrinya|tk tuk Turkmen
tl tgl Tagalog|tn tsn Tswana|to ton Tongan|tr tur Turkish|ts tso Tsonga|tt tat Tatar|ug uig Uyghur|uk ukr Ukrainian
ur urd Urdu|uz uzb Uzbek|vi vie Vietnamese|wo wol Wolof|xh xho Xhosa|yi yid Yiddish|yo yor Yoruba|zh chi zho Chinese
zu zul Zulu|fil fil Filipino|haw haw Hawaiian|yue yue Cantonese|ceb ceb Cebuano|mul mul Multiple languages
`;

const byCode = new Map(); // any code, lower case -> { iso2, iso3, name }
const NAMES = {};

TABLE.split(/\||\n/).map((s) => s.trim()).filter(Boolean).forEach((row) => {
  const words = row.split(/\s+/);
  const iso1 = words[0];
  // codes are the next 1-2 three-letter words; the rest is the name
  let i = 1;
  const codes3 = [];
  while (i < words.length && /^[a-z]{3}$/.test(words[i]) && codes3.length < 2 && !(codes3.length >= 1 && i === words.length - 1)) { codes3.push(words[i]); i++; }
  const name = words.slice(i).join(' ');
  const entry = { iso2: iso1.length === 2 ? iso1 : null, iso3: codes3[codes3.length - 1], name };
  byCode.set(iso1, entry);
  codes3.forEach((c) => byCode.set(c, entry));
  NAMES[name.toLowerCase()] = entry;
});

/** The base language code of a tag: "pt-BR" -> "pt", "zh_Hant" -> "zh", " ENG " -> "eng". '' for anything unusable. */
export function baseCode(code) {
  if (typeof code !== 'string') return '';
  const base = code.trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(base) ? base : '';
}

function lookup(code) {
  const base = baseCode(code);
  if (byCode.has(base)) return byCode.get(base);
  const byName = NAMES[String(code == null ? '' : code).trim().toLowerCase()];
  return byName || null;
}

/** English name of a language code, or the code itself when unknown (Locale(code).displayLanguage.ifBlank { code }). */
export function languageName(code) {
  const e = lookup(code);
  return e ? e.name : (code == null ? '' : String(code));
}

/** Two-letter ISO 639-1 code ("eng" -> "en"), or '' when the language has none or is unknown. */
export function iso2(code) {
  const e = lookup(code);
  return e && e.iso2 ? e.iso2 : '';
}

/** Three-letter ISO 639-2 code, terminologic form ("fre" -> "fra"), or ''. */
export function iso3(code) {
  const e = lookup(code);
  return e ? e.iso3 : '';
}

/** Do two codes or names denote the same language? Unknown codes match only themselves (case-insensitively). */
export function sameLanguage(a, b) {
  const x = lookup(a);
  const y = lookup(b);
  if (x && y) return x === y;
  return baseCode(a) !== '' && baseCode(a) === baseCode(b);
}

export const knownLanguages = () => Array.from(new Set(byCode.values())).map((e) => ({ iso2: e.iso2, iso3: e.iso3, name: e.name }));
