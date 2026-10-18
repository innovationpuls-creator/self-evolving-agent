import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import {SkillError} from './skills.js';
import { AgentService } from './agent.js';
import { memoryContent, memoryReason, MemoryError } from './memory.js';

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
  try{await service.init();}catch(error){await service.close().catch(()=>{});throw error;}
  service.sensitive.add(options.token); service.sensitive.add(options.key.toString('base64'));
  let origin='';
  const authenticated=(req:IncomingMessage) => equal(req.headers.authorization ?? '',`Bearer ${options.token}`);
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
        // Remove the legacy cookie; cookies are shared across ports on a host.
        res.setHeader('Set-Cookie',`agent-${new URL(origin).port}=; Max-Age=0; Path=/`);
        json(res,200,{ok:true}); return;
      }
      if(url.pathname.startsWith('/api/')) {
        if(!authenticated(req)) {json(res,401,{error:'请连接 Agent Host'});return;}
        const route=url.pathname;
        const memoryRoute=/^\/api\/memory(?:\/([a-f0-9-]{36})(?:\/(revise))?)?$/.exec(route);
        if(memoryRoute){
          const query=z.object({project:z.string().max(4096).optional(),query:z.string().max(1000).optional(),
            includeHistory:z.enum(['true','false']).optional(),scope:z.enum(['global','project']).optional(),
            limit:z.coerce.number().int().min(1).max(100).optional(),offset:z.coerce.number().int().min(0).optional()})
            .strict().parse(Object.fromEntries(url.searchParams));
          const ctx=await service.memoryUserContext(query.project),id=memoryRoute[1];
          if(req.method==='GET'){
            json(res,200,id?service.memory.get(ctx,id,query.includeHistory==='true'):
              service.memory.search(ctx,{...query,includeHistory:query.includeHistory==='true'}));return;
          }
          if(req.method==='POST'&&!id){
            const x=z.object({knowledge:memoryContent,reason:memoryReason}).strict().parse(await body(req));
            json(res,201,service.memory.create(ctx,x.knowledge,x.reason));return;
          }
          if(req.method==='POST'&&id&&memoryRoute[2]==='revise'){
            const x=z.object({baseRevision:z.number().int().positive(),knowledge:memoryContent.optional(),reason:memoryReason,
              confirm:z.boolean().optional(),retire:z.boolean().optional()}).strict().parse(await body(req));
            json(res,200,service.memory.revise(ctx,id,{...x,content:x.knowledge}));return;
          }
          if(req.method==='DELETE'&&id&&!memoryRoute[2]){
            const x=z.object({baseRevision:z.number().int().positive(),reason:memoryReason}).strict().parse(await body(req));
            json(res,200,service.memory.revise(ctx,id,{...x,remove:true}));return;
          }
          json(res,405,{error:'不支持的 Memory 操作'});return;
        }
        if(route==='/api/models' && req.method==='GET') {json(res,200,await service.models());return;}
        if(route==='/api/credentials' && req.method==='POST') {const x=credentialInput.parse(await body(req));await service.credentials(x.provider,x.key,x.importExisting);json(res,200,{ok:true});return;}
        if(route==='/api/sessions' && req.method==='GET') {json(res,200,await service.list());return;}
        if(route==='/api/sessions' && req.method==='POST') {const x=createInput.parse(await body(req));json(res,201,await service.create(x.cwd,x.provider,x.model));return;}
        if(route==='/api/skills' && req.method==='GET'){json(res,200,service.sensitive.copy(await service.skills.discover(url.searchParams.get('project')??undefined)));return;}
        if(route==='/api/skills' && req.method==='POST'){
          const input=z.object({source:z.string().min(1).max(4096),project:z.string().optional(),bindings:z.array(z.object({skill:z.string(),extensions:z.array(z.string()),knowledgeFiles:z.array(z.string()).optional()}).strict()).optional()}).strict().parse(await body(req));
          json(res,202,service.sensitive.copy(service.skills.startImport(input)));return;
        }
        const operation=/^\/api\/skills\/operations\/([a-f0-9-]{36})$/.exec(route);
        if(operation&&req.method==='GET'){json(res,200,service.sensitive.copy(service.skills.operation(operation[1]!)));return;}
        const skillRoute=/^\/api\/skills\/([a-f0-9-]{36})(?:\/(files|edit|review|publish|enabled|rollback|knowledge|draft|import-draft))?$/.exec(route);
        if(skillRoute){
          const id=skillRoute[1]!,action=skillRoute[2];
          if(!action&&req.method==='GET'){json(res,200,service.sensitive.copy(await service.skillDetail(id)));return;}
          if(action==='files'&&req.method==='GET'){json(res,200,service.sensitive.copy(await service.skills.read(id,url.searchParams.get('version')??'',url.searchParams.get('path')??'',url.searchParams.get('snapshot')==='true')));return;}
          if(action==='draft'&&req.method==='DELETE'){await service.skills.discardDraft(id);json(res,200,{ok:true});return;}
          if(req.method==='POST'){
            if(action==='edit'){const x=z.object({baseRevision:z.number().int(),files:z.array(z.object({path:z.string(),content:z.string().max(1000000).nullable()}).strict()).min(1).max(50)}).strict().parse(await body(req));json(res,201,service.sensitive.copy(await service.skills.edit(id,x.baseRevision,x.files)));return;}
            if(action==='review'){const x=z.object({version:z.string().uuid(),digest:z.string(),notes:z.string().max(10000),reviewedCode:z.literal(true),reviewedDependencies:z.literal(true),reviewedPermissions:z.literal(true)}).strict().parse(await body(req));json(res,200,service.sensitive.copy(await service.skills.review(id,x.version,x.digest,x.notes)));return;}
            if(action==='publish'||action==='rollback'){const x=z.object({version:z.string().uuid(),baseRevision:z.number().int()}).strict().parse(await body(req));json(res,202,service.sensitive.copy(service.skills.publish(id,x.version,x.baseRevision)));return;}
            if(action==='enabled'){const x=z.object({enabled:z.boolean(),baseRevision:z.number().int()}).strict().parse(await body(req));const r=service.skills.record(id);json(res,202,service.sensitive.copy(service.skills.publish(id,r.current??r.latest,x.baseRevision,x.enabled)));return;}
            if(action==='knowledge'){const x=z.object({baseRevision:z.number().int(),path:z.string(),content:z.string().max(1000000)}).strict().parse(await body(req));const result=await service.skills.setKnowledge(id,x.baseRevision,x.path,x.content);await service.refreshSkillKnowledge();json(res,200,service.sensitive.copy(result));return;}
            if(action==='draft'){await body(req);json(res,201,await service.skills.prepareDraft(id));return;}
            if(action==='import-draft'){const x=z.object({baseRevision:z.number().int()}).strict().parse(await body(req));json(res,201,service.sensitive.copy(await service.skills.importDraft(id,x.baseRevision)));return;}
          }
        }
        const recover=/^\/api\/sessions\/([a-f0-9-]{36})\/recover-skills$/.exec(route);
        if(recover&&req.method==='POST'){await service.recoverSkills(recover[1]!);json(res,200,{ok:true});return;}
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
      if(error instanceof MemoryError) json(res,error.status,{error:error.message,code:error.code});
      else if(error instanceof SkillError) json(res,error.status,{error:error.message});
      else if(error instanceof z.ZodError) json(res,400,{error:'请求字段无效'});
      else json(res,409,{error:error instanceof Error && error.message==='Nothing to compact (session too small)'?'当前对话较短，暂时无需压缩':'操作未完成，请检查会话状态、模型凭据或数据目录'});
    }
  });
  const sockets=new WebSocketServer({noServer:true,maxPayload:1024});
  const verified=new Set<WebSocket>();
  server.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/events' || req.headers.host!==new URL(origin).host || req.headers.origin!==origin) {socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
    sockets.handleUpgrade(req,socket,head,ws=>{
      ws.on('error',()=>ws.terminate());
      const authorize=()=>{verified.add(ws);ws.send(JSON.stringify({type:'connected'}));};
      ws.once('close',()=>verified.delete(ws));
      if(authenticated(req)) {authorize();return;}
      const timer=setTimeout(()=>ws.close(4401,'认证超时'),5000);timer.unref();
      ws.once('close',()=>clearTimeout(timer));
      ws.once('message',bytes=>{
        clearTimeout(timer);
        try {
          const input=z.object({type:z.literal('authenticate'),token:z.string().max(512)}).strict().parse(JSON.parse(bytes.toString()));
          if(equal(input.token,options.token)) authorize();else ws.close(4401,'认证失败');
        } catch {ws.close(4401,'认证失败');}
      });
    });
  });
  const broadcast=(event:unknown)=>{
    const data=JSON.stringify(event);
    for(const ws of verified) if(ws.readyState===WebSocket.OPEN) {
      if(ws.bufferedAmount>4*1024*1024) ws.close(1013,'请重新连接'); else ws.send(data);
    }
  };
  service.on('event',broadcast);
  const heartbeat=setInterval(()=>{for(const ws of verified) ws.ping();},30000);heartbeat.unref();
  try{await new Promise<void>((ok,fail)=>{server.once('error',fail);server.listen(options.port ?? 0,'127.0.0.1',ok);});}
  catch(error){clearInterval(heartbeat);service.off('event',broadcast);sockets.close();await service.close().catch(()=>{});throw error;}
  const address=server.address(); if(!address || typeof address==='string') throw new Error('Host 启动失败');
  origin=`http://127.0.0.1:${address.port}`;
  let closing:Promise<void>|undefined;
  return {origin,service,close(){
    return closing ??= (async()=>{
      clearInterval(heartbeat);service.off('event',broadcast);
      for(const ws of sockets.clients)ws.terminate();sockets.close();
      const stopped=new Promise<void>((ok,fail)=>server.close(error=>error?fail(error):ok()));
      try {await service.close();} finally {await stopped;}
    })();
  }};
}
