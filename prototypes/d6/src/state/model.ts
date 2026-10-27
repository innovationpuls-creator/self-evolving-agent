export type Mode = 'quiet' | 'studio';
export type Page = 'chat' | 'trace' | 'memory' | 'reflection' | 'skills' | 'evolution' | 'settings';
export type Scenario = 'normal' | 'loading' | 'empty' | 'error' | 'long' | 'offline';
export type RunState = 'idle' | 'running' | 'stopped' | 'done' | 'interrupted';
export interface Session {
  id: string;
  title: string;
  project: string;
  draft: string;
  messages: string[];
  transcript?: { role: 'user' | 'assistant'; text: string }[];
  refs: string[];
  model: string;
  reasoning: string;
  run: RunState;
  branch: number;
  archived: boolean;
}
export interface Revision {
  text: string;
  reason: string;
  author: string;
  date: string;
}
export interface Knowledge {
  id: string;
  title: string;
  kind: '经验' | '决定' | '事实' | '怀疑';
  scope: '项目' | '全局';
  status: 'current' | 'revoked' | 'deleted';
  revisions: Revision[];
}
export interface Skill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  extension: boolean;
  version: number;
  versions: number[];
  candidate: string;
  candidateTrusted?: boolean;
  candidateFile?: string;
  code?: string;
  snapshots?: Record<number, { content: string; code?: string }>;
  trusted: boolean;
  content: string;
}
export type DevPhase =
  | 'suggestion'
  | 'discussion'
  | 'developing'
  | 'checking'
  | 'applied'
  | 'failed'
  | 'cancelled'
  | 'nochange';
export interface Store {
  sessions: Session[];
  memories: Knowledge[];
  skills: Skill[];
  phase: DevPhase;
  goal: string;
  discussion: string[];
  grant: null | { goal: string; skill: string; base: number; allowNew: string };
  devEvents: string[];
  auth: 'saved' | 'none' | 'waiting' | 'expired';
  env: boolean;
  connection: boolean;
  authTest: 'unknown' | 'checking' | 'passed' | 'failed';
  provider: string;
}
export const files = ['docs/项目说明-v1.md', 'docs/项目说明-v2.md', '资料/兼容说明.md'];
export const report = `## 从密码登录迁移到设备授权
两版说明的主要变化集中在**身份认证**和**数据恢复**。正文已完成比较；兼容附件缺失，旧版支持范围仍待确认。

### 变化与影响
| 内容 | 旧版说明 | 新版说明 |
| :--- | :--- | :--- |
| 登录方式 | 用户名与密码 | 浏览器设备授权 |
| 数据保护 | 本地保存 | 加密备份，可恢复到新目录 |
| 旧版兼容 | 附件补充 | 附件未提供，暂不判断 |

### 发布前需要确认
1. 补齐兼容说明，核实旧版客户端的登录路径。
2. 为首次使用者增加设备授权操作指引。
3. 在恢复说明中写清“恢复到新目录”，避免覆盖原数据。

> 本次结论仅覆盖两份正文。读取附件失败不等于附件内容没有变化。

### 可复用的比较方式
下面保留文件位置，便于重新核对，而不是只给出没有来源的结论。

\`\`\`typescript
const comparison = compareDocuments({
  before: 'docs/项目说明-v1.md',
  after: 'docs/项目说明-v2.md',
  includeContext: true,
});
return { changes: comparison.changes, unchecked: ['兼容说明'] };
\`\`\`

- [x] 比较两份正文
- [x] 保留章节位置与差异上下文
- [ ] 补齐兼容附件后再核实旧版支持
`;
export const skillText = `# text-diff
比较文本的语义与行级变化，保留章节和文件位置。

## 报告规则
- 先给出主要变化与影响，再展示细节。
- 保留新增、删除和上下文；不要仅依赖颜色。
- 对无法读取的材料说明缺口，不补造结论。

## 工具
按需使用 text_diff，比较前确认输入材料覆盖范围。`;
export const rawTool = {
  tool: 'text_diff',
  callId: 'call_demo_03',
  status: 'returned',
  input: { before: files[0], after: files[1], options: { contextLines: 3, ignoreWhitespace: false } },
  output: {
    changes: [
      {
        section: '身份认证',
        kind: 'modified',
        range: { before: [12, 14], after: [12, 19] },
        removed: ['使用用户名与密码登录'],
        added: ['在浏览器完成设备授权'],
        evidence: { files: files.slice(0, 2), completeness: '正文完整，兼容附件缺失' },
      },
    ],
    attachments: [{ path: files[2], status: 'unavailable', error: { code: 'ENOENT', message: '文件不存在' } }],
  },
  durationMs: null,
  credential: '[已脱敏]',
};
export const toolEvents = [
  {
    id: 'read',
    purpose: '阅读两版项目说明',
    target: '项目说明-v1.md · 项目说明-v2.md',
    tool: 'read',
    status: 'success',
    result: '已读取两份正文，保留原始章节位置',
    time: '14:32:06',
  },
  {
    id: 'diff',
    purpose: '比较正文变化',
    target: '身份认证、数据恢复与兼容说明',
    tool: 'text_diff',
    status: 'success',
    result: '返回 2 处正文变化；兼容范围未判断',
    time: '14:32:08',
  },
  {
    id: 'fail',
    purpose: '核实旧版兼容承诺',
    target: '资料/兼容说明.md',
    tool: 'read',
    status: 'error',
    result: '文件不存在。报告已标出尚未核实的内容',
    time: '14:32:09',
  },
  {
    id: 'unknown',
    purpose: '查询文档元数据',
    target: 'Extension · document_info',
    tool: 'document_info',
    status: 'unknown',
    result: '已收到返回值，未提供可靠的结果摘要',
    time: '14:32:10',
  },
];
export function initial(): Store {
  return {
    sessions: [
      {
        id: 'compare',
        title: '比较两版项目说明',
        project: '~/Projects/agent',
        draft: '',
        messages: ['比较两版项目说明，列出变化、影响和仍需确认的内容。'],
        refs: files.slice(0, 2),
        model: '通用模型',
        reasoning: '标准',
        run: 'done',
        branch: 1,
        archived: false,
      },
      {
        id: 'notes',
        title: '整理版本发布说明',
        project: '~/Projects/agent',
        draft: '先帮我整理发布说明的结构。',
        messages: [],
        refs: [],
        model: '通用模型',
        reasoning: '标准',
        run: 'idle',
        branch: 1,
        archived: false,
      },
    ],
    memories: [
      {
        id: 'report',
        title: '差异报告应单列未核实内容',
        kind: '经验',
        scope: '全局',
        status: 'current',
        revisions: [
          { text: '默认以表格汇总文档差异。', reason: '形成初始报告习惯', author: 'Agent', date: '10月20日 16:40' },
          {
            text: '默认以表格汇总差异，并单列尚未核实的内容。不要把材料缺失推断为没有变化。',
            reason: '兼容附件缺失时，结论需要明确覆盖边界',
            author: 'Agent',
            date: '今天 14:33',
          },
        ],
      },
      {
        id: 'auth',
        title: '新版使用设备授权登录',
        kind: '事实',
        scope: '项目',
        status: 'current',
        revisions: [
          {
            text: '项目说明 v2 将首次登录改为设备授权；用户在浏览器确认后返回应用。',
            reason: '来自新版项目说明的身份认证章节',
            author: 'Agent',
            date: '今天 14:33',
          },
        ],
      },
      {
        id: 'old',
        title: '保留密码登录作为默认入口',
        kind: '决定',
        scope: '项目',
        status: 'revoked',
        revisions: [
          {
            text: '旧版以密码登录作为默认入口。',
            reason: '旧会话分支中的决定，来源分支已撤销',
            author: '用户',
            date: '10月18日 11:20',
          },
        ],
      },
      {
        id: 'doubt',
        title: '旧客户端是否仍可登录',
        kind: '怀疑',
        scope: '项目',
        status: 'current',
        revisions: [
          {
            text: '兼容说明缺失，尚不能确认旧客户端在设备授权迁移后是否可用。',
            reason: '附件读取失败；需要新的直接依据',
            author: 'Agent',
            date: '今天 14:33',
          },
        ],
      },
    ],
    skills: [
      {
        id: 'text-diff',
        name: 'text-diff',
        description: '比较文档变化，保留上下文与证据缺口。',
        enabled: true,
        extension: true,
        version: 1,
        versions: [1],
        candidate: '',
        trusted: true,
        content: skillText,
      },
      {
        id: 'project-notes',
        name: 'project-notes',
        description: '梳理项目说明与持续维护的文档结构。',
        enabled: true,
        extension: false,
        version: 1,
        versions: [1],
        candidate: '',
        trusted: true,
        content: '# project-notes\n按目标、使用方式、限制和下一步整理项目说明。',
      },
      {
        id: 'research-notes',
        name: 'research-notes',
        description: '整理研究材料，区分观察、判断与来源。',
        enabled: false,
        extension: false,
        version: 1,
        versions: [1],
        candidate: '',
        trusted: true,
        content: '# research-notes\n为每项判断记录可追溯来源。',
      },
    ],
    phase: 'suggestion',
    goal: '改进 text-diff 的报告指引，单列未核实的材料，保留原始依据。',
    discussion: [],
    grant: null,
    devEvents: [],
    auth: 'saved',
    env: false,
    connection: true,
    authTest: 'unknown',
    provider: 'OpenAI',
  };
}
