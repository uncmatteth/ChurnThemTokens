#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { DirectBridge, desktopCompanionCommand, inside, privateDir, jsonRead, jsonWrite, cleanEnv } = require('./core');
const { startStdio, startHTTP, publicOrigin, approveOAuth } = require('./transport');
const { startNative } = require('./native');

function argumentsFor(argv) {
  const result = { _: [], root: [] };
  const flags = new Set(['trusted-computer', 'allow-write', 'allow-exec', 'allow-browser', 'allow-desktop', 'stdio', 'http', 'native', 'dry-run']);
  const values = new Set(['config', 'root', 'public-url', 'port', 'python', 'chromium-executable']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { result._.push(arg); continue; }
    const key = arg.slice(2);
    if (flags.has(key)) result[key] = true;
    else if (values.has(key) && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      const value = argv[++i]; if (key === 'root') result.root.push(value); else result[key] = value;
    } else throw new Error(`Unknown option or missing value: ${arg}`);
  }
  return result;
}
function lockServer(state) {
  const file = path.join(state, 'server-lock.json');
  const value = { pid: process.pid, nonce: crypto.randomUUID() };
  if (fs.existsSync(file)) {
    const old = jsonRead(file, null);
    let live = true;
    if (Number.isSafeInteger(old?.pid) && old.pid > 0) {
      try { process.kill(old.pid, 0); } catch (error) { if (error.code === 'ESRCH') live = false; }
    }
    if (live) throw new Error('Another bridge server may be running. Stop it before starting a second instance.');
    fs.unlinkSync(file);
  }
  fs.writeFileSync(file, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  return () => { if (jsonRead(file, null)?.nonce === value.nonce) fs.unlinkSync(file); };
}
function defaultConfig(home = os.homedir(), platform = process.platform, env = process.env) {
  const legacyWindows = path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'ChurnThemTokens', 'config.json');
  const base = platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'ChurnThemTokens') : platform === 'win32' ? (fs.existsSync(legacyWindows) ? path.dirname(legacyWindows) : path.join(home, '.churn-them-tokens')) : path.join(home, '.local', 'share', 'churn-them-tokens');
  return path.join(base, 'config.json');
}
function help() {
  console.log(`ChurnThemTokens -- local tools, no model provider

  node install.js --root project=/absolute/project/path --allow-write --allow-exec

  node cli.js init --root project=/absolute/project/path --trusted-computer
  node cli.js doctor
  node cli.js serve --stdio
  node cli.js serve --native EXTENSION_ORIGIN
  node cli.js set-public-url https://YOUR-HTTPS-HOST
  node cli.js serve --http
  node cli.js approve PAIRING_REQUEST_ID
  node cli.js pause
  node cli.js resume
  node cli.js revoke

--config PATH selects an isolated instance (one per machine).
Repeat --root name=PATH for additional explicitly authorized projects.
Without --trusted-computer, init is read-only; individual --allow-* flags exist.
--trusted-computer grants write, shell, browser and desktop execution as your OS user.
This is NOT a security sandbox. Browser/desktop need optional Python dependencies.
No install command reads ChatGPT login state or starts a network service.
HTTP binds only to loopback and requires authentication. Never publish an unauthenticated shell.
Read AGENTS.md for agent-owned setup in your existing ChatGPT Pro browser chat.`);
}
async function main(argv = process.argv.slice(2)) {
  const args = argumentsFor(argv);
  const command = args._[0] || 'help';
  const file = path.resolve(args.config || defaultConfig());
  if (command === 'help') { help(); return; }
  if (command === 'init') {
    if (fs.existsSync(file)) throw new Error('Config already exists; it was not overwritten');
    if (!args.root.length) throw new Error('Supply at least one explicit --root name=PATH. Whole-home/whole-drive roots are refused.');
    const projects = args.root.map((value, i) => { const split = value.indexOf('='); return { id: split < 0 ? `project${i + 1}` : value.slice(0, split), path: fs.realpathSync(path.resolve(split < 0 ? value : value.slice(split + 1))) }; });
    const stateDir = path.join(path.dirname(file), 'state');
    for (const project of projects) if (inside(project.path, os.homedir()) || inside(project.path, stateDir) || inside(stateDir, project.path)) throw new Error('Whole-home, whole-drive and bridge-state roots are refused');
    const permissions = Object.fromEntries(['write', 'exec', 'browser', 'desktop'].map(name => [name, !!(args['trusted-computer'] || args[`allow-${name}`])]));
    const config = { version: 1, instanceId: crypto.randomUUID(), stateDir, projects, permissions, paused: false, port: Number(args.port || 8768), publicUrl: publicOrigin(args['public-url']), python: args.python || (process.platform === 'win32' ? 'python' : 'python3'), chromiumExecutable: args['chromium-executable'] || null };
    if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('Port must be 1024..65535');
    if (args['dry-run']) { console.log(JSON.stringify({ dry_run: true, config: file, ...config }, null, 2)); return; }
    privateDir(path.dirname(file), true);
    const bridge = new DirectBridge(config);
    config.localBearerToken = crypto.randomBytes(32).toString('base64url');
    jsonWrite(file, config); await bridge.close();
    console.log(`Initialized ${file}. No service or network listener was started. Run doctor, then choose the connection setup in README.md.`);
    return;
  }
  const config = jsonRead(file, null);
  if (!config) throw new Error('No direct bridge config. Run init with explicit project roots first.');
  if (command === 'doctor') {
    let git = false; let ui;
    try { git = execFileSync('git', ['--version'], { encoding: 'utf8', env: cleanEnv(), timeout: 5000 }).trim(); } catch {}
    const companion = desktopCompanionCommand(config);
    try { ui = JSON.parse(execFileSync(companion.command, [...companion.args, '--doctor', '--state', config.stateDir], { encoding: 'utf8', env: cleanEnv({ PYTHONDONTWRITEBYTECODE: '1' }), timeout: 10000 })); } catch { ui = { error: 'Selected desktop companion unavailable' }; }
    console.log(JSON.stringify({ instance_id: config.instanceId, hostname: os.hostname(), platform: process.platform, node: process.version, git, permissions: config.permissions, paused: config.paused, roots: config.projects.map(p => ({ id: p.id, exists: fs.existsSync(p.path) })), public_url_configured: !!config.publicUrl, server_lock: jsonRead(path.join(config.stateDir, 'server-lock.json'), null), ui, chatgpt_connection: 'not verified by local doctor', invokes_codex: false }, null, 2)); return;
  }
  if (command === 'approve') {
    const granted = approveOAuth({ state: config.stateDir, config }, args._[1] || '');
    console.log(JSON.stringify({ approved: true, ...granted, notice: 'Return to the OAuth browser page to finish pairing.' }, null, 2)); return;
  }
  if (command === 'pause' || command === 'resume') {
    config.paused = command === 'pause'; jsonWrite(file, config);
    console.log(`${command === 'pause' ? 'Paused new tool calls' : 'Resumed tool calls'}. Already-running OS processes are not killed by this command.`); return;
  }
  if (command === 'revoke' || command === 'set-public-url') {
    if (command === 'set-public-url') config.publicUrl = publicOrigin(args._[1]);
    config.localBearerToken = crypto.randomBytes(32).toString('base64url');
    config.oauthEpoch = crypto.randomUUID();
    jsonWrite(file, config);
    jsonWrite(path.join(config.stateDir, 'oauth-state.json'), { epoch: config.oauthEpoch, clients: {}, pending: {}, codes: {}, tokens: {}, refresh: {} });
    for (const name of fs.readdirSync(config.stateDir)) if (/^approval-[A-Za-z0-9_-]{43}\.json$/.test(name)) fs.unlinkSync(path.join(config.stateDir, name));
    console.log('Existing HTTP grants were revoked. Restart the server after URL changes, then reconnect the app. Stdio/tunnel authorization is managed separately.'); return;
  }
  if (command !== 'serve') throw new Error('Unknown command. Run node cli.js help.');
  if ([args.http, args.stdio, args.native].filter(Boolean).length > 1) throw new Error('Choose one transport: --http, --stdio or --native');
  if (args.native) {
    const { extensionId } = require('./browser-relay/setup');
    if (args._[1] !== `chrome-extension://${extensionId()}/`) throw new Error('Native transport requires the registered extension origin');
  }
  const unlock = lockServer(config.stateDir);
  const bridge = new DirectBridge(config, file);
  bridge.recoverJobs();
  let server; let stopping = false;
  const shutdown = async () => {
    if (stopping) return; stopping = true;
    if (server) { server.close(); server.closeIdleConnections?.(); }
    await bridge.close(); unlock();
  };
  process.on('SIGINT', () => shutdown().then(() => process.exit(0)));
  process.on('SIGTERM', () => shutdown().then(() => process.exit(0)));
  process.on('exit', unlock);
  if (args.http) {
    server = startHTTP(bridge);
    server.on('error', error => { console.error(`HTTP start failed: ${error.code || 'error'}`); shutdown().then(() => process.exit(1)); });
    server.on('listening', () => console.error(`Direct MCP listening on loopback port ${config.port}. Authentication required. No model client is running.`));
  } else if (args.native) {
    startNative(bridge, process.stdin, process.stdout, shutdown);
  } else {
    startStdio(bridge, process.stdin, process.stdout, shutdown);
  }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main, argumentsFor, lockServer, defaultConfig };
