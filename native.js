'use strict';
const os = require('node:os');
const { dispatch } = require('./transport');
const MAX_MESSAGE = 1024 * 1024;
const little = os.endianness() === 'LE';
function frame(message) {
  let bytes = Buffer.from(JSON.stringify(message));
  if (bytes.length > MAX_MESSAGE) bytes = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32000, message: 'Result exceeds browser message limit. Request a smaller range.' } }));
  const header = Buffer.alloc(4);
  little ? header.writeUInt32LE(bytes.length) : header.writeUInt32BE(bytes.length);
  return Buffer.concat([header, bytes]);
}
function startNative(bridge, input = process.stdin, output = process.stdout, onEnd = () => bridge.close()) {
  let buffered = Buffer.alloc(0), queue = Promise.resolve(), closing = false;
  const send = message => { if (message) output.write(frame(message)); };
  const finish = () => { if (!closing) { closing = true; queue.finally(onEnd).catch(() => {}); } };
  input.on('data', data => {
    if (closing) return;
    buffered = Buffer.concat([buffered, data]);
    while (buffered.length >= 4) {
      const size = little ? buffered.readUInt32LE(0) : buffered.readUInt32BE(0);
      if (size < 1 || size > MAX_MESSAGE) { send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid native message size' } }); input.destroy(); finish(); return; }
      if (buffered.length < size + 4) return;
      const bytes = buffered.subarray(4, size + 4); buffered = buffered.subarray(size + 4);
      let request;
      try { request = JSON.parse(bytes.toString('utf8')); }
      catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } }); continue; }
      queue = queue.then(() => dispatch(bridge, request)).then(send, () => send({ jsonrpc: '2.0', id: request.id ?? null, error: { code: -32603, message: 'Native request failed' } }));
    }
  });
  input.on('end', () => { if (buffered.length) send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Truncated native message' } }); finish(); });
  input.on('error', finish);
  return { close: () => { input.destroy(); finish(); } };
}
module.exports = { startNative, frame, MAX_MESSAGE };
