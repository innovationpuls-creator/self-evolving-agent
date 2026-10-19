import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { _electron, chromium, type ElectronApplication, type Page } from 'playwright-core';
import type { DiagnosticEvent, DiagnosticTrace, DiagnosticTurn } from '../apps/host/diagnostics.js';
import type { MemoryView } from '../apps/host/memory.js';
import type { SkillOperation, SkillRecord, SkillVersion } from '../apps/host/skills.js';

interface DiagnosticCall {
  id: string;
  toolCallId: string;
  parentToolCallId: string | null;
  toolName: string;
  sequence: number;
  started: number | null;
  ended: number | null;
  status: 'running' | 'ok' | 'error' | 'unfinished';
  durationMs: number | null;
  outputBytes: number | null;
  assistantEntryId: string | null;
  resultEntryId: string | null;
  data: {
    skillRead?: { skillId: string; version: string; digest: string; observation: string };
    memory?: { references: Array<{ id: string; revision: number; sources: unknown[] }>; complete: boolean };
    [key: string]: unknown;
  };
}

interface Tree {
  entry: { id: string; message?: { role: string } };
  children: Tree[];
}

interface Message {
  role: string;
  toolName?: string;
  isError?: boolean;
  stopReason?: string;
  errorMessage?: string;
  content: unknown;
}

interface SessionState {
  id: string;
  busy: boolean;
  error?: string;
  provider: string;
  model: string;
  thinkingLevel: string;
  interrupted?: boolean;
  leafId: string;
  messages: Message[];
  tree: Tree[];
}

interface DiagnosticCatalog {
  items: DiagnosticTrace[];
  total: number;
  health: { available: boolean; dropped: number };
  sessionEvents?: DiagnosticEvent[];
}

interface DiagnosticDetail {
  trace: DiagnosticTrace;
  calls: DiagnosticCall[];
  turns: DiagnosticTurn[];
  events: DiagnosticEvent[];
  totals: { calls: number; turns: number; events: number };
}

interface MemoryCatalog {
  items: MemoryView[];
  total: number;
  unavailable: number;
}

interface MemoryDetail {
  current: MemoryView;
  history: MemoryView[];
}

interface Evidence {
  available: boolean;
  content: string;
  onSelectedBranch: boolean;
  source: string;
}
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const flatten = (tree: Tree[]): Tree[] => tree.flatMap((n) => [n, ...flatten(n.children)]);

const root = await realpath(await mkdtemp(join(tmpdir(), 'd2-integration-ui-')));
const executable = process.env.AGENT_APP_PATH ?? resolve('release/Agent-darwin-arm64/Agent.app/Contents/MacOS/Agent');
const model = { provider: 'openai-codex', model: 'gpt-6-luna' };
const evidenceFile = resolve(process.env.AGENT_ACCEPTANCE_EVIDENCE ?? 'docs/evidence/d2-integration-real-ui.json');
const screenshotDir = resolve(process.env.AGENT_ACCEPTANCE_SCREENSHOTS ?? 'release/d2-integration-evidence');
await mkdir(dirname(evidenceFile), { recursive: true });
const approvedDigestArg =
  process.env.D2_SPECIAL_SKILL_APPROVED_DIGEST ??
  process.argv.find((a) => a.startsWith('--approved-digest='))?.split('=')[1];

let desktop: ElectronApplication | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

const launchDesktop = () =>
  _electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${join(root, 'profile')}`],
    env: { ...process.env, AGENT_DESKTOP_DATA_DIR: join(root, 'data') },
    timeout: 30000,
  });

const request = async <T>(page: Page, path: string, method = 'GET', body?: unknown): Promise<T> =>
  JSON.parse(
    await page.evaluate(
      async ({ path, method, body }) => {
        const response = await fetch(`/api${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${sessionStorage.getItem('agent-connection-token')}`,
            'Content-Type': 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const serialized = await response.text();
        if (!response.ok) {
          const value = JSON.parse(serialized);
          const error = new Error(`HTTP ${response.status}: ${value.error}`);
          Object.assign(error, { status: response.status, data: value });
          throw error;
        }
        return serialized;
      },
      { path, method, body },
    ),
  ) as T;

async function call<T>(page: Page, path: string, method = 'GET', body?: unknown): Promise<T> {
  try {
    return await request<T>(page, path, method, body);
  } catch (error) {
    // Only retry a read interrupted by navigation; never replay a submitted mutation.
    if (method !== 'GET' || !(error instanceof Error) || !error.message.includes('Execution context was destroyed'))
      throw error;
    (receipt.interruptedReads as unknown[]).push({ path, at: new Date().toISOString() });
    await page.waitForLoadState('domcontentloaded');
    await page.locator('.shell').waitFor({ timeout: 30000 });
    return request<T>(page, path);
  }
}

async function observeDesktop(app: ElectronApplication, page: Page) {
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame())
      (receipt.desktopNavigations as unknown[]).push({
        at: new Date().toISOString(),
        path: new URL(frame.url()).pathname,
      });
  });
  await app.evaluate(({ app }) => {
    const state = globalThis as typeof globalThis & { d2HostExits?: unknown[] };
    state.d2HostExits = [];
    app.on('child-process-gone', (_event, detail) => {
      state.d2HostExits?.push({
        type: detail.type,
        name: detail.name,
        reason: detail.reason,
        exitCode: detail.exitCode,
      });
    });
  });
}

async function collectHostExits() {
  if (!desktop) return;
  const events = await desktop.evaluate(() => {
    const state = globalThis as typeof globalThis & { d2HostExits?: unknown[] };
    const events = state.d2HostExits ?? [];
    state.d2HostExits = [];
    return events;
  });
  (receipt.hostExits as unknown[]).push(...events);
}

async function waitOperation(page: Page, initialOp: SkillOperation) {
  let op = initialOp;
  const deadline = Date.now() + 120000;
  while (['checking', 'waiting'].includes(op.status)) {
    assert.ok(Date.now() < deadline, 'operation timed out');
    await page.waitForTimeout(200);
    op = await call<SkillOperation>(page, `/skills/operations/${op.id}`);
  }
  return op;
}

async function idleSession(page: Page, sessionId: string) {
  const deadline = Date.now() + 300000;
  let state: SessionState;
  do {
    await page.waitForTimeout(350);
    state = await call<SessionState>(page, `/sessions/${sessionId}`);
  } while (state.busy && Date.now() < deadline);
  assert.equal(state.busy, false, 'Session model run timed out');
  return state;
}

async function promptSession(page: Page, sessionId: string, text: string) {
  await call(page, `/sessions/${sessionId}/prompt`, 'POST', { text });
  return idleSession(page, sessionId);
}

function classifyModelError(state: SessionState): { isQuota: boolean; message: string } | null {
  const lastAssistant = [...state.messages].reverse().find((m) => m.role === 'assistant');
  const errorMsg = lastAssistant?.errorMessage ?? state.error;
  if (!errorMsg && !state.messages.some((m) => m.role === 'assistant' && m.stopReason === 'error')) {
    return null;
  }
  const fullMsg = errorMsg ?? 'Model returned error stopReason';
  const isQuota =
    fullMsg.includes('usage limit') ||
    fullMsg.includes('rate limit') ||
    fullMsg.includes('429') ||
    fullMsg.includes('overloaded');
  return { isQuota, message: fullMsg };
}

function toolPayloads(state: SessionState, name: string, after = 0): unknown[] {
  const attempts = state.messages.slice(after).filter((m) => m.toolName === name);
  for (const failed of attempts.filter((m) => m.isError)) {
    const errors = receipt.toolErrors as unknown[];
    const failure = { sessionId: state.id, toolName: name, content: failed.content };
    errors.push(failure);
    console.log('Tool attempt failed; successful results and business output still required:', JSON.stringify(failure));
  }
  return attempts
    .filter((m) => !m.isError)
    .map((m) => {
      if (Array.isArray(m.content)) {
        return m.content.flatMap((part: unknown) => {
          if (part && typeof part === 'object' && 'type' in part && part.type === 'text' && 'text' in part) {
            return typeof (part as { text: unknown }).text === 'string' ? [(part as { text: string }).text] : [];
          }
          return [];
        });
      }
      return [m.content];
    });
}

const receipt: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  model: `${model.provider}/${model.model}`,
  toolErrors: [],
  interruptedReads: [],
  desktopNavigations: [],
  hostExits: [],
  steps: [],
};
function passed(step: string, evidence: unknown) {
  (receipt.steps as unknown[]).push({ step, at: new Date().toISOString(), evidence });
}

try {
  console.log('=== Step 1: Launch Desktop and configure model auth ===');
  desktop = await launchDesktop();
  const page = await desktop.firstWindow();
  await page.locator('.shell').waitFor({ timeout: 30000 });
  await observeDesktop(desktop, page);

  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await page.getByLabel('模型提供方').selectOption(model.provider);
  await page.getByRole('button', { name: '导入 Pi 授权' }).click();
  await page
    .locator(`.start select option[value="${model.provider}/${model.model}"]`)
    .waitFor({ state: 'attached', timeout: 30000 });
  await page.getByRole('button', { name: '模型设置', exact: true }).click();

  console.log('=== Step 2: Skill Setup (Ordinary discovery & Special review approval check) ===');
  const ordinarySkillDir = join(root, '.agents/skills/d2-deploy-helper');
  await mkdir(ordinarySkillDir, { recursive: true });
  await writeFile(
    join(ordinarySkillDir, 'SKILL.md'),
    `---
name: d2-deploy-helper
description: Use this skill to execute verified deployment tasks and record decisions.
---
Read deploy-spec.txt using the native read tool.
Follow its instructions strictly:
1. Write deployment-receipt.txt with DEPLOYMENT_RECEIPT:<the exact deployment marker> using native write. Do not copy secrets.
2. Save the project decision, project experience, and global fact using memory_save as specified.
3. Report the completion receipt.
`,
  );

  const importedOrdinary = await waitOperation(
    page,
    await call<SkillOperation>(page, '/skills', 'POST', {
      source: ordinarySkillDir,
    }),
  );
  assert.equal(importedOrdinary.status, 'applied', importedOrdinary.message);

  const skillCatalog1 = await call<{ skills: SkillRecord[] }>(page, '/skills');
  const ordinarySkill = skillCatalog1.skills.find((s) => s.name === 'd2-deploy-helper');
  assert.ok(ordinarySkill, 'Ordinary skill d2-deploy-helper must exist');

  const publishedOrdinary = await waitOperation(
    page,
    await call<SkillOperation>(page, `/skills/${ordinarySkill.id}/publish`, 'POST', {
      version: ordinarySkill.latest,
      baseRevision: ordinarySkill.revision,
    }),
  );
  assert.equal(publishedOrdinary.status, 'applied', publishedOrdinary.message);

  const skillCatalog = await call<{ skills: SkillRecord[] }>(page, '/skills');
  const ordinaryEnabled = skillCatalog.skills.find((s) => s.id === ordinarySkill.id);
  assert.ok(ordinaryEnabled?.enabled, 'Ordinary skill must be published and enabled');
  console.log('Ordinary Skill published successfully');

  // The default integrated scenario needs no executable Package. Optional execution
  // requires the operator's actual current review, never a built-in approval note.
  let specialSkill: SkillRecord | undefined;
  if (approvedDigestArg) {
    // Special executable skill: tests/fixtures/reviewed-skill
    const specialSkillDir = resolve('tests/fixtures/reviewed-skill');
    const importedSpecial = await waitOperation(
      page,
      await call<SkillOperation>(page, '/skills', 'POST', {
        source: specialSkillDir,
        bindings: [{ skill: 'skills/receipt/SKILL.md', extensions: ['extensions/receipt.js'] }],
      }),
    );
    assert.equal(importedSpecial.status, 'applied', importedSpecial.message);

    const skillCatalog2 = await call<{ skills: SkillRecord[] }>(page, '/skills');
    specialSkill = skillCatalog2.skills.find((s) => s.name === 'd2-receipt');
    assert.ok(specialSkill, 'Special skill d2-receipt must be registered');

    const specialDetail = await call<{ versions: SkillVersion[] }>(page, `/skills/${specialSkill.id}`);
    const specialLatest = specialSkill.latest;
    const specialVersion = specialDetail.versions.find((v) => v.id === specialLatest);
    assert.ok(specialVersion, 'Special skill version must exist');

    // Verify unreviewed candidate is strictly rejected
    const deniedSpecial = await waitOperation(
      page,
      await call<SkillOperation>(page, `/skills/${specialSkill.id}/publish`, 'POST', {
        version: specialVersion.id,
        baseRevision: specialSkill.revision,
      }),
    );
    assert.equal(deniedSpecial.status, 'failed', 'Unreviewed executable version must be rejected');

    assert.equal(approvedDigestArg, specialVersion.digest, 'Approval must match this exact candidate');
    const reviewNotes = process.env.D2_SPECIAL_SKILL_REVIEW_NOTES;
    assert.ok(
      reviewNotes && reviewNotes.length >= 10,
      'Supply the actual independent review and current approval in D2_SPECIAL_SKILL_REVIEW_NOTES',
    );

    const reviewed = await call<{ review: { digest: string; notes: string; at: number } }>(
      page,
      `/skills/${specialSkill.id}/review`,
      'POST',
      {
        version: specialVersion.id,
        digest: approvedDigestArg,
        notes: reviewNotes,
        reviewedCode: true,
        reviewedDependencies: true,
        reviewedPermissions: true,
      },
    );
    assert.equal(reviewed.review.digest, specialVersion.digest);

    const publishedSpecial = await waitOperation(
      page,
      await call<SkillOperation>(page, `/skills/${specialSkill.id}/publish`, 'POST', {
        version: specialVersion.id,
        baseRevision: specialSkill.revision,
      }),
    );
    assert.equal(publishedSpecial.status, 'applied', publishedSpecial.message);
    console.log('Special Skill d2-receipt approved and published successfully');
  }
  receipt.specialSkillLoaded = Boolean(specialSkill);

  console.log('=== Step 3: Session A - Task Execution, Memory Accumulation, Diagnostic Tracking ===');
  const markerUUID = randomUUID();
  const simulatedSecret = `sk-integration-probe-${randomUUID()}`;
  const specContent = `Project Deployment Specification:
Marker: ${markerUUID}
Secret Token: api_key=${simulatedSecret}

Instructions:
1. Write deployment-receipt.txt containing exactly DEPLOYMENT_RECEIPT:${markerUUID} using native write.
2. Save exactly one project decision with title "deployment-target" and content "Deployment target is cluster-alpha-${markerUUID}". In the reason, cite deploy-spec.txt.
3. Save exactly one project experience with title "preflight-check-rule" and content "Always verify cluster health before deploying".
4. Save exactly one global fact with title "triangle-angles-fact" and content "A flat triangle has three interior angles summing to 180 degrees".
5. Report the receipt text.
`;
  await writeFile(join(root, 'deploy-spec.txt'), specContent);

  await page.getByPlaceholder('工作目录的绝对路径').fill(root);
  await page.locator('.start select').selectOption(`${model.provider}/${model.model}`);
  await page.getByRole('button', { name: '创建会话 →' }).click();
  await page.getByLabel('任务', { exact: true }).waitFor();

  const sessionsAfterA = await call<SessionState[]>(page, '/sessions');
  const sessionA = sessionsAfterA[0];
  assert.ok(sessionA, 'Session A must be created');

  const ordinaryDetail = await call<{ versions: SkillVersion[] }>(page, `/skills/${ordinarySkill.id}`);
  const ordinaryVersion = ordinaryDetail.versions.find((v) => v.id === ordinarySkill.latest);
  assert.ok(ordinaryVersion, 'Ordinary skill version must exist');
  const stateA = await promptSession(
    page,
    sessionA.id,
    'Complete the deployment preparation using the enabled deployment helper Skill. Record useful long-term knowledge and follow the Skill. Do not use bash.',
  );

  const errorA = classifyModelError(stateA);
  if (errorA) {
    if (errorA.isQuota) {
      console.log(`\n[BLOCKED] Real model execution blocked by upstream quota: ${errorA.message}\n`);
      receipt.status = 'blocked';
      receipt.reason = 'UPSTREAM_QUOTA_EXCEEDED';
      receipt.stage = 'session_a_execution';
      receipt.errorMessage = errorA.message;
    } else {
      console.log(`\n[FAILED] Real model execution failed: ${errorA.message}\n`);
      receipt.status = 'failed';
      receipt.reason = 'MODEL_EXECUTION_FAILED';
      receipt.stage = 'session_a_execution';
      receipt.errorMessage = errorA.message;
    }
    receipt.completedAt = new Date().toISOString();
    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({ path: join(screenshotDir, 'desktop-blocked.png') });
    await mkdir(dirname(evidenceFile), { recursive: true });
    await writeFile(evidenceFile, `${JSON.stringify(receipt, null, 2)}\n`);
    throw new Error(errorA.message);
  }

  // Assert Session A real tool outcomes (No synthetic writes!)
  assert.equal(
    (await readFile(join(root, 'deployment-receipt.txt'), 'utf8')).trim(),
    `DEPLOYMENT_RECEIPT:${markerUUID}`,
  );
  assert.ok(stateA.messages.some((m) => m.toolName === 'write'));

  const memorySaves = toolPayloads(stateA, 'memory_save') as MemoryView[][];
  assert.ok(memorySaves.length >= 3, 'Session A must save decision, experience, and fact via memory_save');

  // Verify Diagnostic Trace for Session A
  const tracesA = await call<DiagnosticCatalog>(page, `/diagnostics?sessionId=${sessionA.id}`);
  assert.ok(tracesA.total >= 1, 'Session A must have at least 1 diagnostic trace');
  const traceA = tracesA.items[0];
  assert.ok(traceA);

  const detailA = await call<DiagnosticDetail>(page, `/diagnostics/${traceA.id}`);
  const observedSkillRead = detailA.calls.find((c) => c.toolName === 'read' && c.data.skillRead);
  assert.ok(observedSkillRead, 'Diagnostic trace must capture Skill read association');
  assert.deepEqual(observedSkillRead.data.skillRead, {
    skillId: ordinarySkill.id,
    version: ordinaryVersion.id,
    digest: ordinaryVersion.digest,
    observation: 'observed_read',
  });

  const receiptCall = detailA.calls.find((c) => c.toolName === 'write');
  assert.ok(receiptCall?.assistantEntryId, 'Diagnostic trace must record the native receipt write');

  const memorySaveCall = detailA.calls.find((c) => c.toolName === 'memory_save');
  assert.ok(memorySaveCall, 'Diagnostic trace must record memory_save call');
  assert.ok(memorySaveCall.data.memory?.references?.length, 'memory_save call must link memory references');

  // Verify diagnostic metadata doesn't duplicate raw secret or massive content
  assert.ok(!JSON.stringify(detailA).includes(simulatedSecret), 'Diagnostics must not contain secrets');
  assert.ok(!JSON.stringify(detailA).includes(markerUUID), 'Diagnostics must not duplicate raw Tool content');
  const evidencePath = `/diagnostics/evidence?sessionId=${sessionA.id}&entryId=${receiptCall.assistantEntryId}&limit=32768`;
  const originalEvidence = await call<Evidence>(page, evidencePath);
  assert.ok(originalEvidence.available && originalEvidence.content.includes(`DEPLOYMENT_RECEIPT:${markerUUID}`));
  assert.ok(!originalEvidence.content.includes(simulatedSecret));
  passed('Skill task and sourced Memory', {
    sessionId: sessionA.id,
    traceId: traceA.id,
    skill: observedSkillRead.data.skillRead,
    calls: detailA.calls.map(({ toolName, toolCallId, assistantEntryId, resultEntryId, data }) => ({
      toolName,
      toolCallId,
      assistantEntryId,
      resultEntryId,
      data,
    })),
    evidencePath,
    evidenceSha256: sha256(originalEvidence.content),
  });

  console.log('Session A task, skill tracking, memory saving and diagnostic indexing verified');

  console.log('=== Step 4: Session B - Cross-Session Autonomous Knowledge Retrieval & Usage ===');
  const sessionB = await call<SessionState>(page, '/sessions', 'POST', {
    cwd: root,
    ...model,
  });
  assert.equal((await call<SessionState>(page, `/sessions/${sessionB.id}`)).messages.length, 0);

  const stateB = await promptSession(
    page,
    sessionB.id,
    `Search long-term memory for deployment target decisions and inspect the returned current knowledge and sources.
Write the exact deployment target string from the decision to current-deployment.txt using the write tool.
Also check if the triangle angles fact is in memory.
Do not read deploy-spec.txt or use bash.`,
  );

  const errorB = classifyModelError(stateB);
  if (errorB) {
    receipt.status = errorB.isQuota ? 'blocked' : 'failed';
    receipt.reason = errorB.isQuota ? 'UPSTREAM_QUOTA_EXCEEDED' : 'MODEL_EXECUTION_FAILED';
    receipt.stage = 'session_b_retrieval';
    receipt.errorMessage = errorB.message;
    receipt.completedAt = new Date().toISOString();
    await mkdir(dirname(evidenceFile), { recursive: true });
    await writeFile(evidenceFile, `${JSON.stringify(receipt, null, 2)}\n`);
    throw new Error(errorB.message);
  }

  // Assert Session B tool execution (Must NOT read spec file directly)
  const bSearches = toolPayloads(stateB, 'memory_search');
  assert.ok(bSearches.length >= 1, 'Session B must call memory_search');
  assert.ok(JSON.stringify(bSearches).includes(markerUUID), 'Search must actually return the saved deployment target');
  assert.ok(
    !stateB.messages.some((m) => m.toolName === 'read' || m.toolName === 'bash'),
    'Session B must not read original spec file or use bash',
  );

  const writtenDeployment = await readFile(join(root, 'current-deployment.txt'), 'utf8');
  assert.ok(
    writtenDeployment.includes(markerUUID),
    `current-deployment.txt must contain ${markerUUID}, got: ${writtenDeployment}`,
  );
  console.log('Session B successfully retrieved knowledge across sessions and wrote verified file');
  passed('Cross-session knowledge use', {
    sessionId: sessionB.id,
    tools: stateB.messages.filter((m) => m.toolName).map((m) => m.toolName),
    outputSha256: sha256(writtenDeployment),
  });

  console.log('=== Step 5: Knowledge Correction & Dual-Client State Sync & Conflict ===');
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const web = await browser.newPage({ viewport: { width: 1240, height: 850 } });
  const token = await page.evaluate(() => sessionStorage.getItem('agent-connection-token'));
  assert.ok(token);
  await web.goto(`${new URL(page.url()).origin}/#token=${encodeURIComponent(token)}`);
  await web.locator('.shell').waitFor({ timeout: 30000 });

  // Query memory via API to find deployment decision
  const projSuffix = `?project=${encodeURIComponent(root)}`;
  const memoryCatalog = await call<MemoryCatalog>(page, `/memory${projSuffix}`);
  const decisionItem = memoryCatalog.items.find((item) => item.title === 'deployment-target');
  assert.ok(decisionItem, 'deployment-target memory must exist');
  assert.equal(decisionItem.revision, 1);

  // Chrome corrects the decision to revision 2
  const correctedUUID = randomUUID();
  const updatedDecision = await call<MemoryView>(web, `/memory/${decisionItem.id}/revise${projSuffix}`, 'POST', {
    knowledge: {
      title: 'deployment-target',
      content: `Deployment target is cluster-beta-${correctedUUID}`,
      kind: 'decision',
      scope: 'project',
    },
    reason: 'Upgraded target to cluster-beta per infrastructure directive',
    baseRevision: 1,
  });
  assert.equal(updatedDecision.revision, 2);

  // Desktop attempts stale edit with baseRevision 1 -> expect 409 Conflict
  let conflictOccurred = false;
  try {
    await call(page, `/memory/${decisionItem.id}/revise${projSuffix}`, 'POST', {
      knowledge: {
        title: 'deployment-target',
        content: 'Stale edit that should conflict',
        kind: 'decision',
        scope: 'project',
      },
      reason: 'Stale edit attempt',
      baseRevision: 1,
    });
  } catch (err: unknown) {
    if (
      String(err).includes('409') ||
      (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 409)
    ) {
      conflictOccurred = true;
    }
  }
  assert.ok(conflictOccurred, 'Concurrent edit with stale baseRevision must return 409 Conflict');

  for (const client of [page, web]) {
    await client.locator('nav button').first().click();
    await client.getByRole('button', { name: '记忆管理', exact: true }).click();
    await client.locator('.memory-item').filter({ hasText: 'deployment-target' }).first().click();
    await client.locator('.memory-detail').filter({ hasText: correctedUUID }).waitFor();
  }

  // Verify memory revision history retains revision 1 and revision 2
  const decisionDetail = await call<MemoryDetail>(page, `/memory/${decisionItem.id}${projSuffix}&includeHistory=true`);
  assert.equal(decisionDetail.current.revision, 2);
  assert.equal(decisionDetail.history.length, 2, 'History must retain both revision 1 and revision 2');
  assert.equal(decisionDetail.history[0]?.revision, 2);
  assert.equal(decisionDetail.history[1]?.revision, 1);

  // Session B checks memory again and updates file
  const stateB2 = await promptSession(
    page,
    sessionB.id,
    `The deployment target has been revised. Retrieve the current deployment target from memory again, and overwrite current-deployment.txt with the new target using write.`,
  );
  const errorB2 = classifyModelError(stateB2);
  if (errorB2) {
    receipt.status = errorB2.isQuota ? 'blocked' : 'failed';
    receipt.reason = errorB2.isQuota ? 'UPSTREAM_QUOTA_EXCEEDED' : 'MODEL_EXECUTION_FAILED';
    receipt.stage = 'session_b_update';
    receipt.errorMessage = errorB2.message;
    receipt.completedAt = new Date().toISOString();
    await mkdir(dirname(evidenceFile), { recursive: true });
    await writeFile(evidenceFile, `${JSON.stringify(receipt, null, 2)}\n`);
    throw new Error(errorB2.message);
  }

  const b2Lookups = ['memory_search', 'memory_get'].flatMap((name) =>
    toolPayloads(stateB2, name, stateB.messages.length),
  );
  assert.ok(b2Lookups.length >= 1, 'Session B must retrieve current knowledge again');
  assert.ok(JSON.stringify(b2Lookups).includes(correctedUUID), 'New lookup must return the corrected value');
  const writtenDeploymentV2 = await readFile(join(root, 'current-deployment.txt'), 'utf8');
  assert.ok(
    writtenDeploymentV2.includes(correctedUUID),
    `current-deployment.txt must now contain ${correctedUUID}, got: ${writtenDeploymentV2}`,
  );
  console.log('Knowledge revision, conflict handling and cross-session update verified');
  passed('Correction and dual-client state', {
    memoryId: decisionItem.id,
    revisions: [1, 2],
    conflictStatus: 409,
    desktopAndChromeCurrentValue: true,
    outputSha256: sha256(writtenDeploymentV2),
  });

  console.log('=== Step 6: Native Diagnostic Log Query & Raw Evidence Verification ===');
  const stateB3 = await promptSession(
    page,
    sessionB.id,
    `Investigate the execution history of Session ${sessionA.id} using diagnostic_search and diagnostic_get.
Locate the native write call for deployment-receipt.txt. Use diagnostic_evidence on its assistantEntryId to inspect the original write parameters.
Write the exact DEPLOYMENT_RECEIPT string found in that evidence to receipt-evidence.txt using write.
Do not use bash.`,
  );

  const errorB3 = classifyModelError(stateB3);
  if (errorB3) {
    receipt.status = errorB3.isQuota ? 'blocked' : 'failed';
    receipt.reason = errorB3.isQuota ? 'UPSTREAM_QUOTA_EXCEEDED' : 'MODEL_EXECUTION_FAILED';
    receipt.stage = 'session_b_diagnostic_investigation';
    receipt.errorMessage = errorB3.message;
    receipt.completedAt = new Date().toISOString();
    await mkdir(dirname(evidenceFile), { recursive: true });
    await writeFile(evidenceFile, `${JSON.stringify(receipt, null, 2)}\n`);
    throw new Error(errorB3.message);
  }

  const diagSearches = toolPayloads(stateB3, 'diagnostic_search', stateB2.messages.length);
  const diagGets = toolPayloads(stateB3, 'diagnostic_get', stateB2.messages.length);
  const diagEvidences = toolPayloads(stateB3, 'diagnostic_evidence', stateB2.messages.length);
  assert.ok(diagSearches.length >= 1, 'Session B must call diagnostic_search');
  assert.ok(diagGets.length >= 1, 'Session B must call diagnostic_get');
  assert.ok(diagEvidences.length >= 1, 'Session B must call diagnostic_evidence');

  const writtenEvidence = await readFile(join(root, 'receipt-evidence.txt'), 'utf8');
  assert.ok(
    writtenEvidence.includes(`DEPLOYMENT_RECEIPT:${markerUUID}`),
    `receipt-evidence.txt must contain DEPLOYMENT_RECEIPT:${markerUUID}, got: ${writtenEvidence}`,
  );

  // Multi-client UI Verification: jump to Memory and Diagnostic
  await page.locator('nav button').first().click();
  await page.getByRole('button', { name: '能力管理', exact: true }).waitFor();
  if (!(await page.locator('.memory-panel').isVisible()))
    await page.getByRole('button', { name: '记忆管理', exact: true }).click();
  await page.locator('.memory-item').filter({ hasText: 'deployment-target' }).click();
  await page.locator('.memory-detail summary').click();
  await page.getByRole('button', { name: '查看执行证据', exact: true }).first().click();
  await page.locator('.diagnostics-evidence pre').filter({ hasText: 'memory_save' }).waitFor();

  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: join(screenshotDir, 'desktop-evidence.png') });
  await web.screenshot({ path: join(screenshotDir, 'web-client.png') });
  console.log('Native diagnostic tools and dual-client evidence navigation verified');
  passed('Native diagnostic investigation and evidence navigation', {
    tools: ['diagnostic_search', 'diagnostic_get', 'diagnostic_evidence'],
    outputSha256: sha256(writtenEvidence),
    desktopSourceNavigation: true,
  });

  console.log('=== Step 7: Session A Branch Rollback & Knowledge Applicability ===');
  // Find user entry in Session A tree before memory_save
  const stateANow = await call<SessionState>(page, `/sessions/${sessionA.id}`);
  const userEntry = flatten(stateANow.tree).find((n) => n.entry.message?.role === 'user');
  assert.ok(userEntry, 'User entry in Session A must exist');

  await call(page, `/sessions/${sessionA.id}/branch`, 'POST', { value: userEntry.entry.id });

  // Memory reaction: deployment-target must naturally become withdrawn (NO manual API retirement!)
  const catalogAfterRollback = await call<MemoryCatalog>(page, `/memory${projSuffix}`);
  assert.ok(
    !catalogAfterRollback.items.some((item) => item.id === decisionItem.id),
    'Withdrawn decision must automatically disappear from active memory catalog without manual retirement',
  );
  assert.ok(
    catalogAfterRollback.items.some((item) => item.title === 'preflight-check-rule'),
    'Project experience must remain active after branch rollback',
  );

  const withdrawnDetail = await call<MemoryDetail>(page, `/memory/${decisionItem.id}${projSuffix}&includeHistory=true`);
  assert.equal(
    withdrawnDetail.current.status,
    'withdrawn',
    'Decision status must be withdrawn purely via branch observation',
  );

  // Session B query: search memory for deployment target
  const stateB4 = await promptSession(
    page,
    sessionB.id,
    'Search long-term memory for deployment decisions using memory_search. If none found, write NO_ACTIVE_DEPLOYMENT_DECISION to current-deployment.txt using write.',
  );
  const errorB4 = classifyModelError(stateB4);
  if (errorB4) {
    receipt.status = errorB4.isQuota ? 'blocked' : 'failed';
    receipt.reason = errorB4.isQuota ? 'UPSTREAM_QUOTA_EXCEEDED' : 'MODEL_EXECUTION_FAILED';
    receipt.stage = 'session_b_rollback_check';
    receipt.errorMessage = errorB4.message;
    receipt.completedAt = new Date().toISOString();
    await mkdir(dirname(evidenceFile), { recursive: true });
    await writeFile(evidenceFile, `${JSON.stringify(receipt, null, 2)}\n`);
    throw new Error(errorB4.message);
  }

  const activeSearchResults = toolPayloads(stateB4, 'memory_search', stateB3.messages.length);
  assert.ok(activeSearchResults.length > 0, 'Rollback check must perform a new memory_search');
  assert.ok(
    !JSON.stringify(activeSearchResults).includes(correctedUUID) &&
      !JSON.stringify(activeSearchResults).includes(markerUUID),
    'Active search results must not include withdrawn decision',
  );
  assert.equal((await readFile(join(root, 'current-deployment.txt'), 'utf8')).trim(), 'NO_ACTIVE_DEPLOYMENT_DECISION');

  // Diagnostic history retained: Session A traces still exist in full
  const tracesAfterRollback = await call<DiagnosticCatalog>(page, `/diagnostics?sessionId=${sessionA.id}`);
  assert.ok(tracesAfterRollback.total >= 1, 'Diagnostic trace must NOT be deleted upon rollback');
  const historicalEvidence = await call<Evidence>(page, evidencePath);
  assert.equal(historicalEvidence.content, originalEvidence.content);
  assert.equal(historicalEvidence.onSelectedBranch, false);
  assert.deepEqual((await call<DiagnosticDetail>(page, `/diagnostics/${traceA.id}`)).calls, detailA.calls);
  console.log('Branch rollback, decision withdrawal and diagnostic fact preservation verified');
  passed('Source branch rollback', {
    memoryId: decisionItem.id,
    withdrawnRevision: withdrawnDetail.current.revision,
    sourceEntry: userEntry.entry.id,
    newSearchCount: activeSearchResults.length,
    historicalEvidencePreserved: true,
  });

  console.log('=== Step 8: New Evidence and Current Knowledge Confirmation ===');
  const confirmedUUID = randomUUID();
  await writeFile(
    join(root, 'new-deploy-spec.txt'),
    `New approved deployment target: cluster-gamma-${confirmedUUID}\n`,
  );
  const stateB5 = await promptSession(
    page,
    sessionB.id,
    `The release owner has approved a NEW decision based on new-deploy-spec.txt. Read that file, use memory_get with history for ${decisionItem.id}, then update that SAME withdrawn Memory using memory_revise with confirm=true, latest baseRevision, kind=decision, scope=project, title=deployment-target. Cite the new file and establish the new current basis. Write only the new exact deployment target to current-deployment.txt. Do not create another record or use bash.`,
  );
  const confirmedResults = toolPayloads(stateB5, 'memory_revise', stateB4.messages.length);
  assert.equal(confirmedResults.length, 1);
  assert.equal((await readFile(join(root, 'current-deployment.txt'), 'utf8')).trim(), `cluster-gamma-${confirmedUUID}`);
  const confirmedDetail = await call<MemoryDetail>(page, `/memory/${decisionItem.id}${projSuffix}&includeHistory=true`);
  assert.equal(confirmedDetail.current.revision, 4);
  assert.equal(confirmedDetail.current.operation, 'confirm');
  assert.equal(confirmedDetail.current.usable, true);
  assert.ok(
    confirmedDetail.current.basis.length > 0 && confirmedDetail.current.basis.every((s) => s.sessionId === sessionB.id),
  );
  assert.deepEqual(
    confirmedDetail.history.map((m) => m.revision),
    [4, 3, 2, 1],
  );
  passed('New evidence confirms knowledge', {
    memoryId: decisionItem.id,
    revision: 4,
    basis: confirmedDetail.current.basis,
    history: confirmedDetail.history.map(({ revision, operation, sources, basis }) => ({
      revision,
      operation,
      sources,
      basis,
    })),
  });

  console.log('=== Step 9: Active Host Crash, Reconnect and No Replay ===');
  await web.getByRole('button', { name: '返回对话', exact: true }).click();
  await web.getByRole('button', { name: '历史日志', exact: true }).click();
  await web
    .locator('.diagnostics-item')
    .filter({ hasText: traceA.id.slice(0, 8) })
    .waitFor();
  let refetches = 0;
  web.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/diagnostics') refetches++;
  });
  await call(page, `/sessions/${sessionB.id}/prompt`, 'POST', {
    text: "Use native bash exactly once: printf 'started\\n' >> external-effect.txt; sleep 8; printf 'completed\\n' >> external-effect.txt . Do not retry or modify other files.",
  });
  const crashDeadline = Date.now() + 180000;
  while (true) {
    try {
      if ((await readFile(join(root, 'external-effect.txt'), 'utf8')).includes('started')) break;
    } catch {}
    assert.ok(Date.now() < crashDeadline, 'Native external operation did not start');
    await page.waitForTimeout(100);
  }
  assert.equal((await call<SessionState>(page, `/sessions/${sessionB.id}`)).busy, true);
  const hostPid = await desktop.evaluate(
    ({ app }) => app.getAppMetrics().find((p) => p.type === 'Utility' && p.name === 'Agent Host')?.pid,
  );
  assert.ok(hostPid);
  const refetchesBeforeCrash = refetches;
  process.kill(hostPid, 'SIGKILL');
  let newPid: number | undefined;
  const reconnectDeadline = Date.now() + 30000;
  do {
    await page.waitForTimeout(300);
    newPid = await desktop.evaluate(
      ({ app }) => app.getAppMetrics().find((p) => p.type === 'Utility' && p.name === 'Agent Host')?.pid,
    );
  } while ((!newPid || newPid === hostPid) && Date.now() < reconnectDeadline);
  assert.ok(newPid && newPid !== hostPid);
  for (const client of [page, web])
    await client.waitForFunction(
      () => document.querySelector('.connection')?.textContent?.includes('已连接'),
      undefined,
      { timeout: 30000 },
    );
  await web
    .locator('.diagnostics-item')
    .filter({ hasText: traceA.id.slice(0, 8) })
    .waitFor();
  assert.ok(refetches > refetchesBeforeCrash);
  const recoveredState = await call<SessionState>(page, `/sessions/${sessionB.id}`);
  assert.equal(recoveredState.interrupted, true);
  assert.equal(recoveredState.busy, false);
  await page.waitForTimeout(9000);
  const effects = await readFile(join(root, 'external-effect.txt'), 'utf8');
  assert.equal(effects.split('started').length - 1, 1);
  assert.ok(effects.split('completed').length - 1 <= 1);
  assert.deepEqual(await call(page, `/memory/${decisionItem.id}${projSuffix}&includeHistory=true`), confirmedDetail);
  assert.equal((await call<Evidence>(page, evidencePath)).content, originalEvidence.content);
  const interruptedTrace = (await call<DiagnosticCatalog>(page, `/diagnostics?sessionId=${sessionB.id}`)).items.find(
    (t) => t.status === 'interrupted',
  );
  assert.ok(interruptedTrace);
  const formalSkill = await call(page, `/skills/${ordinarySkill.id}`);
  passed('Active crash and reconnect', {
    sessionId: sessionB.id,
    interruptedTrace: interruptedTrace.id,
    authoritativeRefetches: refetches,
    externalStarts: 1,
    externalCompletions: effects.split('completed').length - 1,
    noReplay: true,
  });

  console.log('=== Step 10: Full Restart and Native Session Continuation ===');
  await collectHostExits();
  await browser.close();
  browser = undefined;
  await desktop.close();
  desktop = undefined;

  // Relaunch desktop
  desktop = await launchDesktop();
  const restoredPage = await desktop.firstWindow();
  await restoredPage.locator('.shell').waitFor({ timeout: 30000 });
  await observeDesktop(desktop, restoredPage);

  // Verify Skill status after restart
  const restartedSkills = await call<{ skills: SkillRecord[] }>(restoredPage, '/skills');
  const ordinaryRestored = restartedSkills.skills.find((s) => s.id === ordinarySkill.id);
  const specialRestored = specialSkill && restartedSkills.skills.find((s) => s.id === specialSkill?.id);
  assert.ok(ordinaryRestored?.enabled, 'Ordinary skill must remain enabled after restart');
  if (specialSkill) assert.ok(specialRestored?.enabled, 'Special skill must remain enabled after restart');

  // Verify Memory status after restart
  const restartedMemory = await call<MemoryCatalog>(restoredPage, `/memory${projSuffix}`);
  assert.ok(restartedMemory.items.some((item) => item.id === decisionItem.id && item.revision === 4));
  assert.ok(restartedMemory.items.some((item) => item.title === 'preflight-check-rule'));

  const restartedDetail = await call<MemoryDetail>(
    restoredPage,
    `/memory/${decisionItem.id}${projSuffix}&includeHistory=true`,
  );
  assert.deepEqual(restartedDetail, confirmedDetail);
  assert.deepEqual(await call(restoredPage, `/skills/${ordinarySkill.id}`), formalSkill);
  assert.equal((await call<Evidence>(restoredPage, evidencePath)).content, originalEvidence.content);
  const restoredCalls = (await call<DiagnosticDetail>(restoredPage, `/diagnostics/${traceA.id}`)).calls;
  // Reconciliation annotates already-observed records with recovered:false.
  // Strip only that optional false value; a recovered:true or any changed fact still fails.
  assert.deepEqual(
    restoredCalls.map((entry) =>
      entry.data.recovered === false
        ? { ...entry, data: Object.fromEntries(Object.entries(entry.data).filter(([key]) => key !== 'recovered')) }
        : entry,
    ),
    detailA.calls,
  );
  const reopened = await call<SessionState>(restoredPage, `/sessions/${sessionB.id}`);
  assert.equal(reopened.leafId, recoveredState.leafId);
  assert.equal(reopened.messages.length, recoveredState.messages.length);
  assert.equal(reopened.interrupted, true);
  const resumed = await promptSession(
    restoredPage,
    sessionB.id,
    'Continue the same Session. Retrieve the current deployment-target from memory again, then write only its current exact target to resumed-target.txt. Do not run bash, read files or repeat the interrupted operation.',
  );
  const resumedLookups = ['memory_search', 'memory_get'].flatMap((name) =>
    toolPayloads(resumed, name, reopened.messages.length),
  );
  assert.ok(resumedLookups.length > 0, 'Continuation must retrieve current knowledge again');
  assert.ok(
    JSON.stringify(resumedLookups).includes(confirmedUUID),
    'Continuation lookup must return the current target',
  );
  assert.equal(resumed.id, sessionB.id);
  assert.equal(resumed.model, sessionB.model);
  assert.equal(resumed.thinkingLevel, sessionB.thinkingLevel);
  assert.equal((await readFile(join(root, 'resumed-target.txt'), 'utf8')).trim(), `cluster-gamma-${confirmedUUID}`);
  assert.equal(await readFile(join(root, 'external-effect.txt'), 'utf8'), effects);
  passed('Full restart and native continuation', {
    sessionId: sessionB.id,
    leafId: reopened.leafId,
    priorMessageCount: reopened.messages.length,
    formalSkillVersion: ordinaryVersion.id,
    memoryRevision: 4,
    originalEvidenceUnchanged: true,
    outputSha256: sha256(await readFile(join(root, 'resumed-target.txt'), 'utf8')),
    currentToolCalls: resumed.messages
      .slice(reopened.messages.length)
      .filter((m) => m.toolName)
      .map((m) => m.toolName),
  });

  // Verify Diagnostic traces after restart
  const restartedTraces = await call<DiagnosticCatalog>(restoredPage, `/diagnostics?sessionId=${sessionA.id}`);
  assert.ok(restartedTraces.total >= 1, 'Traces must survive restart');

  // Verify SQLite contents: No raw tool outputs or credentials leaked
  const db = new DatabaseSync(join(root, 'data/product.sqlite'), { readOnly: true });
  try {
    for (const table of ['diagnostic_traces', 'diagnostic_turns', 'diagnostic_calls', 'diagnostic_events']) {
      const rows = db.prepare(`SELECT data FROM ${table}`).all();
      assert.ok(!JSON.stringify(rows).includes(simulatedSecret), `${table} must not contain secrets`);
      for (const marker of [markerUUID, correctedUUID, confirmedUUID])
        assert.ok(!JSON.stringify(rows).includes(marker), `${table} must not duplicate raw content`);
    }
    const logs = db.prepare('SELECT * FROM host_system_logs').all();
    assert.ok(!JSON.stringify(logs).includes(simulatedSecret), 'host_system_logs must not contain secrets');
    const revisions = db
      .prepare('SELECT revision,data FROM memory_revisions WHERE memory_id=? ORDER BY revision')
      .all(decisionItem.id);
    assert.equal(revisions.length, 4);
    assert.equal(db.prepare('SELECT revision FROM memories WHERE id=?').get(decisionItem.id)?.revision, 4);
    passed('SQLite ownership inspection', {
      revisions: revisions.map((r) => ({ revision: r.revision, sha256: sha256(String(r.data)) })),
      noRawContentDuplicated: true,
      noSyntheticSecret: true,
    });
  } finally {
    db.close();
  }

  console.log('Restart recovery and data consistency verified');
  await collectHostExits();

  receipt.status = 'passed';
  receipt.completedAt = new Date().toISOString();
  receipt.details = {
    ordinarySkillId: ordinarySkill.id,
    specialSkillId: specialSkill?.id,
    sessionAId: sessionA.id,
    sessionBId: sessionB.id,
    markerUUID,
    correctedUUID,
    memoryId: decisionItem.id,
    traceAId: traceA.id,
  };

  await mkdir(dirname(evidenceFile), { recursive: true });
  await writeFile(evidenceFile, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log('\n=== D2 End-to-End Real Model Integration Passed Successfully ===\n');
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  await collectHostExits().catch(() => {});
  receipt.status = receipt.status === 'blocked' ? 'blocked' : 'failed';
  receipt.completedAt = new Date().toISOString();
  receipt.errorMessage = error instanceof Error ? error.message : String(error);
  await writeFile(evidenceFile, `${JSON.stringify(receipt, null, 2)}\n`);
  throw error;
} finally {
  await browser?.close();
  await desktop?.close();
  await rm(root, { recursive: true, force: true });
}
