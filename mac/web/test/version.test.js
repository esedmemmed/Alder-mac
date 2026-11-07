'use strict';
// The Mac bundle carries mac/VERSION (not package.json's version): dist-mac/app.js, from `npm run build:mac`.
const nodeTest = require('node:test').test;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const APP_JS = path.join(ROOT, 'dist-mac', 'app.js');

nodeTest('dist-mac/app.js embeds mac/VERSION', { skip: !fs.existsSync(APP_JS) && 'dist-mac not built (npm run build:mac)' }, () => {
  const version = fs.readFileSync(path.join(ROOT, 'mac', 'VERSION'), 'utf8').trim();
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.ok(fs.readFileSync(APP_JS, 'utf8').includes(JSON.stringify(version)));
});
