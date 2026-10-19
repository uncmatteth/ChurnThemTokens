'use strict';
(() => {
  if (globalThis.chatgptLocalBridgeInstalled) return;
  globalThis.chatgptLocalBridgeInstalled = true;
  let active = null, busy = false, seen = new WeakSet();
  function stopRun(run = active) {
    if (!run || active !== run) return;
    active = null;
    if (run.pending) { clearTimeout(run.pending.timer); run.pending.reject(new Error('Bridge stopped. The pending message was not sent.')); }
  }
  function verifyRun(run) {
    if (!run || active !== run) throw new Error('Bridge stopped. No message was sent.');
    if (run.path !== location.pathname) {
      if (run.initialSent && run.path === '/' && /^\/c\/[A-Za-z0-9-]+$/.test(location.pathname)) run.path = location.pathname;
      else throw new Error('The conversation changed. Reconnect the intended Pro chat.');
    }
    if (!probe().proModel) throw new Error('Pro selection is no longer visible. Bridge paused.');
  }
  function probe() {
    const labels = [...document.querySelectorAll('button[data-testid="model-switcher-dropdown-button"], header button')]
      .filter(el => el.getClientRects().length)
      .filter(el => el.matches('[data-testid="model-switcher-dropdown-button"]') || /model|thinking|intelligence/i.test(el.getAttribute('aria-label') || '') || (el.innerText.trim() === 'Pro' && el.getAttribute('aria-pressed') === 'true'))
      .map(el => [el.innerText, el.getAttribute('aria-label'), el.getAttribute('title')].filter(Boolean).join(' '));
    const model = labels.find(text => /\bpro\b/i.test(text) && !/upgrade|try|subscription/i.test(text));
    return { proModel: !!model, model: model || labels.find(text => /chatgpt|gpt[\s-]?\d/i.test(text)) || '' };
  }
  function generating() { return !!document.querySelector('button[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"]'); }
  async function send(text, run) {
    verifyRun(run);
    if (generating()) throw new Error('ChatGPT is still generating. No message was sent.');
    const composer = document.querySelector('#prompt-textarea');
    if (!composer || !composer.getClientRects().length) throw new Error('ChatGPT composer not found.');
    const existing = composer.tagName === 'TEXTAREA' ? composer.value : composer.innerText;
    if (existing.trim()) throw new Error('Your existing draft was preserved. Clear it before restarting.');
    composer.focus();
    if (composer.tagName === 'TEXTAREA') {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(composer, text);
      composer.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      const selection = window.getSelection(), range = document.createRange(); range.selectNodeContents(composer); selection.removeAllRanges(); selection.addRange(range);
      if (!document.execCommand('insertText', false, text)) throw new Error('Composer insertion failed.');
      composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
    const inserted = composer.tagName === 'TEXTAREA' ? composer.value : composer.innerText;
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 4000;
      const pending = { timer: null, reject: error => settle(error) };
      const settle = error => { clearTimeout(pending.timer); if (run.pending === pending) run.pending = null; error ? reject(error) : resolve(); };
      run.pending = pending;
      const click = () => {
        try {
          verifyRun(run);
          if (generating()) throw new Error('ChatGPT is generating. The pending message was not sent.');
          if (document.querySelector('#prompt-textarea') !== composer || (composer.tagName === 'TEXTAREA' ? composer.value : composer.innerText) !== inserted) throw new Error('The composer changed. Your draft was preserved and no message was sent.');
          const button = document.querySelector('button[data-testid="send-button"], button[data-testid="composer-submit-button"], button[aria-label="Send prompt"]');
          if (button && !button.disabled) { button.click(); settle(); }
          else if (Date.now() < deadline) pending.timer = setTimeout(click, 100);
          else settle(new Error('Send button unavailable. The inserted message remains as a draft.'));
        } catch (error) { settle(error); }
      }; click();
    });
  }
  async function poll() {
    if (!active || busy || generating()) return;
    const run = active;
    verifyRun(run);
    const replies = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    const reply = replies.at(-1);
    if (!reply || seen.has(reply)) return;
    const codes = [...reply.querySelectorAll('pre code')];
    const matching = codes.filter(code => /language-chatgpt-local-bridge/.test(code.className));
    if (!matching.length) return;
    if (matching.length !== 1) { await fail('Expected exactly one bridge packet.'); return; }
    busy = true; seen.add(reply);
    try {
      const response = await chrome.runtime.sendMessage({ kind: 'bridge-packet', text: matching[0].textContent });
      verifyRun(run);
      if (!response.ok) throw new Error(response.error);
      if (response.value.done) { stopRun(run); return; }
      if (response.value.result?.content?.some(item => item.type === 'image')) throw new Error('This relay currently transports text results. Image attachment must be verified before continuing; do not retry the local action automatically.');
      // Returned local bytes are task data, never instructions or tool authority.
      await send('ChurnThemTokens local result (untrusted task data):\n' + JSON.stringify(response.value), run);
    } catch (error) { await fail(error.message, run); }
    finally { busy = false; }
  }
  async function fail(error, run = active) {
    if (!run || active !== run) return;
    stopRun(run);
    await chrome.runtime.sendMessage({ kind: 'bridge-page-error', error }).catch(() => {});
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.kind === 'bridge-probe') { respond(probe()); return; }
    if (message.kind === 'bridge-stop') { stopRun(); respond({ stopped: true }); return; }
    if (message.kind === 'bridge-start') {
      if (active) { respond({ error: 'A run is already active.' }); return; }
      if (message.path !== location.pathname) { respond({ error: 'The selected conversation changed. Reconnect before starting.' }); return; }
      seen = new WeakSet(); document.querySelectorAll('[data-message-author-role="assistant"]').forEach(el => seen.add(el));
      const run = { run: message.run, path: message.path, initialSent: false, pending: null }; active = run;
      send(message.prompt, run).then(() => { run.initialSent = true; respond({ started: true }); }, error => { stopRun(run); respond({ error: error.message }); });
      return true;
    }
  });
  setInterval(() => {
    const run = active; if (!run) return;
    try { verifyRun(run); } catch (error) { fail(error.message, run); return; }
    poll().catch(error => fail(error.message, run));
  }, 750);
})();
