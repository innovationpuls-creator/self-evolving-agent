import { useState, useEffect } from 'react';
import {
  Layers,
  FileText,
  Terminal,
  Shield,
  GitBranch,
  ArrowUpRight,
  ArrowLeft,
  Plus,
  ChevronRight,
  Package,
  Pencil,
} from 'lucide-react';
import { useDemo } from '../state/store';
import {
  Button,
  SectionTitle,
  SearchBox,
  EmptySearch,
  TabBar,
  Status,
  Modal,
  Field,
  Notice,
  StateGate,
} from '../components/ui';
import { Markdown, Code, Diff, JsonView } from '../components/content';
export function Skills() {
  const x = useDemo();
  const id = x.objects.skills;
  const I = (v: string) => x.setObject('skills', v);
  const [tab, T] = useState('用途与说明');
  const [query, Q] = useState('');
  const [catalog, C] = useState('Skill');
  const [editor, E] = useState(false);
  const [editorFile, EF] = useState('SKILL.md');
  const [text, V] = useState('');
  const [review, R] = useState(false);
  const [approved, A] = useState(false);
  const [importing, IM] = useState(false);
  const [name, N] = useState('document-coverage');
  const [rollback, RB] = useState<number | null>(null);
  const [checking, CH] = useState(false);
  const [checkFail, CF] = useState(false);
  const [checkError, CE] = useState('');
  const [tool, TO] = useState('text_diff');
  const [mobile, M] = useState(false);
  useEffect(() => {
    if (x.focusRequest.type === 'skills') M(true);
  }, [x.focusRequest]);
  const skill = x.d.skills.find((s) => s.id === id) ?? x.d.skills[0];
  const owner = x.d.skills.find((s) => s.id === 'text-diff');
  const callable = tool !== 'text_diff' || !!(owner?.enabled && owner?.trusted && owner?.version);
  const studio = x.mode === 'studio';
  const list = x.d.skills.filter((s) => s.name.includes(query) || s.description.includes(query));
  const update = (p: Partial<typeof skill>) =>
    x.mutate((s) => ({ ...s, skills: s.skills.map((k) => (k.id === skill.id ? { ...k, ...p } : k)) }));
  const check = () => {
    CH(true);
    CE('');
    setTimeout(() => {
      CH(false);
      if (checkFail) {
        CE('锁定依赖与候选声明不一致，正式版本保持不变。');
        return;
      }
      const v = Math.max(...skill.versions, 0) + 1;
      update({
        content: skill.candidateFile === 'extension.ts' ? skill.content : skill.candidate || skill.content,
        code: skill.candidateFile === 'extension.ts' ? skill.candidate : skill.code,
        snapshots: {
          ...skill.snapshots,
          [skill.version]: { content: skill.content, code: skill.code },
          [v]: {
            content: skill.candidateFile === 'extension.ts' ? skill.content : skill.candidate || skill.content,
            code: skill.candidateFile === 'extension.ts' ? skill.candidate : skill.code,
          },
        },
        candidate: '',
        candidateTrusted: false,
        trusted: true,
        version: v,
        versions: [...skill.versions, v],
        enabled: true,
      });
      x.notify(`检查通过，${skill.name} v${v} 已自动生效。`);
    }, 1500);
  };
  const detail = (
    <>
      {studio && (
        <Button
          kind="ghost"
          className="directory-return"
          onClick={() => {
            M(false);
            document.querySelector('.capability-matrix')?.scrollIntoView({ block: 'start' });
          }}
        >
          返回能力目录
        </Button>
      )}
      <div className="skill-detail-head">
        <span className="skill-monogram">
          <Layers size={22} />
        </span>
        <div>
          <div className="eyebrow">{skill.extension ? '指引与 Extension' : '文本指引'} / 项目</div>
          <h2>
            {skill.name}
            {x.mode === 'quiet' && <small className="version-inline">v{skill.version}</small>}
          </h2>
          <p>{skill.description}</p>
        </div>
        <label className="switch-label">
          <input
            type="checkbox"
            role="switch"
            aria-checked={skill.enabled}
            aria-label="启用当前 Skill"
            checked={skill.enabled}
            disabled={!skill.version}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          <span>{skill.enabled ? '已启用' : '已禁用'}</span>
        </label>
      </div>
      <TabBar items={['用途与说明', '文件与候选', '工具与依赖', '版本与信任']} value={tab} onChange={T} />
      {!skill.enabled && (
        <Notice title="当前已禁用">
          Agent 不会发现这项 Skill，其所属可选工具与 Hooks 也不生效。已开始的调用仍保留记录。
        </Notice>
      )}
      {tab === '用途与说明' ? (
        <>
          <div className="skill-overview">
            <dl>
              <dt hidden={x.mode === 'quiet'}>当前版本</dt>
              <dd hidden={x.mode === 'quiet'}>{skill.version ? `v${skill.version}` : '尚未生效'}</dd>
              <dt>使用方式</dt>
              <dd>Agent 按需读取，或在会话引用</dd>
              <dt>能力性质</dt>
              <dd>{skill.extension ? '指引 + 可执行扩展' : 'Markdown 指引，不等于 Tool'}</dd>
            </dl>
            <div className="skill-doc">
              <Markdown
                text={
                  skill.content.replace(/^# .*\n/, '') +
                  (x.scenario === 'long'
                    ? `\n## 长文件与复杂输出\n${'保持文件来源，保留未核实范围。\n\n'.repeat(14)}`
                    : '')
                }
              />
            </div>
          </div>
          <div className="inline-actions">
            <Button
              onClick={() => {
                x.updateSession({ refs: [...new Set([...x.session.refs, `/skill:${skill.name}`])] });
                x.go('chat');
              }}
            >
              在会话中引用 <ArrowUpRight size={13} />
            </Button>
            <Button
              kind="ghost"
              onClick={() => {
                EF('SKILL.md');
                V(skill.content);
                E(true);
              }}
            >
              <Pencil size={14} />
              编辑说明
            </Button>
            <Button kind="ghost" onClick={() => x.go('evolution')}>
              与 Agent 讨论改进
            </Button>
          </div>
        </>
      ) : tab === '文件与候选' ? (
        <>
          <div className="file-browser">
            <div>
              <button
                type="button"
                className="selected"
                onClick={() => {
                  EF('SKILL.md');
                  V(skill.content);
                  E(true);
                }}
              >
                <FileText size={14} />
                SKILL.md
                <ChevronRight size={14} />
              </button>
              {skill.extension && (
                <button
                  type="button"
                  onClick={() => {
                    EF('extension.ts');
                    V(
                      skill.code ??
                        'export function compare(before: string, after: string) {\n  return { before, after, context: true };\n}',
                    );
                    E(true);
                  }}
                >
                  <Terminal size={14} />
                  extension.ts
                  <ChevronRight size={14} />
                </button>
              )}
            </div>
            <section>
              <div className="eyebrow">候选版本</div>
              {skill.candidate ? (
                <>
                  <Status tone="warn">已保存，尚未生效</Status>
                  <Diff
                    before={skill.candidateFile === 'extension.ts' ? (skill.code ?? '// 初始比较工具') : skill.content}
                    after={skill.candidate}
                    file={skill.candidateFile ?? 'SKILL.md'}
                  />
                  {skill.extension && !skill.candidateTrusted ? (
                    <Button
                      onClick={() => {
                        A(false);
                        R(true);
                      }}
                    >
                      审查精确候选内容
                    </Button>
                  ) : (
                    <Button kind="primary" onClick={check} disabled={checking}>
                      {checking ? '正在检查…' : '检查并自动生效'}
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <h3>没有待处理的候选</h3>
                  <p>编辑规则或代码后保存为候选。普通会话继续使用当前正式版本。</p>
                  <Button
                    onClick={() => {
                      EF('SKILL.md');
                      V(skill.content);
                      E(true);
                    }}
                  >
                    编辑 SKILL.md
                  </Button>
                </>
              )}
            </section>
          </div>
          <label className="check-row demo-option">
            <input type="checkbox" checked={checkFail} onChange={(e) => CF(e.target.checked)} />
            <span>模拟依赖检查失败</span>
          </label>
          {checkError && (
            <Notice tone="bad" title="候选检查失败">
              {checkError}
            </Notice>
          )}
        </>
      ) : tab === '工具与依赖' ? (
        <>
          <div className="tool-ownership">
            <h3>{skill.extension ? '由这项能力提供的工具' : '这项 Skill 不提供执行工具'}</h3>
            <p>
              {skill.extension
                ? '启用并信任对应版本后，所属工具才可能进入当前会话。'
                : 'Skill 是按需读取的工作指引，不需要凭空注册 Tool。'}
            </p>
            {skill.extension && (
              <button
                type="button"
                className="tool-owned"
                onClick={() => {
                  C('Tool');
                  TO('text_diff');
                }}
              >
                <Terminal size={18} />
                <span>
                  <strong>text_diff</strong>
                  <small>比较文本，保留上下文</small>
                </span>
                <Status tone={skill.enabled ? 'good' : 'neutral'}>{skill.enabled ? '当前可调用' : '已禁用'}</Status>
                <ArrowUpRight size={14} />
              </button>
            )}
          </div>
          <details className="dependency-tree" open>
            <summary>
              <Package size={15} />
              锁定依赖闭包
            </summary>
            <div className="tree-line">
              {skill.name}
              <div>
                └─ {skill.extension ? '@agent/text-compare · 1.2.0' : '无执行依赖'}
                <div>{skill.extension ? '└─ diff · 8.0.2 · 锁定版本' : ''}</div>
              </div>
            </div>
          </details>
        </>
      ) : (
        <>
          <div className="trust-summary">
            <Shield size={22} />
            <div>
              <h3>{skill.trusted ? '当前执行依据可追溯' : '候选尚未获得执行信任'}</h3>
              <p>
                {skill.extension
                  ? '当前示例正式版绑定精确内容审查。安装、保存或启用均不等于信任。'
                  : '普通文本发现不授予任何额外执行权限。'}
              </p>
            </div>
          </div>
          <div className="version-list">
            {[...skill.versions].reverse().map((v) => (
              <div key={v}>
                <span className="version-node">
                  <GitBranch size={15} />
                </span>
                <div>
                  <strong>
                    v{v} {skill.version === v && <span className="version-current">当前版本</span>}
                  </strong>
                  <p>{v === 1 ? '初始比较指引与上下文工具' : '明确材料覆盖与未核实内容'}</p>
                  <small>{v === 1 ? '精确内容人工审查' : '目标授权与必要检查'} · 不可变快照</small>
                </div>
                {v !== skill.version && <Button onClick={() => RB(v)}>恢复此版本</Button>}
              </div>
            ))}
          </div>
          <Notice title="版本回退的范围">
            切换正式能力版本，不回退 Memory、不删除执行记录，也不能撤销 Shell 或外部操作。
          </Notice>
        </>
      )}
    </>
  );
  return (
    <StateGate
      emptyAction={
        <Button
          onClick={() => {
            x.setScenario('normal');
            IM(true);
            if (studio && innerWidth > 700)
              requestAnimationFrame(() => document.querySelector('.matrix-detail')?.scrollIntoView({ block: 'start' }));
          }}
        >
          导入 Skill
        </Button>
      }
    >
      <div className={`skills-page ${mobile ? 'object-open' : ''}`}>
        <SectionTitle
          eyebrow="能力 / Skill & Tool"
          title={studio ? '能力目录' : '技能与工具'}
          description={
            x.mode === 'studio'
              ? 'Skill 提供指引；Tool 执行操作。启用、信任和实际可调用是不同状态。'
              : '查看 Agent 怎样完成工作，管理可使用的技能与工具。涉及代码的能力需要单独信任。'
          }
          action={
            <Button onClick={() => IM(true)}>
              <Plus size={15} />
              导入 Skill
            </Button>
          }
        />
        <div className="skills-filter">
          <TabBar items={['Skill', 'Tool']} value={catalog} onChange={C} />
          <SearchBox value={query} onChange={Q} placeholder="查找能力" />
        </div>
        {catalog === 'Skill' ? (
          studio ? (
            <>
              <div className="capability-matrix">
                {list.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    className={id === s.id ? 'selected' : ''}
                    onClick={() => {
                      I(s.id);
                      T('用途与说明');
                      M(true);
                      if (studio && innerWidth > 700)
                        requestAnimationFrame(() =>
                          document.querySelector('.matrix-detail')?.scrollIntoView({ block: 'start' }),
                        );
                    }}
                  >
                    <Layers size={19} />
                    <div>
                      <strong>{s.name}</strong>
                      <p>{s.description}</p>
                    </div>
                    <span>{s.extension ? '指引 + Extension' : '文本指引'}</span>
                    <Status tone={s.enabled ? 'good' : 'neutral'}>{s.enabled ? '已启用' : '已禁用'}</Status>
                    <small>v{s.version}</small>
                  </button>
                ))}
              </div>
              {!list.length && <EmptySearch />}
              <section className="skill-detail matrix-detail">
                <Button kind="ghost" className="mobile-back" onClick={() => M(false)}>
                  <ArrowLeft size={14} />
                  能力目录
                </Button>
                {detail}
              </section>
            </>
          ) : (
            <div className="skill-library">
              <div className="skill-index">
                {list.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    className={id === s.id ? 'selected' : ''}
                    onClick={() => {
                      I(s.id);
                      T('用途与说明');
                      M(true);
                      if (studio && innerWidth > 700)
                        requestAnimationFrame(() =>
                          document.querySelector('.matrix-detail')?.scrollIntoView({ block: 'start' }),
                        );
                    }}
                  >
                    <Layers size={16} />
                    <span>
                      <strong>{s.name}</strong>
                      <small>{s.description}</small>
                    </span>
                    <span className={`tiny-dot ${s.enabled ? 'enabled' : ''}`} />
                  </button>
                ))}
                {!list.length && <EmptySearch />}
              </div>
              <section className="skill-detail">
                <Button kind="ghost" className="mobile-back" onClick={() => M(false)}>
                  <ArrowLeft size={14} />
                  能力列表
                </Button>
                {detail}
              </section>
            </div>
          )
        ) : (
          <div className="tool-directory">
            <div className="tool-list">
              <div className="eyebrow">来源与可调用状态</div>
              {['read', 'bash', 'text_diff', 'document_info']
                .filter((t) => t.includes(query))
                .map((t) => (
                  <button type="button" key={t} className={tool === t ? 'selected' : ''} onClick={() => TO(t)}>
                    <Terminal size={16} />
                    <span>
                      <strong>{t}</strong>
                      <small>
                        {['read', 'bash'].includes(t)
                          ? 'Pi 原生'
                          : t === 'text_diff'
                            ? 'text-diff'
                            : 'Extension · 文档元数据'}
                      </small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ))}
            </div>
            <div className="tool-catalog-detail">
              <div className="eyebrow">工具目录</div>
              <h2>{tool}</h2>
              <p>
                {tool === 'read'
                  ? '读取项目文件内容。'
                  : tool === 'bash'
                    ? '执行 Shell 命令；使用 Host 本机用户权限。'
                    : tool === 'text_diff'
                      ? '比较文本并返回结构化差异。'
                      : '没有已知的业务摘要；保留声明与原字段。'}
              </p>
              {x.mode === 'quiet' && !callable && (
                <p className="warn-text">所属 Skill 未启用或未获信任，当前会话无法调用。</p>
              )}
              <div className="availability-ladder">
                {[
                  tool === 'text_diff'
                    ? '所属 Skill 提供'
                    : ['read', 'bash'].includes(tool)
                      ? 'Pi 原生提供'
                      : 'Extension 提供',
                  '已加载到会话',
                  '向模型声明',
                  '当前活动可调用',
                ].map((t, i) => (
                  <div key={t}>
                    <Status tone={callable ? 'good' : 'warn'}>{callable ? '可用' : '未提供'}</Status>
                    <span>{t}</span>
                    <small>
                      {!callable
                        ? '所属 Skill 未启用或未获信任'
                        : i === 3 && tool === 'bash'
                          ? '受当前活动权限约束'
                          : '当前会话'}
                    </small>
                  </div>
                ))}
              </div>
              {x.mode === 'quiet' ? (
                <details className="tool-schema">
                  <summary>参数声明与完整结构</summary>{' '}
                  <JsonView
                    value={{
                      name: tool,
                      source: ['read', 'bash'].includes(tool) ? 'Pi' : 'Extension',
                      inputSchema:
                        tool === 'text_diff'
                          ? {
                              type: 'object',
                              properties: { before: { type: 'string' }, after: { type: 'string' } },
                              required: ['before', 'after'],
                            }
                          : tool === 'bash'
                            ? { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] }
                            : {
                                type: 'object',
                                properties: { path: { type: 'string', description: '项目内路径' } },
                                required: ['path'],
                              },
                      session: '比较两版项目说明',
                    }}
                  />
                </details>
              ) : (
                <JsonView
                  value={{
                    name: tool,
                    source: ['read', 'bash'].includes(tool) ? 'Pi' : 'Extension',
                    inputSchema:
                      tool === 'text_diff'
                        ? {
                            type: 'object',
                            properties: { before: { type: 'string' }, after: { type: 'string' } },
                            required: ['before', 'after'],
                          }
                        : tool === 'bash'
                          ? { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] }
                          : {
                              type: 'object',
                              properties: { path: { type: 'string', description: '项目内路径' } },
                              required: ['path'],
                            },
                    session: '比较两版项目说明',
                  }}
                />
              )}
              {tool === 'text_diff' && (
                <Button
                  kind="ghost"
                  onClick={() => {
                    C('Skill');
                    I('text-diff');
                  }}
                >
                  查看所属 Skill <ArrowUpRight size={13} />
                </Button>
              )}
            </div>
          </div>
        )}
        <Modal
          open={editor}
          onClose={() => E(false)}
          title="编辑能力文件"
          description="规则与执行内容保存为候选，正式版本继续工作。"
          wide
        >
          <Field label={`${editorFile} / 候选内容`}>
            <textarea className="source-editor" value={text} onChange={(e) => V(e.target.value)} />
          </Field>
          <div className="modal-footer">
            <Button onClick={() => E(false)}>放弃编辑</Button>
            <Button
              kind="primary"
              disabled={!text.trim() || text === (editorFile === 'extension.ts' ? skill.code : skill.content)}
              onClick={() => {
                update({ candidate: text, candidateFile: editorFile, candidateTrusted: !skill.extension });
                E(false);
                T('文件与候选');
              }}
            >
              保存为候选
            </Button>
          </div>
        </Modal>
        <Modal
          open={review}
          onClose={() => R(false)}
          title="审查精确内容"
          description="审查记录仅绑定眼前这份候选；再次修改会使其失效。"
          wide
        >
          <Notice tone="warn" title="可执行代码使用 Host 权限">
            请同时核对文件、跨资源引用和锁定依赖。人工审查不是沙箱。
          </Notice>
          <Code
            text={skill.candidate}
            language={skill.candidateFile === 'extension.ts' ? 'typescript' : 'markdown'}
            file={`${skill.name}/${skill.candidateFile ?? 'SKILL.md'}`}
          />
          {skill.extension && (
            <Code
              text={
                skill.candidateFile === 'extension.ts'
                  ? skill.content
                  : (skill.code ??
                    'export function compare(before: string, after: string) {\n  return { before, after, context: true };\n}')
              }
              language={skill.candidateFile === 'extension.ts' ? 'markdown' : 'typescript'}
              file={skill.candidateFile === 'extension.ts' ? 'SKILL.md / 保留的正式内容' : 'extension.ts / 随候选审查'}
            />
          )}
          <dl>
            <dt>依赖闭包</dt>
            <dd>@agent/text-compare 1.2.0 → diff 8.0.2</dd>
            <dt>所属 Extension</dt>
            <dd>extension.ts · 独占绑定</dd>
          </dl>
          <label className="check-row">
            <input type="checkbox" checked={approved} onChange={(e) => A(e.target.checked)} />
            <span>我已审查这份候选的完整内容与依赖引用</span>
          </label>
          <div className="modal-footer">
            <Button
              kind="primary"
              disabled={!approved}
              onClick={() => {
                update({ candidateTrusted: true });
                R(false);
              }}
            >
              记录本次内容审查
            </Button>
          </div>
        </Modal>
        <Modal
          open={importing}
          onClose={() => IM(false)}
          title="导入 Skill"
          description="选择脱敏演示包，只保存候选，不加载代码。"
        >
          <Field label="候选名称">
            <input value={name} onChange={(e) => N(e.target.value)} />
          </Field>
          <div className="import-manifest">
            <Package size={22} />
            <div>
              <strong>模拟项目包</strong>
              <small>SKILL.md · extension.ts · 锁定依赖</small>
            </div>
          </div>
          <Notice title="导入与执行分开">
            导入不会执行包入口、安装脚本或授予信任。可执行候选需要精确内容审查及必要检查。
          </Notice>
          <div className="modal-footer">
            <Button
              kind="primary"
              disabled={!name.trim() || x.d.skills.some((s) => s.name === name)}
              onClick={() => {
                x.mutate((s) => ({
                  ...s,
                  skills: [
                    ...s.skills,
                    {
                      id: name,
                      name,
                      description: '明确文档材料覆盖范围，保留未核实内容。',
                      enabled: false,
                      extension: true,
                      version: 0,
                      versions: [],
                      candidate: `# ${name}\n检查输入材料是否完整；不补造缺失结论。`,
                      trusted: false,
                      content: `# ${name}\n尚未生效的导入候选。`,
                    },
                  ],
                }));
                I(name);
                IM(false);
                T('文件与候选');
                M(true);
                if (studio && innerWidth > 700)
                  requestAnimationFrame(() =>
                    document.querySelector('.matrix-detail')?.scrollIntoView({ block: 'start' }),
                  );
              }}
            >
              保存候选
            </Button>
          </div>
        </Modal>
        <Modal open={rollback !== null} onClose={() => RB(null)} title="恢复能力版本">
          <p className="lead">
            将 {skill.name} 从 v{skill.version} 切换到 v{rollback}。
          </p>
          <Notice title="仅恢复能力内容" tone="warn">
            Memory、执行历史和已发生的外部副作用保持原样。已经执行中的调用不被中途替换。
          </Notice>
          <div className="modal-footer">
            <Button onClick={() => RB(null)}>取消</Button>
            <Button
              kind="primary"
              onClick={() => {
                update({ version: rollback ?? 1, ...skill.snapshots?.[rollback ?? 1] });
                RB(null);
                x.notify('版本引用已切换，历史仍保留。');
              }}
            >
              确认恢复 v{rollback}
            </Button>
          </div>
        </Modal>
      </div>
    </StateGate>
  );
}
