#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { defaultConfig } = require('./cli');
const { jsonRead } = require('./core');
const { frame } = require('./native');
const native = require('./browser-relay/setup');

function optionsFor(argv) {
  const options = { roots: [], permissions: {}, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root' && argv[i + 1] && !argv[i + 1].startsWith('--')) options.roots.push(argv[++i]);
    else if (arg === '--config' && argv[i + 1] && !argv[i + 1].startsWith('--')) options.config = path.resolve(argv[++i]);
    else if (arg === '--chrome-user-data-dir' && argv[i + 1] && !argv[i + 1].startsWith('--')) options.profileDirectory = path.resolve(argv[++i]);
    else if (arg === '--dry-run') options.dryRun = true;
    else if (/^--allow-(write|exec|browser|desktop)$/.test(arg)) options.permissions[arg.slice(8)] = true;
    else throw new Error('Use --root name=/approved/project [--allow-write] [--allow-exec] [--config PATH] [--chrome-user-data-dir PATH] [--dry-run].');
  }
  return options;
}
function initArgs(options, config) {
  return ['init', '--config', config, ...options.roots.flatMap(root => ['--root', root]), ...Object.keys(options.permissions).filter(name => options.permissions[name]).map(name => '--allow-' + name)];
}
function runInit(args) {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'cli.js'), ...args], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr.trim() || 'Local configuration failed.');
  return result.stdout;
}
function requestedSettings(options, config) {
  // Reuse CLI root/permission validation without creating any state.
  const preview = JSON.parse(runInit([...initArgs(options, path.join(path.dirname(config), '.install-preflight-' + process.pid + '.json')), '--dry-run']));
  preview.stateDir = path.join(path.dirname(config), 'state');
  delete preview.dry_run; delete preview.config;
  return preview;
}
function sameSettings(existing, requested) {
  const projects = value => [...value.projects].map(project => [project.id, project.path]).sort((a, b) => a[0].localeCompare(b[0]));
  return existing.stateDir === requested.stateDir && JSON.stringify(projects(existing)) === JSON.stringify(projects(requested)) && ['write', 'exec', 'browser', 'desktop'].every(name => !!existing.permissions?.[name] === !!requested.permissions[name]);
}
function handshake(plan) {
  return new Promise((resolve, reject) => {
    const origin = `chrome-extension://${plan.extension_id}/`;
    const child = plan.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/s', '/c', `"${plan.wrapper}" "${origin}"`], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      : spawn(plan.wrapper, [origin], { stdio: ['pipe', 'pipe', 'pipe'] });
    const pieces = [], received = new Set(); let size = 0, finished = false, parsed = 0;
    const timer = setTimeout(() => { child.kill(); finish(new Error('Native helper handshake timed out. Inspect the local process before retrying.')); }, 10000);
    function finish(error, value) { if (finished) return; finished = true; clearTimeout(timer); error ? reject(error) : resolve(value); }
    child.on('error', error => finish(error));
    child.stdin.on('error', () => {});
    child.stderr.resume(); // Do not print private diagnostic bytes.
    child.stdout.on('data', bytes => {
      size += bytes.length;
      if (size > 2 * 1024 * 1024) { child.kill(); finish(new Error('Native helper response exceeded its limit.')); return; }
      pieces.push(bytes);
      const buffered = Buffer.concat(pieces);
      try {
        while (buffered.length - parsed >= 4) {
          const length = os.endianness() === 'LE' ? buffered.readUInt32LE(parsed) : buffered.readUInt32BE(parsed);
          if (!length || length > 1024 * 1024) throw new Error('Invalid native helper frame.');
          if (buffered.length - parsed < length + 4) break;
          received.add(JSON.parse(buffered.subarray(parsed + 4, parsed + 4 + length).toString('utf8')).id);
          parsed += length + 4;
        }
        // EOF revokes the native connection. Keep it open until both tool
        // receipts arrive, then verify the cleanly stopped helper below.
        if (received.has(1) && received.has(2) && !child.stdin.writableEnded) child.stdin.end();
      } catch (error) { child.kill(); finish(error); }
    });
    child.on('close', code => {
      if (finished) return;
      try {
        if (code !== 0) throw new Error('Native helper did not exit cleanly. Check for an existing connection before retrying.');
        const bytes = Buffer.concat(pieces), replies = new Map(); let offset = 0;
        while (offset < bytes.length) {
          if (bytes.length - offset < 4) throw new Error('Truncated native helper header.');
          const length = os.endianness() === 'LE' ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
          if (!length || length > 1024 * 1024 || offset + 4 + length > bytes.length) throw new Error('Invalid native helper frame.');
          const reply = JSON.parse(bytes.subarray(offset + 4, offset + 4 + length).toString('utf8'));
          replies.set(reply.id, reply); offset += 4 + length;
        }
        const value = id => {
          const reply = replies.get(id);
          if (!reply || reply.error || reply.result?.isError) throw new Error('Native helper did not return a successful tool receipt.');
          return JSON.parse(reply.result.content.find(item => item.type === 'text').text);
        };
        const identity = value(1), projects = value(2);
        if (identity.hostname !== os.hostname() || identity.invokes_codex !== false || identity.makes_model_api_calls !== false) throw new Error('Native helper identity or model-call contract was not verified.');
        finish(null, { verified: true, hostname: identity.hostname, permissions: identity.permissions, projects, invokes_codex: false, makes_model_api_calls: false });
      } catch (error) { finish(error); }
    });
    child.stdin.write(Buffer.concat([1, 2].map((id, i) => frame({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: i ? 'project_list' : 'bridge_status', arguments: {} } }))));
  });
}
async function install(options, environment = {}) {
  const platform = environment.platform || process.platform, home = environment.home || os.homedir();
  if (!['linux', 'darwin', 'win32'].includes(platform)) throw new Error('Automated native-host setup supports Linux, macOS and Windows Chrome. No settings were changed.');
  if (!options.roots?.length) throw new Error('The installing agent must provide an explicitly authorized --root name=/project. Whole-home and drive roots are refused.');
  const config = options.config || defaultConfig(home, platform);
  const requested = requestedSettings(options, config);
  if (fs.existsSync(config) && (!fs.lstatSync(config).isFile() || fs.lstatSync(config).isSymbolicLink())) throw new Error('Configuration must be a regular private file, not a symlink.');
  const existing = jsonRead(config, null);
  if (existing && !sameSettings(existing, requested)) throw new Error('Existing roots or permissions differ. Nothing was overwritten; inspect the existing configuration through doctor.');
  const settings = existing || requested;
  const plan = native.plan({ config, settings, home, platform, profileDirectory: options.profileDirectory });
  native.install(plan, true); // Preflight all registrations before creating config.
  let proof = null;
  if (!options.dryRun) {
    if (!existing) runInit(initArgs(options, config));
    native.install(native.plan({ config, home, platform, profileDirectory: options.profileDirectory }), false);
    proof = await handshake(plan);
  }
  return {
    product: 'ChurnThemTokens', dry_run: !!options.dryRun, config,
    status: options.dryRun ? 'planned_no_changes' : 'local_helper_ready_browser_connection_unverified',
    native_handshake: proof, extension_id: plan.extension_id, extension_directory: plan.extension_directory,
    browser_steps: [
      { action: 'install_from_chrome_web_store', url: `https://chromewebstore.google.com/detail/${plan.extension_id}`, extension_id: plan.extension_id, instruction: 'Open the store listing in the intended existing Chrome profile and choose Add to Chrome.' },
      { action: 'select_existing_chat', origin: 'https://chatgpt.com', model: 'Pro', instruction: 'Use the signed-in session. Verify the actual selected model; never copy browser state or change accounts.' },
      { action: 'open_extension', name: 'ChurnThemTokens', button: 'Agree & connect this Pro chat' },
      { action: 'verify_live_round_trip', button: 'Allow tools & run quick check', evidence: 'Actual Pro requests; matching file hashes and real command exit status returned to that same chat.' },
    ],
    agent_instruction: 'Own these browser steps with supported browser tools. Ask the person only for a specific unavoidable local consent. Do not call the connection verified until the live round trip succeeds.',
  };
}
if (require.main === module) install(optionsFor(process.argv.slice(2))).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { install, optionsFor, handshake, sameSettings };
