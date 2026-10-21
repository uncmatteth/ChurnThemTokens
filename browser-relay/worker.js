'use strict';
importScripts('protocol.js');
const HOST = 'com.chatgpt.local_bridge';
let session = null, connecting = false, nextId = 0;
const pending = new Map();
function summary() {
  if (!session) return { connected: false };
  return { connected: true, running: session.running, hostname: session.identity.hostname, permissions: session.identity.permissions, projects: session.projects, model: session.model, sequence: session.sequence, steps: session.steps, error: session.error || null, completion: session.completion || null, desktop: session.desktop || null, desktopPending: !!session.desktopPending, desktopError: session.desktopError || null };
}
function close() {
  const previous = session; session = null;
  for (const wait of pending.values()) { clearTimeout(wait.timer); wait.reject(new Error('Bridge disconnected.')); }
  pending.clear();
  if (previous) { try { previous.port.disconnect(); } catch {} chrome.tabs.sendMessage(previous.tabId, { kind: 'bridge-stop' }).catch(() => {}); }
}
function rpc(method, params = {}) {
  if (!session) return Promise.reject(new Error('Bridge is disconnected.'));
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Local tool request timed out. Inspect it before retrying.')); }, 65000);
    pending.set(id, { resolve, reject, timer });
    try { session.port.postMessage({ jsonrpc: '2.0', id, method, params }); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
}
async function tool(name, args = {}) {
  const result = await rpc('tools/call', { name, arguments: args });
  return result;
}
function textValue(result) {
  if (result.isError) throw new Error(result.content?.[0]?.text || 'Local tool failed.');
  return JSON.parse(result.content.find(c => c.type === 'text').text);
}
async function desktopStart() {
  const current = session;
  if (!current?.identity.permissions?.desktop) throw new Error('Desktop control is not enabled in this local helper.');
  if (current.desktopPending) return summary();
  current.desktopPending = true; current.desktopError = null;
  try {
    const result = textValue(await tool('desktop', { operation: 'start' }));
    if (session !== current) throw new Error('Bridge disconnected while desktop sharing started.');
    current.desktop = result;
    return summary();
  } catch (error) {
    if (session === current) { current.desktop = { active: false }; current.desktopError = error.message; }
    throw error;
  } finally { current.desktopPending = false; }
}
async function desktopStop() {
  if (!session?.identity.permissions?.desktop) throw new Error('Desktop control is not enabled in this local helper.');
  const current = session;
  if (current.desktopPending) throw new Error('Wait for the system sharing prompt to finish.');
  textValue(await tool('desktop', { operation: 'stop' }));
  if (session === current) { current.desktop = { active: false }; current.desktopError = null; }
  return summary();
}
async function connect(tabId) {
  if (connecting || session) throw new Error('Disconnect the existing session first.');
  connecting = true;
  try {
    const tab = await chrome.tabs.get(tabId); LocalBridgeProtocol.chatUrl(tab.url);
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    const probe = await chrome.tabs.sendMessage(tabId, { kind: 'bridge-probe' });
    if (!probe.proModel) throw new Error(`Select the actual Pro model first. Current visible model label: ${probe.model || 'unavailable'}.`);
    const port = chrome.runtime.connectNative(HOST);
    session = { tabId, path: LocalBridgeProtocol.chatUrl(tab.url).pathname, port, identity: {}, projects: [], tools: [], model: probe.model, running: false, run: crypto.randomUUID(), sequence: 1, steps: 0, busy: false, desktop: null, desktopPending: false, desktopError: null };
    port.onMessage.addListener(message => {
      const wait = pending.get(message.id); if (!wait) return;
      pending.delete(message.id); clearTimeout(wait.timer);
      message.error ? wait.reject(new Error(message.error.message)) : wait.resolve(message.result);
    });
    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message;
      if (session?.port === port) { close(); if (error) console.error('Native bridge disconnected:', error); }
    });
    await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'ChurnThemTokens', version: '0.1.1' } });
    session.identity = textValue(await tool('bridge_status'));
    session.projects = textValue(await tool('project_list'));
    session.tools = (await rpc('tools/list')).tools;
    // One extension connection also requests the temporary OS desktop grant.
    // A dismissed OS prompt leaves the Pro chat connected and permits retry.
    if (session.identity.permissions?.desktop) void desktopStart().catch(() => {});
    return summary();
  } catch (error) { close(); throw error; }
  finally { connecting = false; }
}
async function start(task, consent) {
  if (!session || session.running) throw new Error('Connect an idle Pro chat first.');
  if (consent !== true || typeof task !== 'string' || !task.trim() || task.length > 16000) throw new Error('Enter a task and authorize local actions for this chat.');
  const current = session;
  const tab = await chrome.tabs.get(current.tabId);
  if (session !== current || current.running) throw new Error('The bridge session changed. Reconnect before starting a task.');
  if (LocalBridgeProtocol.chatUrl(tab.url).pathname !== current.path) throw new Error('The selected conversation changed. Reconnect the intended Pro chat before starting a task.');
  current.run = crypto.randomUUID(); current.sequence = 1; current.steps = 0; current.error = null; current.completion = null;
  current.running = true;
  try {
    const response = await chrome.tabs.sendMessage(current.tabId, { kind: 'bridge-start', run: current.run, path: current.path, prompt: LocalBridgeProtocol.prompt(current.run, current.tools, task, current.identity, current.projects) });
    if (!response?.started) throw new Error(response?.error || 'ChatGPT did not accept the initial bridge message.');
    return summary();
  } catch (error) { current.running = false; throw error; }
}
async function receive(message, sender) {
  const current = session;
  if (!current || !current.running || sender.tab?.id !== current.tabId) throw new Error('This chat is not attached to an active bridge run.');
  const page = LocalBridgeProtocol.chatUrl(sender.url);
  if (page.pathname !== current.path) {
    if (current.path === '/' && current.sequence === 1 && current.steps === 0 && /^\/c\/[A-Za-z0-9-]+$/.test(page.pathname)) current.path = page.pathname;
    else throw new Error('The selected conversation changed. Reconnect it before requesting local actions.');
  }
  if (current.busy) throw new Error('Bridge is busy.');
  const probe = await chrome.tabs.sendMessage(current.tabId, { kind: 'bridge-probe' });
  if (!probe?.proModel) throw new Error('Pro selection is no longer visible. No local action was executed.');
  if (session !== current || !current.running || current.busy) throw new Error('Bridge session changed before the action.');
  const request = LocalBridgeProtocol.packet(message.text, current.run, current.sequence, current.tools.map(t => t.name));
  current.busy = true;
  try {
    if (request.type === 'done') {
      const jobs = textValue(await tool('job_list'));
      if (Array.isArray(jobs) && jobs.some(j => j.status === 'running')) throw new Error('Local jobs are still running. Read their results before finishing.');
      current.running = false; current.completion = request.message;
      return { done: true, message: request.message };
    }
    if (current.steps >= 64) throw new Error('This run reached its 64-request limit. Inspect results and finish before starting another task.');
    const result = await tool(request.name, request.arguments);
    if (session !== current || !current.running) throw new Error('Bridge stopped while the local action was running. Inspect the outcome before retrying.');
    current.steps++; current.sequence++;
    return { run: current.run, sequence: current.sequence, result };
  } finally { current.busy = false; }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const popup = sender.url === chrome.runtime.getURL('popup.html') && !sender.tab;
  const work = async () => {
    if (message.kind === 'bridge-packet') return receive(message, sender);
    if (message.kind === 'bridge-page-error' && session && sender.tab?.id === session.tabId) { session.error = String(message.error).slice(0, 500); session.running = false; return summary(); }
    if (!popup) throw new Error('Only the bridge panel can manage a connection.');
    if (message.kind === 'status') return summary();
    if (message.kind === 'connect') { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); return connect(tab.id); }
    if (message.kind === 'start') return start(message.task, message.consent);
    if (message.kind === 'desktop-start') return desktopStart();
    if (message.kind === 'desktop-stop') return desktopStop();
    if (message.kind === 'stop') { close(); return summary(); }
    throw new Error('Unknown bridge message.');
  };
  work().then(value => respond({ ok: true, value }), error => respond({ ok: false, error: error.message }));
  return true;
});
chrome.tabs.onRemoved.addListener(id => { if (session?.tabId === id) close(); });
