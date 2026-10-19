import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { _electron, chromium, type ElectronApplication, type Page } from 'playwright-core';
import type { DiagnosticCall, DiagnosticEvent, DiagnosticTrace, DiagnosticTurn } from '../apps/host/diagnostics.js';
import type { MemoryView } from '../apps/host/memory.js';
import type { SkillOperation, SkillRecord, SkillVersion } from '../apps/host/skills.js';

interface Message {
  role: string;
  toolName?: string;
  isError?: boolean;
  stopReason?: string;
  content: unknown;
}
interface State {
  id: string;
  busy: boolean;
  error?: string;
  leafId: string;
  messages: Message[];
  tree: Array<{ entry: { id: string; type: string; customType?: string }; children: State['tree'] }>;
}
interface Catalog {
  items: DiagnosticTrace[];
  total: number;
  health: { available: boolean; dropped: number };
  sessionEvents?: DiagnosticEvent[];
}
interface Detail {
  trace: DiagnosticTrace;
  calls: DiagnosticCall[];
  turns: DiagnosticTurn[];
  events: DiagnosticEvent[];
  sameToolOccurrences: Array<{ name: string; count: number }>;
  totals: { calls: number; turns: number; events: number };
}
interface Evidence {
  available: boolean;
  content?: string;
  total: number;
  nextOffset?: number;
  truncated: boolean;
}
const root = await mkdtemp(join(tmpdir(), 'd2-diagnostic-ui-'));
const executable = process.env.AGENT_APP_PATH ?? resolve('release/Agent-darwin-arm64/Agent.app/Contents/MacOS/Agent');
const model = { provider: 'openai-codex', model: 'gpt-6-luna' };
const associationsOnly = process.argv.includes('--associations-only');
let desktop: ElectronApplication | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const launch = () =>
  _electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${join(root, 'profile')}`],
    env: { ...process.env, AGENT_DESKTOP_DATA_DIR: join(root, 'data') },
    timeout: 30000,
  });
const call = <T>(page: Page, path: string, method = 'GET', body?: unknown) =>
  page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(`/api${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem('agent-connection-token')}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${value.error}`);
      return value;
    },
    { path, method, body },
  ) as Promise<T>;
async function prompt(page: Page, id: string, text: string) {
  await call(page, `/sessions/${id}/prompt`, 'POST', { text });
  const deadline = Date.now() + 300000;
  let state: State;
  do {
    await page.waitForTimeout(350);
    state = await call<State>(page, `/sessions/${id}`);
  } while (state.busy && Date.now() < deadline);
  assert.equal(state.busy, false, 'model task timed out');
  assert.equal(state.error, undefined, 'model task failed');
  assert.ok(!state.messages.some((message) => message.role === 'assistant' && message.stopReason === 'error'));
  return state;
}
function toolPayloads(state: State, name: string): unknown[] {
  return state.messages
    .filter((message) => message.toolName === name)
    .map((message) => {
      assert.notEqual(message.isError, true, `${name} returned an error`);
      assert.ok(Array.isArray(message.content));
      const text = message.content
        .flatMap((part: unknown) => {
          if (part && typeof part === 'object' && 'type' in part && part.type === 'text' && 'text' in part) {
            return typeof part.text === 'string' ? [part.text] : [];
          }
          return [];
        })
        .join('\n');
      return JSON.parse(text) as unknown;
    });
}
async function skillOperation(page: Page, operation: SkillOperation) {
  const deadline = Date.now() + 120000;
  while (operation.status === 'checking' || operation.status === 'waiting') {
    assert.ok(Date.now() < deadline, 'Skill operation timed out');
    await page.waitForTimeout(200);
    operation = await call<SkillOperation>(page, `/skills/operations/${operation.id}`);
  }
  assert.equal(operation.status, 'applied', 'plain Skill operation must apply');
}
async function verifyAssociations(page: Page) {
  const skillName = 'diagnostic-association';
  const source = join(root, '.agents/skills', skillName);
  const marker = randomUUID();
  await mkdir(source, { recursive: true });
  await writeFile(join(root, 'association-marker.txt'), marker);
  await writeFile(
    join(source, 'SKILL.md'),
    '---\nname: diagnostic-association\ndescription: Use this Skill to record diagnostic association evidence.\n---\nRead association-marker.txt. Save a project experience titled diagnostic-association-note with the exact file marker in its content using memory_save. Read back that saved item using memory_get. Do not use bash or change files.\n',
  );
  await skillOperation(page, await call<SkillOperation>(page, '/skills', 'POST', { source, project: root }));
  const catalog = await call<{ skills: SkillRecord[] }>(page, `/skills?project=${encodeURIComponent(root)}`);
  const skill = catalog.skills.find((item) => item.name === skillName);
  assert.ok(skill);
  const skillDetail = await call<{ versions: SkillVersion[] }>(page, `/skills/${skill.id}`);
  const version = skillDetail.versions.find((item) => item.id === skill.latest);
  assert.ok(version);
  await skillOperation(
    page,
    await call<SkillOperation>(page, `/skills/${skill.id}/publish`, 'POST', {
      version: version.id,
      baseRevision: skill.revision,
    }),
  );
  const skillPath = join(root, 'data/skills/versions', version.snapshot, version.packageRoot, version.skillFile);
  const session = await call<State>(page, '/sessions', 'POST', { cwd: root, ...model });
  const state = await prompt(
    page,
    session.id,
    `Use the enabled diagnostic-association Skill. First read its exact loaded SKILL.md at ${skillPath} with read, then follow its instructions. Save exactly one project experience and use memory_get on its returned id.`,
  );
  const saved = toolPayloads(state, 'memory_save') as MemoryView[];
  assert.equal(saved.length, 1, 'real task must save exactly one Memory item');
  const memory = saved[0];
  assert.ok(memory);
  assert.equal(memory.title, 'diagnostic-association-note');
  assert.ok(memory.content.includes(marker));
  assert.ok(memory.sources.some((item) => item.sessionId === session.id && item.entryId));
  const readBack = toolPayloads(state, 'memory_get');
  assert.ok(JSON.stringify(readBack).includes(memory.id));
  const traces = await call<Catalog>(page, `/diagnostics?sessionId=${session.id}`);
  assert.equal(traces.total, 1);
  const trace = traces.items[0];
  assert.ok(trace);
  const detail = await call<Detail>(page, `/diagnostics/${trace.id}`);
  const observed = detail.calls.find((item) => item.toolName === 'read' && item.data.skillRead);
  if (!observed) {
    const requestedPaths = state.messages.flatMap((message) =>
      message.role === 'assistant' && Array.isArray(message.content)
        ? message.content.flatMap((part: unknown) => {
            if (!part || typeof part !== 'object') return [];
            const tool = part as { type?: string; name?: string; arguments?: { path?: unknown } };
            return tool.type === 'toolCall' && tool.name === 'read' && typeof tool.arguments?.path === 'string'
              ? [tool.arguments.path]
              : [];
          })
        : [],
    );
    console.log(
      JSON.stringify({
        skillAssociationPathCheck: {
          requestedPaths,
          expectedPath: skillPath,
          canonicalPath: await realpath(skillPath),
          resources: detail.events.filter((item) => item.kind === 'resources_loaded').map((item) => item.data),
          readMetadata: detail.calls.filter((item) => item.toolName === 'read').map((item) => item.data),
        },
      }),
    );
  }
  assert.deepEqual(observed?.data.skillRead, {
    skillId: skill.id,
    version: version.id,
    digest: version.digest,
    observation: 'observed_read',
  });
  const expectedReference = {
    id: memory.id,
    revision: memory.revision,
    sources: memory.sources.map(({ sessionId, entryId }) => ({ sessionId, entryId })),
  };
  for (const name of ['memory_save', 'memory_get']) {
    const memoryCall = detail.calls.find((item) => item.toolName === name);
    assert.deepEqual(memoryCall?.data.memory, { references: [expectedReference], complete: true });
  }
  const memorySource = memory.sources.find((item) => item.sessionId === session.id);
  assert.ok(memorySource);
  const evidence = await call<Evidence>(
    page,
    `/diagnostics/evidence?sessionId=${memorySource.sessionId}&entryId=${memorySource.entryId}`,
  );
  assert.equal(evidence.available, true);
  assert.ok(evidence.content?.includes('memory_save'));
  assert.ok(!JSON.stringify(detail).includes(marker), 'diagnostic metadata must not duplicate Memory content');
  await page.locator('nav button').first().click();
  await page.getByRole('button', { name: '记忆管理', exact: true }).click();
  await page.locator('.memory-item').filter({ hasText: memory.title }).click();
  await page.locator('.memory-detail summary').click();
  await page.getByRole('button', { name: '查看执行证据', exact: true }).click();
  await page.locator('.diagnostics-evidence pre').filter({ hasText: 'memory_save' }).waitFor();
  assert.ok((await page.locator('.diagnostics-evidence').innerText()).includes(memorySource.entryId));
  await mkdir(resolve('release/d2-diagnostic-evidence'), { recursive: true });
  await page.screenshot({ path: resolve('release/d2-diagnostic-evidence/diagnostic-memory-source.png') });
  receipt.associations = {
    at: new Date().toISOString(),
    sessionId: session.id,
    traceId: trace.id,
    usage: detail.turns.map(({ ordinal, model, provider, usage }) => ({ ordinal, model, provider, usage })),
    skill: { id: skill.id, version: version.id, digest: version.digest, observedRead: true },
    memory: {
      ...expectedReference,
      actualSaveAndGetResults: true,
      sourceEvidenceAvailable: true,
      desktopMemorySourceEvidence: true,
    },
  };
  console.log('Real published Skill version/read and Memory save/get/source diagnostic associations passed');
}
const receipt: Record<string, unknown> = {
  at: new Date().toISOString(),
  client: 'packaged Electron + Chrome',
  model: `${model.provider}/${model.model}`,
};
try {
  desktop = await launch();
  const page = await desktop.firstWindow();
  await page.locator('.shell').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await page.getByLabel('模型提供方').selectOption(model.provider);
  await page.getByRole('button', { name: '导入 Pi 授权' }).click();
  await page.locator(`.start select option[value="${model.provider}/${model.model}"]`).waitFor({ state: 'attached' });
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  if (associationsOnly) {
    Object.assign(receipt, JSON.parse(await readFile(resolve('docs/evidence/d2-diagnostic-real-ui.json'), 'utf8')));
    await verifyAssociations(page);
  } else {
    const marker = randomUUID();
    const simulatedSecret = `sk-diagnostic-probe-${randomUUID()}`;
    // Two native read results near the SDK's 50 KiB limit exceed its 20k-token retained-tail estimate.
    const bulk = Array.from(
      { length: 700 },
      (_, index) => `Evidence row ${index}: ${randomUUID()} ${randomUUID()}`,
    ).join('\n');
    await writeFile(
      join(root, 'diagnostic-marker.txt'),
      `Diagnostic marker: ${marker}\napi_key=${simulatedSecret}\n${bulk}\n`,
    );
    await page.getByPlaceholder('工作目录的绝对路径').fill(root);
    await page.locator('.start select').selectOption(`${model.provider}/${model.model}`);
    await page.getByRole('button', { name: '创建会话 →' }).click();
    await page.getByLabel('任务', { exact: true }).waitFor();
    const [a] = await call<State[]>(page, '/sessions');
    assert.ok(a);
    const executed = await prompt(
      page,
      a.id,
      'Use read twice on diagnostic-marker.txt as two separate calls, explicitly setting offset=1 and limit=2000 in BOTH calls. This is a full-range repeated-output test; do not narrow the second range. Also call read on missing-on-purpose.txt once to observe the expected missing-file error. Then use write to create diagnostic-marker-copy.txt containing only the exact Diagnostic marker UUID from the first file. Do not use bash. Do not copy the api_key line or filler rows. Complete all four requested calls.',
    );
    assert.equal((await readFile(join(root, 'diagnostic-marker-copy.txt'), 'utf8')).trim(), marker);
    assert.ok(executed.messages.filter((message) => message.toolName === 'read').length >= 3);
    assert.ok(executed.messages.some((message) => message.toolName === 'read' && message.isError));
    const initial = await call<Catalog>(page, `/diagnostics?sessionId=${a.id}`);
    assert.equal(initial.total, 1);
    assert.equal(initial.health.available, true);
    const trace = initial.items[0];
    assert.ok(trace);
    const detail = await call<Detail>(page, `/diagnostics/${trace.id}`);
    assert.equal(detail.trace.status, 'ended');
    assert.ok(detail.totals.turns >= 2);
    assert.ok(detail.trace.errorCount >= 1);
    assert.ok(detail.sameToolOccurrences.some((item) => item.name === 'read' && item.count >= 3));
    assert.ok(detail.calls.some((item) => item.status === 'error'));
    assert.ok(
      detail.turns.some((item) => item.usage?.source === 'pi_normalized' && Number(item.usage.totalTokens) > 0),
    );
    const large = detail.calls.find(
      (item) => item.toolName === 'read' && item.status === 'ok' && (item.outputBytes ?? 0) > 20000,
    );
    assert.ok(large?.resultEntryId);
    assert.ok(!JSON.stringify(detail).includes(marker));
    assert.ok(!JSON.stringify(detail).includes(simulatedSecret));
    const evidencePath = `/diagnostics/evidence?sessionId=${a.id}&entryId=${large.resultEntryId}`;
    const originalEvidence = await call<Evidence>(page, evidencePath);
    assert.equal(originalEvidence.available, true);
    assert.ok(originalEvidence.content?.includes(marker));
    assert.ok(!originalEvidence.content?.includes(simulatedSecret));
    assert.equal(originalEvidence.truncated, true);
    assert.ok(originalEvidence.nextOffset);
    receipt.execution = {
      sessionId: a.id,
      traceId: trace.id,
      turns: detail.totals.turns,
      calls: detail.totals.calls,
      errors: detail.trace.errorCount,
      outputBytes: large.outputBytes,
      positiveUsage: true,
      usage: detail.turns.map(({ ordinal, model, provider, usage }) => ({ ordinal, model, provider, usage })),
      markerSha256: createHash('sha256').update(marker).digest('hex'),
    };
    console.log('Real multi-Turn/Tool execution, repeat/error/usage and protected evidence passed');

    const sourceBytes = detail.calls
      .filter((item) => item.toolName === 'read' && item.status === 'ok')
      .reduce((sum, item) => sum + (item.outputBytes ?? 0), 0);
    if (sourceBytes < 85000) {
      const supplemented = await prompt(
        page,
        a.id,
        'Read diagnostic-marker.txt once with offset=1 and limit=2000. This is an explicit full-range diagnostic-output sample, so do not reduce the line range. Do not use other tools; respond with only done after the result.',
      );
      assert.ok(
        supplemented.messages.filter((message) => message.toolName === 'read').length >
          executed.messages.filter((message) => message.toolName === 'read').length,
      );
      receipt.compactionSampleSupplemented = true;
    }
    await call(page, `/sessions/${a.id}/compact`, 'POST', {});
    const afterCompaction = await call<Evidence>(page, evidencePath);
    assert.equal(afterCompaction.content, originalEvidence.content);
    const compacted = await call<Catalog>(page, `/diagnostics?sessionId=${a.id}`);
    assert.ok(compacted.sessionEvents?.some((event) => event.kind.includes('compaction')));
    const b = await call<State>(page, '/sessions', 'POST', { cwd: root, ...model });
    const used = await prompt(
      page,
      b.id,
      `Find the Diagnostic marker UUID from the historical execution in Session ${a.id}. Use diagnostic_search, diagnostic_get and diagnostic_evidence to locate and read the original successful read result, choosing query arguments yourself. Write only the exact UUID recovered from that evidence to historical-marker-use.txt with write. Do not read any files or use bash. The source Session has been compacted; its full original evidence is still available on demand.`,
    );
    const searched = toolPayloads(used, 'diagnostic_search');
    const inspected = toolPayloads(used, 'diagnostic_get');
    const readEvidence = toolPayloads(used, 'diagnostic_evidence');
    assert.ok(searched.length && JSON.stringify(searched).includes(trace.id));
    assert.ok(inspected.length && JSON.stringify(inspected).includes(large.resultEntryId));
    assert.ok(readEvidence.length && JSON.stringify(readEvidence).includes(marker));
    assert.ok(!used.messages.some((message) => message.toolName === 'read' || message.toolName === 'bash'));
    assert.equal((await readFile(join(root, 'historical-marker-use.txt'), 'utf8')).trim(), marker);
    receipt.crossSessionAgentEvidence = {
      sessionId: b.id,
      search: searched.length,
      get: inspected.length,
      evidence: readEvidence.length,
      actualWrittenMarkerMatches: true,
      afterCompaction: true,
    };
    console.log('Real Agent cross-Session diagnostic tools and evidence-based file output passed');

    await page.getByRole('button', { name: '运行诊断', exact: true }).click();
    await page
      .locator('.diagnostics-item')
      .filter({ hasText: trace.id.slice(0, 8) })
      .click();
    await page.locator('.diagnostics-call').first().waitFor();
    browser = await chromium.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    const web = await browser.newPage({ viewport: { width: 1240, height: 850 } });
    const token = await page.evaluate(() => sessionStorage.getItem('agent-connection-token'));
    assert.ok(token);
    await web.goto(`${new URL(page.url()).origin}/#token=${encodeURIComponent(token)}`);
    let listRequests = 0;
    web.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/diagnostics') listRequests++;
    });
    await web.getByRole('button', { name: '历史日志', exact: true }).click();
    await web.getByLabel('诊断 Tool 筛选').fill('read');
    await web.getByRole('checkbox', { name: '仅含异常' }).check();
    await web.getByRole('button', { name: '筛选', exact: true }).click();
    await web
      .locator('.diagnostics-item')
      .filter({ hasText: trace.id.slice(0, 8) })
      .click();
    const callRow = web
      .locator('.diagnostics-call')
      .filter({ hasText: `#${large.sequence} read` })
      .first();
    await callRow.getByRole('button', { name: '查看调用结果', exact: true }).click();
    await web.locator('.diagnostics-evidence pre').filter({ hasText: marker }).waitFor();
    const firstSegment = await web.locator('.diagnostics-evidence pre').innerText();
    await web.getByRole('button', { name: '后一段证据', exact: true }).click();
    await web.waitForFunction(
      (first) => document.querySelector('.diagnostics-evidence pre')?.textContent !== first,
      firstSegment,
    );
    const nextSegment = await web.locator('.diagnostics-evidence pre').innerText();
    assert.notEqual(nextSegment, firstSegment);
    assert.ok(!(await web.locator('.diagnostics-evidence').innerText()).includes(simulatedSecret));
    await mkdir(resolve('release/d2-diagnostic-evidence'), { recursive: true });
    await web.screenshot({ path: resolve('release/d2-diagnostic-evidence/diagnostic-web.png') });
    await page.screenshot({ path: resolve('release/d2-diagnostic-evidence/diagnostic-desktop.png') });
    const beforeRestart = await call<State>(page, `/sessions/${b.id}`);
    const countBeforeRestart = listRequests;
    const hostPid = await desktop.evaluate(
      ({ app }) => app.getAppMetrics().find((item) => item.type === 'Utility' && item.name === 'Agent Host')?.pid,
    );
    assert.ok(hostPid);
    process.kill(hostPid, 'SIGKILL');
    const deadline = Date.now() + 30000;
    let nextPid: number | undefined;
    do {
      await web.waitForTimeout(300);
      nextPid = await desktop.evaluate(
        ({ app }) => app.getAppMetrics().find((item) => item.type === 'Utility' && item.name === 'Agent Host')?.pid,
      );
    } while ((!nextPid || nextPid === hostPid) && Date.now() < deadline);
    assert.ok(nextPid && nextPid !== hostPid);
    await web.waitForFunction(() => document.querySelector('.connection')?.textContent?.includes('已连接'), undefined, {
      timeout: 30000,
    });
    await web
      .locator('.diagnostics-item')
      .filter({ hasText: trace.id.slice(0, 8) })
      .waitFor();
    assert.ok(listRequests > countBeforeRestart, 'reconnected client must reload authoritative diagnostics');
    assert.equal((await call<State>(web, `/sessions/${b.id}`)).messages.length, beforeRestart.messages.length);
    const recovered = await call<Detail>(web, `/diagnostics/${trace.id}`);
    assert.equal(recovered.trace.status, detail.trace.status);
    assert.equal(recovered.totals.calls, detail.totals.calls);
    assert.equal((await call<Evidence>(web, evidencePath)).content, originalEvidence.content);
    receipt.sharedUI = {
      desktopCurrentSession: true,
      chromeGlobalFilters: true,
      paginatedEvidence: true,
      protectedSyntheticSecret: true,
      hostRestartReconnect: true,
      authoritativeRefetch: true,
      noModelReplay: true,
    };
    await browser.close();
    browser = undefined;
    await desktop.close();
    desktop = undefined;
    desktop = await launch();
    const restored = await desktop.firstWindow();
    await restored.locator('.shell').waitFor({ timeout: 30000 });
    assert.equal((await call<Detail>(restored, `/diagnostics/${trace.id}`)).totals.calls, detail.totals.calls);
    assert.equal((await call<Evidence>(restored, evidencePath)).content, originalEvidence.content);
    receipt.fullAppRestartRetainsEvidence = true;
    await verifyAssociations(restored);
    const db = new DatabaseSync(join(root, 'data/product.sqlite'), { readOnly: true });
    try {
      for (const table of ['diagnostic_traces', 'diagnostic_turns', 'diagnostic_calls', 'diagnostic_events']) {
        const rows = db.prepare(`SELECT data FROM ${table}`).all();
        assert.ok(!JSON.stringify(rows).includes(marker), `${table} must not duplicate raw result content`);
        assert.ok(!JSON.stringify(rows).includes(simulatedSecret), `${table} must not contain credentials`);
      }
      const logs = db.prepare('SELECT * FROM host_system_logs').all();
      assert.ok(!JSON.stringify(logs).includes(simulatedSecret));
      receipt.sqlite = { noRawToolContent: true, noSyntheticSecret: true, hostSystemLogRows: logs.length };
    } finally {
      db.close();
    }
  }
  receipt.result = 'passed';
  await mkdir(resolve('docs/evidence'), { recursive: true });
  await writeFile(resolve('docs/evidence/d2-diagnostic-real-ui.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt));
} finally {
  await browser?.close();
  await desktop?.close();
  await rm(root, { recursive: true, force: true });
}
