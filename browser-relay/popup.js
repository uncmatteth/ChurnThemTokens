'use strict';
const elements = Object.fromEntries(['status', 'connect', 'error', 'task-panel', 'permissions', 'roots', 'task', 'start', 'check', 'check-help', 'completion', 'stop'].map(id => [id, document.getElementById(id)]));
const QUICK_CHECK = 'Verify this bridge: identify the machine and approved roots, create a uniquely named harmless test file in an approved root, read it back, delete it with its hash, then run a harmless command and read its real exit status. Report only observed results.';
let current = { connected: false }, busy = false, actionError = '', nextRequest = 0;
function friendlyError(message) {
  if (/native messaging host not found|specified native messaging host|access to the specified native messaging host/i.test(message)) return 'The computer helper is not connected. The extension is installed, but this computer still needs its local helper setup.';
  if (/chatgpt website tab/i.test(message)) return 'Open the ChatGPT chat you want to use, select Pro, then open ChurnThemTokens again.';
  if (/actual Pro model first/i.test(message)) return 'Choose Pro in the model menu at the top of your ChatGPT chat, then connect again.';
  return message;
}
function render() {
  const connected = current.connected === true, running = current.running === true;
  elements.connect.hidden = connected;
  elements.connect.disabled = busy;
  elements.connect.textContent = busy ? 'Connecting…' : 'Connect this Pro chat';
  elements['task-panel'].hidden = !connected;
  elements.status.textContent = !connected ? 'Open your Pro chat in ChatGPT, then connect.' : running ? `Working on ${current.hostname} · ${current.steps || 0} tool results` : current.error ? `Paused on ${current.hostname}` : current.completion ? `Finished on ${current.hostname}` : `Connected to ${current.hostname}`;
  const error = actionError || current.error || '';
  elements.error.hidden = !error; elements.error.textContent = friendlyError(error);
  const permissions = current.permissions || {};
  elements.permissions.textContent = [permissions.write ? 'Read and change files' : 'Read files', permissions.exec && 'Run commands', permissions.browser && 'Use browser tools', permissions.desktop && 'Control the desktop'].filter(Boolean).join(' · ');
  elements.roots.replaceChildren(...(current.projects || []).map(project => {
    const item = document.createElement('li'); item.textContent = `${project.id}: ${project.root}`; return item;
  }));
  elements.task.disabled = busy || running;
  elements.start.disabled = busy || !connected || running || !elements.task.value.trim();
  elements.check.disabled = busy || !connected || running;
  elements.check.hidden = running; elements['check-help'].hidden = running;
  elements.completion.hidden = !current.completion; elements.completion.textContent = current.completion || '';
}
async function request(kind, extra = {}) {
  const version = ++nextRequest;
  if (kind !== 'status') { busy = true; actionError = ''; render(); }
  try {
    const result = await chrome.runtime.sendMessage({ kind, ...extra });
    if (!result?.ok) throw new Error(result?.error || 'The bridge did not respond. Reopen the extension to check its state.');
    if (version === nextRequest) current = result.value;
  } catch (error) { if (version === nextRequest) actionError = error.message; }
  finally { if (kind !== 'status') busy = false; if (version === nextRequest) render(); }
}
elements.connect.addEventListener('click', () => request('connect'));
// Each labelled button authorizes the displayed access for this task.
elements.start.addEventListener('click', () => request('start', { task: elements.task.value, consent: true }));
elements.check.addEventListener('click', () => request('start', { task: QUICK_CHECK, consent: true }));
elements.stop.addEventListener('click', () => request('stop'));
elements.task.addEventListener('input', render);
request('status');
setInterval(() => { if (!busy) request('status'); }, 1200);
