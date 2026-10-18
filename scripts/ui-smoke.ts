import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {_electron,chromium} from 'playwright-core';
import electron from 'electron';

const root=await mkdtemp(join(tmpdir(),'agent-ui-'));
const desktop=await _electron.launch({executablePath:electron as unknown as string,args:['dist/desktop/main.js'],env:{...process.env,AGENT_DESKTOP_DATA_DIR:join(root,'data')},timeout:30000});
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
try {
  const page=await desktop.firstWindow();await page.locator('.shell').waitFor({timeout:30000});
  const origin=new URL(page.url()).origin;
  assert.equal(await page.evaluate(()=>typeof (window as unknown as {require?:unknown}).require),'undefined');
  await page.getByRole('button',{name:'模型设置',exact:true}).click();
  await page.getByLabel('模型提供方').selectOption('openai-codex');
  await page.getByRole('button',{name:'导入 Pi 授权'}).click();
  await page.locator('.start select option[value="openai-codex/gpt-6-luna"]').waitFor({state:'attached',timeout:30000});
  await page.getByRole('button',{name:'模型设置',exact:true}).click();
  await page.getByPlaceholder('工作目录的绝对路径').fill(root);
  await page.locator('.start select').selectOption('openai-codex/gpt-6-luna');
  await page.getByRole('button',{name:'创建会话 →'}).click();
  await page.getByLabel('任务',{exact:true}).waitFor();
  await page.getByLabel('任务',{exact:true}).fill('Use the native write tool to create ui-acceptance.txt in the current directory with exactly UI real model success. Then read it with the native read tool. Do not use bash or modify any other file.');
  await page.getByRole('button',{name:'发送 ↑'}).click();
  // Closing the visible window must leave both the Host and submitted task alive.
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.close());
  assert.equal(await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.isVisible()),false);
  const state=async()=>page.evaluate(async()=>{const list=await(await fetch('/api/sessions')).json();return(await fetch(`/api/sessions/${list[0].id}`)).json();});
  const deadline=Date.now()+180000;let current;
  do {await new Promise(ok=>setTimeout(ok,400));current=await state();}while(current.busy&&Date.now()<deadline);
  assert.equal(current.busy,false);assert.equal((await readFile(join(root,'ui-acceptance.txt'),'utf8')).trim(),'UI real model success');
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.show());
  await page.reload();await page.locator('.shell').waitFor();
  await page.locator('nav button').first().click();await page.getByLabel('任务',{exact:true}).waitFor();
  assert.ok(await page.locator('details').count()>=2);
  // A real Chrome browser connects to the same Host and authoritative Pi session.
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  const context=await browser.newContext();await context.addCookies(await desktop.context().cookies());
  const web=await context.newPage();await web.goto(origin);await web.locator('.shell').waitFor();await web.locator('nav button').first().click();
  await web.getByLabel('任务',{exact:true}).fill('Continue this same session. Read ui-acceptance.txt with the native read tool and report its exact content. Do not modify files.');
  await web.getByRole('button',{name:'发送 ↑'}).click();
  await web.getByRole('button',{name:'停止',exact:true}).waitFor();
  await web.getByRole('button',{name:'发送 ↑'}).waitFor({timeout:180000});
  assert.ok((await web.locator('.assistant').last().innerText()).includes('UI real model success'));
  const beforeCrash=await state();
  const hostPid=await desktop.evaluate(({app})=>app.getAppMetrics().find(p=>p.type==='Utility'&&p.name==='Agent Host')?.pid);
  assert.ok(hostPid);process.kill(hostPid,'SIGKILL');
  const recoveryDeadline=Date.now()+30000;
  let recoveredPid:number|undefined;
  do {await new Promise(ok=>setTimeout(ok,300));recoveredPid=await desktop.evaluate(({app})=>app.getAppMetrics().find(p=>p.type==='Utility'&&p.name==='Agent Host')?.pid);}while((!recoveredPid||recoveredPid===hostPid)&&Date.now()<recoveryDeadline);
  assert.ok(recoveredPid&&recoveredPid!==hostPid);
  await page.waitForFunction(()=>document.querySelector('.connection')?.textContent?.includes('已连接'),{timeout:30000});
  await page.locator('nav button').first().click();await page.getByLabel('任务',{exact:true}).waitFor();
  const afterCrash=await state();assert.equal(afterCrash.id,beforeCrash.id);assert.equal(afterCrash.messages.length,beforeCrash.messages.length);
  await web.waitForFunction(()=>document.querySelector('.connection')?.textContent?.includes('已连接'),{timeout:30000});
  await web.screenshot({path:join(root,'web.png')});
  console.log(JSON.stringify({result:'passed',desktop:true,webBrowser:'Chrome',realModel:'openai-codex/gpt-6-luna',nativeTools:true,windowCloseKeepsHost:true,sharedSessionMultiTurn:true,hostCrashRecovery:true,rendererNode:false}));
}finally{await browser?.close();await desktop.close();await rm(root,{recursive:true,force:true});}
