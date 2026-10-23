'use strict';
const elements = Object.fromEntries(['status', 'error', 'task-panel', 'access-panel', 'permissions', 'roots', 'desktop-panel', 'desktop-status', 'desktop-share', 'desktop-stop', 'desktop-error', 'task', 'start', 'check', 'check-help', 'completion', 'stop'].map(id => [id, document.getElementById(id)]));
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
  elements['access-panel'].hidden = !connected;
  elements.status.textContent = busy && !connected ? 'Connecting this Pro chat…' : !connected ? 'Open your Pro chat in ChatGPT, then run a task.' : running ? `Working on ${current.hostname} · ${current.steps || 0} tool results` : current.error ? `Paused on ${current.hostname}` : current.completion ? `Finished on ${current.hostname}` : `Connected to ${current.hostname}`;
  const error = actionError || current.error || '';
  elements.error.hidden = !error; elements.error.textContent = friendlyError(error);
  const permissions = current.permissions || {};
  elements.permissions.textContent = [permissions.write ? 'Read and change files' : 'Read files', permissions.exec && 'Run commands', permissions.browser && 'Use browser tools', permissions.desktop && 'AIClickThatShit available (optional)'].filter(Boolean).join(' · ');
  elements.roots.replaceChildren(...(current.projects || []).map(project => {
    const item = document.createElement('li'); item.textContent = `${project.id}: ${project.root}`; return item;
  }));
  elements['desktop-panel'].hidden = !connected || !permissions.desktop;
  const sharing = current.desktop?.active === true;
  const pending = current.desktopPending === true;
  elements['desktop-status'].textContent = sharing ? 'AIClickThatShit on · mouse and keyboard ready' : pending ? 'Waiting for the computer’s Share dialog…' : 'AIClickThatShit off';
  elements['desktop-share'].hidden = sharing;
  elements['desktop-share'].disabled = busy || pending;
  elements['desktop-stop'].hidden = !sharing;
  elements['desktop-stop'].disabled = busy || pending;
  elements['desktop-error'].hidden = !current.desktopError;
  elements['desktop-error'].textContent = current.desktopError || '';
  elements.task.disabled = busy || running;
  elements.start.disabled = busy || running || !elements.task.value.trim();
  elements.start.textContent = connected ? 'Run task' : 'Connect & run task';
  elements.check.disabled = busy || running;
  elements.check.textContent = connected ? 'Run quick check' : 'Connect & run quick check';
  elements.check.hidden = running; elements['check-help'].hidden = running;
  elements.completion.hidden = !current.completion; elements.completion.textContent = current.completion || '';
  elements.stop.hidden = !connected;
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
// Each labelled button authorizes the displayed access for this task.
elements.start.addEventListener('click', () => request('start', { task: elements.task.value, consent: true }));
elements.check.addEventListener('click', () => request('start', { task: QUICK_CHECK, consent: true }));
elements['desktop-share'].addEventListener('click', () => request('desktop-start'));
elements['desktop-stop'].addEventListener('click', () => request('desktop-stop'));
elements.stop.addEventListener('click', () => request('stop'));
elements.task.addEventListener('input', render);
request('status');
setInterval(() => { if (!busy) request('status'); }, 1200);
