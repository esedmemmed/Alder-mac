import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../../src/app/session.js';
import { createLogger } from '../../src/lib/log.js';
import { KEYS } from '../../src/core/keys.js';
import { passwordSignIn } from '../../src/platform/mac/signin-form.js';
import { attachKeys } from '../../src/platform/mac/keys.js';
import { buildMacAppJs } from './mac-build-lock.js';
import { fakeHttp, memoryStore } from '../core/helpers.js';

const KEY = 'FIXTURE-AUTH-KEY-0001'; // dev/fixtures/api.strem.io/api/login.json
const PASSWORD = 'correct horse battery';
const EMAIL = 'viewer@fixture.test';
const WRONG = '{"error":{"code":2,"message":"Wrong e-mail or password"}}';

function make(over = {}) {
  const http = fakeHttp(over);
  const store = memoryStore();
  const log = createLogger();
  return { http, store, log, session: createSession({ store, http, tvLanguage: () => 'en' }) };
}

test('Mac sign-in: e-mail and password give the auth key (fixture); only the profile store key holds it; no log line has it', async () => {
  const { http, store, log, session } = make();
  const r = await passwordSignIn(session, ' ' + EMAIL + ' ', PASSWORD, log);
  assert.deepEqual(r, { authKey: KEY });
  session.profiles.add('Ann', r.authKey, undefined);
  for (const [k, v] of store.data) {
    assert.equal(JSON.stringify(v).includes(KEY), k === KEYS.profiles, 'authKey in store key ' + k);
  }
  assert.equal(KEYS.profiles, 'account/profiles');
  assert.equal(session.authKey(), KEY);
  const sent = JSON.parse(http.log.find((q) => q.url.endsWith('/login')).body);
  assert.deepEqual(sent, { type: 'Login', email: EMAIL, password: PASSWORD, facebook: false });
  const text = JSON.stringify(log.lines()) + log.text();
  for (const secret of [KEY, PASSWORD, EMAIL]) assert.ok(!text.includes(secret), 'log holds a secret');
});

test('Mac sign-in: a wrong password shows Stremio\'s own text, as the Tizen e-mail path does; nothing sensitive is logged', async () => {
  const { log, session } = make({ overrides: { 'https://api.strem.io/api/login': WRONG } });
  const r = await passwordSignIn(session, EMAIL, PASSWORD, log);
  assert.deepEqual(r, { error: 'Wrong e-mail or password' });
  assert.equal(session.profile(), null);
  const text = log.text();
  assert.ok(text.includes('e-mail sign-in failed (2)'));
  for (const secret of [KEY, PASSWORD, EMAIL]) assert.ok(!text.includes(secret));
});

test('Mac sign-in: an unreachable Stremio, an empty e-mail and an empty password give the Tizen texts', async () => {
  const down = make({ overrides: { 'https://api.strem.io/api/login': new Error('offline') } });
  assert.deepEqual(await passwordSignIn(down.session, EMAIL, PASSWORD, down.log), { error: "Can't reach Stremio. Check the Mac's internet connection." });
  const { session } = make();
  assert.deepEqual(await passwordSignIn(session, 'nobody', PASSWORD), { error: 'Enter the e-mail address.' });
  assert.deepEqual(await passwordSignIn(session, EMAIL, ''), { error: 'Enter the password.' });
});

test('Mac keys: in a text field Backspace, Space, digits, letters and left / right stay the field\'s; Return and Esc still reach the app', () => {
  const handlers = {};
  const target = { addEventListener: (n, f) => { handlers[n] = f; }, removeEventListener() {} };
  const seen = [];
  attachKeys({ target, onAction: (e) => seen.push(e.action) });
  for (const code of [8, 32, 48, 53, 96, 37, 39, 221, 219, 65]) {
    const e = { keyCode: code, target: { tagName: 'INPUT' }, preventDefault() { assert.fail('key ' + code + ' was eaten'); }, repeat: false };
    handlers.keydown(e); handlers.keyup(e);
  }
  assert.deepEqual(seen, []);
  for (const code of [13, 27]) {
    const e = { keyCode: code, target: { tagName: 'INPUT' }, preventDefault() {}, repeat: false };
    handlers.keydown(e); handlers.keyup(e);
  }
  assert.deepEqual(seen, ['ok', 'back']);
});

test('build:mac: sign-in holds the native form, search no longer shows the letter grid, osk.js is the native one', async () => {
  const js = await buildMacAppJs();
  assert.ok(js.includes('Sign in to Stremio'));
  assert.ok(js.includes('osk-native'));
  assert.ok(!js.includes('TV keyboard'), 'the Tizen on-screen keyboard is in the Mac bundle');
});
