/*
 * Mac sign-in: an e-mail and password in native fields on the code screen (scripts/build.mjs patches it into signin.js), through
 * session.login(email, password) (api.strem.io `login`). The phone link and QR stay below it. Never logs the e-mail, the password
 * or the auth key; the auth key goes to the caller (the profile store) and nowhere else.
 */
import { h } from '../../lib/dom.js';
import { pill } from '../../ui/button.js';
import { createTextField } from './osk.js';

const REACH = "Can't reach Stremio. Check the TV's connection.";

/** { authKey } or { error } (the text for the screen). The failure text is the one the Tizen e-mail path shows. */
export async function passwordSignIn(session, emailText, password, log) {
  const email = String(emailText || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: 'Enter the e-mail address.' };
  if (!password) return { error: 'Enter the password.' };
  try {
    return { authKey: await session.login(email, password) };
  } catch (e) {
    // Never log the request: it carries the password.
    if (log) log.warn('signin', 'e-mail sign-in failed' + (e && e.code ? ' (' + e.code + ')' : ''));
    return { error: e && e.name === 'ApiException' && e.message ? e.message : REACH };
  }
}

export function macSigninForm({ session, draftName, onApproved, log }) {
  let busy = false;
  const error = h('div', { class: 't-small ob-error' }, '');
  const clearError = () => { error.textContent = ''; };
  const mail = createTextField({ placeholder: 'E-mail', maxLength: 128, onChange: clearError });
  const pass = createTextField({ placeholder: 'Password', password: true, maxLength: 128, onChange: clearError });
  mail.input.type = 'email';
  mail.input.setAttribute('autocomplete', 'username');
  pass.input.setAttribute('autocomplete', 'current-password');

  async function submit() {
    if (busy) return;
    busy = true;
    error.textContent = 'Signing in…';
    const r = await passwordSignIn(session, mail.value, pass.value, log);
    busy = false;
    if (!el.isConnected) return;
    if (r.error) { error.textContent = r.error; return; }
    error.textContent = '';
    onApproved(r.authKey);
  }
  mail.input.addEventListener('keydown', (e) => { if (e.keyCode === 13) { e.preventDefault(); if (pass.value) submit(); else pass.input.focus(); } });
  pass.input.addEventListener('keydown', (e) => { if (e.keyCode === 13) { e.preventDefault(); submit(); } });

  const el = h('div', { class: 'ob-macform' },
    h('div', { class: 't-title' }, 'Sign in to Stremio'),
    h('div', { class: 't-body t-2 ob-sub' }, 'Use ' + draftName + "'s Stremio e-mail and password."),
    mail.el, pass.el, error, pill('Sign in', { onClick: submit }));
  return { el, firstInput: mail.input };
}
