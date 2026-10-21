#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const manifest = require('./manifest.json');
const { jsonRead, privateDir } = require('../core');
const HOST = 'com.chatgpt.local_bridge';
const PRE_STORE_EXTENSION_ID = 'kbnifegchipefmhibbgpndogjaokagdj';
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
  // Only our exact pre-store registration may be migrated. An unrelated or
  // edited native host always remains untouched.
  const priorRegistration = value.files.find(file => file.path === value.host_manifest)?.content.replace(
    `chrome-extension://${value.extension_id}/`, `chrome-extension://${PRE_STORE_EXTENSION_ID}/`);
  for (const file of value.files) {
    try {
      const stat = fs.lstatSync(file.path);
      const existing = stat.isFile() && !stat.isSymbolicLink() ? fs.readFileSync(file.path, 'utf8') : null;
      if (existing !== file.content && !(file.path === value.host_manifest && existing === priorRegistration)) throw new Error('An existing native-host file differs; it was not overwritten.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!dryRun) for (const file of value.files) {
    privateDir(path.dirname(file.path));
    if (fs.existsSync(file.path)) {
      const existing = fs.readFileSync(file.path, 'utf8');
      if (existing === file.content) continue;
      if (file.path !== value.host_manifest || existing !== priorRegistration) throw new Error('An existing native-host file differs; it was not overwritten.');
      const backup = file.path + '.pre-store-backup';
      if (fs.existsSync(backup)) {
        if (!fs.lstatSync(backup).isFile() || fs.lstatSync(backup).isSymbolicLink() || fs.readFileSync(backup, 'utf8') !== existing) throw new Error('An existing native-host backup differs; it was not overwritten.');
      } else fs.writeFileSync(backup, existing, { mode: 0o600, flag: 'wx' });
      const staged = file.path + '.new-' + process.pid;
      try {
        fs.writeFileSync(staged, file.content, { mode: file.mode, flag: 'wx' });
        fs.renameSync(staged, file.path);
      } finally {
        if (fs.existsSync(staged)) fs.unlinkSync(staged);
      }
      continue;
    }
    fs.writeFileSync(file.path, file.content, { mode: file.mode, flag: 'wx' });
  }
  return { dry_run: dryRun, extension_id: value.extension_id, extension_directory: value.extension_directory, native_host_manifest: value.host_manifest, notice: 'The local helper is registered. Open the Chrome Web Store listing for this extension ID in the intended Chrome profile, then connect the authorized Pro chat.' };
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
