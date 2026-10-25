'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { install, optionsFor, handshake, runPrivateCommand } = require('../install');
const native = require('../browser-relay/setup');
const { jsonWrite } = require('../core');
const { spawnSync, spawn } = require('node:child_process');
function fixture(t) {
  const temp = fs.mkdtempSync(path.join(process.platform === 'win32' ? os.homedir() : os.tmpdir(), 'churn-install-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'project'), home = path.join(temp, 'home'), config = path.join(temp, 'private', 'config.json');
  fs.mkdirSync(root);
  return { temp, root, home, config, environment: { home, platform: 'linux' }, options: { config, roots: [`project=${root}`], permissions: { write: true, exec: true } } };
}
function macFixture(t, scenario = {}) {
  const f = fixture(t), app = path.join(f.home, 'Applications', 'ChurnThemTokensDesktop.app');
  fs.mkdirSync(app, { recursive: true });
  const state = path.join(f.temp, 'scenario.json'), events = path.join(f.temp, 'events');
  fs.writeFileSync(state, JSON.stringify({ signature: 'stable', permissions: { screen_recording: true, accessibility: true }, ...scenario }));
  const companion = path.join(f.home, 'Applications', 'ChurnThemTokensDesktop', '.venv', 'bin', 'python');
  fs.mkdirSync(path.dirname(companion), { recursive: true });
  fs.writeFileSync(companion, `#!${process.execPath}\nconst fs = require('node:fs'), path = require('node:path');\nconst state = ${JSON.stringify(state)}, events = ${JSON.stringify(events)}, app = ${JSON.stringify(app)};\nconst s = JSON.parse(fs.readFileSync(state));\nif (path.basename(process.argv[2]) !== 'macos_app_relay.py' || process.argv[3] !== '--app' || process.argv[4] !== app) process.exit(18);\nconst mode = process.argv.includes('--setup') ? 'setup' : process.argv.includes('--doctor') ? 'doctor' : 'invalid';\nfs.appendFileSync(events, mode + '\\n');\nprocess.stderr.write('private synthetic companion details');\nif (mode === 'doctor') { if (s.badDoctor) process.stdout.write('x'.repeat(70000)); else console.log(JSON.stringify({macos_permissions:s.permissions})); }\nelse if (mode === 'setup') { if (s.waitSetup) setInterval(() => {}, 1000); else { s.permissions = s.after || s.permissions; fs.writeFileSync(state, JSON.stringify(s)); if (!s.setupExit) console.log(JSON.stringify({macos_permissions:s.permissions, frame_verified:!!s.frameVerified,cancelled:!!s.cancelled})); process.exitCode = s.setupExit || 0; } }\nelse process.exitCode = 19;\n`, { mode: 0o700 });
  const signing = path.join(f.temp, 'codesign.js');
  fs.writeFileSync(signing, `const fs = require('node:fs');
const s = JSON.parse(fs.readFileSync(${JSON.stringify(state)}));
if (process.argv.at(-1) !== ${JSON.stringify(app)}) process.exit(18);
if (process.argv.includes('--verify')) {
  fs.appendFileSync(${JSON.stringify(events)}, 'verify\\n');
  if (s.signature === 'invalid') process.exit(1);
} else if (process.argv.includes('--display')) {
  fs.appendFileSync(${JSON.stringify(events)}, 'identity\\n');
  const requirement = s.requirement || (s.signature === 'weak' ? 'identifier "ChurnThemTokensDesktop"' : 'identifier "ChurnThemTokensDesktop" and anchor apple generic and certificate leaf[subject.OU] = "TESTTEAM"');
  const identifier = s.identifier || 'ChurnThemTokensDesktop';
  const team = s.team || 'TESTTEAM';
  if (s.signature === 'adhoc') process.stderr.write('Signature=adhoc\\nTeamIdentifier=not set\\ndesignated => cdhash H"1234"\\n');
  else {
    process.stderr.write('Identifier=' + identifier + '\\nAuthority=Apple Development: Synthetic Test\\nTeamIdentifier=' + team + '\\n');
    const line = (s.commented ? '# ' : '') + 'designated => ' + requirement + '\\n';
    (s.commented ? process.stdout : process.stderr).write(line);
  }
} else process.exit(19);
`);
  const initialized = spawnSync(process.execPath, [path.resolve(__dirname, '..', 'cli.js'), 'init', '--config', f.config, '--root', `project=${f.root}`, '--allow-write', '--allow-exec', '--allow-desktop', '--python', companion], { encoding: 'utf8', timeout: 10000 });
  assert.equal(initialized.status, 0, initialized.stderr);
  f.options.permissions.desktop = true;
  f.environment = { ...f.environment, platform: 'darwin', codesign: { command: process.execPath, args: [signing] } };
  return { ...f, app, events: () => fs.existsSync(events) ? fs.readFileSync(events, 'utf8').trim().split('\n') : [] };
}
test('macOS desktop dry run does not launch signing, doctor or setup processes', { skip: process.platform === 'win32' }, async t => {
  const f = macFixture(t, { permissions: { screen_recording: false, accessibility: false } });
  const before = fs.readFileSync(f.config);
  const result = await install({ ...f.options, dryRun: true }, f.environment);
  assert.deepEqual(f.events(), []);
  assert.equal(result.desktop_setup.ready, false);
  assert.equal(result.desktop_setup.required, true);
  assert.equal(result.desktop_setup.status, 'planned_not_checked');
  assert.deepEqual(fs.readFileSync(f.config), before);
});
test('macOS ready repeats check the selected app without requesting grants or changing tokens', { skip: process.platform === 'win32' }, async t => {
  const f = macFixture(t), before = fs.readFileSync(f.config);
  for (let i = 0; i < 2; i++) {
    const result = await install(f.options, f.environment);
    assert.equal(result.desktop_setup.status, 'permissions_ready_live_check_required');
    assert.equal(result.desktop_setup.ready, true);
    assert.equal(result.desktop_setup.required, false);
    assert.equal(result.desktop_setup.live_input_verified, false);
    assert.match(result.status, /browser_connection_unverified/);
    assert.equal(JSON.stringify(result).includes('private synthetic'), false);
  }
  assert.deepEqual(f.events(), ['verify', 'identity', 'doctor', 'verify', 'identity', 'doctor']);
  assert.deepEqual(fs.readFileSync(f.config), before);
});
test('macOS accepts commented and noncommented strong certificate requirements', { skip: process.platform === 'win32' }, async t => {
  for (const commented of [false, true]) {
    const f = macFixture(t, { commented });
    const result = await install(f.options, f.environment);
    assert.equal(result.desktop_setup.identity, 'certificate_backed', String(commented));
    assert.equal(result.desktop_setup.ready, true, String(commented));
    assert.deepEqual(f.events(), ['verify', 'identity', 'doctor']);
  }
});
test('macOS rejects mismatched bundle IDs and Team values outside the leaf OU constraint', { skip: process.platform === 'win32' }, async t => {
  const cases = [
    { name: 'metadata bundle ID differs', identifier: 'OtherDesktop' },
    { name: 'designated requirement bundle ID differs', requirement: 'identifier "OtherDesktop" and anchor apple generic and certificate leaf[subject.OU] = "TESTTEAM"' },
    { name: 'Team appears in another certificate field', requirement: 'identifier "ChurnThemTokensDesktop" and anchor apple generic and certificate leaf[subject.OU] = "OTHERTEAM" and certificate leaf[subject.CN] = "TESTTEAM"' },
    { name: 'leaf OU constraint is absent', requirement: 'identifier "ChurnThemTokensDesktop" and anchor apple generic and certificate leaf[subject.CN] = "TESTTEAM"' },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async t => {
      const f = macFixture(t, scenario);
      const result = await install(f.options, f.environment);
      assert.equal(result.desktop_setup.identity, 'unverified');
      assert.equal(result.desktop_setup.ready, false);
      assert.equal(result.desktop_setup.required, true);
      assert.equal(result.desktop_setup.status, 'signing_identity_required');
      assert.deepEqual(f.events(), ['verify', 'identity']);
    });
  }
});
test('macOS missing grants run setup once then inspect a new app context even after nonzero exit', { skip: process.platform === 'win32' }, async t => {
  const f = macFixture(t, { permissions: { screen_recording: false, accessibility: null }, after: { screen_recording: true, accessibility: true }, setupExit: 3 });
  const result = await install(f.options, f.environment);
  assert.deepEqual(f.events(), ['verify', 'identity', 'doctor', 'setup', 'doctor']);
  assert.equal(result.desktop_setup.ready, true);
  assert.equal(result.desktop_setup.setup_exit_code, 3);
  assert.equal(result.desktop_setup.live_input_verified, false);
});
test('new macOS desktop configurations reuse the installed companion Python', { skip: process.platform === 'win32' }, async t => {
  const f = macFixture(t);
  fs.unlinkSync(f.config);
  const result = await install(f.options, f.environment);
  assert.equal(result.desktop_setup.ready, true);
  assert.equal(JSON.parse(fs.readFileSync(f.config)).python, path.join(f.home, 'Applications', 'ChurnThemTokensDesktop', '.venv', 'bin', 'python'));
  assert.deepEqual(f.events(), ['verify', 'identity', 'doctor']);
});
test('macOS setup frame receipt does not claim live input verification', { skip: process.platform === 'win32' }, async t => {
  const f = macFixture(t, { permissions: { screen_recording: false, accessibility: false }, after: { screen_recording: true, accessibility: true }, frameVerified: true });
  const result = await install(f.options, f.environment);
  assert.equal(result.desktop_setup.status, 'permissions_ready_live_check_required');
  assert.equal(result.desktop_setup.frame_verified, true);
  assert.equal(result.desktop_setup.live_input_verified, false);
  assert.deepEqual(f.events(), ['verify', 'identity', 'doctor', 'setup', 'doctor']);
});
test('macOS cancelled setup with unknown grants stays explicitly required', { skip: process.platform === 'win32' }, async t => {
  const f = macFixture(t, { permissions: { screen_recording: null, accessibility: false }, cancelled: true });
  const result = await install(f.options, f.environment);
  assert.equal(result.desktop_setup.ready, false);
  assert.equal(result.desktop_setup.required, true);
  assert.equal(result.desktop_setup.status, 'setup_cancelled');
  assert.match(result.status, /desktop_setup_required/);
  assert.deepEqual(f.events(), ['verify', 'identity', 'doctor', 'setup', 'doctor']);
});
test('aborting macOS setup ends the pending child without starting a fresh doctor', { skip: process.platform === 'win32' }, async t => {
  const f = macFixture(t, { permissions: { screen_recording: false, accessibility: false }, waitSetup: true });
  const controller = new AbortController();
  const pending = install(f.options, { ...f.environment, signal: controller.signal });
  const deadline = Date.now() + 5000;
  while (!f.events().includes('setup') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.events().includes('setup'), true);
  controller.abort();
  const result = await pending;
  assert.equal(result.desktop_setup.status, 'setup_cancelled');
  assert.equal(result.desktop_setup.ready, false);
  assert.equal(result.desktop_setup.required, true);
  assert.deepEqual(f.events(), ['verify', 'identity', 'doctor', 'setup']);
});
test('macOS absent, ad hoc and weak-identity apps never become desktop ready or launch setup', { skip: process.platform === 'win32' }, async t => {
  for (const signature of ['adhoc', 'weak', 'invalid', 'absent']) {
    const f = macFixture(t, { signature });
    if (signature === 'absent') fs.rmdirSync(f.app);
    const result = await install(f.options, f.environment);
    assert.equal(result.desktop_setup.ready, false, signature);
    assert.equal(result.desktop_setup.required, true, signature);
    assert.equal(f.events().includes('setup'), false, signature);
    assert.equal(result.native_handshake.verified, true);
    assert.match(result.status, /desktop_setup_required/);
  }
});
test('macOS oversized doctor output is bounded and cannot claim ready or leak diagnostics', { skip: process.platform === 'win32' }, async t => {
  const f = macFixture(t, { badDoctor: true, cancelled: true });
  const result = await install(f.options, f.environment);
  assert.equal(result.desktop_setup.ready, false);
  assert.equal(result.desktop_setup.required, true);
  assert.equal(JSON.stringify(result).includes('private synthetic'), false);
  assert.equal(JSON.stringify(result).includes('x'.repeat(100)), false);
});
test('private command stdout overflow discards captured bytes and stderr', async () => {
  const result = await runPrivateCommand({ command: process.execPath }, ['-e', 'process.stderr.write("private fixture diagnostics"); process.stdout.write("x".repeat(70000));']);
  assert.equal(result.failure, 'output_limit');
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});
test('aborting a pending private command stops its owned tree and preserves an independent process', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), record = path.join(f.temp, 'owned-pids');
  const independent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  t.after(() => { if (independent.exitCode === null) independent.kill(); });
  const controller = new AbortController();
  const script = `const fs = require('node:fs'); const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio:'ignore'}); fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify([process.pid,child.pid])); setInterval(() => {}, 1000);`;
  const running = runPrivateCommand({ command: process.execPath }, ['-e', script], { timeout: null, signal: controller.signal });
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(record) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(fs.existsSync(record), true);
  const pids = JSON.parse(fs.readFileSync(record));
  controller.abort();
  const result = await running;
  assert.equal(result.cancelled, true);
  for (const pid of pids) {
    let live = true;
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') live = false; else throw error; }
    if (live && process.platform === 'linux') {
      try { live = !fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].startsWith('Z'); }
      catch (error) { if (error.code === 'ENOENT') live = false; else throw error; }
    } else if (live && process.platform === 'darwin') {
      const state = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' });
      live = state.status === 0 && !state.stdout.trim().startsWith('Z');
    }
    assert.equal(live, false, 'an owned command process survived cancellation');
  }
  assert.equal(independent.exitCode, null);
  assert.doesNotThrow(() => process.kill(independent.pid, 0));
});
test('agent installer dry run makes no files or browser changes', async t => {
  const f = fixture(t), result = await install({ ...f.options, dryRun: true }, f.environment);
  assert.equal(result.status, 'planned_no_changes'); assert.equal(result.native_handshake, null);
  assert.equal(fs.existsSync(f.config), false); assert.equal(fs.existsSync(f.home), false);
  assert.equal(result.browser_steps[0].url, 'https://chromewebstore.google.com/detail/nmmgjnldkinoellekdjmmdgcjadmabok');
  assert.equal(result.browser_steps.at(-1).action, 'open_extension_and_verify');
  assert.equal(result.browser_steps.at(-1).button, 'Connect & run quick check');
});
test('agent installer verifies real native transport and repeats without changing config or tokens', { skip: process.platform === 'win32' }, async t => {
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
test('installer migrates only its exact pre-store Chrome origin and keeps a reversible backup', { skip: process.platform === 'win32' }, async t => {
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
