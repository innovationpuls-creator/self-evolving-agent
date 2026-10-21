import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createJiti } from 'jiti';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager }
  from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';

// Only data leaves this Guest. Neither this worker nor ExtensionContext has a
// reference to the product Host's session, provider registry or credentials.
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
const ownTools = new Set();
const declarations = [];
const turns = new Set();
let session;
let fatal;
const deny = (name) => { throw new Error('isolated_api_unsupported:' + name); };
const restricted = (context) => new Proxy(Object.freeze({
  cwd: '/tmp/skill', hasUI: false,
  executeTool: (name, args, options) => {
    if (!ownTools.has(name)) deny('executeTool:' + name);
    return context.executeTool(name, args, options);
  },
}), { get(target, name) { if (!(name in target)) deny(String(name)); return target[name]; } });

async function load(request) {
  if (session) throw new Error('duplicate_load');
  let total = 0;
  for (const file of request.files) {
    if (!/^[a-zA-Z0-9_.\/-]+$/.test(file.path) || file.path.split('/').some((p) => !p || p === '.' || p === '..')
      || file.path.startsWith('/')) throw new Error('invalid_file');
    const bytes = Buffer.from(file.base64, 'base64');
    total += bytes.length;
    if (total > 4 * 1024 * 1024) throw new Error('input_limit');
    const path = resolve('/tmp/skill', file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes, { flag: 'wx' });
  }
  const settings = SettingsManager.inMemory({}, { projectTrusted: false });
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  const factories = request.extensions.map((path) => async (pi) => {
    const factory = await jiti.import(resolve('/tmp/skill', path), { default: true });
    await factory(new Proxy({}, { get(_target, key) {
      if (key === 'registerTool') return (tool) => {
        const allowed = ['name', 'label', 'description', 'parameters', 'execute', 'exposure', 'defaultActive',
          'promptSnippet', 'promptGuidelines', 'outputSchema', 'executionMode', 'annotations'];
        for (const k of Object.keys(tool)) if (!allowed.includes(k)) deny('tool.' + k);
        if (!/^d4_[a-z0-9_]{1,60}$/.test(tool.name) || ownTools.has(tool.name)) deny('tool.name');
        ownTools.add(tool.name);
        const { execute, ...declaration } = tool;
        declarations.push(declaration);
        pi.registerTool({ ...tool, execute: (id, args, signal, update, ctx) =>
          execute(id, args, signal, update, restricted(ctx)) });
      };
      if (key === 'on') return (event, handler) => {
        if (!['agent_start', 'tool_call', 'tool_result'].includes(event)) deny('hook.' + event);
        pi.on(event, async (value, ctx) => {
          if (event !== 'agent_start' && !ownTools.has(value.toolName)) return;
          try { return await handler(value, restricted(ctx)); }
          catch (error) { fatal = error; throw error; }
        });
      };
      return deny('pi.' + String(key));
    } }));
  });
  const loader = new DefaultResourceLoader({ cwd: '/tmp/skill', agentDir: '/tmp/pi', settingsManager: settings,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    noContextFiles: true, extensionFactories: factories });
  await loader.reload();
  if (loader.getExtensions().errors.length) throw new Error('isolated_extension_initialization_failed');
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null,
    refreshOnCreate: false, allowModelNetwork: false });
  session = (await createAgentSession({ cwd: '/tmp/skill', agentDir: '/tmp/pi', noTools: 'builtin',
    modelRuntime: runtime, resourceLoader: loader, settingsManager: settings,
    sessionManager: SessionManager.inMemory('/tmp/skill') })).session;
  await session.bindExtensions({ onError: (error) => { fatal = error; } });
  session.setActiveToolsByName([...ownTools]);
  if (fatal) throw fatal;
  return declarations;
}

for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let request;
  try {
    if (Buffer.byteLength(line) > 65536) throw new Error('request_limit');
    request = JSON.parse(line);
    let value;
    if (request.kind === 'load') value = await load(request);
    else if (request.kind === 'agent_start') {
      if (!turns.has(request.turn)) {
        turns.add(request.turn);
        await session.extensionRunner.emit({ type: 'agent_start' });
      }
    } else if (request.kind === 'call') {
      if (!ownTools.has(request.name)) deny('tool:' + request.name);
      // Project only this authorized Host call. Pi requires an issuing assistant
      // message for its native nested pipeline; no Host transcript is transferred.
      session.agent.state.messages = [{role:'assistant',api:'openai-completions',provider:'d4-projection',
        model:'delegated-call',content:[{type:'toolCall',id:request.id,name:request.name,arguments:request.args}],
        stopReason:'toolUse',timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,
          cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}];
      value = await session.extensionRunner.createToolContext(request.id, undefined)
        .executeTool(request.name, request.args);
    } else throw new Error('invalid_request');
    if (fatal) throw fatal;
    send({ id: request.id, value });
  } catch (error) {
    send({ id: request?.id, error: String(error?.message ?? error) });
  }
}
