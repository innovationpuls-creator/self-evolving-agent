import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {WebSocket} from 'ws';
import {fauxProvider} from '@earendil-works/pi-ai/providers/faux';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {startHost} from '../apps/host/server.js';
import {EncryptedStore, SensitiveData, snapshot, restore} from '../apps/host/storage.js';

async function fixture() {
  const dir=await mkdtemp(join(tmpdir(),'agent-test-')),token=randomBytes(32).toString('hex'),key=randomBytes(32);
  const host=await startHost({dataDir:join(dir,'data'),key,token});
  const fake=fauxProvider({models:[{id:'test-model',contextWindow:262144,maxTokens:512}],tokensPerSecond:10000});
  host.service.runtime.registerNativeProvider(fake.provider);
  const request=async(path:string,method='GET',body?:unknown,headers:Record<string,string>={})=>fetch(`${host.origin}/api${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const create=async()=>{const response=await request('/sessions','POST',{cwd:dir,provider:fake.provider.id,model:'test-model'});assert.equal(response.status,201);return response.json();};
  const settle=async(id:string)=>{
    const deadline=Date.now()+10000;
    let state;do{await new Promise(ok=>setTimeout(ok,20));state=await(await request(`/sessions/${id}`)).json();}while(state.busy&&Date.now()<deadline);
    assert.equal(state.busy,false);return state;
  };
  return {dir,key,token,host,fake,request,create,settle,close:async()=>{await host.close();await rm(dir,{recursive:true,force:true});}};
}

test('encrypted snapshot preserves non-last selected leaf; wrong key and tamper fail closed',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'agent-store-'));
  try {
    const key=randomBytes(32),store=new EncryptedStore(dir,key),manager=SessionManager.inMemory(dir);
    const first=manager.appendMessage({role:'user',content:'secret history sentinel',timestamp:Date.now()});
    manager.appendMessage(fauxAssistantMessage('first branch'));manager.branch(first);
    manager.appendMessage(fauxAssistantMessage('second branch'));manager.branch(first);
    const saved=snapshot(manager);await store.write('test.enc',saved);
    const data=await store.read<typeof saved>('test.enc');assert.ok(data);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot(restore(data)))),JSON.parse(JSON.stringify(saved)));
    const bytes=await readFile(join(dir,'test.enc'),'utf8');assert.ok(!bytes.includes('secret history sentinel'));
    await assert.rejects(new EncryptedStore(dir,randomBytes(32)).read('test.enc'));
    const envelope=JSON.parse(bytes);envelope.data=Buffer.from('tamper').toString('base64');await writeFile(join(dir,'test.enc'),JSON.stringify(envelope));
    await assert.rejects(store.read('test.enc'));
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('boundary redaction protects nested credentials without mutating tool arguments',()=>{
  const sensitive=new SensitiveData();const secret='mock-sensitive-value-12345';sensitive.add(secret);
  const source={tool:{apiToken:secret},text:`Bearer abcdefghijklmnop email person@example.com`,schema:{properties:{apiKey:{type:'string'}}}};
  const projected=sensitive.copy(source);
  assert.ok(!JSON.stringify(projected).includes(secret));assert.ok(!projected.text.includes('person@example.com'));
  assert.equal(source.tool.apiToken,secret);assert.deepEqual(projected.schema,source.schema);
});

test('HTTP and WebSocket reject unauthenticated, cross-origin and rebinding requests',async()=>{
  const f=await fixture();
  try {
    assert.equal((await fetch(`${f.host.origin}/api/sessions`)).status,401);
    assert.equal((await f.request('/sessions','GET',undefined,{Origin:'https://evil.example'})).status,403);
    const rebinding=await new Promise<number|undefined>((ok,fail)=>{const req=httpRequest(`${f.host.origin}/api/sessions`,{headers:{Host:'evil.example',Authorization:`Bearer ${f.token}`}},res=>{res.resume();ok(res.statusCode);});req.on('error',fail);req.end();});assert.equal(rebinding,403);
    assert.equal((await f.request('/connect','POST',{token:'wrong'})).status,401);
    const login=await f.request('/connect','POST',{token:f.token},{Origin:f.host.origin});assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie')!.split(';')[0]!;
    const denied=await fetch(`${f.host.origin}/api/sessions`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,403);
    await new Promise<void>((ok,fail)=>{
      const ws=new WebSocket(`${f.host.origin.replace('http','ws')}/events`,{origin:'https://evil.example',headers:{Authorization:`Bearer ${f.token}`}});
      ws.once('unexpected-response',(_req,res)=>{assert.equal(res.statusCode,403);res.resume();ok();});ws.once('open',()=>fail(new Error('untrusted socket opened')));ws.once('error',()=>{});
    });
  }finally{await f.close();}
});

test('native tool execution, stream events, independent sessions, branching and encrypted restart',async()=>{
  const f=await fixture();
  let second:Awaited<ReturnType<typeof startHost>>|undefined;let firstClosed=false;
  try {
    const first=await f.create(),other=await f.create();assert.notEqual(first.id,other.id);
    const secret='mock-tool-secret-preserve-12345';f.host.service.sensitive.add(secret);
    f.fake.setResponses([
      fauxAssistantMessage(fauxToolCall('write',{path:'native.txt',content:secret}),{stopReason:'toolUse'}),
      fauxAssistantMessage('done')
    ]);
    const events:string[]=[];
    const ws=new WebSocket(`${f.host.origin.replace('http','ws')}/events`,{origin:f.host.origin,headers:{Authorization:`Bearer ${f.token}`}});
    await once(ws,'open');ws.on('message',value=>events.push(value.toString()));
    assert.equal((await f.request(`/sessions/${first.id}/prompt`,'POST',{text:'Write file'})).status,202);
    const state=await f.settle(first.id);ws.close();
    assert.equal(await readFile(join(f.dir,'native.txt'),'utf8'),secret,'native tool arguments must remain exact');
    assert.ok(!JSON.stringify(state).includes(secret));assert.ok(!events.join('').includes(secret));
    assert.ok(events.some(e=>e.includes('tool_execution_end')));
    assert.equal((await(await f.request(`/sessions/${other.id}`)).json()).messages.length,0);
    const leaves=(await f.host.service.store.read<{session:{entries:Array<{id:string;type:string}>}}>(`sessions/${first.id}.enc`))!.session.entries;
    const user=leaves.find(e=>e.type==='message');assert.ok(user);
    assert.equal((await f.request(`/sessions/${first.id}/branch`,'POST',{value:user.id})).status,200);
    const branched=await(await f.request(`/sessions/${first.id}`)).json();
    await f.host.close();firstClosed=true;
    const index=new DatabaseSync(join(f.dir,'data','product.sqlite'));index.exec('DELETE FROM sessions');index.close();
    second=await startHost({dataDir:join(f.dir,'data'),key:f.key,token:f.token});
    second.service.runtime.registerNativeProvider(f.fake.provider);
    const response=await fetch(`${second.origin}/api/sessions/${first.id}`,{headers:{Authorization:`Bearer ${f.token}`}});
    const restored=await response.json();assert.equal((await second.service.list()).length,2);assert.equal(restored.leafId,branched.leafId);assert.deepEqual(restored.messages,branched.messages);
  }finally{await second?.close();if(!firstClosed)await f.host.close();await rm(f.dir,{recursive:true,force:true});}
});

test('running request rejects overlap; stop does not replay work',async()=>{
  const f=await fixture();
  try {
    const session=await f.create();
    f.fake.setResponses([async(_context,options)=>{await new Promise<void>(ok=>{const timer=setTimeout(ok,3000);options?.signal?.addEventListener('abort',()=>{clearTimeout(timer);ok();},{once:true});});return fauxAssistantMessage('stopped');}]);
    assert.equal((await f.request(`/sessions/${session.id}/prompt`,'POST',{text:'long task'})).status,202);
    assert.equal((await f.request(`/sessions/${session.id}/prompt`,'POST',{text:'overlap'})).status,409);
    assert.equal((await f.request(`/sessions/${session.id}/stop`,'POST',{})).status,200);
    await f.settle(session.id);assert.equal(f.fake.state.callCount,1);
  }finally{await f.close();}
});

test('model dispatch refuses unchecked context instead of falling through an Extension hook',async()=>{
  const f=await fixture();
  try {
    const original=f.host.service.sensitive.copy.bind(f.host.service.sensitive);
    f.host.service.sensitive.copy=()=>{throw new Error('simulated mandatory check failure');};
    assert.throws(()=>f.host.service.runtime.streamSimple(f.fake.getModel(),{messages:[{role:'user',content:'must never dispatch',timestamp:Date.now()}]}));
    assert.equal(f.fake.state.callCount,0);
    f.host.service.sensitive.copy=original;
  }finally{await f.close();}
});

test('parallel sessions keep their conversation separate and native compaction survives recovery',async()=>{
  const f=await fixture();
  try {
    const a=await f.create(),b=await f.create();
    const reply=async(context:{messages:unknown[]})=>fauxAssistantMessage(JSON.stringify(context.messages).includes('alpha-only')?'alpha-result':'beta-result');
    f.fake.setResponses([reply,reply]);
    await Promise.all([f.request(`/sessions/${a.id}/prompt`,'POST',{text:'alpha-only '+ 'historical context '.repeat(6000)}),f.request(`/sessions/${b.id}/prompt`,'POST',{text:'beta-only'})]);
    const [sa,sb]=await Promise.all([f.settle(a.id),f.settle(b.id)]);
    assert.ok(JSON.stringify(sa.messages).includes('alpha-result'));assert.ok(!JSON.stringify(sa.messages).includes('beta-only'));
    assert.ok(JSON.stringify(sb.messages).includes('beta-result'));assert.ok(!JSON.stringify(sb.messages).includes('alpha-only'));
    f.fake.setResponses([fauxAssistantMessage('alpha follow-up result')]);
    await f.request(`/sessions/${a.id}/prompt`,'POST',{text:'alpha follow-up '+ 'recent context '.repeat(6500)});await f.settle(a.id);
    f.fake.setResponses([fauxAssistantMessage('Summary: user requested alpha-only and received alpha-result.')]);
    await f.host.service.action(a.id,'compact');
    const saved=await f.host.service.store.read<{session:ReturnType<typeof snapshot>}>(`sessions/${a.id}.enc`);assert.ok(saved);
    assert.ok(saved.session.entries.some(entry=>entry.type==='compaction'));
    assert.ok(restore(saved.session).getEntries().some(entry=>entry.type==='compaction'));
  }finally{await f.close();}
});

test('a model error can be retried without restarting the Host',async()=>{
  const f=await fixture();
  try {
    const session=await f.create();
    f.fake.setResponses([fauxAssistantMessage('',{stopReason:'error',errorMessage:'permanent invalid input'})]);
    await f.request(`/sessions/${session.id}/prompt`,'POST',{text:'first request'});
    const failed=await f.settle(session.id);assert.ok(failed.error);assert.equal(failed.interrupted,true);
    f.fake.setResponses([fauxAssistantMessage('recovered')]);
    assert.equal((await f.request(`/sessions/${session.id}/prompt`,'POST',{text:'retry request'})).status,202);
    const recovered=await f.settle(session.id);assert.equal(recovered.error,undefined);assert.ok(JSON.stringify(recovered.messages).includes('recovered'));
  }finally{await f.close();}
});
