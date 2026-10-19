'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

for (const composerType of ['textarea', 'contenteditable']) test(`real Chrome ${composerType} fixture: Pro selection, preserved drafts and tool-result return`, { skip: !process.env.BRIDGEBRAIN_RELAY_CHROME }, t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-relay-ui-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fixture = path.join(directory, 'fixture.html');
  const source = pathToFileURL(path.resolve(__dirname, '../browser-relay/content.js')).href;
  fs.writeFileSync(fixture, `<!doctype html><meta charset="utf-8"><header><button data-testid="model-switcher-dropdown-button" id="model">GPT Pro</button><button>Pro</button></header>
    ${composerType === 'textarea' ? '<textarea id="prompt-textarea"></textarea>' : '<div id="prompt-textarea" contenteditable="true"></div>'}<button data-testid="send-button" id="send">Send</button><main id="replies"></main><pre id="result">PENDING</pre>
    <script>
      let listener; const sent = [], packets = [], failures = [];
      window.chrome.runtime = {id:'fixture',onMessage:{addListener:fn=>listener=fn}, sendMessage:async message=>{
        if(message.kind==='bridge-page-error'){failures.push(message.error);return {ok:true};}
        packets.push(message);
        return {ok:true,value:{run:'fixture',sequence:2,result:{content:[{type:'text',text:'local receipt'}]}}};
      }};
      const getDraft=()=>{const composer=document.querySelector('#prompt-textarea');return composer.tagName==='TEXTAREA'?composer.value:composer.innerText;};
      const setDraft=value=>{const composer=document.querySelector('#prompt-textarea');if(composer.tagName==='TEXTAREA')composer.value=value;else composer.textContent=value;};
      document.querySelector('#send').onclick=()=>{sent.push(getDraft());setDraft('');};
    </script><script src="${source}"></script><script>
      const ask=message=>new Promise(resolve=>listener(message,{id:'fixture'},resolve));
      const check=(condition,message)=>{if(!condition)throw new Error(message);};
      (async()=>{
        check((await ask({kind:'bridge-probe'})).proModel,'Pro was not detected');
        document.querySelector('#model').textContent='Sol';
        check(!(await ask({kind:'bridge-probe'})).proModel,'Sol was accepted as Pro');
        document.querySelector('#model').textContent='GPT Pro';
        setDraft('preserve this draft');
        const refused=await ask({kind:'bridge-start',run:'fixture',prompt:'safe prompt'});
        check(!!refused.error,'Existing draft was accepted');
        check(getDraft()==='preserve this draft','Draft was overwritten');
        setDraft('');
        check((await ask({kind:'bridge-start',run:'fixture',prompt:'safe prompt'})).started,'Initial prompt was not sent');
        const reply=document.createElement('div'); reply.dataset.messageAuthorRole='assistant';
        const pre=document.createElement('pre'),code=document.createElement('code');code.className='language-chatgpt-local-bridge';code.textContent='{"type":"tool"}';pre.append(code);reply.append(pre);document.querySelector('#replies').append(reply);
        await new Promise(resolve=>setTimeout(resolve,1100));
        check(packets.length===1,'Packet was not relayed exactly once');
        check(sent.length===2 && sent[1].includes('local receipt'),'Local result did not return through the composer');
        document.querySelector('#model').textContent='Sol';
        await new Promise(resolve=>setTimeout(resolve,1100));
        check(failures.length===1,'Model change did not pause the relay');
        document.querySelector('#result').textContent='PASS';
      })().catch(error=>{document.querySelector('#result').textContent='FAIL: '+error.message;});
    </script>`);
  const result = spawnSync(process.env.BRIDGEBRAIN_RELAY_CHROME, ['--headless', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + path.join(directory, 'isolated-profile'), '--virtual-time-budget=5000', '--dump-dom', pathToFileURL(fixture).href], { encoding: 'utf8', timeout: 25000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /id="result">PASS<\/pre>/, result.stdout);
});

test('real Chrome popup fixture: simple setup, explicit action consent and useful progress', { skip: !process.env.BRIDGEBRAIN_RELAY_CHROME }, t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'churn-popup-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fixture = path.join(directory, 'popup.html');
  const source = path.resolve(__dirname, '../browser-relay');
  let html = fs.readFileSync(path.join(source, 'popup.html'), 'utf8');
  html = html.replace('href="popup.css"', `href="${pathToFileURL(path.join(source, 'popup.css')).href}"`);
  const mock = `<script>
    let value={connected:false}, failConnect=true; const calls=[];
    const connected=()=>({connected:true,running:false,hostname:'test-computer',permissions:{write:true,exec:true},projects:[{id:'project',root:'/fixture'}]});
    window.chrome.runtime={sendMessage:async message=>{
      calls.push(message);
      if(message.kind==='connect'){
        if(failConnect){failConnect=false;return {ok:false,error:'Specified native messaging host not found.'};}
        value=connected();
      }
      if(message.kind==='start')value={...value,running:true};
      if(message.kind==='stop')value={connected:false};
      return {ok:true,value};
    }};
  </script><script src="${pathToFileURL(path.join(source, 'popup.js')).href}"></script><pre id="result">PENDING</pre><script>
    const wait=()=>new Promise(resolve=>setTimeout(resolve,10));
    const check=(condition,message)=>{if(!condition)throw new Error(message);};
    const el=id=>document.getElementById(id);
    (async()=>{
      await wait();
      check(el('task-panel').hidden,'Task controls appeared before connection');
      el('connect').click(); await wait();
      check(el('error').textContent.includes('local helper setup'),'Missing helper error was not understandable');
      el('connect').click(); await wait();
      check(!el('task-panel').hidden && el('status').textContent==='Connected to test-computer','Connection state was not shown');
      check(el('permissions').textContent.includes('Run commands') && el('roots').textContent.includes('/fixture'),'Access was not disclosed');
      check(el('start').disabled,'Empty task could run');
      el('check').click(); await wait();
      check(calls.find(message=>message.kind==='start').consent===true,'Quick-check button did not authorize its task');
      check(el('task').disabled && el('check').hidden && el('status').textContent.includes('Working on'),'Running state permits duplicate work or hides progress');
      value={...value,running:false,completion:'Observed file hash and command exit 0.'};
      await new Promise(resolve=>setTimeout(resolve,1300));
      check(el('completion').textContent.includes('exit 0') && el('status').textContent.includes('Finished'),'Completion was lost');
      el('task').value='Read the project instructions';el('task').dispatchEvent(new Event('input'));
      check(!el('start').disabled,'A typed task could not run');
      el('start').click();await wait();
      check(calls.filter(message=>message.kind==='start').at(-1).task==='Read the project instructions','Typed task was replaced');
      el('stop').click();await wait();
      check(el('task-panel').hidden,'Disconnect left task controls active');
      el('connect').click();await wait();
      document.getElementById('result').textContent='PASS';
    })().catch(error=>document.getElementById('result').textContent='FAIL: '+error.message);
  </script>`;
  html = html.replace('<script src="popup.js"></script>', mock);
  fs.writeFileSync(fixture, html);
  const args = ['--headless', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + path.join(directory, 'isolated-profile'), '--window-size=420,850', '--force-prefers-reduced-motion', '--virtual-time-budget=5000', '--dump-dom'];
  if (process.env.CHURN_POPUP_SCREENSHOT) args.push('--screenshot=' + process.env.CHURN_POPUP_SCREENSHOT);
  args.push(pathToFileURL(fixture).href);
  const result = spawnSync(process.env.BRIDGEBRAIN_RELAY_CHROME, args, { encoding: 'utf8', timeout: 25000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /id="result">PASS<\/pre>/, result.stdout);
});
