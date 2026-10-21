// Deterministic adversarial fixture. The production Worker does not import this module.
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, symlink, open, rm } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { connect } from 'node:net';
import { createSocket } from 'node:dgram';
import { lookup } from 'node:dns/promises';
import {
  DefaultResourceLoader,
  SettingsManager,
  createAgentSession,
  SessionManager,
  ModelRuntime,
} from '@earendil-works/pi-coding-agent';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { fauxAssistantMessage, fauxToolCall, InMemoryCredentialStore } from '@earendil-works/pi-ai';
export interface ProbeInput {
  paths: string[];
  ipv4: number;
  ipv6: number;
  udp: number;
  unix: string;
  external: string;
  python: string[];
  tarball: string;
  lifecycle: string;
  wheel: string;
}
const code = (e: unknown) => (e as NodeJS.ErrnoException).code ?? String(e);
export async function attempt(path: string) {
  let read: string, write: string;
  try {
    await readFile(path);
    read = 'ALLOWED';
  } catch (e) {
    read = code(e);
  }
  try {
    const fd = await open(path, 'r+');
    await fd.write('PROBE');
    await fd.close();
    write = 'ALLOWED';
  } catch (e) {
    write = code(e);
  }
  return { path, read, write };
}
function exec(command: string, args: string[], env = process.env, timeout = 15000) {
  const r = spawnSync(command, args, { encoding: 'utf8', timeout, maxBuffer: 256 * 1024, env });
  return {
    status: r.status,
    signal: r.signal,
    stdout: r.stdout ?? '',
    stderr: (r.stderr ?? '').slice(0, 2000),
    error: r.error ? code(r.error) : undefined,
  };
}
export async function runProbes(input: ProbeInput) {
  const cwd = process.cwd(),
    runtime = join(dirname(process.argv[1]!), '../../../..');
  const env = { ...process.env, PATH: `${join(runtime, 'toolchains/bin')}:/usr/bin:/bin` };
  const native = join(runtime, '../../MacOS');
  await writeFile('allowed.txt', 'workspace');
  const direct = await Promise.all(input.paths.map(attempt));
  const sibling = join(dirname(cwd), `d4-sibling-${process.pid}`);
  await mkdir(sibling);
  await writeFile(join(sibling, 'canary'), 'sibling');
  const siblingAccess = await attempt(join(sibling, 'canary'));
  const traversal = await attempt(relative(cwd, input.paths[0]!));
  const relativeEscape = await attempt(`../${sibling.split('/').pop()}/canary`);
  await symlink(input.paths[0]!, 'escape-link');
  const link = await attempt(join(cwd, 'escape-link'));
  const directoryFD = await open(cwd, 'r');
  const fdPath = await attempt(`/dev/fd/${directoryFD.fd}/../${sibling.split('/').pop()}/canary`);
  await directoryFD.close();
  const fdInheritance = exec(process.execPath, [
    '-e',
    "let r=[];for(let i=3;i<32;i++){try{const s=require('node:fs').fstatSync(i);r.push({fd:i,ino:s.ino,dev:s.dev})}catch{}}console.log(JSON.stringify(r))",
  ]);
  const childCode = `const fs=require('node:fs');console.log(JSON.stringify(${JSON.stringify(input.paths)}.map(p=>{let r,w;try{fs.readFileSync(p);r='ALLOWED'}catch(e){r=e.code}try{const f=fs.openSync(p,'r+');fs.writeSync(f,'PROBE');fs.closeSync(f);w='ALLOWED'}catch(e){w=e.code}return {path:p,read:r,write:w}})))`;
  await writeFile('child.cjs', childCode);
  const node = exec(process.execPath, ['child.cjs']);
  await writeFile('shell-probe.sh', 'printf shell-ok > shell-allowed.txt\n"$NODE" child.cjs & wait\n');
  const shell = exec('/bin/sh', ['shell-probe.sh'], { ...env, NODE: process.execPath });
  const externalCommand = exec('/bin/cat', [input.paths[0]!]);
  await writeFile(
    'dynamic.mjs',
    `import{readFileSync}from'node:fs';export default ()=>{try{readFileSync(${JSON.stringify(input.paths[0])});return 'ALLOWED'}catch(e){return e.code}}`,
  );
  const dynamic = ((await import(join(cwd, 'dynamic.mjs'))) as { default: () => string }).default();
  await writeFile(
    'typed.ts',
    `import {readFileSync} from 'node:fs';const values:number[]=[1,2,3];if(values.reduce((a,b)=>a+b,0)!==6)throw Error('bad');let denied:string;try{readFileSync(${JSON.stringify(input.paths[0])});denied='ALLOWED'}catch(e){denied=(e as NodeJS.ErrnoException).code!}console.log(JSON.stringify({marker:'TS_PASS',denied,allowed:readFileSync('allowed.txt','utf8')}));`,
  );
  const typescript = exec(process.execPath, ['typed.ts']);
  const socketProbe = (host: string, port?: number) =>
    new Promise<string>((resolve) => {
      const socket = port ? connect(port, host) : connect(host);
      const done = (result: string) => {
        socket.destroy();
        resolve(result);
      };
      socket.on('connect', () => done('ALLOWED'));
      socket.on('error', (e) => done(code(e)));
      socket.setTimeout(1500, () => done('TIMEOUT'));
    });
  const udp = await new Promise<string>((resolve) => {
    const s = createSocket('udp4');
    const timer = setTimeout(() => {
      s.close();
      resolve('TIMEOUT');
    }, 1500);
    s.on('error', (e) => {
      clearTimeout(timer);
      s.close();
      resolve(code(e));
    });
    s.send('probe', input.udp, '127.0.0.1', (e) => {
      clearTimeout(timer);
      s.close();
      resolve(e ? code(e) : 'ALLOWED');
    });
  });
  const network = {
    ipv4: await socketProbe('127.0.0.1', input.ipv4),
    ipv6: await socketProbe('::1', input.ipv6),
    unix: await socketProbe(input.unix),
    external: await socketProbe(input.external, 443),
    udp,
    dns: await lookup('example.com').then((r) => r.address, code),
  };
  const python = [];
  for (const interpreter of input.python) {
    const source = `import os,json,subprocess,sys\nr=[]\nfor p in ${JSON.stringify(input.paths)}:\n v={'path':p}\n for key,mode in [('read','rb'),('write','r+b')]:\n  try:\n   with open(p,mode) as f:\n    if key=='write': f.write(b'PROBE')\n    else: f.read()\n   v[key]='ALLOWED'\n  except OSError as e: v[key]=e.errno\n r.append(v)\nprint(json.dumps({'files':r,'version':sys.version,'executable':sys.executable,'prefix':sys.base_prefix,'child':subprocess.run([sys.executable,'-I','-c','print(42)'],capture_output=True,text=True).stdout}))`;
    const probe = exec(interpreter, ['-I', '-c', source]);
    const subprocessProbe = exec(interpreter, [
      '-I',
      '-c',
      `import subprocess,sys; subprocess.run([sys.executable,'-I','-c',${JSON.stringify(source)}],check=True)`,
    ]);
    python.push({ interpreter, probe, subprocess: subprocessProbe });
  }
  const npm = join(runtime, 'toolchains/npm/bin/npm-cli.js');
  await mkdir('deps');
  await writeFile('deps/package.json', '{"name":"d4-deps","version":"1.0.0"}');
  for (const [name, data] of [
    ['zod.tgz', input.tarball],
    ['lifecycle.tgz', input.lifecycle],
    ['d4_fixture-1.0-py3-none-any.whl', input.wheel],
  ])
    await writeFile(name!, Buffer.from(data!, 'base64'));
  await writeFile('user.conf', '');
  await writeFile('global.conf', '');
  const npmArgs = [
    '--offline',
    '--no-audit',
    '--no-fund',
    `--cache=${join(cwd, 'cache')}`,
    `--prefix=${join(cwd, 'deps')}`,
    `--userconfig=${join(cwd, 'user.conf')}`,
    `--globalconfig=${join(cwd, 'global.conf')}`,
    '--script-shell=/bin/sh',
  ];
  await writeFile('deps/.npmrc', 'script-shell=/nonexistent-malicious-shell\nregistry=http://127.0.0.1:1\n');
  const install = exec(
    process.execPath,
    [npm, 'install', ...npmArgs, '--ignore-scripts', join(cwd, 'zod.tgz'), join(cwd, 'lifecycle.tgz')],
    env,
    30000,
  );
  const lifecycleBefore = await readFile('deps/node_modules/d4-lifecycle/lifecycle.json', 'utf8').catch(() => 'ABSENT');
  const lifecycle = exec(
    process.execPath,
    [npm, 'rebuild', ...npmArgs, '--ignore-scripts=false'],
    { ...env, D4_CANARY: input.paths[0]! },
    30000,
  );
  const lifecycleEvidence = await readFile('deps/node_modules/d4-lifecycle/lifecycle.json', 'utf8').catch(
    () => 'ABSENT',
  );
  const missing = exec(
    process.execPath,
    ['-e', "try{require('./deps/node_modules/nonexistent-d4')}catch(e){console.log(e.code)}"],
    env,
  );
  const zod = exec(
    process.execPath,
    ['-e', "const z=require('./deps/node_modules/zod');console.log(z.string().parse('zod-ok'))"],
    env,
  );
  await mkdir(join(dirname(cwd), 'node_modules/.bin'), { recursive: true });
  const pollution = join(dirname(cwd), 'node_modules/.bin/d4-ancestor');
  await writeFile(pollution, '#!/bin/sh\nprintf ancestor-executed\n', { mode: 0o700 });
  const ancestor = exec(
    '/bin/sh',
    ['-c', `PATH=${JSON.stringify(join(dirname(cwd), 'node_modules/.bin'))}:$PATH d4-ancestor`],
    env,
  );
  await rm(pollution, { force: true });
  // Actual Pi extension top-level, hook, Tool and nested Tool paths in the same sandbox.
  await mkdir('extensions');
  const extSource = `import{readFileSync}from'node:fs';import{Type}from'typebox';function probe(){try{readFileSync(${JSON.stringify(input.paths[0])});return 'ALLOWED'}catch(e){return e.code}}globalThis.__d4top=probe();export default pi=>{pi.on('agent_start',()=>{globalThis.__d4hook=probe()});pi.registerTool({name:'probe',label:'probe',description:'probe',parameters:Type.Object({}),async execute(){return{content:[{type:'text',text:probe()}]}}});pi.registerTool({name:'nested',label:'nested',description:'nested',parameters:Type.Object({}),async execute(_i,_p,_s,_u,ctx){return(await ctx.executeTool('probe',{})).result}})}`;
  await writeFile('extensions/probe.js', extSource);
  const fake = fauxProvider({
    models: [{ id: 'probe', contextWindow: 10000, maxTokens: 128 }],
    tokensPerSecond: 100000,
  });
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    modelsStorePath: join(cwd, 'agent/models'),
    allowModelNetwork: false,
  });
  modelRuntime.registerNativeProvider(fake.provider);
  const settings = SettingsManager.inMemory({}, { projectTrusted: false });
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: join(cwd, 'agent'),
    settingsManager: settings,
    noExtensions: true,
    noSkills: true,
    noContextFiles: true,
    noPromptTemplates: true,
    noThemes: true,
    additionalExtensionPaths: [join(cwd, 'extensions/probe.js')],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir: join(cwd, 'agent'),
    modelRuntime,
    model: fake.provider.getModels()[0],
    settingsManager: settings,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
    tools: ['probe', 'nested'],
  });
  const extensionEvents: unknown[] = [];
  session.subscribe((e) => {
    if (e.type === 'tool_execution_end') extensionEvents.push(e.result);
  });
  fake.setResponses([
    fauxAssistantMessage(fauxToolCall('nested', {}), { stopReason: 'toolUse' }),
    fauxAssistantMessage('done'),
  ]);
  await session.prompt('probe');
  session.dispose();
  const globals = globalThis as typeof globalThis & { __d4top?: string; __d4hook?: string };
  const limits = {
    report: exec(join(native, 'D4LimitProbe'), ['--report'], env),
    defaultReport: exec(join(native, 'D4Launcher'), ['--report'], env),
    cpu: exec(join(native, 'D4LimitProbe'), [process.execPath, '-e', 'while(true){}'], env, 8000),
    file: exec(
      join(native, 'D4LimitProbe'),
      [process.execPath, '-e', "require('node:fs').writeFileSync('large.bin',Buffer.alloc(256*1024))"],
      env,
    ),
    fd: exec(
      join(native, 'D4LimitProbe'),
      [
        process.execPath,
        '-e',
        "const fs=require('node:fs');try{for(let i=0;i<100;i++)fs.openSync('/dev/null','r')}catch(e){console.log(e.code)}",
      ],
      env,
    ),
  };
  const pip = [];
  for (const interpreter of input.python)
    pip.push({
      interpreter,
      result: exec(
        interpreter,
        [
          '-I',
          '-m',
          'pip',
          'install',
          '--no-index',
          '--no-deps',
          '--target',
          join(cwd, 'wheel-target'),
          join(cwd, 'd4_fixture-1.0-py3-none-any.whl'),
        ],
        env,
      ),
    });
  await rm(sibling, { recursive: true, force: true });
  const detached = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], {
    detached: true,
    stdio: 'ignore',
    env,
  });
  detached.unref();
  return {
    cwd,
    allowed: await readFile('allowed.txt', 'utf8'),
    shellAllowed: await readFile('shell-allowed.txt', 'utf8'),
    direct,
    siblingAccess,
    relativeEscape,
    traversal,
    link,
    fdPath,
    fdInheritance,
    openat: {
      allowed: exec(join(native, 'D4FDProbe'), ['allowed.txt'], env),
      denied: exec(join(native, 'D4FDProbe'), [relative(cwd, input.paths[0]!)], env),
    },
    node,
    shell,
    externalCommand,
    dynamic,
    typescript,
    network,
    python,
    dependencies: { install, lifecycleBefore, lifecycle, lifecycleEvidence, zod, missing, ancestor },
    extension: {
      top: globals.__d4top,
      hook: globals.__d4hook,
      events: extensionEvents,
      errors: loader.getExtensions().errors.length,
    },
    limits,
    pip,
    detachedPID: detached.pid,
    envKeys: Object.keys(process.env).sort(),
    runtimeRead: await readFile(join(runtime, 'package.json'), 'utf8'),
    runtimeWrite: await attempt(join(runtime, 'package.json')),
  };
}
