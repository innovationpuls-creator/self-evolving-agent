import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { AgentService } from '../apps/host/runtime/agent.js';
import { sessionRoutes } from '../apps/host/runtime/session-routes.js';
import { skillRoutes } from '../apps/host/skills/skill-routes.js';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { inputQuery, referencedFiles } from '../apps/web/src/features/chat/input-completion.js';
import { fileCandidates } from '../apps/host/runtime/input-resources.js';
import { bindings, skillPackage } from './fixtures/skills-package.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'post-d5-input-'));
  const project = join(root, 'project');
  await mkdir(join(project, '.pi', 'skills', 'native-input'), { recursive: true });
  await writeFile(
    join(project, '.pi', 'skills', 'native-input', 'SKILL.md'),
    '---\nname: native-input\ndescription: Native input test instructions.\n---\nOnly use INPUT_SKILL_EVIDENCE when asked.',
  );
  await writeFile(join(project, 'evidence.txt'), 'FILE_REFERENCE_EVIDENCE');
  const service = new AgentService(join(root, 'host'), randomBytes(32));
  await service.init();
  const host = { service };
  const fake = fauxProvider({ models: [{ id: 'input-test', contextWindow: 100000, maxTokens: 512 }] });
  host.service.runtime.registerNativeProvider(fake.provider);
  const session = await host.service.create(project, fake.models[0].provider, fake.models[0].id);
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), {
      method,
    }) as IncomingMessage;
    let status = 200;
    let content = '';
    const res = {
      writeHead: (code: number) => {
        status = code;
      },
      end: (value: string) => {
        content = value;
      },
    } as unknown as ServerResponse;
    const url = new URL(`/api${path}`, 'http://localhost');
    try {
      if (!(await sessionRoutes(service, req, res, url)) && !(await skillRoutes(service, req, res, url))) status = 404;
    } catch (error) {
      status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 409;
      content = JSON.stringify({ error: error instanceof Error ? error.message : 'failed' });
    }
    return new Response(content, { status });
  };
  const wait = async (predicate: () => boolean | Promise<boolean>) => {
    const deadline = Date.now() + 15000;
    while (!(await predicate())) {
      assert.ok(Date.now() < deadline, 'timed out');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  return {
    root,
    project,
    host,
    fake,
    session,
    request,
    wait,
    close: async () => {
      await service.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('input completion distinguishes native skill commands and structured file references', () => {
  assert.deepEqual(inputQuery('/skill:na', 9), { kind: 'skills', query: 'na', start: 0, end: 9 });
  assert.deepEqual(inputQuery('inspect @src/', 13), { kind: 'files', query: 'src/', start: 8, end: 13 });
  assert.equal(inputQuery('email@example.com', 17), undefined);
  assert.deepEqual(referencedFiles('Inspect @"src/a b.ts" and @"src/a b.ts"'), ['src/a b.ts']);
  assert.deepEqual(inputQuery('Inspect @"src/a b.ts" now', 15), { kind: 'files', query: 'src/a', start: 8, end: 21 });
  assert.deepEqual(referencedFiles(`Inspect @${JSON.stringify('src/a "quote".ts')}`), ['src/a "quote".ts']);
});

test('real Host discovery, Pi skill expansion and actual file bytes reach native model context', async () => {
  const fixture = await fixtureInput();
  try {
    const resources = await (
      await fixture.request(`/sessions/${fixture.session.id}/input-resources?kind=skills&query=native`)
    ).json();
    assert.ok(resources.skills.some((skill: { name: string }) => skill.name === 'native-input'));
    const files = await (
      await fixture.request(`/sessions/${fixture.session.id}/input-resources?kind=files&query=evi`)
    ).json();
    assert.deepEqual(files.files, [{ path: 'evidence.txt', directory: false }]);
    let context = '';
    fixture.fake.setResponses([
      (value) => {
        context = JSON.stringify(value);
        return fauxAssistantMessage('Received actual instructions and evidence.');
      },
    ]);
    const response = await fixture.request(`/sessions/${fixture.session.id}/prompt`, 'POST', {
      text: '/skill:native-input Inspect @"evidence.txt"',
      files: ['evidence.txt'],
    });
    assert.equal(response.status, 202);
    await fixture.wait(async () => !(await fixture.host.service.viewSession(fixture.session.id)).busy);
    assert.ok(context.includes('<skill name=\\"native-input\\"'));
    assert.ok(context.includes('INPUT_SKILL_EVIDENCE'));
    assert.ok(context.includes('FILE_REFERENCE_EVIDENCE'));
    assert.ok(context.includes('file-reference'));
    assert.ok(
      !(await readFile(join(fixture.root, 'host', 'sessions', `${fixture.session.id}.enc`), 'utf8')).includes(
        'FILE_REFERENCE_EVIDENCE',
      ),
    );
    fixture.fake.setResponses([
      (value) => {
        context = JSON.stringify(value);
        return fauxAssistantMessage('Unknown command remains text.');
      },
    ]);
    const unknown = await fixture.request(`/sessions/${fixture.session.id}/prompt`, 'POST', {
      text: '/skill:unapproved not allowed',
    });
    assert.equal(unknown.status, 202);
    await fixture.wait(async () => !(await fixture.host.service.viewSession(fixture.session.id)).busy);
    assert.ok(context.includes('/skill:unapproved not allowed'));
    assert.ok(!context.includes('<skill name=\\"unapproved'));
    assert.ok(
      !(await fixture.host.service.viewSession(fixture.session.id)).messages.some(
        (message) => message.role === 'toolResult' && message.toolName === 'unapproved',
      ),
    );
    fixture.fake.setResponses([fauxAssistantMessage('Still usable.')]);
    await fixture.host.service.prompt(fixture.session.id, 'Continue.');
    await fixture.wait(async () => !(await fixture.host.service.viewSession(fixture.session.id)).busy);
    assert.equal((await fixture.host.service.viewSession(fixture.session.id)).error, undefined);
  } finally {
    await fixture.close();
  }
});

const fixtureInput = fixture;

test('file candidates and structured references reject traversal, credentials and symlink escapes', async () => {
  const fixture = await fixtureInput();
  try {
    await writeFile(join(fixture.project, '.env'), 'PRIVATE_FILE_VALUE');
    await symlink(join(fixture.root, 'host'), join(fixture.project, 'outside'));
    await symlink(join(fixture.project, '.env'), join(fixture.project, 'alias.txt'));
    const candidates = await fileCandidates(fixture.project, '', join(fixture.root, 'host'));
    assert.ok(!candidates.some((file) => ['.env', 'outside', 'alias.txt'].includes(file.path)));
    for (const path of ['../host/credentials.enc', '.env', 'outside/credentials.enc', 'alias.txt', '/etc/passwd']) {
      const result = await fixture.request(`/sessions/${fixture.session.id}/prompt`, 'POST', {
        text: 'Read evidence.',
        files: [path],
      });
      assert.ok([400, 403].includes(result.status));
    }
    const result = await fixture.request(`/sessions/${fixture.session.id}/prompt`, 'POST', {
      text: 'Read absent.',
      files: ['absent.txt'],
    });
    assert.ok(result.status >= 400);
    await assert.rejects(
      fileCandidates(fixture.root, 'host/', join(fixture.root, 'host')),
      /Host 数据目录|超出当前项目权限/,
    );
    await assert.rejects(
      fileCandidates(fixture.root, 'host/sessions/', join(fixture.root, 'host')),
      /Host 数据目录|超出当前项目权限/,
    );
    fixture.fake.setResponses([fauxAssistantMessage('Usable after rejected input.')]);
    await fixture.host.service.prompt(fixture.session.id, 'Continue.');
    await fixture.wait(async () => !(await fixture.host.service.viewSession(fixture.session.id)).busy);
    assert.equal((await fixture.host.service.viewSession(fixture.session.id)).error, undefined);
  } finally {
    await fixture.close();
  }
});

test('Tool catalog uses native metadata without loading unreviewed executable sources', async () => {
  const fixture = await fixtureInput();
  try {
    const packageRoot = await skillPackage(join(fixture.root, 'package'));
    const [skill] = await fixture.host.service.skills.import({ source: packageRoot, bindings });
    assert.ok(skill);
    const before = await (await fixture.request(`/tools?project=${encodeURIComponent(fixture.project)}`)).json();
    assert.ok(
      before.tools.some((tool: { name: string; parameters: unknown }) => tool.name === 'read' && tool.parameters),
    );
    assert.ok(!before.tools.some((tool: { name: string }) => tool.name === 'skill_echo'));
    assert.equal(
      before.sources.find((source: { skillId: string }) => source.skillId === skill.id).review,
      'unreviewed',
    );
    const version = fixture.host.service.skills.version(skill.latest);
    await fixture.host.service.skills.review(
      skill.id,
      version.id,
      version.digest,
      'Reviewed fixture code and dependencies.',
    );
    const operation = fixture.host.service.skills.publish(
      skill.id,
      version.id,
      fixture.host.service.skills.record(skill.id).revision,
    );
    await fixture.wait(
      () => !['checking', 'waiting'].includes(fixture.host.service.skills.operation(operation.id).status),
    );
    assert.equal(fixture.host.service.skills.operation(operation.id).status, 'applied');
    const after = await (await fixture.request(`/tools?project=${encodeURIComponent(fixture.project)}`)).json();
    const tool = after.tools.find((entry: { name: string }) => entry.name === 'skill_echo');
    assert.ok(tool, 'Published native Tool is visible through the project path alias');
    assert.equal(tool.skillId, skill.id);
    assert.equal(tool.exposure, 'deferred');
    assert.equal(tool.status, 'available');
    assert.ok(tool.parameters.properties.value);
    assert.deepEqual(tool.callableSessions, [fixture.session.id]);
    assert.deepEqual(tool.activeSessions, []);
    const supported = after.tools.find((entry: { name: string }) => entry.name === 'grep');
    assert.equal(supported.status, 'disabled');
    assert.deepEqual(supported.sessions, [fixture.session.id]);
    assert.deepEqual(supported.callableSessions, []);
  } finally {
    await fixture.close();
  }
});
