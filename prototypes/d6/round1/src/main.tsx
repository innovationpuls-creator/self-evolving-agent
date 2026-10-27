import { useState, useRef, isValidElement } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './styles.css';
type Mode = 'quiet' | 'studio';
const report = `## 项目说明有哪些变化？
认证方式从密码迁移到设备授权；旧版兼容说明仍需补充。

| 章节 | 变化 | 影响 |
|---|---|---|
| 登录 | 新增设备授权 | 首次使用需确认 |
| 数据 | 加密备份 | 可恢复到新目录 |

### 建议下一步
先补齐兼容说明，再发布文档。附件读取失败，以下结论仅覆盖两版说明。

\`\`\`typescript
const result = compare(before, after);
console.log(result.changes);
\`\`\`

- [x] 比较正文
- [ ] 核实附件中的兼容承诺
`;
const raw = {
  tool: 'text_diff',
  status: 'returned',
  changes: [
    {
      section: '登录',
      before: '密码',
      after: '设备授权',
      context: { confidence: '正文直接记录', references: ['说明 v1.md', '说明 v2.md'] },
    },
  ],
  limitations: ['附件不存在'],
  metrics: { duration: null },
  credential: '[已脱敏]',
};
const initial = () => ({
  sessions: [
    { id: 1, title: '比较项目说明', draft: '', messages: ['请比较两版项目说明，列出变化与风险。'], done: true },
    { id: 2, title: '整理项目说明', draft: '', messages: [] as string[], done: false },
  ],
  memory: ['默认以表格汇总文档差异。', '默认以表格汇总差异，并单列尚未核实的内容。'],
  version: 1,
  versions: [1],
  phase: '建议',
  goal: '改进 text-diff 的报告说明，明确区分正文差异与未核实附件',
  scope: true,
  newName: '',
  events: [] as string[],
  discussionDraft: '',
  discussion: [] as string[],
  selectedModel: '通用模型',
  hostSaved: true,
  model: true,
  auth: '已授权',
  offline: false,
});
function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ alt }) => <span>图片引用：{alt}</span>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          pre: ({ children }) => (
            <div className="code">
              <button
                type="button"
                onClick={() =>
                  navigator.clipboard?.writeText(
                    String(isValidElement<{ children?: string }>(children) ? (children.props.children ?? '') : ''),
                  )
                }
              >
                复制代码
              </button>
              <pre>{children}</pre>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
function Json({ value }: { value: unknown }) {
  return value !== null && typeof value === 'object' ? (
    <div className="json">
      {Object.entries(value).map(([k, v]) => (
        <details key={k} open={typeof v !== 'object'}>
          <summary>
            {k} <small>{Array.isArray(v) ? `数组 · ${v.length}` : typeof v}</small>
          </summary>
          <Json value={v} />
        </details>
      ))}
    </div>
  ) : (
    <code>{JSON.stringify(value)}</code>
  );
}
function App() {
  const [mode, M] = useState<Mode>(new URLSearchParams(location.search).get('route') === 'studio' ? 'studio' : 'quiet');
  const [stores, S] = useState({ quiet: initial(), studio: initial() });
  const d = stores[mode];
  const set = (patch: Partial<typeof d>) => S((s) => ({ ...s, [mode]: { ...s[mode], ...patch } }));
  const [view, V] = useState('对话');
  const [sid, I] = useState(1);
  const session = d.sessions.find((s) => s.id === sid) ?? d.sessions[0];
  const [inspect, Q] = useState('');
  const [refMap, RM] = useState<Record<string, string[]>>({});
  const refs = refMap[`${mode}:${sid}`] ?? [];
  const R = (next: string[]) => RM((m) => ({ ...m, [`${mode}:${sid}`]: next }));
  const [rev, H] = useState(1);
  const [edit, E] = useState('');
  const [reason, B] = useState('');
  const [conflict, C] = useState(false);
  const [reflection, F] = useState('发现');
  const [call, T] = useState('读取正文');
  const runId = useRef(0);
  const trigger = useRef<HTMLElement | null>(null);
  const [running, U] = useState(false);
  const [nav, N] = useState(false);
  const [outcome, O] = useState('成功');
  const [rawOpen, X] = useState(false);
  const [page, P] = useState(0);
  const evidenceText = JSON.stringify(
    {
      ...raw,
      records: Array.from({ length: 60 }, (_, i) => ({
        line: i + 1,
        source: '说明 v2.md',
        text: '认证与数据备份变更的完整脱敏模拟上下文。',
      })),
    },
    null,
    2,
  );
  const updateSession = (patch: Partial<typeof session>) =>
    set({ sessions: d.sessions.map((s) => (s.id === session.id ? { ...s, ...patch } : s)) });
  const go = (v: string) => {
    V(v);
    N(false);
    Q('');
  };
  const newSession = () => {
    const id = Date.now();
    set({ sessions: [...d.sessions, { id, title: '新会话', draft: '', messages: [], done: false }] });
    I(id);
    go('对话');
  };
  const send = () => {
    if (!session.draft.trim() || running || d.offline || !d.model) return;
    const text = session.draft;
    updateSession({ draft: '', messages: [...session.messages, text] });
    U(true);
    const token = ++runId.current;
    setTimeout(() => {
      if (token !== runId.current) return;
      S((all) => {
        const state = all[mode];
        return {
          ...all,
          [mode]: { ...state, sessions: state.sessions.map((s) => (s.id === session.id ? { ...s, done: true } : s)) },
        };
      });
      U(false);
    }, 1400);
  };
  const develop = () => {
    set({ phase: '开发中', events: ['用户已授权目标与范围', 'Agent 正在调查和修改说明'] });
    setTimeout(
      () =>
        S((all) => {
          const s = all[mode];
          if (s.phase !== '开发中') return all;
          return {
            ...all,
            [mode]: {
              ...s,
              phase: outcome === '成功' ? '已生效' : outcome === '失败' ? '检查失败' : '无代码完成',
              version: outcome === '成功' ? 2 : s.version,
              versions: outcome === '成功' ? [1, 2] : s.versions,
              events: [
                ...s.events,
                'Agent 自测完成',
                outcome === '失败'
                  ? 'Host 检查失败：候选未替换正式版本'
                  : outcome === '无代码'
                    ? '调查认为无需修改能力'
                    : 'Host 检查通过，版本 v2 已自动生效',
              ],
            },
          };
        }),
      2200,
    );
  };
  const links = ['对话', '轨迹', '记忆', '回顾', '建议', '能力', '模型'];
  return (
    <div className={mode}>
      <div className="demo">
        D6 · 独立交互模拟 · 不连接 Host{' '}
        <span>
          <button
            type="button"
            onClick={() => {
              const next = mode === 'quiet' ? 'studio' : 'quiet';
              M(next);
              history.replaceState({}, '', `?route=${next}`);
              V('对话');
              Q('');
            }}
          >
            切换到{mode === 'quiet' ? ' B 工作与成长空间' : ' A 会话工作台'}
          </button>
          <button
            type="button"
            onClick={() => {
              S({ ...stores, [mode]: initial() });
              I(1);
              V('对话');
              Q('');
            }}
          >
            重置案例
          </button>
        </span>
      </div>
      {mode === 'studio' && (
        <header className="studio-nav">
          <strong>Agent / 工作与成长</strong>
          {['工作', '认识', '能力'].map((x, i) => (
            <button type="button" key={x} onClick={() => go(['对话', '记忆', '建议'][i])}>
              {x}
            </button>
          ))}
          <button type="button" onClick={() => go('建议')}>
            待你决定 · {d.phase === '建议' ? 1 : 0}
          </button>
          <button type="button" onClick={() => go('模型')}>
            模型与连接
          </button>
        </header>
      )}
      <div className="shell">
        <button type="button" className="menu" onClick={() => N(!nav)}>
          ☰ 导航
        </button>
        <aside className={nav ? 'open' : ''}>
          <div className="brand">
            Agent<span>{mode === 'quiet' ? '会话工作台' : '工作目录'}</span>
          </div>
          <button type="button" className="primary" onClick={newSession}>
            ＋ 开始新会话
          </button>
          <small>最近工作</small>
          {d.sessions.map((s) => (
            <button
              type="button"
              className={sid === s.id ? 'active' : ''}
              key={s.id}
              onClick={() => {
                I(s.id);
                go('对话');
              }}
            >
              {s.title}
              <small>{s.done ? '有结果 · 可检查依据' : '尚未完成'}</small>
            </button>
          ))}
          <hr />
          {links.slice(2).map((x) => (
            <button type="button" key={x} onClick={() => go(x)} className={view === x ? 'active' : ''}>
              {x === '回顾' ? '反思记录' : x === '建议' ? '能力建议与开发' : x}
            </button>
          ))}
          <footer>
            <button type="button" onClick={() => set({ offline: !d.offline })}>
              {d.offline ? '○ 连接中断 · 点击恢复' : '● 模拟连接正常'}
            </button>
          </footer>
        </aside>
        <main>
          <header>
            <div>
              <small>
                {['对话', '轨迹'].includes(view) ? '当前工作' : '个人工作区'} / {view}
              </small>
              <h1>{['对话', '轨迹'].includes(view) ? session.title : view === '建议' ? '让下一次做得更好' : view}</h1>
            </div>
            <span className="tag">{d.offline ? '离线' : running ? '正在执行' : '可继续工作'}</span>
          </header>
          {d.offline && (
            <div className="warning">
              连接中断。已有内容和草稿保留；恢复连接不会重新发送任务。
              <button type="button" onClick={() => set({ offline: false })}>
                重新连接
              </button>
            </div>
          )}
          {mode === 'studio' && ['对话', '轨迹'].includes(view) && (
            <div className="context">
              <button type="button" onClick={() => go('记忆')}>
                相关认识 · 1 条
              </button>
              <button type="button" onClick={() => go('回顾')}>
                查看反思
              </button>
              <button type="button" onClick={() => go('建议')}>
                能力改进 · {d.phase}
              </button>
            </div>
          )}
          <div className="body">
            {['对话', '轨迹'].includes(view) && (
              <>
                <div className="tabs">
                  <button type="button" className={view === '对话' ? 'active' : ''} onClick={() => go('对话')}>
                    {mode === 'studio' ? '工作结果' : '对话'}
                  </button>
                  <button type="button" className={view === '轨迹' ? 'active' : ''} onClick={() => go('轨迹')}>
                    执行轨迹
                  </button>
                  <button type="button" onClick={() => Q('会话操作')}>
                    会话操作
                  </button>
                </div>
                {view === '对话' ? (
                  <>
                    <div className="messages">
                      {session.messages.map((m, i) => (
                        <p className="user" key={i}>
                          {m}
                        </p>
                      ))}
                      {session.done ? (
                        <>
                          <div className="result-label">
                            本次结果 <span>附件未核实</span>
                          </div>
                          <Markdown text={report} />
                          <div className="result-actions">
                            <button type="button" onClick={() => go('轨迹')}>
                              查看执行依据 ↗
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                go('记忆');
                                H(1);
                              }}
                            >
                              查看保存的认识
                            </button>
                            <button type="button" onClick={() => Q('结构化结果')}>
                              浏览结构化结果
                            </button>
                          </div>
                          {mode === 'quiet' && (
                            <div className="related">
                              <strong>这次工作之后</strong>
                              <p>反思发现：报告应当显式区分已核实内容与附件缺口。</p>
                              <button type="button" onClick={() => go('回顾')}>
                                阅读反思
                              </button>
                              <button type="button" onClick={() => go('建议')}>
                                讨论能力改进
                              </button>
                            </div>
                          )}
                        </>
                      ) : (
                        !running && (
                          <div className="empty">
                            <h2>从一项具体工作开始</h2>
                            <p>选择模型，引用项目材料，告诉 Agent 你想得到什么。</p>
                            <button
                              type="button"
                              onClick={() => updateSession({ draft: '比较两版项目说明，列出变化和未核实内容。' })}
                            >
                              比较项目说明
                            </button>
                          </div>
                        )
                      )}
                      {running && (
                        <p role="status">
                          正在读取正文并整理结果…{' '}
                          <button
                            type="button"
                            onClick={() => {
                              runId.current++;
                              U(false);
                            }}
                          >
                            停止
                          </button>
                        </p>
                      )}
                    </div>
                    <div className="composer">
                      <div className="chips">
                        {refs.map((r) => (
                          <button type="button" key={r} onClick={() => R(refs.filter((x) => x !== r))}>
                            {r} ×
                          </button>
                        ))}
                      </div>
                      <textarea
                        aria-label="任务"
                        placeholder="描述你想完成的工作…"
                        value={session.draft}
                        onChange={(e) => updateSession({ draft: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            send();
                          }
                        }}
                      />
                      <div className="compose-actions">
                        <button type="button" onClick={() => Q('引用文件')}>
                          @ 文件
                        </button>
                        <button type="button" onClick={() => Q('引用 Skill')}>
                          / Skill
                        </button>
                        <button type="button" onClick={() => Q('选择模型')}>
                          {d.model ? d.selectedModel : '选择模型'}
                        </button>
                        <button
                          type="button"
                          className="primary"
                          disabled={!session.draft.trim() || running || d.offline || !d.model}
                          onClick={send}
                        >
                          发送 ↑
                        </button>
                      </div>
                      <small>⌘ / Ctrl + Enter 发送 · 文件来自模拟 Host 项目</small>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="muted">执行结束不代表所有材料均已核实。原始记录可逐层检查。</p>
                    <div className="trace-layout">
                      <div>
                        {(session.done
                          ? ['理解目标', '读取正文', '读取附件 · 失败', '生成差异', '形成结果']
                          : running
                            ? ['理解目标', '读取正文']
                            : []
                        ).map((c, i) => (
                          <button
                            type="button"
                            className="event"
                            key={c}
                            onClick={() => {
                              T(c);
                              Q('调用详情');
                            }}
                          >
                            <small>
                              0{i + 1} / {i === 2 ? '调用失败' : '已记录'}
                            </small>
                            <strong>{c}</strong>
                            <span>{i === 2 ? '文件不存在，未自动重试' : '查看输入、输出与来源 →'}</span>
                          </button>
                        ))}
                      </div>
                      <div className="trace-summary">
                        <h2>运行概要</h2>
                        <p>正文比较已返回。附件缺失，结论范围受限。</p>
                        <p>耗时：未知</p>
                        <button type="button" onClick={() => Q('原始证据')}>
                          检查完整依据
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
            {view === '记忆' && (
              <div className="split">
                <section>
                  <small>项目 / 项目说明</small>
                  <h2>报告如何表达未核实内容</h2>
                  <span className="tag">当前 · 经验</span>
                  <p>{d.memory.at(-1)}</p>
                  <button
                    type="button"
                    onClick={() => {
                      E(d.memory.at(-1) ?? '');
                      B('');
                      C(false);
                    }}
                  >
                    修正这条认识
                  </button>
                  <h3>修订历史</h3>
                  {d.memory.map((_m, i) => (
                    <button type="button" key={i} className={rev === i ? 'active' : ''} onClick={() => H(i)}>
                      修订 {i + 1} · {i === d.memory.length - 1 ? '当前' : '历史'}
                    </button>
                  ))}
                  <hr />
                  <h3>已撤销的项目决定</h3>
                  <p>旧版密码登录方案已因来源分支变化撤销，不再作为当前要求。</p>
                  <button type="button" onClick={() => Q('历史来源')}>
                    查看旧分支依据
                  </button>
                </section>
                <section>
                  <h2>修订 {rev + 1}</h2>
                  <Markdown text={d.memory[rev] ?? d.memory[0]} />
                  <p className="muted">
                    {rev === d.memory.length - 1 ? '这是当前认识。' : '本次写入已成为历史；当前认识另有修订。'}
                  </p>
                  {rev > 0 && (
                    <div className="diff">
                      <del>− {d.memory[rev - 1]}</del>
                      <ins>＋ {d.memory[rev]}</ins>
                    </div>
                  )}
                  <button type="button" onClick={() => Q('原始证据')}>
                    来源：比较项目说明 →
                  </button>
                  {edit && (
                    <div className="editor">
                      <h3>修正认识</h3>
                      <textarea aria-label="记忆正文" value={edit} onChange={(e) => E(e.target.value)} />
                      <input
                        aria-label="修正理由"
                        placeholder="为什么修正？"
                        value={reason}
                        onChange={(e) => B(e.target.value)}
                      />
                      {conflict && <p className="warning">另一个客户端已更新。草稿保留，请重新核对当前版本。</p>}
                      <button type="button" onClick={() => C(true)}>
                        模拟修订冲突
                      </button>
                      <button
                        type="button"
                        disabled={!reason.trim() || !edit.trim()}
                        onClick={() => {
                          set({ memory: [...d.memory, edit] });
                          H(d.memory.length);
                          E('');
                          C(false);
                        }}
                      >
                        核对并保存新修订
                      </button>
                      <button type="button" onClick={() => E('')}>
                        取消
                      </button>
                    </div>
                  )}
                </section>
              </div>
            )}
            {view === '回顾' && (
              <>
                <div className="tabs">
                  {['发现', '无新发现', '环境不可用'].map((x) => (
                    <button type="button" key={x} onClick={() => F(x)}>
                      {x}
                    </button>
                  ))}
                </div>
                <article>
                  <small>比较项目说明之后 · 后台反思</small>
                  <h2>{reflection === '发现' ? '缺失材料应与已确认结果分开' : reflection}</h2>
                  {reflection === '发现' ? (
                    <>
                      <h3>形成的判断</h3>
                      <p>报告应在结论附近标明材料覆盖范围，避免把未核实附件当成已验证。</p>
                      <h3>仍不确定</h3>
                      <p>附件是否包含额外兼容约束，当前证据不足。</p>
                      <h3>关联变化</h3>
                      <button type="button" onClick={() => go('记忆')}>
                        认识修订 2 →
                      </button>
                      <button type="button" onClick={() => go('建议')}>
                        报告能力改进建议 →
                      </button>
                      <button type="button" onClick={() => Q('原始证据')}>
                        检查依据
                      </button>
                    </>
                  ) : (
                    <p>
                      {reflection === '无新发现'
                        ? '本次审查没有产生新的认识或能力建议。无需处理。'
                        : '受限反思环境不可用。检查签名与运行环境后重新检查，不降级到 Host 执行。'}
                    </p>
                  )}
                  {reflection === '环境不可用' && (
                    <button type="button" onClick={() => F('无新发现')}>
                      模拟环境恢复后重新检查
                    </button>
                  )}
                </article>
              </>
            )}
            {view === '建议' && (
              <article>
                <small>来自：项目说明反思 · 能力构想</small>
                <h2>让差异报告主动说明证据缺口</h2>
                <p>
                  预期价值：后续比较任务能一致地区分正文变化与未读取材料。尚不确定：应放在 Skill 指引还是 Tool
                  输出中，需要讨论。
                </p>
                <span className="tag">{d.phase}</span>
                {d.phase === '建议' ? (
                  <div>
                    <button type="button" className="primary" onClick={() => set({ phase: '讨论' })}>
                      采纳并建立讨论
                    </button>
                    <button type="button" onClick={() => set({ phase: '已忽略' })}>
                      忽略建议
                    </button>
                  </div>
                ) : d.phase === '已忽略' ? (
                  <button type="button" onClick={() => set({ phase: '建议' })}>
                    恢复建议
                  </button>
                ) : (
                  <>
                    <div className="discussion">
                      <h3>独立讨论</h3>
                      <p>建议背景已带入。此时尚未发送消息，也没有开发权限。</p>
                      <textarea
                        aria-label="讨论消息"
                        value={d.discussionDraft}
                        onChange={(e) => set({ discussionDraft: e.target.value })}
                        disabled={!['讨论', '待授权'].includes(d.phase)}
                        placeholder="说说你的目标或补充约束"
                      />
                      <button
                        type="button"
                        disabled={!['讨论', '待授权'].includes(d.phase) || !d.discussionDraft.trim()}
                        onClick={() =>
                          set({
                            phase: '待授权',
                            discussion: [...d.discussion, d.discussionDraft],
                            discussionDraft: '',
                            events: ['讨论结论：优先改进 Skill 的报告指引，保留 Tool 原始输出。'],
                          })
                        }
                      >
                        发送讨论消息
                      </button>
                      {d.discussion.map((text, i) => (
                        <p className="user" key={i}>
                          {text}
                        </p>
                      ))}
                      {d.events.map((e, i) => (
                        <p key={i}>{e}</p>
                      ))}
                    </div>
                    {['讨论', '待授权'].includes(d.phase) && (
                      <button type="button" className="primary" onClick={() => Q('确认开发授权')}>
                        确认目标与开发范围
                      </button>
                    )}
                    {d.phase === '开发中' && (
                      <button
                        type="button"
                        onClick={() => set({ phase: '已取消', events: [...d.events, '用户取消；未完成候选未发布'] })}
                      >
                        取消开发
                      </button>
                    )}
                    {['检查失败', '已取消', '无代码完成', '已生效'].includes(d.phase) && (
                      <p>当前正式版本 v{d.version}。历史活动保留，未完成请求不会自动重放。</p>
                    )}
                    <button type="button" onClick={() => go('能力')}>
                      查看能力与版本 →
                    </button>
                  </>
                )}
              </article>
            )}
            {view === '能力' && (
              <div className="split">
                <section>
                  <h2>可复用的能力</h2>
                  <button type="button" className="active" onClick={() => Q('Skill 说明')}>
                    text-diff<small>比较文本，整理变更</small>
                  </button>
                  <button type="button" onClick={() => Q('工具目录')}>
                    Tools · 来源与可调用状态
                  </button>
                  <button type="button" onClick={() => Q('导入候选')}>
                    导入 Skill 候选
                  </button>
                </section>
                <section>
                  <small>Skill / 项目</small>
                  <h2>文本差异报告</h2>
                  <p>按需读取的工作指引，关联 Extension Tool；Skill 本身不等于 Tool。</p>
                  <span className="tag">已启用 · 当前 v{d.version}</span>
                  <Markdown text="### 使用方式\n比较两份文本，保留上下文。未读取的材料需单独说明。" />
                  <h3>版本历史</h3>
                  {d.versions.map((v) => (
                    <div className="version" key={v}>
                      v{v} · {v === 1 ? '初始版本' : '授权开发成果'}
                      <button
                        type="button"
                        disabled={d.version === v}
                        onClick={() => {
                          set({ version: v });
                          Q('回退结果');
                        }}
                      >
                        {d.version === v ? '当前使用' : '恢复此版本'}
                      </button>
                    </div>
                  ))}
                  <p className="muted">回退仅切换能力版本，不删除执行事实或回滚 Memory。</p>
                  <button type="button" onClick={() => go('建议')}>
                    查看相关开发活动
                  </button>
                </section>
              </div>
            )}
            {view === '模型' && (
              <article>
                <small>模型与连接</small>
                <h2>OpenAI · 模拟提供方</h2>
                <p>
                  Host 保存副本：{d.hostSaved ? '存在' : '无'} · {d.auth}
                </p>
                <button type="button" onClick={() => set({ auth: '等待设备授权' })}>
                  模拟设备登录
                </button>
                <button type="button" onClick={() => set({ auth: 'API Key 已保存，尚未验证' })}>
                  保存演示 API Key
                </button>
                <button
                  type="button"
                  onClick={() => set({ hostSaved: false, model: false, auth: '已删除 Host 副本；提供方端撤销未确认' })}
                >
                  退出 Host
                </button>
                {d.auth === '等待设备授权' && (
                  <div className="warning">
                    <p>模拟验证码：DEMO-ONLY；不会打开真实登录页。</p>
                    <button
                      type="button"
                      onClick={() => set({ hostSaved: true, model: true, auth: '授权可用；本轮尚未调用' })}
                    >
                      模拟授权成功
                    </button>
                    <button type="button" onClick={() => set({ auth: '授权过期，请重新登录' })}>
                      模拟过期
                    </button>
                    <button type="button" onClick={() => set({ auth: '用户取消登录' })}>
                      取消登录
                    </button>
                  </div>
                )}
                <h3>其他授权来源</h3>
                <p>环境或配置文件授权可能仍然有效，退出 Host 不代表已从提供方撤销。</p>
                <button type="button" onClick={() => set({ model: true, auth: '环境授权可用' })}>
                  模拟环境授权仍可用
                </button>
                <h3>连接恢复</h3>
                <button type="button" onClick={() => set({ offline: !d.offline })}>
                  {d.offline ? '恢复连接' : '模拟断线'}
                </button>
              </article>
            )}
          </div>
        </main>
      </div>
      {inspect && (
        <div className="overlay">
          <section
            className={`inspector ${mode === 'studio' && inspect === '确认开发授权' ? 'grant-workspace' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={inspect}
            ref={(el) => {
              if (el && !el.contains(document.activeElement)) {
                trigger.current = document.activeElement as HTMLElement;
                el.querySelector<HTMLButtonElement>('button')?.focus();
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') Q('');
              if (e.key === 'Tab') {
                const buttons = Array.from(
                  e.currentTarget.querySelectorAll<HTMLElement>('button,input,textarea,select,summary'),
                );
                const first = buttons[0],
                  last = buttons.at(-1);
                if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first?.focus();
                }
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last?.focus();
                }
              }
            }}
          >
            <header>
              <h2>{inspect}</h2>
              <button
                type="button"
                onClick={() => {
                  Q('');
                  setTimeout(() => trigger.current?.focus(), 0);
                }}
              >
                关闭详情
              </button>
            </header>
            {mode === 'studio' && inspect === '确认开发授权' && (
              <div className="grant-context">
                <small>能力 / 开发活动</small>
                <h2>讨论与决定</h2>
                <p>从建议进入独立讨论。当前目标是让差异报告明确证据缺口。</p>
                <h3>讨论背景</h3>
                <p>读取附件失败，报告应区分已确认正文与尚未核实的信息。</p>
                <h3>范围基础</h3>
                <p>text-diff · v{d.version}</p>
                <p>保留工具原始输出，优先完善报告指引。</p>
              </div>
            )}
            {inspect === '引用文件' || inspect === '引用 Skill' ? (
              <>
                {(inspect === '引用文件'
                  ? ['说明 v1.md', '说明 v2.md', '资料/兼容说明.md']
                  : ['/skill:text-diff', '/skill:project-notes']
                ).map((x) => (
                  <button
                    type="button"
                    className="event"
                    key={x}
                    onClick={() => {
                      R([...new Set([...refs, x])]);
                      Q('');
                    }}
                  >
                    {x} ＋
                  </button>
                ))}
              </>
            ) : inspect === '选择模型' ? (
              <>
                <p>{d.model ? '模型已授权，可用于发送任务。' : '尚未授权。'}</p>
                {['通用模型', '推理模型'].map((name) => (
                  <button
                    type="button"
                    key={name}
                    disabled={!d.model}
                    onClick={() => {
                      set({ selectedModel: name });
                      Q('');
                    }}
                  >
                    {name}
                    {d.selectedModel === name ? ' · 当前' : ''}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    go('模型');
                  }}
                >
                  管理授权
                </button>
              </>
            ) : inspect === '确认开发授权' ? (
              <>
                <p>批准的是下面的目标与能力范围；检查通过后会自动生效。</p>
                <label>
                  具体目标
                  <textarea aria-label="授权目标" value={d.goal} onChange={(e) => set({ goal: e.target.value })} />
                </label>
                <label>
                  <input type="checkbox" checked={d.scope} onChange={(e) => set({ scope: e.target.checked })} />
                  允许改进 text-diff · 基础 v{d.version}
                </label>
                <label>
                  允许新建 Skill 名称
                  <input
                    value={d.newName}
                    onChange={(e) => set({ newName: e.target.value })}
                    placeholder="留空则不允许新建"
                  />
                </label>
                <div className="warning">
                  开发 Shell 和加载的 Extension 具有当前用户 / Host 权限。候选目录及检查不构成 OS
                  沙箱；取消和回退不能逆转已发生的外部副作用。
                </div>
                <label>
                  演示分支
                  <select value={outcome} onChange={(e) => O(e.target.value)}>
                    {['成功', '失败', '无代码'].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="primary"
                  disabled={!d.goal.trim() || (!d.scope && !d.newName.trim())}
                  onClick={() => {
                    develop();
                    Q('');
                  }}
                >
                  批准此目标并开始开发
                </button>
              </>
            ) : inspect === '导入候选' ? (
              <>
                <p>导入只保存候选，不授予代码执行信任。</p>
                <input placeholder="演示包地址或名称" />
                <button type="button" onClick={() => Q('候选待审查')}>
                  保存候选
                </button>
              </>
            ) : inspect === '候选待审查' ? (
              <p>候选已保存在演示状态中。可执行 Extension 必须进行精确内容审查，不能仅因安装而加载。</p>
            ) : inspect === '回退结果' ? (
              <p>当前能力已切换至 v{d.version}。已有记录与 Memory 保留。</p>
            ) : inspect === '会话操作' ? (
              <>
                <p>压缩上下文会保留完整历史；历史分支查看与切换执行位置不同。</p>
                <button type="button" onClick={() => Q('历史来源')}>
                  只读查看历史分支
                </button>
                <button type="button" onClick={() => Q('上下文压缩记录')}>
                  模拟压缩上下文
                </button>
              </>
            ) : inspect === '工具目录' ? (
              <>
                <h3>text_diff</h3>
                <p>来源：text-diff Extension</p>
                <p>已加载 · 向模型声明 · 可调用</p>
                <h3>read</h3>
                <p>Pi 原生 Tool · 当前可调用</p>
                <button
                  type="button"
                  onClick={() => {
                    T('生成差异');
                    Q('调用详情');
                  }}
                >
                  查看参数与结果
                </button>
              </>
            ) : inspect === 'Skill 说明' ? (
              <Markdown text="## text-diff\n按需读取的比较指引。关联工具提供行级差异；使用前确认材料覆盖范围。" />
            ) : (
              <>
                <p>{inspect === '调用详情' ? call : '来源：比较项目说明 / 当次修订引用'}</p>
                <span className="tag">
                  {inspect === '历史来源' ? '旧分支 · 只读' : call.includes('失败') ? '调用失败' : '已记录'}
                </span>
                <p>
                  {call.includes('失败')
                    ? '附件不存在。可补齐文件后明确发送新任务，不自动重放。'
                    : '保留调用与材料来源，不从执行结束推断任务成功。'}
                </p>
                <h3>输入与输出</h3>
                <Json
                  value={
                    call.includes('失败')
                      ? {
                          tool: 'read',
                          status: 'error',
                          input: { path: '资料/兼容说明.md' },
                          output: 'ENOENT: 文件不存在',
                          retry: '未自动重试',
                        }
                      : raw
                  }
                />
                <button type="button" onClick={() => X(!rawOpen)}>
                  {rawOpen ? '收起原文' : '查看完整脱敏原文'}
                </button>
                {rawOpen && (
                  <>
                    <pre>{evidenceText.slice(page * 4096, (page + 1) * 4096)}</pre>
                    <button type="button" disabled={page === 0} onClick={() => P(Math.max(0, page - 1))}>
                      前一段
                    </button>
                    <button
                      type="button"
                      disabled={(page + 1) * 4096 >= evidenceText.length}
                      onClick={() => P(page + 1)}
                    >
                      后一段
                    </button>
                  </>
                )}
                <button type="button" onClick={() => Q('')}>
                  返回{view}中的原位置
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
