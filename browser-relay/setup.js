#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const manifest = require('./manifest.json');
const { jsonRead, privateDir } = require('../core');
const HOST = 'com.chatgpt.local_bridge';
function extensionId() {
  if (!manifest.key) throw new Error('Extension public key is missing.');
  return crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, value => String.fromCharCode(97 + parseInt(value, 16)));
}
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
function plan({ config, home = os.homedir(), platform = process.platform, node = process.execPath, profileDirectory, settings: providedSettings } = {}) {
  if (!['linux', 'darwin'].includes(platform)) throw new Error('Native-host installation currently supports Linux and macOS Chrome.');
  if (!config || !path.isAbsolute(config)) throw new Error('Supply the absolute path to the local executor config.');
  const settings = providedSettings || jsonRead(config, null);
  if (!settings?.stateDir || !settings.projects?.length) throw new Error('Initialize an executor with explicit project roots first.');
  const id = extensionId();
  const wrapper = path.join(settings.stateDir, 'browser-relay-host');
  const chromeDirectory = platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Google', 'Chrome') : path.join(home, '.config', 'google-chrome');
  const hostManifest = path.join(profileDirectory || chromeDirectory, 'NativeMessagingHosts', HOST + '.json');
  const cli = path.resolve(__dirname, '..', 'cli.js');
  const script = `#!/bin/sh\nexec ${quote(node)} ${quote(cli)} serve --native --config ${quote(config)} "$@"\n`;
  const registration = JSON.stringify({ name: HOST, description: 'ChurnThemTokens local computer tools', path: wrapper, type: 'stdio', allowed_origins: [`chrome-extension://${id}/`] }, null, 2) + '\n';
  return { extension_id: id, extension_directory: __dirname, wrapper, host_manifest: hostManifest, files: [{ path: wrapper, content: script, mode: 0o700 }, { path: hostManifest, content: registration, mode: 0o600 }] };
}
function install(value, dryRun = true) {
  // Preflight every destination before writing either file. Never replace a
  // user's existing registration or follow its symlink.
  for (const file of value.files) {
    try {
      const stat = fs.lstatSync(file.path);
      if (!stat.isFile() || stat.isSymbolicLink() || fs.readFileSync(file.path, 'utf8') !== file.content) throw new Error('An existing native-host file differs; it was not overwritten.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!dryRun) for (const file of value.files) {
    privateDir(path.dirname(file.path));
    try { fs.writeFileSync(file.path, file.content, { mode: file.mode, flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST' || fs.readFileSync(file.path, 'utf8') !== file.content) throw error; }
  }
  return { dry_run: dryRun, extension_id: value.extension_id, extension_directory: value.extension_directory, native_host_manifest: value.host_manifest, notice: 'No browser was changed and no process, listener or model client was started. The installing agent should load or reload the extension using supported browser controls, then connect the authorized Pro chat.' };
}
function main(argv = process.argv.slice(2)) {
  let config, profileDirectory, dryRun = true;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' && argv[i + 1]) config = path.resolve(argv[++i]);
    else if (argv[i] === '--profile-directory' && argv[i + 1]) profileDirectory = path.resolve(argv[++i]);
    else if (argv[i] === '--install') dryRun = false;
    else if (argv[i] !== '--dry-run') throw new Error('Use --config PATH [--profile-directory CHROME_USER_DATA_DIRECTORY] [--dry-run|--install].');
  }
  console.log(JSON.stringify(install(plan({ config, profileDirectory }), dryRun), null, 2));
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { extensionId, plan, install, main };
