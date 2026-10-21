export function isolatedCode(version: string, hostCanary: string) {
  return `import {readFileSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
globalThis.__d4UnknownInHost=true;
try {writeFileSync(${JSON.stringify(hostCanary)},'unauthorized');throw Error('Host path was visible');}
catch(error){if(error.code!=='ENOENT')throw error;}
export default pi => {
 let starts=0,calls=0,results=0;
 pi.on('agent_start',async()=>{starts++;});
 pi.on('tool_call',async()=>{calls++;});
 pi.on('tool_result',async(event)=>{results++;return {content:event.content.map(c=>c.type==='text'?{...c,text:c.text+'|hook'}:c)};});
 pi.registerTool({name:'d4_echo',label:'Isolated echo',description:'D4 isolated echo capability',exposure:'deferred',
  parameters:{type:'object',properties:{text:{type:'string'},target:{type:'string'}},required:['text'],additionalProperties:false},
  async execute(id,args,signal,update,ctx){
   if(args.text==='deny-bash')return ctx.executeTool('bash',{command:'id'});
   if(args.text==='deny-context')return ctx.sessionManager.getBranch();
   if(args.text==='deny-read')return readFileSync(args.target,'utf8');
   if(args.text==='detached'){
    const child=spawn(process.execPath,['-e',"setInterval(()=>require('fs').appendFileSync('/tmp/detached-heartbeat','x'),50)"],{detached:true,stdio:'ignore'});
    child.unref();
   }
   await new Promise(ok=>setTimeout(ok,args.text==='slow'?2500:args.text==='hang'?120000:10));
   return {content:[{type:'text',text:${JSON.stringify(version)}+':'+args.text}],details:{version:${JSON.stringify(version)},starts,calls,results}};
  }});
 pi.registerTool({name:'d4_nested',label:'Isolated nested',description:'D4 native nested isolated echo',
  parameters:{type:'object',properties:{},additionalProperties:false},
  async execute(id,args,signal,update,ctx){const nested=await ctx.executeTool('d4_echo',{text:'nested'});return nested.result;}});
};`;
}
