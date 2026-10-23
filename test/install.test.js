'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { install, optionsFor, handshake } = require('../install');
const native = require('../browser-relay/setup');
const { jsonWrite } = require('../core');
function fixture(t) {
  const temp = fs.mkdtempSync(path.join(process.platform === 'win32' ? os.homedir() : os.tmpdir(), 'churn-install-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'project'), home = path.join(temp, 'home'), config = path.join(temp, 'private', 'config.json');
  fs.mkdirSync(root);
  return { temp, root, home, config, environment: { home, platform: 'linux' }, options: { config, roots: [`project=${root}`], permissions: { write: true, exec: true } } };
}
test('agent installer dry run makes no files or browser changes', async t => {
  const f = fixture(t), result = await install({ ...f.options, dryRun: true }, f.environment);
  assert.equal(result.status, 'planned_no_changes'); assert.equal(result.native_handshake, null);
  assert.equal(fs.existsSync(f.config), false); assert.equal(fs.existsSync(f.home), false);
  assert.equal(result.browser_steps[0].url, 'https://chromewebstore.google.com/detail/nmmgjnldkinoellekdjmmdgcjadmabok');
  assert.equal(result.browser_steps.at(-1).action, 'open_extension_and_verify');
  assert.equal(result.browser_steps.at(-1).button, 'Connect & run quick check');
});
test('agent installer verifies real native transport and repeats without changing config or tokens', async t => {
  const f = fixture(t), result = await install(f.options, f.environment);
  assert.equal(result.native_handshake.verified, true); assert.equal(result.native_handshake.hostname, os.hostname());
  assert.equal(result.native_handshake.invokes_codex, false); assert.equal(result.native_handshake.makes_model_api_calls, false);
  assert.match(result.status, /browser_connection_unverified/);
  const before = fs.readFileSync(f.config, 'utf8'), settings = JSON.parse(before);
  assert.equal(JSON.stringify(result).includes(settings.localBearerToken), false);
  assert.equal(fs.existsSync(path.join(settings.stateDir, 'server-lock.json')), false);
  assert.equal((await install(f.options, f.environment)).native_handshake.verified, true);
  assert.equal(fs.readFileSync(f.config, 'utf8'), before);
  await assert.rejects(install({ ...f.options, permissions: {} }, f.environment), /differ/);
  assert.equal(fs.readFileSync(f.config, 'utf8'), before);
});
test('agent installer refuses registration conflicts before creating configuration', async t => {
  const f = fixture(t), folder = path.join(f.home, '.config', 'google-chrome', 'NativeMessagingHosts');
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const registration = path.join(folder, 'com.chatgpt.local_bridge.json'); fs.writeFileSync(registration, '{"different":true}', { mode: 0o600 });
  await assert.rejects(install(f.options, f.environment), /not overwritten/);
  assert.equal(fs.existsSync(f.config), false); assert.equal(fs.readFileSync(registration, 'utf8'), '{"different":true}');
});
test('installer rejects unsafe roots, unsupported platforms and malformed options', async t => {
  const f = fixture(t);
  await assert.rejects(install({ ...f.options, roots: [`all=${os.homedir()}`] }, f.environment), /Whole-home/);
  await assert.rejects(install(f.options, { ...f.environment, platform: 'freebsd' }), /Linux, macOS and Windows/);
  for (const argv of [['--config'], ['--root', '--allow-write'], ['--unknown']]) assert.throws(() => optionsFor(argv));
  assert.equal(fs.existsSync(f.config), false);
});
test('installer migrates only its exact pre-store Chrome origin and keeps a reversible backup', async t => {
  const f = fixture(t);
  await install(f.options, f.environment);
  const registration = path.join(f.home, '.config', 'google-chrome', 'NativeMessagingHosts', 'com.chatgpt.local_bridge.json');
  const current = fs.readFileSync(registration, 'utf8');
  const former = current.replace('chrome-extension://nmmgjnldkinoellekdjmmdgcjadmabok/', 'chrome-extension://kbnifegchipefmhibbgpndogjaokagdj/');
  assert.notEqual(former, current);
  fs.writeFileSync(registration, former);
  assert.equal((await install({ ...f.options, dryRun: true }, f.environment)).status, 'planned_no_changes');
  assert.equal(fs.readFileSync(registration, 'utf8'), former);
  assert.equal((await install(f.options, f.environment)).native_handshake.verified, true);
  assert.equal(fs.readFileSync(registration, 'utf8'), current);
  assert.equal(fs.readFileSync(registration + '.pre-store-backup', 'utf8'), former);
  fs.writeFileSync(registration, former.replace('local computer tools', 'unexpected edit'));
  await assert.rejects(install(f.options, f.environment), /differs/);
  assert.notEqual(fs.readFileSync(registration, 'utf8'), current);
});
test('installer refuses a readable or hard-linked native host before executing it', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t);
  await install(f.options, f.environment);
  const plan = native.plan({ config: f.config, platform: 'linux', home: f.home });
  fs.chmodSync(plan.host_manifest, 0o644);
  await assert.rejects(install({ ...f.options, dryRun: true }, f.environment), /private/);
  fs.chmodSync(plan.host_manifest, 0o600);
  const other = plan.wrapper + '.hardlink';
  fs.linkSync(plan.wrapper, other);
  await assert.rejects(install({ ...f.options, dryRun: true }, f.environment), /single-link/);
});
test('native setup uses the correct macOS Chrome registration directory', t => {
  const f = fixture(t), settings = { stateDir: path.join(f.temp, 'state'), projects: [{ id: 'project', path: f.root }] };
  const plan = native.plan({ config: f.config, settings, platform: 'darwin', home: f.home });
  assert.equal(plan.host_manifest, path.join(f.home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts', 'com.chatgpt.local_bridge.json'));
  assert.equal(native.install(plan, true).dry_run, true); assert.equal(fs.existsSync(f.home), false);
});
test('native setup plans a private Windows host and current-user registration', t => {
  const config = 'C:\\Users\\Tommy\\AppData\\Local\\ChurnThemTokens\\config.json';
  const settings = { stateDir: 'C:\\Users\\Tommy\\AppData\\Local\\ChurnThemTokens\\state', projects: [{ id: 'project', path: 'C:\\work' }] };
  const plan = native.plan({ config, settings, platform: 'win32', node: 'C:\\Program Files\\nodejs\\node.exe' });
  assert.equal(plan.registry_key, 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.chatgpt.local_bridge');
  assert.equal(plan.host_manifest, 'C:\\Users\\Tommy\\AppData\\Local\\ChurnThemTokens\\state\\com.chatgpt.local_bridge.json');
  assert.match(plan.files[0].content, /@echo off/);
  assert.match(plan.files[0].content, /"%~1"/);
});
test('Windows native setup refuses shell metacharacters in host paths', async () => {
  const settings = { stateDir: 'C:\\Users\\bad&name\\ChurnThemTokens\\state', projects: [{ id: 'project', path: 'C:\\work' }] };
  assert.throws(() => native.plan({ config: 'C:\\Users\\bad&name\\ChurnThemTokens\\config.json', settings, platform: 'win32', node: 'C:\\Program Files\\nodejs\\node.exe' }), /metacharacters/);
  await assert.rejects(handshake({ platform: 'win32', wrapper: 'C:\\Users\\bad&name\\host.cmd', extension_id: 'a'.repeat(32) }), /metacharacters/);
});
test('Windows native wrapper returns a real handshake before clean EOF', { skip: process.platform !== 'win32' }, async t => {
  const f = fixture(t);
  const settings = { instanceId: crypto.randomUUID(), stateDir: path.join(f.temp, 'private', 'state'), projects: [{ id: 'project', path: f.root }], permissions: { write: false, exec: false, browser: false, desktop: false }, paused: false };
  fs.mkdirSync(path.dirname(f.config), { recursive: true });
  jsonWrite(f.config, settings);
  fs.mkdirSync(settings.stateDir);
  const plan = native.plan({ config: f.config, settings, platform: 'win32' });
  fs.writeFileSync(plan.wrapper, plan.files[0].content);
  const proof = await handshake(plan);
  assert.equal(proof.verified, true);
  assert.equal(proof.hostname, os.hostname());
});
