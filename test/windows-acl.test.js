'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { privateDir, jsonRead, jsonWrite } = require('../core');
const { defaultConfig } = require('../cli');

test('Windows installs use a private profile directory and reject broad ACLs', { skip: process.platform !== 'win32' }, t => {
  const home = fs.mkdtempSync(path.join(os.homedir(), '.churn-acl-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const config = defaultConfig(home, 'win32', { LOCALAPPDATA: path.join(home, 'AppData', 'Local') });
  assert.equal(config, path.join(home, '.churn-them-tokens', 'config.json'));
  privateDir(path.dirname(config), true);
  jsonWrite(config, { fixture: true });
  assert.deepEqual(jsonRead(config, null), { fixture: true });
  execFileSync('icacls.exe', [config, '/grant', '*S-1-1-0:R'], { windowsHide: true, stdio: 'ignore' });
  assert.throws(() => jsonRead(config, null), /private ACL/);
});
