'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { desktopCompanionCommand } = require('../core');

test('macOS uses the installed app through its relay even with configured Python', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ctt-app-selection-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const app = path.join(home, 'Applications', 'ChurnThemTokensDesktop.app');
  fs.mkdirSync(app, { recursive: true });
  const selected = desktopCompanionCommand({ python: 'configured-python' }, 'darwin', home);
  assert.equal(selected.command, 'configured-python');
  assert.deepEqual(selected.args, [path.resolve(__dirname, '..', 'macos_app_relay.py'), '--app', app]);
});

test('a missing macOS app retains the existing Python companion path', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ctt-app-absent-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const selected = desktopCompanionCommand({ python: 'configured-python' }, 'darwin', home);
  assert.equal(selected.command, 'configured-python');
  assert.equal(path.basename(selected.args[0]), 'desktop_companion.py');
});
