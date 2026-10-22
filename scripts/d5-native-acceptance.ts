import assert from 'node:assert/strict';
import { type ExecFileOptionsWithStringEncoding, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readStoredCredential, SessionManager } from '@earendil-works/pi-coding-agent';

const run = (file: string, args: string[], options: Omit<ExecFileOptionsWithStringEncoding, 'encoding'>) =>
  new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = execFile(file, args, { ...options, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
    child.stdin?.end();
  });
const root = await mkdtemp(join(tmpdir(), 'd5-native-pi-'));
const output = resolve('release/d5-evidence');
await mkdir(output, { recursive: true });
const config = join(root, 'agent'),
  project = join(root, 'project'),
  sessions = join(root, 'sessions');
const provider = 'openai-codex',
  model = process.env.AGENT_SMOKE_MODEL ?? 'gpt-6-luna';
const env = { ...process.env, PI_CODING_AGENT_DIR: config, PI_OFFLINE: '1' };
const cli = resolve('node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
const receipt: Record<string, unknown> = {
  time: new Date().toISOString(),
  node: process.version,
  pi: '1.3.0',
  provider,
  model,
  passed: false,
};
try {
  await mkdir(config, { mode: 0o700 });
  await mkdir(project);
  await mkdir(sessions, { mode: 0o700 });
  const credential = readStoredCredential(provider);
  assert.ok(credential, 'real native Provider credential required');
  await writeFile(join(config, 'auth.json'), JSON.stringify({ [provider]: credential }), { mode: 0o600 });
  const pack = await run('npm', ['pack', resolve('packages/pi-diagnostics'), '--pack-destination', root, '--json'], {
    env,
  });
  const filename = (JSON.parse(pack.stdout) as Array<{ filename: string }>)[0]?.filename;
  assert.ok(filename);
  receipt.packageSha256 = createHash('sha256')
    .update(await readFile(join(root, filename)))
    .digest('hex');
  await run('tar', ['-xzf', join(root, filename), '-C', root], { env });
  const installed = join(root, 'package');
  await run(process.execPath, [cli, 'install', installed], { env, cwd: project, timeout: 60000 });
  const listed = await run(process.execPath, [cli, 'list'], { env, cwd: project, timeout: 60000 });
  assert.ok(listed.stdout.includes(installed), 'actual native Pi package install/list');
  const marker = randomUUID(),
    syntheticSecret = 'sk-d5-native-synthetic-do-not-disclose-123456';
  await writeFile(join(project, 'source.txt'), `receipt=${marker}\napi_key=${syntheticSecret}\n`);
  const sourceId = randomUUID(),
    inquiryId = randomUUID();
  const args = [
    '--offline',
    '--no-approve',
    '--no-context-files',
    '--no-skills',
    '--no-prompt-templates',
    '--no-mcp',
    '--provider',
    provider,
    '--model',
    model,
    '--thinking',
    'low',
    '--mode',
    'json',
    '--session-dir',
    sessions,
  ];
  console.log('Native package installed; running source Session.');
  const source = await run(
    process.execPath,
    [
      cli,
      ...args,
      '--session-id',
      sourceId,
      '--tools',
      'read',
      '-p',
      'Read source.txt using the native read tool once, then report only the receipt UUID. Do not disclose the api_key.',
    ],
    { env, cwd: project, timeout: 240000, maxBuffer: 8 * 1024 * 1024 },
  );
  assert.ok(source.stdout.includes('tool_execution_end'), 'native source Tool must execute');
  const sourcePath = (await readdir(sessions)).find((f) => f.includes(sourceId));
  assert.ok(sourcePath);
  const sourceManager = SessionManager.open(join(sessions, sourcePath));
  const diagnosticEntries = sourceManager
    .getEntries()
    .filter((e) => e.type === 'custom' && e.customType === 'diagnostic_native_v1');
  assert.ok(diagnosticEntries.length >= 4, 'native Extension must collect metadata');
  assert.ok(
    !JSON.stringify(diagnosticEntries).includes(marker) && !JSON.stringify(diagnosticEntries).includes(syntheticSecret),
    'no duplicate transcript in diagnostic Entries',
  );
  console.log('Native source Session saved; querying its evidence from another native Session.');
  const inquiry = await run(
    process.execPath,
    [
      cli,
      ...args,
      '--session-id',
      inquiryId,
      '--tools',
      'diagnostic_*',
      '-p',
      `Recover the exact receipt UUID from the historical read result in earlier native Session ${sourceId}. You cannot access files. Use the available execution diagnostics and precise historical evidence as needed. Report the UUID only; never report credentials. Do not guess it.`,
    ],
    { env, cwd: project, timeout: 240000, maxBuffer: 8 * 1024 * 1024 },
  );
  const inquiryPath = (await readdir(sessions)).find((f) => f.includes(inquiryId));
  assert.ok(inquiryPath);
  const inquiryManager = SessionManager.open(join(sessions, inquiryPath));
  const results = inquiryManager
    .getEntries()
    .flatMap((e) => (e.type === 'message' && e.message.role === 'toolResult' ? [e.message] : []));
  const toolNames = results.map((m) => m.toolName);
  assert.ok(
    toolNames.includes('diagnostic_search') &&
      toolNames.includes('diagnostic_get') &&
      toolNames.includes('diagnostic_evidence'),
    'actual autonomous native Tool Calling across Sessions',
  );
  assert.ok(
    results.every((r) => !r.isError),
    'native diagnostic Tool failures',
  );
  const evidence = JSON.stringify(results.filter((m) => m.toolName === 'diagnostic_evidence'));
  assert.ok(evidence.includes(marker), 'original raw result reference must recover marker');
  assert.ok(!evidence.includes(syntheticSecret), 'evidence must protect synthetic credential before model');
  const messages = inquiryManager.getEntries().filter((e) => e.type === 'message' && e.message.role === 'assistant');
  assert.ok(
    JSON.stringify(messages.at(-1)).includes(marker),
    'model must actually use cross-session historical evidence',
  );
  assert.ok(!inquiry.stdout.includes(syntheticSecret), 'CLI inquiry stream must not disclose credential');
  Object.assign(receipt, {
    passed: true,
    installed: true,
    standaloneTarball: filename,
    sourceId,
    inquiryId,
    sourceMetadataEntries: diagnosticEntries.length,
    nativeToolCalls: toolNames,
    protectedEvidence: true,
    originalMarkerRecovered: true,
  });
  await writeFile(join(output, 'native-pi.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt));
} catch (error) {
  // CLI buffers may contain credentials; never serialize child-process errors or raw stdout/stderr.
  await writeFile(join(output, 'native-pi.json'), `${JSON.stringify({ ...receipt, failed: true }, null, 2)}\n`);
  throw new Error(
    error instanceof assert.AssertionError
      ? error.message
      : 'Native Pi acceptance failed; inspect isolated output locally without exporting credentials',
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
