import { Markdown } from '../../components/Markdown';
import { readPosition, savePosition } from '../../app/view-state';
import { useEffect, useRef, useState } from 'react';
import { ToolCatalog } from './ToolCatalog';
interface Skill {
  id: string;
  name: string;
  description: string;
  source: string;
  project: string;
  enabled: boolean;
  revision: number;
  current?: string;
  latest: string;
}
interface Version {
  id: string;
  skillFile: string;
  extensions: string[];
  knowledgeFiles: string[];
  digest: string;
  created: number;
  review?: { notes: string; at: number };
  evolution?: { activityId: string; checkedAt: number };
}
interface Operation {
  id: string;
  skillId: string;
  status: string;
  message: string;
  created: number;
}
interface Detail {
  skill: Skill;
  versions: Version[];
  files: string[];
  snapshotFiles: string[];
  operations: Operation[];
  draftDir: string;
  runtime?: {
    loaded: boolean;
    tools: Array<{ name: string; description: string; exposure: string; parameters: unknown }>;
    hooks: string[];
  };
  knowledge: Array<{ id: string; version: string; file: string; content: string; created: number }>;
}
interface Catalog {
  skills: Skill[];
  discovered: Array<{ name: string; description: string; source: string }>;
  operations: Operation[];
}
type Api = <T>(path: string, method?: string, data?: unknown) => Promise<T>;
export function SkillsPanel({
  api,
  project,
  initialId,
  initialKnowledgeRevision,
  onClose,
  onAssist,
  onDirtyChange,
  onActivity,
}: {
  api: Api;
  project: string;
  initialId?: string;
  initialKnowledgeRevision?: string;
  onClose: () => void;
  onAssist: (prompt: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  onActivity?: (id: string) => void;
}) {
  const [catalog, setCatalog] = useState<Catalog>(),
    [detail, setDetail] = useState<Detail>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [source, setSource] = useState(''),
    [binding, setBinding] = useState(''),
    [scope, setScope] = useState('global'),
    [path, setPath] = useState(''),
    [content, setContent] = useState(''),
    [loaded, setLoaded] = useState(''),
    [editing, setEditing] = useState(false);
  const [reading, setReading] = useState(true);
  const [bufferRevision, setBufferRevision] = useState(0);
  const [pendingImport, setPendingImport] = useState<string>();
  const [snapshotContent, setSnapshotContent] = useState('');
  const [reviewKey, setReviewKey] = useState('');
  const [notes, setNotes] = useState(''),
    [reviewChecks, setReviewChecks] = useState([false, false, false]),
    [notice, setNotice] = useState('');
  const detailRef = useRef<string | undefined>(undefined),
    epoch = useRef(0),
    detailEpoch = useRef(0),
    refreshEpoch = useRef(0),
    generation = useRef(0),
    context = useRef(project),
    operations = useRef(0),
    dirty = useRef(false);
  if (context.current !== project) {
    context.current = project;
    generation.current++;
    operations.current = 0;
  }
  const refresh = async () => {
    if (context.current !== project) return;
    const request = ++refreshEpoch.current,
      owner = generation.current,
      selection = epoch.current;
    const list = await api<Catalog>(`/skills${project ? `?project=${encodeURIComponent(project)}` : ''}`);
    if (request !== refreshEpoch.current || owner !== generation.current) return;
    setCatalog(list);
    if (detailRef.current && !dirty.current && selection === epoch.current) {
      const id = detailRef.current,
        detailRequest = ++detailEpoch.current,
        data = await api<Detail>(`/skills/${id}`);
      if (
        request === refreshEpoch.current &&
        owner === generation.current &&
        selection === epoch.current &&
        detailRequest === detailEpoch.current &&
        id === detailRef.current &&
        !dirty.current
      )
        setDetail(data);
    }
  };
  const guard = async (fn: () => Promise<unknown>) => {
    const owner = generation.current;
    operations.current++;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      if (owner === generation.current) setError((e as Error).message);
    } finally {
      if (owner === generation.current) {
        operations.current--;
        setBusy(operations.current > 0);
      }
    }
  };
  useEffect(() => {
    detailRef.current = undefined;
    epoch.current++;
    detailEpoch.current++;
    dirty.current = false;
    setCatalog(undefined);
    setDetail(undefined);
    setEditing(false);
    setPath('');
    setContent('');
    setLoaded('');
    setError('');
    setNotice('');
    setBusy(false);
    void guard(refresh);
    const handler = () => void refresh().catch(() => {});
    window.addEventListener('agent-skills-changed', handler);
    window.addEventListener('agent-reconnected', handler);
    return () => {
      generation.current++;
      refreshEpoch.current++;
      detailEpoch.current++;
      epoch.current++;
      operations.current = 0;
      window.removeEventListener('agent-skills-changed', handler);
      window.removeEventListener('agent-reconnected', handler);
    };
  }, [project]);
  const open = async (id: string) => {
    if (dirty.current && !window.confirm('当前文件有未保存修改，离开并放弃这些修改？')) return;
    const current = ++epoch.current,
      request = ++detailEpoch.current,
      owner = generation.current;
    detailRef.current = id;
    dirty.current = false;
    setDetail(undefined);
    setEditing(false);
    setPath('');
    setContent('');
    setLoaded('');
    setNotes('');
    setReviewChecks([false, false, false]);
    const data = await api<Detail>(`/skills/${id}`);
    if (owner === generation.current && epoch.current === current && request === detailEpoch.current) setDetail(data);
  };
  useEffect(() => {
    const id = initialId ?? readPosition('skills').id;
    if (id) void guard(() => open(id));
  }, [initialId, project]);
  useEffect(() => {
    if (detail) savePosition('skills', { id: detail.skill.id });
  }, [detail]);
  const read = async (file: string, version?: string) => {
    if (dirty.current && !window.confirm('放弃当前文件未保存的修改？')) return;
    setReading(true);
    if (!detail || detailRef.current !== detail.skill.id) return;
    const current = ++epoch.current,
      owner = generation.current;
    const data = await api<{ content: string; baseRevision: number; version: string; latest: string }>(
      `/skills/${detail.skill.id}/files?version=${version ?? detail.skill.latest}&path=${encodeURIComponent(file)}`,
    );
    if (owner !== generation.current || current !== epoch.current) return;
    setPath(file);
    setContent(data.content);
    setLoaded(data.content);
    setBufferRevision(data.baseRevision);
    dirty.current = false;
    setEditing(data.version === data.latest && (!version || version === detail.skill.latest));
  };
  const post = async (action: string, data: unknown) => {
    if (!detail) return;
    await api(`/skills/${detail.skill.id}/${action}`, 'POST', data);
    setNotice('请求已提交，结果将在能力状态中显示。');
    await refresh();
  };
  const importSource = async (value = source) => {
    const bindings = binding.trim() ? JSON.parse(binding) : undefined;
    const operation = await api<Operation>('/skills', 'POST', {
      source: value,
      project: scope === 'project' ? project : undefined,
      bindings,
    });
    setPendingImport(operation.id);
    await refresh();
    setNotice('正在准备候选，结果将在列表中同步。可执行版本须先完成实际审查。');
  };
  useEffect(() => {
    const op = catalog?.operations.find((o) => o.id === pendingImport);
    if (op && !['checking', 'waiting'].includes(op.status)) {
      setNotice(op.message);
      setPendingImport(undefined);
    }
  }, [catalog, pendingImport]);
  const latest = detail?.versions.find((v) => v.id === detail.skill.latest);
  const versionKey = latest ? `${latest.id}:${latest.digest}` : '';
  useEffect(() => {
    setSnapshotContent('');
    setNotes('');
    setReviewChecks([false, false, false]);
    setReviewKey(versionKey);
  }, [versionKey]);
  useEffect(() => {
    onDirtyChange(content !== loaded);
    dirty.current = content !== loaded;
  }, [content, loaded]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      onDirtyChange(false);
    };
  }, []);
  const save = async () => {
    if (!detail) return;
    const owner = generation.current,
      selection = epoch.current,
      id = detail.skill.id;
    const data = await api<Detail>(`/skills/${detail.skill.id}/edit`, 'POST', {
      baseRevision: bufferRevision,
      files: [{ path, content }],
    });
    if (owner !== generation.current || selection !== epoch.current || id !== detailRef.current) return;
    dirty.current = false;
    setLoaded(content);
    setBufferRevision(data.skill.revision);
    setDetail(data);
    await refresh();
    setNotice('候选已保存，正式版本尚未改变。');
  };
  return (
    <section className="skill-panel" aria-label="Skill 管理">
      <header>
        <div>
          <h1>能力</h1>
          <p>查看和管理 Agent 可以按需使用的 Skill。</p>
        </div>
        <button type="button" onClick={onClose}>
          返回对话
        </button>
      </header>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div className="skill-catalog-ops" aria-live="polite">
        {catalog?.operations
          .filter((o) => o.skillId === 'catalog' && o.status !== 'applied')
          .slice(0, 1)
          .map((o) => (
            <p className="notice" key={o.id} data-operation-status={o.status}>
              {o.message}
            </p>
          ))}
      </div>
      <div className="skill-layout" data-detail={!!detail}>
        <div className="skill-list" aria-busy={busy}>
          {!catalog && !error && (
            <p className="list-placeholder" role="status">
              正在读取能力列表…
            </p>
          )}
          {catalog && !catalog.skills.length && (
            <p className="empty-action">尚未添加 Skill。可添加已有来源，或展开已发现的普通 Skill。</p>
          )}
          <details>
            <summary>添加 Skill</summary>
            <label>
              来源
              <input
                aria-label="Skill 来源"
                placeholder="本地目录、npm:包名 或 git:地址"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
            </label>
            <label>
              作用域
              <select aria-label="Skill 作用域" value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="global">所有项目</option>
                <option value="project" disabled={!project}>
                  当前项目
                </option>
              </select>
            </label>
            <details>
              <summary>特殊 Package 的能力归属</summary>
              <p>为每个 Skill 指定独占 Extension 路径；知识文件可单独声明。所有路径相对于包根目录。</p>
              <textarea
                aria-label="Skill 绑定"
                placeholder={
                  '[{"skill":"skills/example/SKILL.md","extensions":["extensions/example.ts"],"knowledgeFiles":["skills/example/notes.md"]}]'
                }
                value={binding}
                onChange={(e) => setBinding(e.target.value)}
              />
            </details>
            <button type="button" disabled={busy || !source.trim()} onClick={() => void guard(() => importSource())}>
              保存候选
            </button>
          </details>
          {catalog?.skills.map((s) => (
            <button
              type="button"
              className={`skill-item ${s.id === detail?.skill.id ? 'selected' : ''}`}
              key={s.id}
              onClick={() => void guard(() => open(s.id))}
            >
              <b>{s.name}</b>
              <span>{s.description}</span>
              <small>
                {s.current ? (s.enabled ? '已启用' : '已禁用') : '尚未生效'} · {s.project ? '项目' : '所有项目'}
              </small>
            </button>
          ))}
          {!!catalog?.discovered.length && (
            <details>
              <summary>已发现的普通 Skill · {catalog.discovered.length}</summary>
              {catalog.discovered.map((s) => (
                <div key={s.source}>
                  <b>{s.name}</b>
                  <p>{s.description}</p>
                  <button type="button" disabled={busy} onClick={() => void guard(() => importSource(s.source))}>
                    纳入管理
                  </button>
                </div>
              ))}
            </details>
          )}
          <ToolCatalog api={api} project={project} onSkill={(id) => void guard(() => open(id))} />
        </div>
        <div className="skill-detail">
          {detail && (
            <button
              type="button"
              className="back-to-list"
              onClick={() => {
                if (dirty.current && !window.confirm('放弃未保存修改？')) return;
                dirty.current = false;
                onDirtyChange(false);
                detailRef.current = undefined;
                setDetail(undefined);
              }}
            >
              ← 能力列表
            </button>
          )}
          {!detail ? (
            <div className="skill-empty">
              <h2>选择一项能力</h2>
              <p>说明、编辑和版本历史会显示在这里。</p>
            </div>
          ) : (
            <>
              <h2>{detail.skill.name}</h2>
              <p>{detail.skill.description}</p>
              <p className="skill-source">{detail.skill.source}</p>
              <div className="skill-controls">
                <span>{detail.skill.current ? (detail.skill.enabled ? '已启用' : '已禁用') : '候选尚未生效'}</span>
                <button
                  type="button"
                  disabled={busy || !detail.skill.current}
                  onClick={() =>
                    void guard(() =>
                      post('enabled', { enabled: !detail.skill.enabled, baseRevision: detail.skill.revision }),
                    )
                  }
                >
                  {detail.skill.enabled ? '禁用' : '启用'}
                </button>
                <button
                  type="button"
                  disabled={busy || !latest || (latest.extensions.length > 0 && !latest.review && !latest.evolution)}
                  onClick={() =>
                    void guard(() =>
                      post('publish', { version: detail.skill.latest, baseRevision: detail.skill.revision }),
                    )
                  }
                >
                  检查并生效
                </button>
                <button
                  type="button"
                  disabled={busy || !latest}
                  onClick={() => latest && void guard(() => read(latest.skillFile))}
                >
                  查看说明
                </button>
              </div>
              {!!detail.operations.length && (
                <div className="skill-operations" aria-live="polite">
                  {detail.operations.slice(0, 1).map((o) => (
                    <p key={o.id} data-operation-status={o.status}>
                      {o.message} <small>{new Date(o.created).toLocaleString()}</small>
                    </p>
                  ))}
                </div>
              )}
              <details open={!!path}>
                <summary>文件与编辑</summary>
                <select aria-label="Skill 文件" value={path} onChange={(e) => void guard(() => read(e.target.value))}>
                  <option value="">选择文件</option>
                  {detail.files.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
                {path && (
                  <>
                    <p>
                      {path}
                      {content !== loaded ? ' · 未保存' : ''}
                    </p>
                    {reading ? (
                      <div className="skill-reading">
                        {path.endsWith('.md') ? (
                          <Markdown>{content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')}</Markdown>
                        ) : (
                          <pre>{content}</pre>
                        )}
                        <button type="button" disabled={!editing} onClick={() => setReading(false)}>
                          编辑文件
                        </button>
                      </div>
                    ) : (
                      <textarea
                        className="skill-editor"
                        aria-label="Skill 内容"
                        value={content}
                        readOnly={!editing}
                        onChange={(e) => {
                          setContent(e.target.value);
                          dirty.current = true;
                        }}
                      />
                    )}
                    {!reading && (
                      <div className="skill-controls">
                        <button
                          type="button"
                          disabled={busy || !editing || content === loaded}
                          onClick={() => void guard(save)}
                        >
                          保存修改为候选
                        </button>
                        {latest?.knowledgeFiles.includes(path) && (
                          <button
                            type="button"
                            disabled={busy || !detail.skill.current || content === loaded}
                            onClick={() =>
                              void guard(async () => {
                                await post('knowledge', { baseRevision: bufferRevision, path, content });
                                dirty.current = false;
                                setLoaded(content);
                                setBufferRevision(bufferRevision + 1);
                                await refresh();
                                setNotice('知识修订已保存，无需重新加载执行能力。');
                              })
                            }
                          >
                            仅更新知识
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
                <details>
                  <summary>让 Agent 协助编辑</summary>
                  <p>Agent 修改候选目录，与直接编辑共用同一版本历史。可执行变更仍需实际人工审查。</p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void guard(async () => {
                        const d = await api<{ directory: string; revision: number }>(
                          `/skills/${detail.skill.id}/draft`,
                          'POST',
                          {},
                        );
                        setNotice(`编辑目录：${d.directory}`);
                        onAssist(
                          `请协助编辑 Skill ${detail.skill.name}。先与我确认具体目标，仅在候选目录 ${d.directory} 修改文件；不要执行候选代码或变更正式 Skill。完成后我会在能力管理中导入候选并审查。`,
                        );
                      })
                    }
                  >
                    准备编辑目录并进入对话
                  </button>
                  <p>{detail.draftDir}</p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void guard(async () => {
                        if (!window.confirm('永久放弃此编辑目录及其中未导入的修改？')) return;
                        await api(`/skills/${detail.skill.id}/draft`, 'DELETE');
                        setNotice('编辑目录已放弃，可以重新准备。');
                      })
                    }
                  >
                    放弃编辑目录
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void guard(async () => {
                        await post('import-draft', { baseRevision: detail.skill.revision });
                      })
                    }
                  >
                    导入目录中的修改
                  </button>
                </details>
              </details>
              {!!latest?.extensions.length && (
                <details>
                  <summary>代码、依赖与执行信任</summary>
                  <p>Extension 与 Agent Host 同进程、同权限运行。项目授信不是沙箱；只批准实际审查过的精确内容。</p>
                  <p>Extension：{latest.extensions.join('、')}</p>
                  <p className="skill-source">内容摘要：{latest.digest}</p>
                  <details>
                    <summary>完整快照与锁定依赖（只读）</summary>
                    <p>包根以外的安装锁与依赖同样包含在审查摘要中。</p>
                    <select
                      aria-label="快照审查文件"
                      defaultValue=""
                      onChange={(e) =>
                        void guard(async () => {
                          const data = await api<{ content: string }>(
                            `/skills/${detail.skill.id}/files?version=${latest.id}&snapshot=true&path=${encodeURIComponent(e.target.value)}`,
                          );
                          setSnapshotContent(data.content);
                        })
                      }
                    >
                      <option value="">选择快照文件</option>
                      {detail.snapshotFiles.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                    <pre>{snapshotContent}</pre>
                  </details>
                  {latest.evolution ? (
                    <p>此版本来自已授权的能力开发活动，通过候选检查后生效。</p>
                  ) : latest.review ? (
                    <p>此内容已记录人工审查：{latest.review.notes}</p>
                  ) : (
                    <>
                      <fieldset>
                        <legend>实际审查完成后确认</legend>
                        {['已审查执行代码及资源归属', '已审查完整依赖及锁定内容', '已审查本机权限与副作用'].map(
                          (t, i) => (
                            <label key={t}>
                              <input
                                type="checkbox"
                                checked={reviewChecks[i]}
                                onChange={(e) =>
                                  setReviewChecks((old) => old.map((v, j) => (j === i ? e.target.checked : v)))
                                }
                              />
                              {t}
                            </label>
                          ),
                        )}
                      </fieldset>
                      <textarea
                        aria-label="审查结论"
                        placeholder="记录实际代码、依赖与权限审查结论"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                      />
                      <button
                        type="button"
                        disabled={
                          busy || reviewKey !== versionKey || reviewChecks.some((v) => !v) || notes.trim().length < 10
                        }
                        onClick={() =>
                          void guard(() =>
                            post('review', {
                              version: latest.id,
                              digest: latest.digest,
                              notes,
                              reviewedCode: true,
                              reviewedDependencies: true,
                              reviewedPermissions: true,
                            }),
                          )
                        }
                      >
                        批准此精确版本
                      </button>
                    </>
                  )}
                </details>
              )}
              {!!latest?.extensions.length && (
                <details>
                  <summary>Tool 与 Hook</summary>
                  {!detail.runtime?.loaded ? (
                    <p>此能力尚未加载到运行中的会话。</p>
                  ) : (
                    <>
                      {detail.runtime.tools.map((t) => (
                        <details key={t.name}>
                          <summary>
                            {t.name} · {t.exposure}
                          </summary>
                          <p>{t.description}</p>
                          <pre>{JSON.stringify(t.parameters, null, 2)}</pre>
                        </details>
                      ))}
                      <p>Hook：{detail.runtime.hooks.join('、') || '无'}</p>
                    </>
                  )}
                </details>
              )}
              {initialKnowledgeRevision && !detail.knowledge.some((item) => item.id === initialKnowledgeRevision) && (
                <p className="notice" role="status">
                  指定知识修订不可访问，请查看当前版本与可用历史。
                </p>
              )}
              <details open={!!initialKnowledgeRevision}>
                <summary>版本与修订历史</summary>
                <details>
                  <summary>操作记录</summary>
                  {detail.operations.map((o) => (
                    <p key={o.id}>
                      {new Date(o.created).toLocaleString()} · {o.message}
                    </p>
                  ))}
                </details>
                {detail.versions.map((v) => (
                  <div className="skill-version" key={v.id}>
                    <p>
                      {new Date(v.created).toLocaleString()} · {v.id.slice(0, 8)}{' '}
                      {v.id === detail.skill.current ? '· 当前正式版本' : ''}{' '}
                      {v.id === detail.skill.latest ? '· 最新候选' : ''}
                    </p>
                    <div className="skill-controls">
                      {v.evolution && onActivity && (
                        <button type="button" onClick={() => onActivity(v.evolution!.activityId)}>
                          查看开发活动
                        </button>
                      )}
                      <button type="button" disabled={busy} onClick={() => void guard(() => read(v.skillFile, v.id))}>
                        查看说明
                      </button>
                      <button
                        type="button"
                        disabled={
                          busy ||
                          v.id === detail.skill.current ||
                          (v.extensions.length > 0 && !v.review && !v.evolution)
                        }
                        onClick={() =>
                          void guard(() => post('rollback', { version: v.id, baseRevision: detail.skill.revision }))
                        }
                      >
                        恢复此版本
                      </button>
                    </div>
                  </div>
                ))}
                {detail.knowledge.map((k, i) => (
                  <details key={k.id ?? i} open={k.id === initialKnowledgeRevision ? true : undefined}>
                    <summary>
                      知识修订 · {k.file} · {new Date(k.created).toLocaleString()}
                    </summary>
                    <p>关联能力版本：{k.version.slice(0, 8)}</p>
                    <Markdown>{k.content}</Markdown>
                    <button
                      type="button"
                      disabled={busy || !detail.skill.current}
                      onClick={() =>
                        void guard(async () => {
                          if (dirty.current && !window.confirm('放弃未保存内容并恢复此知识修订？')) return;
                          await api(`/skills/${detail.skill.id}/knowledge`, 'POST', {
                            baseRevision: detail.skill.revision,
                            path: k.file,
                            content: k.content,
                          });
                          dirty.current = false;
                          setPath('');
                          setContent('');
                          setLoaded('');
                          await refresh();
                          setNotice('知识修订已恢复并留存新记录。');
                        })
                      }
                    >
                      恢复此知识修订
                    </button>
                  </details>
                ))}
              </details>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
