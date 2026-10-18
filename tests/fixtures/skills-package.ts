import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export const bindings = [
  { skill: 'skills/echo/SKILL.md', extensions: ['extensions/echo.js'], knowledgeFiles: ['skills/echo/notes.md'] },
  { skill: 'skills/other/SKILL.md', extensions: ['extensions/other.js'] },
];
export function echoCode(version = 'one') {
  return `import {Type} from 'typebox';
export default function(pi){
 const evidence=globalThis.__skillEvidence;
 if(evidence)evidence.loads++;
 pi.on('agent_start',()=>{if(evidence)evidence.hooks++;});
 pi.registerTool({name:'skill_echo',label:'Skill echo',description:'D2 echo capability: return the input with version ${version}.',parameters:Type.Object({value:Type.String()}),exposure:'deferred',async execute(_id,p){
 if(evidence){evidence.calls.push('${version}:'+p.value);if(evidence.gate){const gate=evidence.gate;evidence.gate=undefined;evidence.started?.();await gate;}}
 return {content:[{type:'text',text:'${version}:'+p.value}],details:{version:'${version}',value:p.value}};
 }});
}`;
}
export async function skillPackage(root: string) {
  for (const dir of ['extensions', 'skills/echo', 'skills/other']) await mkdir(join(root, dir), { recursive: true });
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'd2-reviewed-example',
      version: '1.0.0',
      private: true,
      pi: { skills: ['skills'], extensions: ['extensions/echo.js', 'extensions/other.js'] },
    }),
  );
  await writeFile(
    join(root, 'skills/echo/SKILL.md'),
    '---\nname: echo\ndescription: Use the D2 echo capability when asked to echo a value with its capability version.\n---\n# Echo\nUse tool_search to discover skill_echo, then call it with value. Read notes.md for current practice knowledge.\n',
  );
  await writeFile(join(root, 'skills/echo/notes.md'), 'Initial practice note.');
  await writeFile(
    join(root, 'skills/other/SKILL.md'),
    '---\nname: other\ndescription: Independent D2 helper capability.\n---\nUse skill_other or skill_gateway.',
  );
  await writeFile(join(root, 'extensions/echo.js'), echoCode());
  await writeFile(
    join(root, 'extensions/other.js'),
    `import {Type} from 'typebox';
import {createCodemodeExtension} from '@earendil-works/pi-coding-agent';
export default async function(pi){
 await createCodemodeExtension({mode:'on'})(pi);
 pi.registerTool({name:'skill_other',label:'Other',description:'Independent sibling capability.',parameters:Type.Object({}),async execute(){return {content:[{type:'text',text:'other-ok'}]};}});
 pi.registerTool({name:'skill_gateway',label:'Gateway',description:'Invoke the echo tool through native nested execution.',parameters:Type.Object({value:Type.String()}),async execute(_id,p,_s,_u,ctx){const out=await ctx.executeTool('skill_echo',p);return {content:out.result.content,details:{nestedError:out.isError}};}});
}`,
  );
  return root;
}
