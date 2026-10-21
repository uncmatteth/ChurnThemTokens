#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const top = new Set(['.gitignore', 'AGENTS.md', 'README.md', 'TESTING.md', 'SECURITY.md', 'PRIVACY.md', 'LICENSE', 'package.json', 'core.js', 'transport.js', 'cli.js', 'native.js', 'install.js', 'ui_backend.py', 'desktop_companion.py', 'wayland_portal.py', 'requirements-ui.txt']);
const allowed = name => top.has(name) || /^browser-relay\/(?:manifest\.json|(?:icon128|bob128)\.png|(?:worker|content|protocol|popup|setup)\.js|popup\.(?:html|css))$/.test(name) || /^test\/[a-z0-9_.-]+\.(?:js|py)$/.test(name) || ['scripts/package-guard.js', 'scripts/build-webstore.py', 'scripts/build-icon.py', 'skills/churn-them-tokens/SKILL.md', 'skills/churn-them-tokens/agents/openai.yaml'].includes(name);
const blockers = [];
function walk(directory, prefix = '') {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!prefix && ['.git', 'node_modules'].includes(entry.name)) continue;
    const name = prefix + entry.name, absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) { blockers.push(name + ': symlink'); continue; }
    if (entry.isDirectory()) {
      if (!['browser-relay', 'test', 'scripts', 'skills', 'skills/churn-them-tokens', 'skills/churn-them-tokens/agents'].includes(name)) blockers.push(name + ': unexpected directory');
      else walk(absolute, name + '/');
      continue;
    }
    if (!allowed(name)) { blockers.push(name + ': unexpected file'); continue; }
    if (['browser-relay/icon128.png', 'browser-relay/bob128.png'].includes(name)) {
      const image = fs.readFileSync(absolute);
      if (image.length > 100_000 || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || image.readUInt32BE(16) !== 128 || image.readUInt32BE(20) !== 128) blockers.push(name + ': invalid icon');
      continue;
    }
    const text = fs.readFileSync(absolute, 'utf8');
    if (/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(text) || /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,})\b/.test(text) || /\/(?:home|Users)\/[A-Za-z0-9_.-]+\//.test(text)) blockers.push(name + ': private key, credential or personal home path');
  }
}
walk(root);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'browser-relay/manifest.json')));
if (JSON.stringify([...manifest.permissions].sort()) !== JSON.stringify(['activeTab', 'nativeMessaging', 'scripting'])) blockers.push('manifest permissions differ from reviewed access');
if (manifest.host_permissions || manifest.content_scripts) blockers.push('persistent site access needs a separate review');
if (manifest.icons?.['128'] !== 'icon128.png' || manifest.action?.default_icon !== 'icon128.png') blockers.push('store icon is missing');
if (blockers.length) { console.error('Publication blocked:\n' + blockers.join('\n')); process.exitCode = 1; }
else console.log('Package guard passed: reviewed source only; no private state, credentials, personal paths or hosted workflows.');
