import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { VMChannel } from '../apps/host/evolution/sandbox/vm-channel.js';
const vm = new VMChannel({
  helper: resolve('release/d4-execution/bin/d4-vm-owner'),
  observer: resolve('release/d4-execution/bin/d4-vm-observer'),
  work: resolve('release/d4-execution-work'),
});
const extension = `
export default pi => {
  let starts=0, calls=0, results=0;
  pi.on('agent_start', async () => { starts++; });
  pi.on('tool_call', async () => { calls++; });
  pi.on('tool_result', async () => { results++; });
  pi.registerTool({name:'d4_echo',label:'Echo',description:'Isolated asynchronous echo',
    parameters:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false},
    async execute(id,args,signal,update,ctx) {
      await new Promise(ok=>setTimeout(ok,10));
      if(args.text==='forbidden') return ctx.executeTool('bash',{command:'id'});
      return {content:[{type:'text',text:args.text}],details:{starts,calls,results}};
    }});
  pi.registerTool({name:'d4_nested',label:'Nested',description:'Native nested isolated call',
    parameters:{type:'object',properties:{},additionalProperties:false},
    async execute(id,args,signal,update,ctx) {return ctx.executeTool('d4_echo',{text:'nested'});}});
};`;
const receipt: Record<string, unknown> = { admission: false, scope: 'Guest native runner probe; formal path pending' };
try {
  await vm.start();
  receipt.tools = await vm.request({
    kind: 'load',
    extensions: ['extension.mjs'],
    files: [{ path: 'extension.mjs', base64: Buffer.from(extension).toString('base64') }],
  });
  await vm.request({ kind: 'agent_start', turn: 'one' });
  await vm.request({ kind: 'agent_start', turn: 'one' });
  receipt.direct = await vm.request({ kind: 'call', name: 'd4_echo', args: { text: 'direct' } });
  receipt.nested = await vm.request({ kind: 'call', name: 'd4_nested', args: {} });
  receipt.denied = await vm.request({ kind: 'call', name: 'd4_echo', args: { text: 'forbidden' } });
  assert.ok(receipt.direct);
  assert.equal((receipt.direct as { isError: boolean }).isError, false);
  assert.equal((receipt.nested as { isError: boolean }).isError, false);
  assert.equal((receipt.denied as { isError: boolean }).isError, true);
} catch (error) {
  receipt.error = String(error);
  process.exitCode = 1;
} finally {
  await vm.close();
  receipt.events = vm.events;
  await writeFile(resolve('release/d4-vm-evidence/skill-runner.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
}
