import type {
  ReflectionJob,
  ReflectionJobStatus,
  ReflectionSourceStatus,
} from '../../../../apps/host/reflection/reflection-jobs';
import type {
  ReflectionRecord,
  ReflectionService,
  SessionRecord,
} from '../../../../apps/host/reflection/reflection-service';
import type { DiagnosticHistory } from '../../../../apps/host/diagnostics/diagnostic-history';

export type Catalog = ReturnType<ReflectionService['catalog']>;
export type CatalogJob = Catalog['jobs'][number];
export type SourceEvidence = Awaited<ReturnType<DiagnosticHistory['evidence']>>;
export type Detail = { job: ReflectionJob; record?: ReflectionRecord };
export const statuses = [
  'succeeded',
  'waiting_user',
  'failed',
  'running',
  'interrupted',
  'pending',
] as const satisfies readonly ReflectionJobStatus[];
export const scenarios = [
  'mixed',
  'empty',
  'loading',
  'list-error',
  'detail-error',
  'environment-unchecked',
  'environment-unavailable',
  'source-missing',
  'source-truncated',
  'source-old-branch',
  'source-previous',
  'source-denied',
  'metadata-missing',
  'pagination',
] as const;
export type Scenario = (typeof scenarios)[number];
export interface Fixture {
  seed: number;
  scenario: Scenario;
  details: Detail[];
  sessions: SessionRecord[];
  evidence: SourceEvidence[];
  availability: Catalog['availability'];
}
export const fixedNow = Date.parse('2026-10-25T18:00:00.000Z');
export const id = (seed: number, n: number) =>
  `a6000000-0000-4000-8000-${(seed * 10000 + n).toString(16).padStart(12, '0')}`;
const tasks = [
  '核对发布测试范围',
  '核验备份恢复结果',
  '整理项目结构',
  '整理研究笔记',
  '核对接口兼容范围',
  '整理版本发布说明',
];

export function createFixture({
  seed = 25,
  count = 12,
  scenario = 'mixed',
}: {
  seed?: number;
  count?: number;
  scenario?: Scenario;
} = {}): Fixture {
  const details: Detail[] = [],
    sessions: SessionRecord[] = [],
    evidence: SourceEvidence[] = [];
  for (let i = 0; i < (scenario === 'empty' ? 0 : count); i++) {
    const sample = i % 10;
    const proposed = sample < statuses.length ? statuses[sample] : 'succeeded';
    const status = proposed === 'running' && details.some((d) => d.job.status === 'running') ? 'succeeded' : proposed;
    const sessionId = id(seed, 1000 + i);
    const project = `/Users/person/Projects/${i % 3 === 0 ? 'research' : 'agent'}`;
    const created = fixedNow - i * 3_600_000 - Math.floor(i / 6) * 86_400_000;
    const sourceStatus: ReflectionSourceStatus = (['ended', 'stopped', 'failed'] as const)[i % 3];
    const error =
      status === 'failed'
        ? '检查超过时限；中断前已保存的成果保留，不自动重放。'
        : status === 'interrupted'
          ? 'Host 运行中断；已提交成果保留，不自动重放。'
          : status === 'waiting_user'
            ? '原生隔离服务不可用，等待环境恢复。'
            : undefined;
    const job: ReflectionJob = {
      id: id(seed, i + 1),
      sessionId,
      project,
      provider: 'fixture',
      model: 'fixture-model',
      scheduledAt: created + 30_000,
      created,
      updated: created + 60_000,
      runId: status === 'pending' || status === 'waiting_user' ? null : id(seed, 2000 + i),
      ...(status !== 'pending' && status !== 'waiting_user' ? { reflectionSessionId: id(seed, 3000 + i) } : {}),
      status,
      ...(error ? { error } : {}),
      sources: Array.from({ length: 1 + (i % 3) }, (_, n) => ({
        markerEntryId: `settled-${i}-${n}`,
        settledAt: created - n * 1000,
        status: sourceStatus,
        ...(n % 2 ? {} : { traceId: id(seed, 4000 + i) }),
      })),
    };
    sessions.push({
      id: sessionId,
      cwd: project,
      project,
      provider: job.provider,
      model: job.model,
      title: tasks[i % tasks.length],
      updated: job.updated,
      purpose: 'chat',
    });
    const hasRecord = status !== 'pending' && status !== 'waiting_user';
    const summary =
      sample === 6 || status === 'running'
        ? ''
        : sample === 7
          ? '本次没有新增发现。'
          : sample === 8
            ? '尚未读取对应版本的接口契约，不能将已有使用经验视为本次验证结果。\n'.repeat(18)
            : status === 'failed'
              ? '已保存两个文件的校验结果；其余文件尚未核验。'
              : status === 'interrupted'
                ? '中断前已保存检查范围，尚不能确认全部结果。'
                : '构建已经通过，集成测试尚未运行。发布结论仍需补充验证。';
    const record: ReflectionRecord | undefined = hasRecord
      ? {
          id: job.id,
          jobId: job.id,
          sessionId,
          reflectionSessionId: id(seed, 3000 + i),
          project,
          status,
          created,
          updated: job.updated,
          summary,
          findings: sample === 0 || status === 'failed' ? ['当前结果仅覆盖已读取的材料。'] : [],
          uncertainties: sample === 0 || sample === 8 ? ['集成测试与真实运行环境仍未核实。'] : [],
          evidence: [{ sessionId, entryId: `source-${i}` }],
          changes:
            status === 'failed' || status === 'interrupted' || sample === 0
              ? [
                  {
                    kind: 'skill_knowledge',
                    id: id(seed, 5000 + i),
                    knowledgeRevision: id(seed, 6000 + i),
                    file: 'checks.md',
                    summary: '保存本次实际检查范围，保留未核验部分。',
                  },
                ]
              : [],
          ...(error ? { error } : {}),
        }
      : undefined;
    details.push({ job, ...(record ? { record } : {}) });
    const content = JSON.stringify({
      id: `source-${i}`,
      type: 'message',
      message: {
        role: 'toolResult',
        toolName: 'read',
        content: [
          {
            type: 'text',
            text: `已读取检查清单。任务：${tasks[i % tasks.length]}。\n已核验的两个文件校验值匹配；其余项目未运行，不能推断全部检查通过。`,
          },
        ],
      },
    });
    const base = {
      sessionId,
      entryId: `source-${i}`,
      source: scenario === 'source-previous' ? ('previous_checkpoint' as const) : ('checkpoint' as const),
      recovered: scenario === 'source-previous',
      onSelectedBranch: scenario !== 'source-old-branch',
    };
    evidence.push(
      scenario === 'source-missing'
        ? { ...base, available: false, reason: 'entry_missing_from_checkpoint', truncated: false, total: 0 }
        : {
            ...base,
            available: true,
            nested: false,
            content,
            truncated: scenario === 'source-truncated',
            total: scenario === 'source-truncated' ? content.length * 2 : content.length,
            ...(scenario === 'source-truncated' ? { nextOffset: content.length } : {}),
          },
    );
  }
  return {
    seed,
    scenario,
    details,
    sessions: scenario === 'metadata-missing' ? [] : sessions,
    evidence,
    availability:
      scenario === 'environment-unchecked'
        ? { available: false, reason: '尚未检查反思环境；有待执行任务时自动检查，也可手动检查。' }
        : scenario === 'environment-unavailable'
          ? { available: false, reason: '原生隔离服务不可用，不能在普通环境执行。', checkedAt: fixedNow }
          : { available: true, checkedAt: fixedNow },
  };
}

export function catalog(
  fixture: Fixture,
  {
    sessionId,
    limit = 20,
    offset = 0,
    statusOnly = false,
  }: { sessionId?: string; limit?: number; offset?: number; statusOnly?: boolean } = {},
): Catalog {
  const all = fixture.details.filter((d) => !sessionId || d.job.sessionId === sessionId);
  const order = { running: 0, waiting_user: 1, pending: 2, succeeded: 3, failed: 3, interrupted: 3 };
  const sorted = [...all].sort((a, b) =>
    statusOnly
      ? order[a.job.status] - order[b.job.status] || b.job.updated - a.job.updated || b.job.id.localeCompare(a.job.id)
      : b.job.created - a.job.created || b.job.id.localeCompare(a.job.id),
  );
  const rows = sorted.slice(statusOnly ? 0 : offset, statusOnly ? 1 : offset + limit);
  return {
    jobs: rows.map(({ job }) => ({
      id: job.id,
      sessionId: job.sessionId,
      created: job.created,
      updated: job.updated,
      scheduledAt: job.scheduledAt,
      status: job.status,
      reflectionSessionId: job.reflectionSessionId,
      error: job.error,
      sourceCount: job.sources.length,
    })),
    records: statusOnly
      ? []
      : rows.flatMap(({ record }) =>
          record
            ? [{ id: record.id, jobId: record.jobId, summary: Array.from(record.summary).slice(0, 240).join('') }]
            : [],
        ),
    total: all.length,
    limit: statusOnly ? 1 : limit,
    offset: statusOnly ? 0 : offset,
    pending: all.filter((d) => d.job.status === 'pending').length,
    availability: fixture.availability,
  };
}

export class FixtureError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}
export function createTransport(fixture: Fixture) {
  const calls: Array<{ operation: string; id?: string; offset?: number }> = [];
  const failures = new Set<string>();
  const once = (key: string) => {
    if (failures.has(key)) return false;
    failures.add(key);
    return true;
  };
  const wait = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const timer = setTimeout(
        () => {
          signal?.removeEventListener('abort', abort);
          resolve();
        },
        fixture.scenario === 'loading' ? 2500 : 90,
      );
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    });
  return {
    calls,
    async catalog(input: { sessionId?: string; offset?: number }, signal?: AbortSignal) {
      calls.push({ operation: 'catalog', offset: input.offset ?? 0 });
      await wait(signal);
      if (fixture.scenario === 'list-error' && once('list-error'))
        throw new FixtureError('反思状态读取或操作未完成，请重新读取', 503, 'REFLECTION_UNAVAILABLE');
      return catalog(fixture, input);
    },
    async detail(jobId: string, signal?: AbortSignal) {
      calls.push({ operation: 'detail', id: jobId });
      await wait(signal);
      if (fixture.scenario === 'detail-error' && once(`detail:${jobId}`))
        throw new FixtureError('反思记录读取未完成，请重新读取', 503, 'REFLECTION_UNAVAILABLE');
      const result = fixture.details.find((d) => d.job.id === jobId);
      if (!result) throw new FixtureError('反思任务不存在', 404, 'REFLECTION_NOT_FOUND');
      return structuredClone(result);
    },
    async source(sessionId: string, entryId: string, signal?: AbortSignal) {
      calls.push({ operation: 'source', id: entryId });
      await wait(signal);
      if (fixture.scenario === 'source-denied') throw new FixtureError('来源不受信任', 403);
      const entry = fixture.evidence.find((e) => e.sessionId === sessionId && e.entryId === entryId);
      if (!entry) throw new FixtureError('证据不存在', 404, 'DIAGNOSTIC_NOT_FOUND');
      return structuredClone(entry);
    },
  };
}
export type Transport = ReturnType<typeof createTransport>;
