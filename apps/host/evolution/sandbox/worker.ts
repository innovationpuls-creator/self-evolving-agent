import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createBashToolDefinition,
  createLocalBashOperations,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import {
  InMemoryCredentialStore,
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model,
  type Api,
  type Provider,
} from '@earendil-works/pi-ai';
import { candidateFiles, permissionProfile, type CandidateExport } from './candidate.js';
import { workerChannel } from './worker-channel.js';
interface Start {
  kind: 'start';
  runId: string;
  goalHash: string;
  mode: 'develop' | 'verify';
  model: Model<Api>;
  prompt?: string;
  candidate?: CandidateExport;
}
const channel = workerChannel<Start>();
async function main() {
  const start = await channel.starting;
  const cwd = process.cwd();
  const agentDir = process.env.AGENT_REFLECTION_AGENT_DIR;
  if (!agentDir || !process.env.AGENT_D4_SANDBOX) throw new Error('d4_native_required');
  const tools = join(cwd, 'tool-bin');
  await mkdir(tools);
  const runtimeRoot = join(dirname(process.argv[1]!), '../../../..');
  const nodeBin = join(runtimeRoot, 'toolchains/bin');
  process.env.PATH = `${nodeBin}:/usr/bin:/bin`;
  if (start.mode === 'verify') {
    const candidate = candidateFiles(start.candidate);
    if (candidate.value.goalHash !== start.goalHash || candidate.value.runId !== start.runId)
      throw new Error('d4_scope');
    for (const file of candidate.files) {
      await mkdir(dirname(join(cwd, file.path)), { recursive: true });
      await writeFile(join(cwd, file.path), file.bytes);
    }
  } else {
    await writeFile('normalize.mjs', 'export const normalize = values => values;\n');
    await writeFile(
      'test.mjs',
      "import assert from 'node:assert/strict'; import {normalize} from './normalize.mjs'; assert.deepEqual(normalize([' b ','a','b']),['a','b']); console.log('PASS');\n",
    );
  }
  const initialTest =
    start.mode === 'develop'
      ? spawnSync(process.execPath, ['test.mjs'], { cwd, encoding: 'utf8', timeout: 30000, maxBuffer: 65536 })
      : undefined;
  if (initialTest && (initialTest.status !== 1 || !initialTest.stderr.includes('AssertionError')))
    throw new Error('d4_initial_test_must_fail');
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    modelsStorePath: join(agentDir, 'models'),
    allowModelNetwork: false,
  });
  const provider: Provider = {
    id: start.model.provider,
    name: 'Host authorized D4 prototype',
    auth: {
      apiKey: {
        name: 'Host',
        async resolve() {
          return { auth: {} };
        },
      },
    },
    getModels() {
      return [start.model];
    },
    stream(m, c, o) {
      return this.streamSimple(m, c, { signal: o?.signal });
    },
    streamSimple(m, context) {
      const stream = createAssistantMessageEventStream();
      void channel
        .request('model', { runId: start.runId, goalHash: start.goalHash, modelId: m.id, context })
        .then((raw) => {
          const message = raw as AssistantMessage;
          if (message.stopReason === 'error' || message.stopReason === 'aborted')
            stream.push({ type: 'error', reason: message.stopReason, error: message });
          else if (message.stopReason !== 'pending') stream.push({ type: 'done', reason: message.stopReason, message });
          stream.end(message);
        })
        .catch(() => {
          channel.finish(false);
        });
      return stream;
    },
  };
  runtime.registerNativeProvider(provider);
  const settings = SettingsManager.inMemory({ compaction: { enabled: false } }, { projectTrusted: false });
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager: settings,
    noExtensions: true,
    noSkills: true,
    noContextFiles: true,
    noPromptTemplates: true,
    noThemes: true,
    additionalExtensionPaths: start.mode === 'verify' ? [join(cwd, 'extensions/normalize.js')] : [],
    systemPrompt:
      'You are developing only the authorized normalize-labels fixture in this isolated workspace. Use native read/write/edit/bash tools. Never access unrelated resources. Run the existing failing test before fixing it. Finish all requested files and tests.',
  });
  await loader.reload();
  if (loader.getExtensions().errors.length) throw new Error('d4_extension_load_failed');
  const local = createLocalBashOperations({ shellPath: '/bin/sh' });
  let outputBytes = 0;
  const bash = createBashToolDefinition(cwd, {
    shellPath: '/bin/sh',
    exposeSessionEnvironment: false,
    operations: {
      async exec(command, directory, options) {
        const controller = new AbortController();
        const result = await local.exec(command, directory, {
          ...options,
          signal: AbortSignal.any([channel.signal, controller.signal, ...(options.signal ? [options.signal] : [])]),
          timeout: Math.min(options.timeout ?? 30, 30),
          onData(data) {
            outputBytes += data.length;
            if (outputBytes > 4 * 1024 * 1024) controller.abort();
            else options.onData(data);
          },
        });
        if (controller.signal.aborted) throw new Error('d4_output_limit');
        return result;
      },
    },
  });
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    model: start.model,
    modelRuntime: runtime,
    resourceLoader: loader,
    settingsManager: settings,
    sessionManager: SessionManager.inMemory(cwd),
    tools: ['read', 'write', 'edit', 'bash', 'normalize_labels'],
    customTools: [bash as unknown as ToolDefinition],
  });
  const events: Array<{ tool: string; args: unknown; isError: boolean; result: unknown }> = [];
  const calls = new Map<string, unknown>();
  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'tool_execution_start') calls.set(event.toolCallId, event.args);
    if (event.type === 'tool_execution_end')
      events.push({
        tool: event.toolName,
        args: calls.get(event.toolCallId),
        isError: event.isError,
        result: event.result,
      });
  });
  try {
    if (start.mode === 'develop') await session.prompt(start.prompt!);
    else await session.prompt('Call normalize_labels with values [" b ","a","b"] and confirm the result.');
    if (start.mode === 'develop') {
      const failure = events.findIndex(
        (e) =>
          e.tool === 'bash' &&
          e.isError &&
          JSON.stringify(e.args).includes('test.mjs') &&
          JSON.stringify(e.result).includes('AssertionError'),
      );
      const repaired = events
        .slice(failure + 1)
        .some(
          (e) =>
            e.tool === 'bash' &&
            !e.isError &&
            JSON.stringify(e.args).includes('test.mjs') &&
            JSON.stringify(e.result).includes('PASS'),
        );
      if (failure < 0 || !repaired) throw new Error('d4_missing_failure_repair_evidence');
    }
    if (start.mode === 'verify') {
      const call = events.find((e) => e.tool === 'normalize_labels' && !e.isError);
      if (!call || !JSON.stringify(call.result).includes('a') || !JSON.stringify(call.result).includes('b'))
        throw new Error('d4_missing_extension_call');
      const result = call.result as { content: Array<{ type: string; text?: string }> };
      if (
        !result.content.some((p) => p.type === 'text' && p.text && JSON.stringify(JSON.parse(p.text)) === '["a","b"]')
      )
        throw new Error('d4_wrong_tool_result');
      if (!(globalThis as typeof globalThis & { __d4HookRan?: boolean }).__d4HookRan)
        throw new Error('d4_hook_missing');
    }
    const test = spawnSync(process.execPath, ['test.mjs'], { cwd, encoding: 'utf8', timeout: 30000, maxBuffer: 65536 });
    if (test.status !== 0) throw new Error('d4_final_test_failed');
    const files: CandidateExport['files'] = [];
    async function collect(dir: string) {
      for (const item of await readdir(join(cwd, dir), { withFileTypes: true })) {
        const path = dir ? `${dir}/${item.name}` : item.name;
        if (['agent', 'tool-bin', 'tmp', 'node_modules'].includes(path)) continue;
        if (item.isDirectory()) await collect(path);
        else if (item.isFile()) files.push({ path, base64: (await readFile(join(cwd, path))).toString('base64') });
        else throw new Error('d4_special_file');
      }
    }
    await collect('');
    await channel.request('evidence', {
      runId: start.runId,
      mode: start.mode,
      events,
      initialTest: initialTest ? { status: initialTest.status, error: initialTest.stderr } : undefined,
      test: { status: test.status, output: test.stdout },
    });
    await channel.request('candidate_export', {
      runId: start.runId,
      goalHash: start.goalHash,
      permissionProfile,
      files,
    });
  } finally {
    unsubscribe();
    session.dispose();
  }
}
void main().then(
  () => channel.finish(true),
  async (error: unknown) => {
    await channel.request('evidence', { error: String(error).slice(0, 500) }).catch(() => {});
    channel.finish(false);
  },
);
