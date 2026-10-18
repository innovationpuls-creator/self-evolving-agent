import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {mkdir,mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {fauxProvider} from '@earendil-works/pi-ai/providers/faux';
import {startHost} from '../apps/host/server.js';
const root=await realpath(await mkdtemp(join(tmpdir(),'agent-browser-'))),token=randomBytes(32).toString('hex');
const host=await startHost({dataDir:join(root,'data'),key:randomBytes(32),token,webDir:resolve('dist/web')});
const fake=fauxProvider({models:[{id:'browser-model',contextWindow:100000,maxTokens:512}]});host.service.runtime.registerNativeProvider(fake.provider);
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
let observedCookie='',observedAuth='';
const observer=createServer((req,res)=>{observedCookie=req.headers.cookie??'';observedAuth=req.headers.authorization??'';res.end('local observer');});
try {
 await new Promise<void>(ok=>observer.listen(0,'127.0.0.1',ok));const address=observer.address();assert.ok(address&&typeof address!=='string');
 const aDir=join(root,'A'),bDir=join(root,'B');await mkdir(aDir);await mkdir(bDir);
 const a=await host.service.create(aDir,fake.provider.id,'browser-model'),b=await host.service.create(bDir,fake.provider.id,'browser-model');
 const page=await browser.newPage();await page.goto(`${host.origin}/#token=${token}`);await page.locator('.shell').waitFor();await page.waitForFunction(()=>document.querySelector('.connection')?.textContent?.includes('已连接'));
 assert.equal(new URL(page.url()).hash,'');assert.equal(await page.evaluate(()=>localStorage.length),0);
 await page.reload();await page.locator('.shell').waitFor();
 let release!:()=>void,started!:()=>void;const gate=new Promise<void>(ok=>release=ok),requestStarted=new Promise<void>(ok=>started=ok);
 await page.route(`**/api/sessions/${a.id}`,async route=>{started();await gate;await route.continue();});
 await page.locator('nav button').filter({hasText:aDir}).click();await requestStarted;
 await page.locator('nav button').filter({hasText:bDir}).click();await page.waitForFunction(value=>document.querySelector('main header p')?.textContent===value,bDir);
 const oldResponse=page.waitForResponse(response=>response.url().endsWith(`/api/sessions/${a.id}`));release();await oldResponse;await page.waitForTimeout(100);
 assert.equal(await page.locator('main header p').innerText(),bDir);await page.unrouteAll({behavior:'wait'});
 // A separate local origin must receive neither automatic cookies nor the bearer credential.
 await page.goto(`http://127.0.0.1:${address.port}/api/sessions`);assert.equal(observedCookie,'');assert.equal(observedAuth,'');
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('agent-connection-token')),null);
 const replay=await fetch(`${host.origin}/api/sessions`,{headers:{Cookie:observedCookie,Origin:host.origin}});assert.equal(replay.status,401);
 await page.goto(host.origin);await page.locator('.shell').waitFor();
 await page.evaluate(()=>sessionStorage.setItem('agent-connection-token','revoked-or-invalid-connection-token'));
 await page.reload();await page.getByRole('heading',{name:'连接 Agent',exact:true}).waitFor();assert.equal(await page.evaluate(()=>sessionStorage.getItem('agent-connection-token')),null);
 console.log(JSON.stringify({browserRegression:'passed',crossPortCredentialIsolation:true,refreshAuthentication:true,sessionSelectionRace:true,invalidAuthenticationReturnsToConnect:true}));
}finally{await browser.close();await new Promise<void>(ok=>observer.close(()=>ok()));await host.close();await rm(root,{recursive:true,force:true});}
