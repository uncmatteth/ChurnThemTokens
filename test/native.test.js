'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { PassThrough } = require('node:stream');
const { startNative, frame, MAX_MESSAGE } = require('../native');
const { fixture, finish } = require('./helpers');
const { extensionId, plan, install } = require('../browser-relay/setup');
const protocol = require('../browser-relay/protocol');
const rpc = (method, params = {}, id = 1) => ({ jsonrpc: '2.0', method, params, id });
function decode(bytes) {
  const values = []; let offset = 0;
  while (offset < bytes.length) {
    const n = os.endianness() === 'LE' ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
    values.push(JSON.parse(bytes.subarray(offset + 4, offset + 4 + n))); offset += 4 + n;
  }
  return values;
}
async function nativeCall(f, data) {
  const input = new PassThrough(), output = new PassThrough(), pieces = [];
  output.on('data', bytes => pieces.push(bytes));
  let done; const finished = new Promise(resolve => { done = resolve; });
  startNative(f.bridge, input, output, async () => done());
  // Exercise partial headers and payloads, not only complete writes.
  input.write(data.subarray(0, 2)); input.write(data.subarray(2, 7)); input.end(data.subarray(7));
  await finished; return decode(Buffer.concat(pieces));
}
test('native transport preserves real file writes, readback hashes and deletion', async t => {
  const f = fixture(t);
  let [response] = await nativeCall(f, frame(rpc('tools/call', { name: 'file_write', arguments: { project: 'sample', path: 'smoke.txt', content: 'native receipt', expected_sha256: '' } })));
  assert.equal(response.result.isError, false);
  const saved = JSON.parse(response.result.content[0].text);
  assert.equal(fs.readFileSync(path.join(f.root, 'smoke.txt'), 'utf8'), 'native receipt');
  [response] = await nativeCall(f, frame(rpc('tools/call', { name: 'file_read', arguments: { project: 'sample', path: 'smoke.txt' } })));
  assert.equal(JSON.parse(response.result.content[0].text).sha256, saved.sha256);
  [response] = await nativeCall(f, frame(rpc('tools/call', { name: 'file_delete', arguments: { project: 'sample', path: 'smoke.txt', expected_sha256: saved.sha256 } })));
  assert.equal(response.result.isError, false); assert.equal(fs.existsSync(path.join(f.root, 'smoke.txt')), false);
});
test('native RPC retains read-only permission checks and never executes notifications', async t => {
  const f = fixture(t, { write: false });
  const call = rpc('tools/call', { name: 'file_write', arguments: { project: 'sample', path: 'no.txt', content: 'no', expected_sha256: '' } });
  const notification = { ...call }; delete notification.id;
  const responses = await nativeCall(f, Buffer.concat([frame(call), frame(notification)]));
  assert.equal(responses.length, 1); assert.equal(responses[0].result.isError, true); assert.equal(fs.existsSync(path.join(f.root, 'no.txt')), false);
});
test('native transport executes a local command and returns its actual exit status', async t => {
  const f = fixture(t);
  const [started] = await nativeCall(f, frame(rpc('tools/call', { name: 'command_start', arguments: { project: 'sample', argv: [process.execPath, '-e', "process.stdout.write('native-command-receipt')"], request_id: 'native-command-smoke' } })));
  assert.equal(started.result.isError, false);
  const job = JSON.parse(started.result.content[0].text);
  await finish(f.bridge, job.id);
  const [read] = await nativeCall(f, frame(rpc('tools/call', { name: 'job_read', arguments: { job_id: job.id } })));
  const result = JSON.parse(read.result.content[0].text);
  assert.equal(result.exitCode, 0); assert.match(result.output, /native-command-receipt/);
});
test('native transport rejects invalid lengths and bounds results for Chrome', async t => {
  const f = fixture(t), header = Buffer.alloc(4);
  os.endianness() === 'LE' ? header.writeUInt32LE(MAX_MESSAGE + 1) : header.writeUInt32BE(MAX_MESSAGE + 1);
  const replies = await nativeCall(f, header); assert.equal(replies[0].error.code, -32600);
  const [large] = decode(frame({ id: 2, result: 'a'.repeat(MAX_MESSAGE) }));
  assert.equal(large.error.code, -32000); assert.equal(large.id, 2);
});
test('relay protocol binds each request to its run, sequence and discovered tools', () => {
  const request = { version: 1, run_id: 'run-a', sequence: 1, type: 'tool', name: 'bridge_status', arguments: {} };
  const parse = value => protocol.packet(JSON.stringify(value), 'run-a', 1, ['bridge_status']);
  assert.deepEqual(parse(request), request);
  for (const modified of [{ ...request, run_id: 'other' }, { ...request, sequence: 0 }, { ...request, name: 'unknown' }, { ...request, arguments: [] }, { ...request, inject: true }]) assert.throws(() => parse(modified));
  assert.throws(() => protocol.chatUrl('https://chatgpt.com.attacker.invalid/'));
  assert.throws(() => protocol.chatUrl('http://chatgpt.com/'));
  assert.equal(protocol.chatUrl('https://chatgpt.com/c/example').hostname, 'chatgpt.com');
});
test('native installer is a dry run by default and refuses conflicting registrations', t => {
  const f = fixture(t), home = path.join(f.temp, 'fake-home');
  const value = plan({ config: f.configFile, home, platform: 'linux' });
  assert.match(extensionId(), /^[a-p]{32}$/);
  const result = install(value); assert.equal(result.dry_run, true); assert.equal(fs.existsSync(value.wrapper), false); assert.equal(fs.existsSync(home), false);
  install(value, false); assert.equal(fs.statSync(value.wrapper).mode & 0o777, 0o700);
  assert.deepEqual(JSON.parse(fs.readFileSync(value.host_manifest)).allowed_origins, [`chrome-extension://${extensionId()}/`]);
  assert.equal(install(value, false).dry_run, false);
  fs.writeFileSync(value.host_manifest, '{}'); assert.throws(() => install(value, false), /not overwritten/);
});
test('native CLI rejects an unregistered origin before accepting commands', t => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../cli.js'), 'serve', '--native', 'chrome-extension://wrong/', '--config', f.configFile], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1); assert.match(result.stderr, /registered extension origin/);
  assert.equal(fs.existsSync(path.join(f.bridge.state, 'server-lock.json')), false);
});
