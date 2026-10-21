'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

for (const composerType of ['textarea', 'contenteditable', 'current-chat']) test(`real Chrome ${composerType} fixture: Pro selection, preserved drafts and tool-result return`, { skip: !process.env.BRIDGEBRAIN_RELAY_CHROME }, t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-relay-ui-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fixture = path.join(directory, 'fixture.html');
  const source = pathToFileURL(path.resolve(__dirname, '../browser-relay/content.js')).href;
  const currentChat = composerType === 'current-chat';
  fs.writeFileSync(fixture, `<!doctype html><meta charset="utf-8"><header>${currentChat ? '' : '<button data-testid="model-switcher-dropdown-button" id="model">GPT Pro</button>'}<button>Pro</button></header>
    <form>${currentChat ? '<button type="button" aria-label="Select ChatGPT model" id="model">Pro</button><div role="textbox" aria-label="Ask ChatGPT" contenteditable="true"></div>' : composerType === 'textarea' ? '<textarea id="prompt-textarea"></textarea>' : '<div id="prompt-textarea" contenteditable="true"></div>'}<button type="button" ${currentChat ? 'aria-label="Send"' : 'data-testid="send-button"'} id="send">Send</button></form><main id="replies"></main><pre id="result">PENDING</pre>
    <script>
      let listener; const sent = [], packets = [], failures = [];
      window.chrome.runtime = {id:'fixture',onMessage:{addListener:fn=>listener=fn}, sendMessage:async message=>{
        if(message.kind==='bridge-page-error'){failures.push(message.error);return {ok:true};}
        packets.push(message);
        return {ok:true,value:{run:'fixture',sequence:2,result:{content:[{type:'text',text:'local receipt'}]}}};
      }};
      const getDraft=()=>{const composer=document.querySelector('textarea,[contenteditable="true"]');return composer.tagName==='TEXTAREA'?composer.value:composer.innerText;};
      const setDraft=value=>{const composer=document.querySelector('textarea,[contenteditable="true"]');if(composer.tagName==='TEXTAREA')composer.value=value;else composer.textContent=value;};
      document.querySelector('#send').onclick=()=>{sent.push(getDraft());setDraft('');};
    </script><script src="${source}"></script><script>
      const ask=message=>new Promise(resolve=>listener(message,{id:'fixture'},resolve));
      const check=(condition,message)=>{if(!condition)throw new Error(message);};
      (async()=>{
        check((await ask({kind:'bridge-probe'})).proModel,'Pro was not detected');
        for(const label of ['Sol','Upgrade to Pro']){
          document.querySelector('#model').textContent=label;
          check(!(await ask({kind:'bridge-probe'})).proModel,label+' was accepted as Pro');
        }
        document.querySelector('#model').textContent='GPT Pro';
        setDraft('preserve this draft');
        const refused=await ask({kind:'bridge-start',run:'fixture',path:location.pathname,prompt:'safe prompt'});
        check(!!refused.error,'Existing draft was accepted');
        check(getDraft()==='preserve this draft','Draft was overwritten');
        setDraft('');
        check((await ask({kind:'bridge-start',run:'fixture',path:location.pathname,prompt:'safe prompt'})).started,'Initial prompt was not sent');
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

test('real Chrome fixture attaches a desktop frame to the same chat result', { skip: !process.env.BRIDGEBRAIN_RELAY_CHROME }, t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'churn-image-relay-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fixture = path.join(directory, 'fixture.html');
  const source = pathToFileURL(path.resolve(__dirname, '../browser-relay/content.js')).href;
  fs.writeFileSync(fixture, `<!doctype html><header><button data-testid="model-switcher-dropdown-button">GPT Pro</button></header>
  <form><textarea id="prompt-textarea"></textarea><input id="upload" type="file" accept="image/jpeg,image/png"><button id="send" type="button" data-testid="send-button">Send</button></form><main id="replies"></main><pre id="result">PENDING</pre>
  <script>
    let listener; const sent=[], uploads=[], errors=[];
    window.chrome.runtime={id:'fixture',onMessage:{addListener:fn=>listener=fn},sendMessage:async message=>{
      if(message.kind==='bridge-page-error'){errors.push(message.error);return {ok:true};}
      return {ok:true,value:{run:'fixture',sequence:2,result:{isError:false,content:[
        {type:'text',text:'{"native_width":100,"native_height":100}'},
        {type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg=='}
      ]}}};
    }};
    document.querySelector('#upload').addEventListener('change',event=>{
      uploads.push(event.target.files[0]);
      const preview=document.createElement('div');preview.dataset.testid='attachment';document.querySelector('form').append(preview);
    });
    document.querySelector('#send').onclick=()=>{sent.push(document.querySelector('#prompt-textarea').value);document.querySelector('#prompt-textarea').value='';};
  </script><script src="${source}"></script><script>
    const ask=message=>new Promise(resolve=>listener(message,{id:'fixture'},resolve));
    (async()=>{
      if(!(await ask({kind:'bridge-start',run:'fixture',path:location.pathname,prompt:'safe prompt'})).started)throw Error('start');
      const reply=document.createElement('div');reply.dataset.messageAuthorRole='assistant';
      reply.innerHTML='<pre><code class="language-chatgpt-local-bridge">{"type":"tool"}</code></pre>';
      document.querySelector('#replies').append(reply);
      await new Promise(resolve=>setTimeout(resolve,1200));
      if(errors.length||uploads.length!==1||uploads[0].type!=='image/png'||sent.length!==2||!sent[1].includes('native_width')||sent[1].includes('iVBORw0'))throw Error('image was not attached with the sanitized text receipt');
      document.querySelector('#result').textContent='PASS';
    })().catch(error=>document.querySelector('#result').textContent='FAIL: '+error.message);
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

test('real Chrome composer fixture: stop, navigation and model changes cancel pending sends', { skip: !process.env.BRIDGEBRAIN_RELAY_CHROME }, t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'churn-send-guards-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fixture = path.join(directory, 'fixture.html');
  const content = fs.readFileSync(path.resolve(__dirname, '../browser-relay/content.js'), 'utf8');
  fs.writeFileSync(fixture, `<!doctype html><header><button id="model" data-testid="model-switcher-dropdown-button">GPT Pro</button></header><textarea id="prompt-textarea"></textarea><button id="send" data-testid="send-button">Send</button><main id="replies"></main><pre id="result">PENDING</pre>
  <script>
    let listener, pendingResult;const sent=[],errors=[];window.fixtureRoute={pathname:'/c/original'};
    window.chrome.runtime={id:'fixture',onMessage:{addListener:fn=>listener=fn},sendMessage:async message=>{
      if(message.kind==='bridge-page-error'){errors.push(message.error);return {ok:true};}
      return new Promise(resolve=>pendingResult=resolve);
    }};
    document.querySelector('#send').onclick=()=>{const composer=document.querySelector('#prompt-textarea');sent.push(composer.value);composer.value='';};
  </script><script>(function(location){${content}\n})(window.fixtureRoute);</script><script>
    const ask=message=>new Promise(resolve=>listener(message,{id:'fixture'},resolve));
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const check=(condition,message)=>{if(!condition)throw new Error(message);};
    const button=document.querySelector('#send'),composer=document.querySelector('#prompt-textarea'),model=document.querySelector('#model');
    (async()=>{
      for(const action of ['stop','navigate','model']){
        fixtureRoute.pathname='/c/original';model.textContent='GPT Pro';composer.value='';button.disabled=true;
        const pending=ask({kind:'bridge-start',run:action,path:'/c/original',prompt:'do not send after '+action});
        await wait(30);
        if(action==='stop')await ask({kind:'bridge-stop'});
        if(action==='navigate')fixtureRoute.pathname='/c/other';
        if(action==='model')model.textContent='Sol';
        button.disabled=false;
        check(!!(await pending).error,'Pending send survived '+action);
        await wait(150);check(sent.length===0,'A message was sent after '+action);
      }
      fixtureRoute.pathname='/c/original';model.textContent='GPT Pro';composer.value='';
      const wrong=await ask({kind:'bridge-start',run:'wrong',path:'/c/other',prompt:'private prompt'});
      check(!!wrong.error && composer.value==='','A task was inserted into an unexpected conversation');
      check((await ask({kind:'bridge-start',run:'late-result',path:'/c/original',prompt:'initial task'})).started,'Could not start result test');
      const reply=document.createElement('div');reply.dataset.messageAuthorRole='assistant';
      const pre=document.createElement('pre'),code=document.createElement('code');code.className='language-chatgpt-local-bridge';code.textContent='{"type":"tool"}';pre.append(code);reply.append(pre);document.querySelector('#replies').append(reply);
      await wait(900);check(!!pendingResult,'Local action was not requested');
      fixtureRoute.pathname='/c/other';pendingResult({ok:true,value:{run:'late-result',sequence:2,result:{content:[{type:'text',text:'private local result'}]}}});
      await wait(150);check(sent.length===1 && !composer.value.includes('private local result'),'Local result crossed into another conversation');
      document.querySelector('#result').textContent='PASS';
    })().catch(error=>document.querySelector('#result').textContent='FAIL: '+error.message);
  </script>`);
  const result = spawnSync(process.env.BRIDGEBRAIN_RELAY_CHROME, ['--headless', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + path.join(directory, 'isolated-profile'), '--virtual-time-budget=6000', '--dump-dom', pathToFileURL(fixture).href], { encoding: 'utf8', timeout: 25000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /id="result">PASS<\/pre>/, result.stdout);
});
