import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {_electron,type ElectronApplication,type Page} from 'playwright-core';
const dir=await mkdtemp(join(tmpdir(),'agent-packaged-'));
const executable=process.env.AGENT_APP_PATH??resolve('release/Agent-darwin-arm64/Agent.app/Contents/MacOS/Agent');
const launch=()=>_electron.launch({executablePath:executable,args:[`--user-data-dir=${join(dir,'profile')}`],env:{...process.env,AGENT_DESKTOP_DATA_DIR:join(dir,'data')}});
const ready=async(app:ElectronApplication)=>{const page=await app.firstWindow();await page.locator('.shell').waitFor({timeout:30000});return page;};
const request=(page:Page,path:string,body?:unknown)=>page.evaluate(async({path,body})=>{
 const response=await fetch(`/api${path}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${sessionStorage.getItem('agent-connection-token')}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json();
},{path,body});
let desktop:ElectronApplication|undefined;
try {
  const contents=await readdir(join(dirname(executable),'../Resources/app'));assert.deepEqual(contents.sort(),['README.md','dist','node_modules','package.json']);
  desktop=await launch();let page=await ready(desktop);
  assert.equal(await page.evaluate(()=>typeof (window as unknown as {require?:unknown}).require),'undefined');
  const session=await request(page,'/sessions',{cwd:dir,provider:'openai-codex',model:'gpt-6-luna'});
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.close());
  assert.equal(await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.isVisible()),false);
  await request(page,'/models');
  const hostPid=await desktop.evaluate(({app})=>app.getAppMetrics().find(p=>p.type==='Utility'&&p.name==='Agent Host')?.pid);assert.ok(hostPid);
  process.kill(hostPid,'SIGKILL');
  const deadline=Date.now()+30000;let newPid:number|undefined;
  do{await new Promise(ok=>setTimeout(ok,300));newPid=await desktop.evaluate(({app})=>app.getAppMetrics().find(p=>p.type==='Utility'&&p.name==='Agent Host')?.pid);}while((!newPid||newPid===hostPid)&&Date.now()<deadline);
  assert.ok(newPid&&newPid!==hostPid);await page.waitForFunction(()=>document.querySelector('.connection')?.textContent?.includes('已连接'),{timeout:30000});
  assert.equal((await request(page,`/sessions/${session.id}`)).id,session.id);
  await desktop.close();desktop=undefined;desktop=await launch();page=await ready(desktop);
  assert.equal((await request(page,`/sessions/${session.id}`)).id,session.id);
  console.log(JSON.stringify({packagedDesktop:'passed',platform:process.platform,arch:process.arch,independentHost:true,bundledRuntime:true,windowCloseKeepsHost:true,hostRestartReconnect:true,emptySessionAppReopen:true,packageContents:'allowlisted'}));
}finally{await desktop?.close();await rm(dir,{recursive:true,force:true});}
