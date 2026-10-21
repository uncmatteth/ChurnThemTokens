'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const protocol = require('../browser-relay/protocol');
function worker() {
  let listener, receiver, disconnect;
  const calls = [], posts = [];
  const context = { pro: true, jobs: [], desktopGrant: false, url: 'https://chatgpt.com/c/fixture' };
  const tools = ['bridge_status', 'project_list', 'job_list', 'file_read', 'desktop'].map(name => ({ name, inputSchema: { type: 'object' } }));
  const value = (name, args) => name === 'bridge_status' ? { hostname: 'test-machine', permissions: { write: false, desktop: context.desktopGrant } } : name === 'project_list' ? [{ id: 'sample', root: '/fixture' }] : name === 'job_list' ? context.jobs : name === 'desktop' ? { active: args.operation === 'start', wayland: true } : { content: 'receipt' };
  const port = {
    onMessage: { addListener: fn => { receiver = fn; } },
    onDisconnect: { addListener: fn => { disconnect = fn; } },
    disconnect: () => {},
    postMessage: message => {
      calls.push(message);
      const result = message.method === 'tools/list' ? { tools } : message.method === 'tools/call' ? { isError: false, content: [{ type: 'text', text: JSON.stringify(value(message.params.name, message.params.arguments)) }] } : {};
      queueMicrotask(() => receiver({ id: message.id, result }));
    },
  };
  const chrome = {
    runtime: { getURL: name => 'chrome-extension://fixture/' + name, connectNative: () => port, onMessage: { addListener: fn => { listener = fn; } } },
    tabs: {
      get: async () => ({ id: 7, url: context.url }),
      query: async () => [{ id: 7 }],
      sendMessage: async (id, message) => {
        posts.push(message);
        return message.kind === 'bridge-probe' ? { proModel: context.pro, model: context.pro ? 'GPT Pro' : 'Sol' } : { started: true };
      },
      onRemoved: { addListener: () => {} },
    }, scripting: { executeScript: async () => {} },
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../browser-relay/worker.js'), 'utf8'), { chrome, importScripts: () => {}, LocalBridgeProtocol: protocol, crypto, setTimeout, clearTimeout, console });
  const popup = { url: 'chrome-extension://fixture/popup.html' };
  const content = { tab: { id: 7 }, url: 'https://chatgpt.com/c/fixture' };
  const send = (message, sender = popup) => new Promise(resolve => listener(message, sender, resolve));
  return { context, calls, posts, send, content, disconnect: () => disconnect(), packet: (sequence = 1, extra = {}) => ({ version: 1, run_id: posts.find(m => m.kind === 'bridge-start').run, sequence, type: 'tool', name: 'file_read', arguments: { project: 'sample', path: 'code.txt' }, ...extra }) };
}
test('relay cannot connect or start against a non-Pro selection', async () => {
  const w = worker(); w.context.pro = false;
  const refused = await w.send({ kind: 'connect' });
  assert.equal(refused.ok, false); assert.match(refused.error, /actual Pro/); assert.equal(w.calls.length, 0);
});
test('relay requires explicit session consent and sends no task without it', async () => {
  const w = worker(); assert.equal((await w.send({ kind: 'connect' })).ok, true);
  const refused = await w.send({ kind: 'start', task: 'read code', consent: false });
  assert.equal(refused.ok, false); assert.equal(w.posts.some(m => m.kind === 'bridge-start'), false);
  await w.send({ kind: 'stop' });
});
test('AIClickThatShit starts by default and only the panel can enable or stop it', async () => {
  const w = worker(); w.context.desktopGrant = true;
  assert.equal((await w.send({ kind: 'connect' })).ok, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await w.send({ kind: 'status' })).value.desktop.active, true);
  assert.equal((await w.send({ kind: 'desktop-stop' })).value.desktop.active, false);
  assert.equal((await w.send({ kind: 'desktop-start' }, w.content)).ok, false);
  assert.equal((await w.send({ kind: 'desktop-start' })).value.desktop.active, true);
  assert.equal(w.calls.filter(m => m.params?.name === 'desktop' && m.params.arguments.operation === 'start').length, 2);
  assert.equal((await w.send({ kind: 'desktop-stop' }, w.content)).ok, false);
  assert.equal((await w.send({ kind: 'desktop-stop' })).value.desktop.active, false);
  await w.send({ kind: 'stop' });
});
test('changing conversations while idle blocks the initial task and private prompt', async () => {
  const w = worker(); await w.send({ kind: 'connect' });
  w.context.url = 'https://chatgpt.com/c/another-conversation';
  const result = await w.send({ kind: 'start', task: 'read code', consent: true });
  assert.equal(result.ok, false); assert.equal(w.posts.some(message => message.kind === 'bridge-start'), false);
  await w.send({ kind: 'stop' });
});
test('the request limit still permits a verified completion packet', async () => {
  const w = worker(); await w.send({ kind: 'connect' }); await w.send({ kind: 'start', task: 'read code', consent: true });
  for (let sequence = 1; sequence <= 64; sequence++) assert.equal((await w.send({ kind: 'bridge-packet', text: JSON.stringify(w.packet(sequence)) }, w.content)).ok, true);
  assert.equal((await w.send({ kind: 'bridge-packet', text: JSON.stringify(w.packet(65)) }, w.content)).ok, false);
  const result = await w.send({ kind: 'bridge-packet', text: JSON.stringify(w.packet(65, { type: 'done', message: 'Observed completion', name: undefined, arguments: undefined })) }, w.content);
  assert.equal(result.ok, true); assert.equal(result.value.done, true);
  await w.send({ kind: 'stop' });
});
test('relay binds actions to the selected tab, run and ordered sequence', async () => {
  const w = worker(); await w.send({ kind: 'connect' }); await w.send({ kind: 'start', task: 'read code', consent: true });
  const baseline = w.calls.length;
  const message = { kind: 'bridge-packet', text: JSON.stringify(w.packet()) };
  assert.equal((await w.send(message, { ...w.content, tab: { id: 8 } })).ok, false);
  assert.equal((await w.send(message, { ...w.content, url: 'https://attacker.invalid/' })).ok, false);
  assert.equal((await w.send(message, { ...w.content, url: 'https://chatgpt.com/c/other-chat' })).ok, false);
  assert.equal(w.calls.length, baseline);
  const result = await w.send(message, w.content); assert.equal(result.ok, true); assert.equal(result.value.sequence, 2);
  assert.equal((await w.send(message, w.content)).ok, false);
  assert.equal(w.calls.filter(m => m.params?.name === 'file_read').length, 1);
  await w.send({ kind: 'stop' });
});
test('changing away from Pro blocks execution before local tools run', async () => {
  const w = worker(); await w.send({ kind: 'connect' }); await w.send({ kind: 'start', task: 'read code', consent: true });
  w.context.pro = false;
  const result = await w.send({ kind: 'bridge-packet', text: JSON.stringify(w.packet()) }, w.content);
  assert.equal(result.ok, false); assert.equal(w.calls.some(m => m.params?.name === 'file_read'), false);
  await w.send({ kind: 'stop' });
});
test('a completion cannot claim success while local jobs are still running', async () => {
  const w = worker(); await w.send({ kind: 'connect' }); await w.send({ kind: 'start', task: 'read code', consent: true });
  const packet = { version: 1, run_id: w.packet().run_id, sequence: 1, type: 'done', message: 'Finished' };
  w.context.jobs = [{ status: 'running' }];
  assert.equal((await w.send({ kind: 'bridge-packet', text: JSON.stringify(packet) }, w.content)).ok, false);
  w.context.jobs = [];
  assert.equal((await w.send({ kind: 'bridge-packet', text: JSON.stringify(packet) }, w.content)).value.done, true);
  assert.equal((await w.send({ kind: 'status' })).value.completion, 'Finished');
  await w.send({ kind: 'stop' });
});

test('turning off AIClickThatShit blocks Pro desktop requests while file tools keep working', async () => {
  const w = worker(); w.context.desktopGrant = true;
  await w.send({ kind: 'connect' });
  await w.send({ kind: 'desktop-start' });
  await w.send({ kind: 'start', task: 'check tools', consent: true });
  await w.send({ kind: 'desktop-stop' });
  const baseline = w.calls.length;
  for (const operation of ['start', 'screenshot', 'click']) {
    const result = await w.send({ kind: 'bridge-packet', text: JSON.stringify(w.packet(1, { name: 'desktop', arguments: { operation } })) }, w.content);
    assert.equal(result.ok, false); assert.match(result.error, /AIClickThatShit/);
  }
  assert.equal(w.calls.length, baseline);
  assert.equal((await w.send({ kind: 'bridge-packet', text: JSON.stringify(w.packet()) }, w.content)).ok, true);
  await w.send({ kind: 'stop' });
  await w.send({ kind: 'connect' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await w.send({ kind: 'status' })).value.desktop.active, true);
  await w.send({ kind: 'stop' });
});
