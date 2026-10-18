import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { AgentService } from './agent.js';

const createInput=z.object({cwd:z.string().min(1).max(4096),provider:z.string().min(1),model:z.string().min(1)}).strict();
const credentialInput=z.object({provider:z.string().min(1),key:z.string().max(16384).optional(),importExisting:z.boolean().optional()}).strict();
function equal(a: string, b: string) { const x=Buffer.from(a),y=Buffer.from(b); return x.length===y.length && timingSafeEqual(x,y); }
async function body(req: IncomingMessage): Promise<unknown> {
  let size=0; const chunks:Buffer[]=[];
  for await (const chunk of req) { size+=chunk.length; if (size>1024*1024) throw new Error('请求过大'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function json(res: ServerResponse,status: number,value: unknown) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(value)); }

export async function startHost(options: {dataDir:string;key:Buffer;token:string;port?:number;webDir?:string;service?:AgentService}) {
  if(options.token.length<32) throw new Error('连接令牌至少需要 32 个字符');
  const service=options.service ?? new AgentService(options.dataDir,options.key);
  await service.init();
  service.sensitive.add(options.token); service.sensitive.add(options.key.toString('base64'));
  const cookie=createHmac('sha256',options.token).update('agent-browser-cookie-v1').digest('hex'); service.sensitive.add(cookie);
  let origin='',cookieName='';
  const authenticated=(req:IncomingMessage) => equal(req.headers.authorization ?? '',`Bearer ${options.token}`) || (req.headers.cookie ?? '').split(';').some(c=>equal(c.trim(),`${cookieName}=${cookie}`));
  const bearer=(req:IncomingMessage) => equal(req.headers.authorization ?? '',`Bearer ${options.token}`);
  const server=createServer(async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");
    try {
      if(req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin!==origin)) { json(res,403,{error:'来源不受信任'}); return; }
      const url=new URL(req.url ?? '/',origin);
      if(url.pathname==='/api/connect' && req.method==='POST') {
        const input=z.object({token:z.string()}).strict().parse(await body(req));
        if(!equal(input.token,options.token)) {json(res,401,{error:'连接令牌无效'});return;}
        res.setHeader('Set-Cookie',`${cookieName}=${cookie}; HttpOnly; SameSite=Strict; Path=/`);
        json(res,200,{ok:true}); return;
      }
      if(url.pathname.startsWith('/api/')) {
        if(!authenticated(req)) {json(res,401,{error:'请连接 Agent Host'});return;}
        if(req.method!=='GET' && !bearer(req) && req.headers.origin!==origin) {json(res,403,{error:'缺少可信来源'});return;}
        const route=url.pathname;
        if(route==='/api/models' && req.method==='GET') {json(res,200,await service.models());return;}
        if(route==='/api/credentials' && req.method==='POST') {const x=credentialInput.parse(await body(req));await service.credentials(x.provider,x.key,x.importExisting);json(res,200,{ok:true});return;}
        if(route==='/api/sessions' && req.method==='GET') {json(res,200,await service.list());return;}
        if(route==='/api/sessions' && req.method==='POST') {const x=createInput.parse(await body(req));json(res,201,await service.create(x.cwd,x.provider,x.model));return;}
        const match=/^\/api\/sessions\/([a-f0-9-]{36})(?:\/(prompt|stop|compact|branch|model|thinking|export))?$/.exec(route);
        if(match) {
          const id=match[1]!,action=match[2];
          if(!action && req.method==='GET') {json(res,200,await service.viewSession(id));return;}
          if(action==='export' && req.method==='GET') {json(res,200,await service.export(id));return;}
          if(req.method==='POST') {
            if(action==='prompt') {const x=z.object({text:z.string().min(1).max(200000)}).strict().parse(await body(req));await service.prompt(id,x.text);json(res,202,{ok:true});return;}
            if(action==='stop') {await service.stop(id);json(res,200,{ok:true});return;}
            if(action==='compact'||action==='branch'||action==='model'||action==='thinking') {const x=z.object({value:z.string().optional(),provider:z.string().optional()}).strict().parse(await body(req));json(res,200,await service.action(id,action,x.value,x.provider));return;}
          }
        }
        json(res,404,{error:'接口不存在'}); return;
      }
      if(req.method!=='GET') {json(res,405,{error:'请求方法不支持'});return;}
      const root=options.webDir ?? fileURLToPath(new URL('../web/',import.meta.url));
      const path=resolve(root,url.pathname==='/' ? 'index.html' : `.${decodeURIComponent(url.pathname)}`);
      if(!path.startsWith(resolve(root)+sep)) {json(res,404,{error:'页面不存在'});return;}
      const data=await readFile(path);
      res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'} as Record<string,string>)[extname(path)] ?? 'application/octet-stream'});res.end(data);
    } catch(error) {
      if(error instanceof z.ZodError) json(res,400,{error:'请求字段无效'});
      else json(res,409,{error:error instanceof Error && error.message==='Nothing to compact (session too small)'?'当前对话较短，暂时无需压缩':'操作未完成，请检查会话状态、模型凭据或数据目录'});
    }
  });
  const sockets=new WebSocketServer({noServer:true,maxPayload:1024});
  server.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/events' || req.headers.host!==new URL(origin).host || req.headers.origin!==origin || !authenticated(req)) {socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
    sockets.handleUpgrade(req,socket,head,ws=>{sockets.emit('connection',ws,req);ws.send(JSON.stringify({type:'connected'}));});
  });
  const broadcast=(event:unknown)=>{
    const data=JSON.stringify(event);
    for(const ws of sockets.clients) if(ws.readyState===WebSocket.OPEN) {
      if(ws.bufferedAmount>4*1024*1024) ws.close(1013,'请重新连接'); else ws.send(data);
    }
  };
  service.on('event',broadcast);
  const heartbeat=setInterval(()=>{for(const ws of sockets.clients) ws.ping();},30000);heartbeat.unref();
  await new Promise<void>((ok,fail)=>{server.once('error',fail);server.listen(options.port ?? 0,'127.0.0.1',ok);});
  const address=server.address(); if(!address || typeof address==='string') throw new Error('Host 启动失败');
  origin=`http://127.0.0.1:${address.port}`;cookieName=`agent-${address.port}`;
  return {origin,service,async close(){clearInterval(heartbeat);service.off('event',broadcast);for(const ws of sockets.clients)ws.terminate();sockets.close();await service.close();await new Promise<void>((ok,fail)=>server.close(error=>error?fail(error):ok()));}};
}
