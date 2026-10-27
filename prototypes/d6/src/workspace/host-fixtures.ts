import type {
  WorkspacePayload,
  MemoryView,
  ReflectionRecord,
  ReflectionJob,
  EvolutionSuggestion,
  EvolutionActivity,
} from './host-data';

export const uid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (day: number, hour = 14) => new Date(2026, 9, day, hour, 33).getTime();
export const project = '/Users/person/Projects/agent';
export const researchProject = '/Users/person/Projects/research';
export const researchHash = '506e9e4679b5bd082d08f6e9c97befc32ed7d97471d608e80e1e59832f25fbd7';
export const projectHash = 'cf2b170d5ffd0175ddddaee6a5b1ac2ba55f1cd875d39b9cee99f826fe631a4a';
export const fixtureProjects: Record<string, string> = { [project]: projectHash, [researchProject]: researchHash };
const source = (n: number, entryId = 'task-result') => ({ sessionId: uid(n), entryId, project: projectHash });
function memory(n: number, title: string, content: string, overrides: Partial<MemoryView> = {}): MemoryView {
  return {
    id: uid(n),
    revision: 1,
    previousRevision: null,
    title,
    content,
    kind: 'fact',
    scope: 'project',
    project: projectHash,
    status: 'current',
    operation: 'create',
    reason: '根据任务保留的材料记录',
    actor: 'agent',
    created: at(23),
    sources: [source(1)],
    basis: [],
    isCurrent: true,
    usable: true,
    unavailable: false,
    ...overrides,
  };
}
function job(
  n: number,
  session: number,
  status: ReflectionJob['status'],
  overrides: Partial<ReflectionJob> = {},
): ReflectionJob {
  return {
    id: uid(n),
    sessionId: uid(session),
    project: [6, 7, 8].includes(session) ? researchProject : project,
    provider: 'example',
    model: 'example-model',
    scheduledAt: at(23),
    created: at(23),
    updated: at(23),
    runId: status === 'pending' || status === 'waiting_user' ? null : uid(n + 100),
    status,
    sources: [{ markerEntryId: 'settled-task', settledAt: at(23), status: 'ended' }],
    ...overrides,
  };
}
function record(j: ReflectionJob, summary: string, overrides: Partial<ReflectionRecord> = {}): ReflectionRecord {
  return {
    id: j.id,
    jobId: j.id,
    sessionId: j.sessionId,
    reflectionSessionId: uid(Number(j.id.slice(-12)) + 200),
    project: j.project,
    status: j.status,
    created: j.created,
    updated: j.updated,
    summary,
    findings: [],
    uncertainties: [],
    evidence: [],
    changes: [],
    ...overrides,
  };
}
function suggestion(n: number, title: string, overrides: Partial<EvolutionSuggestion> = {}): EvolutionSuggestion {
  return {
    id: uid(n),
    title,
    goal: '先核对现有行为与任务要求，再决定是否需要修改。',
    reason: '任务记录中保留了需要进一步核对的行为。',
    value: '减少后续任务中重复核对的成本。',
    uncertainty: '尚未确定是否需要修改现有技能。',
    action: '进入讨论，核对目标和允许修改的范围。',
    evidence: [],
    priority: 'normal',
    project,
    actor: 'agent',
    status: 'pending',
    revision: 1,
    created: at(23),
    updated: at(23),
    ...overrides,
  };
}
function activity(
  n: number,
  goal: string,
  status: EvolutionActivity['status'],
  overrides: Partial<EvolutionActivity> = {},
): EvolutionActivity {
  return {
    id: uid(n),
    sessionId: uid(n + 500),
    project,
    goal,
    status,
    revision: 3,
    created: at(22),
    updated: at(22, 16),
    releases: [],
    grant: {
      id: uid(n + 600),
      goal,
      at: at(22),
      actor: 'user',
      targets: [
        {
          key: uid(n === 43 ? 404 : n === 42 ? 407 : n === 44 ? 408 : 401),
          skillId: uid(n === 43 ? 404 : n === 42 ? 407 : n === 44 ? 408 : 401),
          name: n === 43 ? 'backup-report' : n === 42 ? 'text-diff' : n === 44 ? 'migration-report' : 'release-report',
          baseRevision: 2,
          directory: `/agent-data/evolution/${uid(n)}/${uid(n === 43 ? 404 : n === 42 ? 407 : n === 44 ? 408 : 401)}`,
        },
        ...(n === 43
          ? [
              {
                key: uid(409),
                skillId: uid(409),
                name: 'backup-index',
                baseRevision: 1,
                directory: `/agent-data/evolution/${uid(n)}/${uid(409)}`,
              },
            ]
          : []),
      ],
    },
    ...overrides,
  };
}
export const fixtureAliases: Record<'memory' | 'reflection' | 'evolution', Record<string, string>> = {
  memory: { report: uid(11), auth: uid(12), old: uid(13), doubt: uid(14) },
  reflection: { finding: uid(21), none: uid(22), unavailable: uid(23) },
  evolution: { covered: uid(31) },
};
// Navigation compatibility, never a source for generated conclusions.
export const loadedDemoSessions: Record<string, string> = { [uid(1)]: 'compare', [uid(2)]: 'notes' };
export function createWorkspaceFixtures(): WorkspacePayload {
  const report1 = memory(11, '差异报告默认使用表格', '默认以表格汇总文档差异。', {
    kind: 'experience',
    scope: 'project',
    project: projectHash,
    created: at(20),
    isCurrent: false,
    usable: false,
    sources: [],
    reason: '形成初始报告习惯',
  });
  const report2 = memory(
    11,
    '差异报告应单列未核实内容',
    '默认以表格汇总差异，并单列尚未核实的内容。不要把材料缺失推断为没有变化。',
    {
      kind: 'experience',
      scope: 'global',
      project: null,
      revision: 2,
      previousRevision: 1,
      operation: 'revise',
      reason: '兼容附件缺失时，结论需要明确覆盖边界',
    },
  );
  const auth = memory(12, '新版使用设备授权登录', '项目说明 v2 将首次登录改为设备授权；用户在浏览器确认后返回应用。', {
    reason: '来自新版项目说明的身份认证章节',
  });
  const old = memory(13, '保留密码登录作为默认入口', '旧版以密码登录作为默认入口。', {
    kind: 'decision',
    status: 'withdrawn',
    operation: 'branch',
    actor: 'system',
    usable: false,
    created: at(18),
    reason: '来源分支不再有效',
    basis: [source(1, 'old-decision')],
  });
  const doubt = memory(14, '旧客户端是否仍可登录', '兼容说明缺失，尚不能确认旧客户端在设备授权迁移后是否可用。', {
    kind: 'hypothesis',
    reason: '附件读取失败；需要新的直接依据',
  });
  const tests1 = memory(15, '发布前运行全量测试', '发布前执行全部测试。', {
    kind: 'experience',
    created: at(21),
    sources: [source(3)],
    isCurrent: false,
    usable: false,
  });
  const tests2 = memory(
    15,
    '发布检查需区分已运行与未运行的测试',
    '本次增量构建通过，但集成测试没有运行。报告应分别列出已执行检查和未验证范围。',
    {
      kind: 'experience',
      revision: 2,
      previousRevision: 1,
      operation: 'revise',
      sources: [source(3)],
      reason: '构建结果不能替代集成测试结果',
    },
  );
  const restore = memory(16, '恢复前保留旧数据目录', '恢复到新目录，核对后再决定是否替换旧目录。', {
    kind: 'decision',
    sources: [],
    basis: [source(4)],
    usable: false,
    unavailable: true,
    reason: '适用依据正在恢复，暂不用于当前判断',
  });
  const j1 = job(21, 1, 'succeeded');
  const j2 = job(22, 2, 'succeeded', { created: at(22), updated: at(22) });
  const j3 = job(23, 5, 'waiting_user', { error: '原生隔离服务不可用，等待环境恢复。' });
  const j4 = job(24, 3, 'succeeded');
  const j5 = job(25, 4, 'failed', { error: '检查超过时限；部分变更已在失败前保存。' });
  const j6 = job(26, 6, 'interrupted', { error: 'Host 中断；不自动重放检查。' });
  const j7 = job(27, 7, 'pending');
  const j8 = job(28, 8, 'succeeded');
  const partial = memory(17, '恢复核验只覆盖了清单中的两个文件', '两项文件校验通过；其余内容尚未完成核验。', {
    sources: [source(4)],
    reason: '检查超时前已提交的观察记录',
    kind: 'experience',
  });
  return {
    sessions: [
      [1, '比较两版项目说明'],
      [2, '整理版本发布说明'],
      [3, '核对发布测试范围'],
      [4, '核验备份恢复结果'],
      [5, '整理项目结构'],
      [6, '排查下载中断'],
      [7, '整理研究笔记'],
      [8, '核对旧版 API 兼容范围'],
      [303, '备份报告区分已核验与未核验的文件'],
      [541, '讨论发布报告的测试范围'],
      [542, '讨论文档比较的材料缺失规则'],
      [543, '讨论备份文件校验报告'],
      [544, '讨论迁移报告的环境信息'],
    ].map(([id, title]) => ({
      id: uid(Number(id)),
      title: String(title),
      cwd: [6, 7, 8].includes(Number(id)) ? researchProject : project,
      project: [6, 7, 8].includes(Number(id)) ? researchProject : project,
      provider: 'example',
      model: 'example-model',
      updated: at(23),
      purpose: Number(id) === 303 || Number(id) > 500 ? ('discussion' as const) : ('chat' as const),
    })),
    memories: [
      (() => {
        const value = memory(
          18,
          '研究摘录保留原文页码',
          '引用研究材料时，记录原文页码与版本；没有页码时标明定位方式。',
          {
            kind: 'decision',
            project: researchHash,
            sources: [{ sessionId: uid(7), entryId: 'research-note', project: researchHash }],
            basis: [{ sessionId: uid(7), entryId: 'research-note', project: researchHash }],
          },
        );
        return { current: value, history: [value] };
      })(),
      (() => {
        const value = memory(19, '引用中区分观察与推断', '研究笔记中分开记录直接观察与推断，保留不确定性。', {
          kind: 'experience',
          scope: 'global',
          project: null,
          sources: [{ sessionId: uid(7), entryId: 'research-note', project: researchHash }],
        });
        return { current: value, history: [value] };
      })(),

      { current: report2, history: [report2, report1] },
      { current: auth, history: [auth] },
      { current: old, history: [old] },
      { current: doubt, history: [doubt] },
      { current: tests2, history: [tests2, tests1] },
      { current: restore, history: [restore] },
      { current: partial, history: [partial] },
    ],
    reflections: [
      {
        job: j1,
        record: record(j1, '两版正文已比较，旧客户端支持范围仍待核实。', {
          findings: ['正文中的登录方式由密码登录改为设备授权。'],
          uncertainties: ['兼容附件缺失，无法确认旧客户端在迁移后的登录方式。'],
          evidence: [{ sessionId: uid(1), entryId: 'comparison', traceId: uid(101) }],
          changes: [
            { kind: 'memory', id: uid(11), revision: 2, summary: report2.reason },
            { kind: 'memory', id: uid(12), revision: 1, summary: auth.reason },
            { kind: 'suggestion', id: uid(31), summary: '核对文档比较对缺失材料的处理' },
          ],
        }),
      },
      {
        job: j2,
        record: record(j2, '本次没有新增发现。', { evidence: [{ sessionId: uid(2), entryId: 'release-notes' }] }),
      },
      { job: j3 },
      {
        job: j4,
        record: record(j4, '增量构建已通过，集成测试未运行。', {
          findings: ['构建过程正常结束。'],
          uncertainties: ['当前材料不能判断集成测试是否通过。'],
          changes: [{ kind: 'memory', id: uid(15), revision: 2, summary: tests2.reason }],
          evidence: [{ sessionId: uid(3), entryId: 'build-result' }],
        }),
      },
      {
        job: j5,
        record: record(j5, '', {
          changes: [{ kind: 'memory', id: uid(17), revision: 1, summary: partial.reason }],
          evidence: [{ sessionId: uid(4), entryId: 'partial-check' }],
          error: j5.error,
        }),
      },
      { job: j6 },
      { job: j7 },
      {
        job: j8,
        record: record(
          j8,
          '当前记录只保留了对旧版 API 兼容范围的初步说明。尚未读取对应版本的接口契约，不能将已有使用经验视为本次验证结果。需要区分已读材料、未读材料与仍未确认的调用条件，后续应以对应版本的直接材料核对。',
          { findings: [], uncertainties: ['旧版 API 的适用版本和参数约束尚未验证。'], evidence: [] },
        ),
      },
    ],
    suggestions: [
      suggestion(31, '核对文档比较对缺失材料的处理', {
        status: 'ignored',
        revision: 2,
        source: { sessionId: uid(1), entryId: 'comparison', project },
        reflectionId: j1.id,
        evidence: [{ reflectionId: j1.id }],
        reason: '比较任务未读到兼容附件，需要核对已有处理规则。',
        uncertainty: '现有记录未说明是否需要修改。',
      }),
      suggestion(32, '为发布报告附上实际运行的测试范围', {
        goal: '在报告中区分已执行检查与尚未运行的测试，不把构建通过当作集成测试通过。',
        reason: '发布检查只运行了构建，集成测试结果仍未知。',
        value: '让用户能判断报告覆盖了哪些验证范围。',
        uncertainty: '需要先核对现有报告技能是否已经支持这种区分。',
        evidence: [{ reflectionId: j4.id }, { memoryId: uid(15), revision: 2 }],
        reflectionId: j4.id,
        priority: 'high',
        attentionReason: '尚未验证的范围影响发布判断。',
      }),
      suggestion(33, '备份报告区分已核验与未核验的文件', {
        status: 'adopted',
        discussionSessionId: uid(303),
        evidence: [{ reflectionId: j5.id }],
        reflectionId: j5.id,
        goal: '报告只把实际核验过的文件列为已验证。',
      }),
      suggestion(34, '迁移脚本记录运行环境', {
        status: 'archived',
        uncertainty: '尚未读取脚本，无法确认是否缺少环境信息。',
        reason: '仅有会话中的初步想法，没有返回证据引用。',
      }),
    ],
    activities: [
      activity(45, '报告只把实际核验过的文件列为已验证。', 'discussion', {
        sessionId: uid(303),
        suggestionId: uid(33),
        grant: undefined,
        revision: 1,
      }),
      activity(41, '让发布报告区分实际运行的测试范围', 'completed', {
        result: {
          summary: '发布指引已补充测试覆盖范围。',
          packages: [{ target: uid(401), skillFile: 'SKILL.md', extensions: [], knowledgeFiles: [], probes: [] }],
        },
        releases: [{ skillId: uid(401), version: uid(402), operationId: uid(403) }],
      }),
      activity(42, '核对文档比较是否需要调整缺失材料规则', 'completed', {
        result: { summary: '现有规则已覆盖本次目标，没有提交能力变更。', packages: [] },
        suggestionId: uid(31),
      }),
      activity(43, '核对备份报告中的文件校验结果', 'failed', {
        result: {
          summary: '已整理两份候选报告指引，等待必要检查。',
          packages: [404, 409].map((id) => ({
            target: uid(id),
            skillFile: 'SKILL.md',
            extensions: [],
            knowledgeFiles: [],
            probes: [],
          })),
        },
        error: '第二个候选检查失败；第一个版本已在失败前发布。',
        releases: [{ skillId: uid(404), version: uid(405), operationId: uid(406) }],
      }),
      activity(44, '整理迁移报告的环境信息', 'cancelled', { error: '用户取消；不自动继续开发。' }),
    ],
  };
}

// Extra Host-shaped records are available only through the existing long-content scenario.
export function createStressFixtures(base: WorkspacePayload, count = 64): WorkspacePayload {
  const extra = createWorkspaceFixtures();
  const counts = {
    memories: extra.memories.length,
    reflections: extra.reflections.length,
    suggestions: extra.suggestions.length,
  };
  const facts = [
    ['保留原文页码', '引用研究材料时记录页码，无法定位的段落单独标明。'],
    ['长文摘录的适用范围', '仅对实际读过的材料归纳，不将未读取的章节纳入结论。'.repeat(35)],
    ['检查命令的退出状态', '检查未运行时不能标记为通过。'],
    ['迁移报告的环境信息', '运行环境尚待核实。'],
  ];
  for (let i = 0; i < count; i++) {
    const [label, content] = facts[i % facts.length];
    const value = memory(1000 + i, `${label} · ${i + 1}`, content, {
      scope: i % 3 ? 'project' : 'global',
      kind: i % 4 === 3 ? 'hypothesis' : 'fact',
      project: i % 3 ? projectHash : null,
      sources: [],
      basis: [],
      actor: 'user',
      reason: '用户记录',
      created: at(21, i % 24),
    });
    extra.memories.push({ current: value, history: [value] });
    const j = job(2000 + i, i % 2 ? 7 : 3, i % 7 === 0 ? 'failed' : 'succeeded', {
      updated: at(20, i % 24),
      created: at(20, i % 24),
      ...(i % 7 === 0 ? { error: '读取任务材料失败，检查未完成。' } : {}),
    });
    extra.reflections.push({
      job: j,
      record: record(j, i % 2 ? content : '当前材料不足，尚不能确认完整范围。', {
        evidence: [],
        findings: [],
        changes: [],
        uncertainties: i % 2 ? [] : ['仍需读取缺失的材料。'],
      }),
    });
    extra.suggestions.push(
      suggestion(3000 + i, `${label} · 第 ${i + 1} 份材料`, {
        goal: content,
        reason: '当前记录仅覆盖部分材料，需要先确认现有指引是否已经支持。',
        uncertainty: '尚未读取全部材料，是否需要修改仍待讨论。',
        evidence: i % 11 === 1 ? [{ memoryId: uid(9090), revision: 4 }] : [],
        reflectionId: undefined,
        source: undefined,
        updated: at(19, i % 24),
        status: i % 5 === 0 ? 'archived' : 'pending',
      }),
    );
  }
  return {
    ...base,
    memories: [...base.memories, ...extra.memories.slice(counts.memories)],
    reflections: [...base.reflections, ...extra.reflections.slice(counts.reflections)],
    suggestions: [...base.suggestions, ...extra.suggestions.slice(counts.suggestions)],
  };
}
