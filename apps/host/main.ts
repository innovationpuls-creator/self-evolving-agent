import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { startHost } from './server.js';

interface Config {dataDir:string;key:string;token:string;port?:number}
async function run(config:Config) {
  const dataDir=resolve(config.dataDir);
  await mkdir(dataDir,{recursive:true,mode:0o700});
  const lock=join(dataDir,'host.lock');
  try {const pid=Number(await readFile(lock,'utf8'));try{process.kill(pid,0);throw new Error('该数据目录已有 Host 运行');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;await unlink(lock);}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const handle=await open(lock,'wx',0o600);await handle.writeFile(String(process.pid));await handle.close();
  let host:Awaited<ReturnType<typeof startHost>>;
  try {host=await startHost({...config,dataDir,key:Buffer.from(config.key,'base64')});}
  catch(error) {await unlink(lock);throw error;}
  let stopping=false;
  const close=async()=>{if(stopping)return;stopping=true;try{await host.close();}finally{await unlink(lock);process.exit(0);}};
  process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
  process.parentPort?.on('message',event=>{if(event.data?.type==='shutdown')void close();});
  if(process.parentPort) process.parentPort.postMessage({type:'ready',origin:host.origin});
  else console.log(`Agent Host: ${host.origin}`);
}
if(process.parentPort) process.parentPort.once('message',event=>{void run(event.data as Config).catch(()=>{process.parentPort?.postMessage({type:'failed'});process.exit(1);});});
else {
  const {AGENT_DATA_KEY:key,AGENT_TOKEN:token}=process.env;
  if(!key||!token) {console.error('请设置 AGENT_DATA_KEY（32 字节 Base64）及 AGENT_TOKEN（至少 32 字符）');process.exit(1);}
  delete process.env.AGENT_DATA_KEY; delete process.env.AGENT_TOKEN;
  void run({dataDir:process.env.AGENT_DATA_DIR ?? '.agent-data',key,token,port:Number(process.env.PORT ?? 4317)}).catch(()=>{console.error('Host 启动失败，请检查密钥、数据目录与端口');process.exit(1);});
}
