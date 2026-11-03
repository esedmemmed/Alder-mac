import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseCode, languageName, iso2, iso3, sameLanguage, knownLanguages } from '../../src/lib/i18n-lang.js';

test('baseCode strips region and script tags and case; junk gives empty', () => {
  assert.equal(baseCode('pt-BR'), 'pt');
  assert.equal(baseCode('zh_Hant'), 'zh');
  assert.equal(baseCode(' ENG '), 'eng');
  assert.equal(baseCode(''), '');
  assert.equal(baseCode(null), '');
  assert.equal(baseCode('x'), '');
  assert.equal(baseCode('12'), '');
});

test('languageName: 2 and 3 letter codes, both ISO 639-2 forms, region tags', () => {
  assert.equal(languageName('en'), 'English');
  assert.equal(languageName('eng'), 'English');
  assert.equal(languageName('fre'), 'French');
  assert.equal(languageName('fra'), 'French');
  assert.equal(languageName('ger'), 'German');
  assert.equal(languageName('deu'), 'German');
  assert.equal(languageName('pt-BR'), 'Portuguese');
  assert.equal(languageName('zho'), 'Chinese');
  assert.equal(languageName('chi'), 'Chinese');
  assert.equal(languageName('spa'), 'Spanish');
  assert.equal(languageName('ara'), 'Arabic');
  assert.equal(languageName('jpn'), 'Japanese');
  assert.equal(languageName('ru'), 'Russian');
  assert.equal(languageName('ZH'), 'Chinese');
});

test('multi-word names survive the table parser', () => {
  assert.equal(languageName('gd'), 'Scottish Gaelic');
  assert.equal(languageName('fy'), 'Western Frisian');
  assert.equal(languageName('nb'), 'Norwegian Bokmål');
  assert.equal(languageName('ht'), 'Haitian Creole');
  assert.equal(languageName('mul'), 'Multiple languages');
});

test('unknown codes come back as given; names are accepted as input', () => {
  assert.equal(languageName('qqq'), 'qqq');
  assert.equal(languageName(''), '');
  assert.equal(languageName(null), '');
  assert.equal(languageName('English'), 'English');
  assert.equal(iso2('english'), 'en');
});

test('iso2 / iso3 conversions', () => {
  assert.equal(iso2('eng'), 'en');
  assert.equal(iso2('fre'), 'fr');
  assert.equal(iso2('fil'), '', 'Filipino has no two-letter code in this table');
  assert.equal(iso2('qqq'), '');
  assert.equal(iso3('fre'), 'fra');
  assert.equal(iso3('fr'), 'fra');
  assert.equal(iso3('en'), 'eng');
  assert.equal(iso3('de'), 'deu');
  assert.equal(iso3('zz'), '');
});

test('sameLanguage matches across forms and rejects different languages', () => {
  assert.ok(sameLanguage('en-GB', 'eng'));
  assert.ok(sameLanguage('fre', 'fra'));
  assert.ok(sameLanguage('fr', 'FRE'));
  assert.ok(sameLanguage('English', 'en'));
  assert.ok(!sameLanguage('en', 'es'));
  assert.ok(!sameLanguage('eng', 'spa'));
  assert.ok(sameLanguage('qqq', 'QQQ'), 'unknown codes match only themselves');
  assert.ok(!sameLanguage('qqq', 'qqr'));
  assert.ok(!sameLanguage('', ''));
});

test('the table is consistent: every entry has a name and a three-letter code, no duplicates', () => {
  const all = knownLanguages();
  assert.ok(all.length > 120);
  for (const l of all) {
    assert.ok(l.name && l.name.length > 2, JSON.stringify(l));
    assert.match(l.iso3, /^[a-z]{3}$/, JSON.stringify(l));
    if (l.iso2) assert.match(l.iso2, /^[a-z]{2}$/);
    assert.ok(!/^[a-z]{3}(\s|$)/.test(l.name), 'a code leaked into the name: ' + l.name);
  }
  const names = all.map((l) => l.name);
  assert.equal(new Set(names).size, names.length);
});
