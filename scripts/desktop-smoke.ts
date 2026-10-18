import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {_electron} from 'playwright-core';
const dir=await mkdtemp(join(tmpdir(),'agent-packaged-'));
const executable=process.env.AGENT_APP_PATH ?? resolve('release/Agent-darwin-arm64/Agent.app/Contents/MacOS/Agent');
const desktop=await _electron.launch({executablePath:executable,args:[],env:{...process.env,AGENT_DESKTOP_DATA_DIR:dir}});
try {
  const page=await desktop.firstWindow();await page.locator('.shell').waitFor({timeout:30000});
  assert.equal(await page.evaluate(()=>typeof (window as unknown as {require?:unknown}).require),'undefined');
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.close());
  assert.equal(await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.isVisible()),false);
  const status=await page.evaluate(async()=> (await fetch('/api/models')).status);assert.equal(status,200);
  const metrics=await desktop.evaluate(({app})=>app.getAppMetrics().map(p=>({type:p.type,pid:p.pid,name:p.name})));
  assert.ok(metrics.some(p=>p.type==='Utility'&&p.name==='Agent Host'));
  console.log(JSON.stringify({packagedDesktop:'passed',platform:process.platform,arch:process.arch,independentHost:true,bundledRuntime:true,windowCloseKeepsHost:true}));
}finally{await desktop.close();await rm(dir,{recursive:true,force:true});}
