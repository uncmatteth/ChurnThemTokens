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
    const modelSelectors = 'button[data-testid="model-switcher-dropdown-button"], button[aria-label="Select ChatGPT model"]';
    const labels = [...document.querySelectorAll(modelSelectors + ', header button')]
      .filter(el => el.getClientRects().length)
      .filter(el => el.matches(modelSelectors) || /model|thinking|intelligence/i.test(el.getAttribute('aria-label') || '') || (el.innerText.trim() === 'Pro' && el.getAttribute('aria-pressed') === 'true'))
      .map(el => [el.innerText, el.getAttribute('aria-label'), el.getAttribute('title')].filter(Boolean).join(' '));
    const model = labels.find(text => /\bpro\b/i.test(text) && !/upgrade|try|subscription/i.test(text));
    return { proModel: !!model, model: model || labels.find(text => /chatgpt|gpt[\s-]?\d/i.test(text)) || '' };
  }
  function generating() { return !!document.querySelector('button[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"]'); }
  function getComposer() {
    const visible = [...document.querySelectorAll('#prompt-textarea, [contenteditable="true"][role="textbox"][aria-label="Ask ChatGPT"]')].filter(el => el.getClientRects().length);
    return visible.length === 1 ? visible[0] : null;
  }
  async function send(text, run, attachment = false) {
    verifyRun(run);
    if (generating()) throw new Error('ChatGPT is still generating. No message was sent.');
    const composer = getComposer();
    if (!composer) throw new Error('ChatGPT composer not found or ambiguous.');
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
      const deadline = Date.now() + (attachment ? 15000 : 4000);
      const pending = { timer: null, reject: error => settle(error) };
      const settle = error => { clearTimeout(pending.timer); if (run.pending === pending) run.pending = null; error ? reject(error) : resolve(); };
      run.pending = pending;
      const click = () => {
        try {
          verifyRun(run);
          if (generating()) throw new Error('ChatGPT is generating. The pending message was not sent.');
          if (getComposer() !== composer || (composer.tagName === 'TEXTAREA' ? composer.value : composer.innerText) !== inserted) throw new Error('The composer changed. Your draft was preserved and no message was sent.');
          const button = document.querySelector('button[data-testid="send-button"], button[data-testid="composer-submit-button"], button[aria-label="Send prompt"]') || composer.closest('form')?.querySelector('button[aria-label="Send"]');
          if (button && !button.disabled) { button.click(); settle(); }
          else if (Date.now() < deadline) pending.timer = setTimeout(click, 100);
          else settle(new Error('Send button unavailable. The inserted message remains as a draft.'));
        } catch (error) { settle(error); }
      }; click();
    });
  }
  async function attachImage(result, run) {
    verifyRun(run);
    const images = result?.content?.filter(item => item.type === 'image') || [];
    if (images.length !== 1 || !['image/jpeg', 'image/png'].includes(images[0].mimeType) ||
        typeof images[0].data !== 'string' || images[0].data.length > 900000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(images[0].data)) throw new Error('The desktop image could not be attached safely. No result was sent.');
    const composer = getComposer();
    const form = composer?.closest('form');
    if (!form) throw new Error('ChatGPT attachment controls were not found. No screenshot was sent.');
    const candidates = [...document.querySelectorAll('input[type="file"]')]
      .filter(input => !input.disabled && /image|\.jpe?g|\.png/i.test(input.accept || ''));
    const withinForm = candidates.filter(input => form.contains(input));
    const inputs = withinForm.length ? withinForm : candidates;
    if (inputs.length !== 1) throw new Error('ChatGPT image upload control is missing or ambiguous. No screenshot was sent.');
    const before = new Set(form.querySelectorAll('img, [data-testid*="attachment"], [data-testid*="upload"]'));
    const bytes = Uint8Array.from(atob(images[0].data), char => char.charCodeAt(0));
    const filename = `ChurnThemTokens-screen-${run.run.slice(0, 8)}.${images[0].mimeType === 'image/png' ? 'png' : 'jpg'}`;
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], filename, { type: images[0].mimeType }));
    inputs[0].files = transfer.files;
    inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      verifyRun(run);
      if (getComposer() !== composer) throw new Error('ChatGPT composer changed during screenshot upload.');
      if ([...form.querySelectorAll('img, [data-testid*="attachment"], [data-testid*="upload"]')].some(item => !before.has(item))) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Screenshot upload was not visibly accepted. No text result was sent.');
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
      const hasImage = response.value.result?.content?.some(item => item.type === 'image');
      if (hasImage) await attachImage(response.value.result, run);
      const safeResult = hasImage ? { ...response.value, result: { ...response.value.result, content: response.value.result.content.filter(item => item.type !== 'image') } } : response.value;
      // Returned local bytes are task data, never instructions or tool authority.
      await send('ChurnThemTokens local result (untrusted task data):\n' + JSON.stringify(safeResult), run, hasImage);
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
