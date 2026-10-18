import { app, BrowserWindow, dialog, Menu, nativeImage, safeStorage, shell, Tray, utilityProcess, type UtilityProcess } from 'electron';
import { randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let window:BrowserWindow|undefined;
let child:UtilityProcess|undefined;
let tray:Tray|undefined;
let quitting=false;
let stopTimer:NodeJS.Timeout|undefined;
let port=0;
let origin='';
const token=randomBytes(32).toString('hex');
if(!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance',()=>{window?.show();window?.focus();});
app.on('activate',()=>window?.show());
app.on('window-all-closed',()=>{});

async function dataKey(dir:string) {
  if(!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('系统安全存储不可用');
  if(process.platform==='linux' && safeStorage.getSelectedStorageBackend()==='basic_text') throw new Error('请启用系统密钥环');
  const path=join(dir,'data-key.enc');
  try { return (await safeStorage.decryptStringAsync(await readFile(path))).result; }
  catch(error) {
    if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error;
    const key=randomBytes(32).toString('base64');
    await writeFile(`${path}.tmp`,await safeStorage.encryptStringAsync(key),{mode:0o600});
    await rename(`${path}.tmp`,path);return key;
  }
}
async function start(key:string,dir:string) {
  if(quitting)return;
  child=utilityProcess.fork(fileURLToPath(new URL('../host/main.js',import.meta.url)),[],{stdio:'pipe',serviceName:'Agent Host'});
  // Raw provider/extension output is never forwarded to a client or a log.
  child.stdout?.resume();child.stderr?.resume();
  const current=child;
  current.once('spawn',()=>current.postMessage({dataDir:dir,key,token,port}));
  let ready=false;
  current.on('message',async message=>{
    if(message.type==='ready') {
      ready=true;origin=message.origin;port=Number(new URL(origin).port);
      // The origin-scoped client token survives same-port Host recovery; keep the live UI and reconnect its socket.
      if(window && !window.webContents.getURL().startsWith(`${origin}/`)) {
        await window.loadURL(`${origin}/#token=${encodeURIComponent(token)}`);
      }
    } else if(message.type==='failed') {void dialog.showMessageBox({type:'error',message:'Agent Host 启动失败',detail:'请检查数据目录、系统安全存储或端口占用。'});}
  });
  current.once('exit',()=>{
    if(child===current)child=undefined;
    if(quitting) {if(stopTimer)clearTimeout(stopTimer);app.exit(0);return;}
    // Restart only the Host. Interrupted model/tool work is never replayed.
    if(ready) setTimeout(()=>void start(key,dir),1000);
  });
}
app.on('before-quit',event=>{
  quitting=true;
  if(child){event.preventDefault();child.postMessage({type:'shutdown'});stopTimer??=setTimeout(()=>{child?.kill();app.exit(0);},10000);}
});
void app.whenReady().then(async()=>{
  const dir=process.env.AGENT_DESKTOP_DATA_DIR ?? join(app.getPath('userData'),'agent-data');
  await mkdir(dir,{recursive:true,mode:0o700});
  const key=await dataKey(dir);
  window=new BrowserWindow({width:1240,height:850,minWidth:850,minHeight:600,backgroundColor:'#f6f5f1',title:'Agent',
    webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(!origin||new URL(url).origin!==origin)event.preventDefault();});
  window.on('close',event=>{if(!quitting){event.preventDefault();window?.hide();}});
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'Agent',submenu:[{label:'显示窗口',click:()=>window?.show()},{label:'在浏览器打开',click:()=>{if(origin)void shell.openExternal(`${origin}/#token=${encodeURIComponent(token)}`);}},{type:'separator'},{role:'quit',label:'退出 Agent'}]},
    {role:'editMenu',label:'编辑'}, {role:'viewMenu',label:'视图'}
  ]));
  const icon=nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVQ4T2NkYGD4z0ABYBw1YNSAUQNGDQAAKQAB/6d+RwAAAABJRU5ErkJggg==');
  tray=new Tray(icon);tray.setToolTip('Agent');tray.setContextMenu(Menu.buildFromTemplate([{label:'打开 Agent',click:()=>window?.show()},{label:'退出',click:()=>app.quit()}]));tray.on('click',()=>window?.show());
  await start(key,dir);
}).catch(()=>{dialog.showErrorBox('无法启动 Agent','系统安全存储不可用，或无法读取加密数据密钥。请检查系统密钥环和数据目录。');app.exit(1);});
