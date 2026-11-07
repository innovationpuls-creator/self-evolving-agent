import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileCode, FileText, Plus, RefreshCw } from 'lucide-react';
import type { AgentService } from '../../../../host/runtime/agent';
import type { SkillOperation, SkillVersion } from '../../../../host/skills/skills';
import type { toolCatalog } from '../../../../host/skills/tool-catalog';
import { Button, Field, IconButton, Modal, Notice, SearchBox } from '../../components/ui';
import { Code, Markdown } from '../../components/content';
import { Diff, Evidence } from '../../components/structured-content';
import { ViewTabs, ViewPanel } from '../../components/controls';
import { Failure, date, projectName } from '../../components/reading';
import { useRead, type Host, type Route, type SkillDetail } from '../../app/types';
import { type SkillDrafts, operationApplied, reviewed } from './skill-management';
import './skills.css';
type Catalog = Awaited<ReturnType<AgentService['skills']['discover']>>;
type Tools = ReturnType<typeof toolCatalog>;
type Go = (r: Route) => void;
const versionLabel = (v: SkillVersion) =>
  `${new Date(v.created).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })} · ${v.id.slice(0, 8)}`;
const events = ['agent-skills-changed', 'agent-tools-changed'];
function immutableFile(detail: SkillDetail, version: string, path: string) {
  const v = detail.versions.find((v) => v.id === version);
  if (!v) throw Error('指定版本不存在');
  return new URLSearchParams({
    version,
    path: v.packageRoot && v.packageRoot !== '.' ? `${v.packageRoot}/${path}` : path,
    snapshot: 'true',
  });
}
export function Skills({
  host,
  project,
  go,
  store,
  route,
  back,
  onAssist,
}: {
  host: Host;
  project: string;
  go: Go;
  store: SkillDrafts;
  route: Route;
  back: () => void;
  onAssist?: (text: string) => void;
}) {
  const id = route.page === 'result' && route.target.kind === 'skill' ? route.target.id : undefined;
  const catalog = useRead<Catalog>(host.api, `/skills?${new URLSearchParams(project ? { project } : {})}`, events);
  const tools = useRead<Tools>(host.api, `/tools?${new URLSearchParams(project ? { project } : {})}`, events);
  const [query, Q] = useState(''),
    [tab, T] = useState('技能'),
    [filter, F] = useState('全部'),
    [importing, I] = useState(false);
  const [source, S] = useState(''),
    [binding, B] = useState(''),
    [scope, SC] = useState(project ? 'project' : 'global'),
    [error, E] = useState(''),
    [busy, U] = useState(false),
    [importOp, IO] = useState<SkillOperation>();
  useEffect(() => {
    if (!importOp || !['checking', 'waiting'].includes(importOp.status)) return;
    const timer = setInterval(() => {
      void host
        .api<SkillOperation>(`/skills/operations/${importOp.id}`)
        .then(IO)
        .catch((e) => E(e.message));
      catalog.refresh();
    }, 1000);
    return () => clearInterval(timer);
  }, [host.api, importOp?.id, importOp?.status, catalog.refresh]);
  useEffect(() => {
    if (!project && scope === 'project') SC('global');
  }, [project, scope]);
  const projects = [...new Set(host.sessions.map((s) => s.cwd))];
  return (
    <div className="asm host-capabilities">
      <header className="asm-heading">
        <h1 tabIndex={-1}>技能与工具</h1>
        <Button onClick={() => I(true)} disabled={host.connection !== 'ready'}>
          <Plus size={15} />
          导入技能
        </Button>
      </header>
      <div className="aw-toolbar">
        <select
          aria-label="技能项目"
          value={project}
          title={project || undefined}
          onChange={(e) => go({ page: 'skills', project: e.target.value })}
        >
          <option value="">默认项目</option>
          {projects.map((p) => (
            <option key={p} value={p} title={p}>
              {projectName(p)}
            </option>
          ))}
        </select>
        <IconButton
          label="刷新"
          onClick={() => {
            catalog.refresh();
            tools.refresh();
          }}
        >
          <RefreshCw size={15} />
        </IconButton>
      </div>
      <div className="asm-manager" data-detail={!!id}>
        <aside className="asm-library" aria-label="能力目录">
          <ViewTabs items={['技能', '工具']} value={tab} onChange={T} label="能力类型" id="real-capability-kind" />
          {(tab === '技能' ? !!catalog.value?.skills.length : !!tools.value?.tools.length) && (
            <SearchBox value={query} onChange={Q} placeholder={tab === '技能' ? '搜索技能' : '搜索工具'} />
          )}
          {catalog.error && <Failure error={catalog.error} retry={catalog.refresh} />}
          {tab === '技能' ? (
            <>
              {!!catalog.value?.skills.length && (
                <div className="asm-filters">
                  {['全部', '已启用', '待发布'].map((v) => (
                    <button type="button" key={v} aria-pressed={filter === v} onClick={() => F(v)}>
                      {v}
                    </button>
                  ))}
                </div>
              )}
              {catalog.loading && !catalog.value && <p role="status">正在读取技能…</p>}
              <div className="asm-items">
                {catalog.value?.skills
                  .filter(
                    (s) =>
                      (!query || `${s.name} ${s.description}`.toLowerCase().includes(query.toLowerCase())) &&
                      (filter === '全部' ||
                        (filter === '已启用' && !!s.current && s.enabled) ||
                        (filter === '待发布' && s.latest !== s.current)),
                  )
                  .map((s) => (
                    <button
                      type="button"
                      className={`asm-item ${s.id === id ? 'selected' : ''}`}
                      key={s.id}
                      data-focus={`skill-${s.id}`}
                      data-skill={s.id}
                      onClick={() => go({ page: 'result', project, target: { kind: 'skill', id: s.id } })}
                    >
                      <FileText size={18} />
                      <span className="asm-item-text">
                        <strong>{s.name}</strong>
                        <span>{s.description}</span>
                        {(!s.current || !s.enabled || s.latest !== s.current) && (
                          <small>{!s.current ? '尚未生效' : !s.enabled ? '已禁用' : '有待发布版本'}</small>
                        )}
                      </span>
                    </button>
                  ))}
              </div>
              {catalog.value && !catalog.value.skills.length && <p>还没有技能</p>}
              {!!catalog.value?.discovered.length && (
                <details className="host-discovered">
                  <summary>未管理的技能文件</summary>
                  {catalog.value.discovered.map((s) => (
                    <div key={s.source}>
                      <strong>{s.name}</strong>
                      <p>{s.description}</p>
                      <Button
                        kind="ghost"
                        onClick={() => {
                          S(s.source);
                          I(true);
                        }}
                      >
                        纳入管理
                      </Button>
                    </div>
                  ))}
                </details>
              )}
            </>
          ) : (
            <div className="host-tool-list">
              {tools.error && <Failure error={tools.error} retry={tools.refresh} />}
              {tools.value?.tools
                .filter((t) => `${t.name} ${t.description}`.toLowerCase().includes(query.toLowerCase()))
                .map((t) => (
                  <details key={`${t.source}:${t.name}`}>
                    <summary>{t.name}</summary>
                    <ToolReader tool={t} sessions={host.sessions} project={project} go={go} />
                  </details>
                ))}
            </div>
          )}
        </aside>
        <section className="asm-detail" aria-label="技能详情">
          {id ? (
            <SkillReader
              key={id}
              host={host}
              id={id}
              route={route}
              store={store}
              go={go}
              back={back}
              onAssist={onAssist}
            />
          ) : (
            <div className="asm-empty">
              <FileCode size={30} />
              <h2>选择技能，继续阅读或编辑</h2>
              {!!store.all().length && (
                <div>
                  <h3>未保存的文件</h3>
                  {[...new Set(store.all().map((d) => d.id))].map((sid) => (
                    <Button
                      key={sid}
                      onClick={() => go({ page: 'result', project, target: { kind: 'skill', id: sid } })}
                    >
                      继续编辑 {catalog.value?.skills.find((s) => s.id === sid)?.name || '技能'}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
      <Modal
        open={importing}
        onClose={() => {
          if (!busy) I(false);
        }}
        title="导入技能"
        footer={
          <Button
            kind="primary"
            disabled={busy || !source.trim() || host.connection !== 'ready'}
            onClick={() => {
              void (async () => {
                U(true);
                E('');
                try {
                  const op = await host.api<SkillOperation>('/skills', 'POST', {
                    source,
                    project: scope === 'project' ? project : undefined,
                    ...(binding.trim() ? { bindings: JSON.parse(binding) } : {}),
                  });
                  IO(op);
                  I(false);
                  catalog.refresh();
                } catch (e) {
                  E(`${e instanceof Error ? e.message : '请求未完成'}。结果未确认，请先核对目录。`);
                } finally {
                  U(false);
                }
              })();
            }}
          >
            保存候选
          </Button>
        }
      >
        <Field label="来源">
          <input
            aria-label="Skill 来源"
            value={source}
            onChange={(e) => S(e.target.value)}
            placeholder="本地目录、npm:包名 或 git:地址"
          />
        </Field>
        <Field label="范围">
          <select value={scope} onChange={(e) => SC(e.target.value)}>
            <option value="project" disabled={!project}>
              当前项目
            </option>
            <option value="global">所有项目</option>
          </select>
        </Field>
        <details>
          <summary>代码扩展与知识文件归属</summary>
          <p>路径相对于来源根目录。每个代码扩展只绑定一项技能；知识须为独立 Markdown 文件。</p>
          <textarea aria-label="Skill 绑定" value={binding} onChange={(e) => B(e.target.value)} rows={5} />
        </details>
        <p>导入只保存为候选版本，不会运行其中的代码或安装脚本，也不代表已被信任。</p>
        {error && <p role="alert">{error}</p>}
      </Modal>
      {importOp && (
        <p role="status" data-operation-status={importOp.status}>
          {importOp.message}
        </p>
      )}
      {error && !importing && <p role="alert">{error}</p>}
    </div>
  );
}
function ToolReader({
  tool,
  sessions,
  project,
  go,
}: {
  tool: Tools['tools'][number];
  sessions: Host['sessions'];
  project: string;
  go: Go;
}) {
  const [sid, S] = useState('');
  const selected = sessions.find((s) => s.id === sid && (!project || s.cwd === project));
  return (
    <div>
      <p>{tool.description}</p>
      <Field label="查看会话">
        <select aria-label={`工具 ${tool.name} 的会话`} value={selected?.id || ''} onChange={(e) => S(e.target.value)}>
          <option value="">项目汇总</option>
          {sessions
            .filter((s) => !project || s.cwd === project)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.title || '未命名会话'}
              </option>
            ))}
        </select>
      </Field>
      {selected ? (
        <dl className="host-tool-membership">
          {[
            ['已加载', tool.sessions.includes(sid)],
            ['向模型声明', tool.activeSessions.includes(sid)],
            ['可以调用', tool.callableSessions.includes(sid)],
          ].map(([k, v]) => (
            <div key={String(k)}>
              <dt>{k}</dt>
              <dd>{v ? '是' : '否'}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>
          {tool.sessions.length} 个会话已加载 · {tool.callableSessions.length} 个会话可调用
          {tool.status === 'provided' ? ' · 内置工具，尚无会话加载' : ''}
        </p>
      )}
      {tool.skillId && (
        <Button
          kind="ghost"
          onClick={() => go({ page: 'result', project, target: { kind: 'skill', id: tool.skillId || '' } })}
        >
          管理来源技能
        </Button>
      )}
      <details>
        <summary>完整声明</summary>
        <Evidence value={tool} />
      </details>
    </div>
  );
}
function SkillReader({
  host,
  id,
  route,
  store,
  go,
  back,
  onAssist,
}: {
  host: Host;
  id: string;
  route: Route;
  store: SkillDrafts;
  go: Go;
  back: () => void;
  onAssist?: (text: string) => void;
}) {
  const read = useRead<SkillDetail>(host.api, `/skills/${id}`, events),
    detail = read.value;
  const [tab, T] = useState('内容'),
    [version, V] = useState(''),
    [path, P] = useState(''),
    [mode, M] = useState('阅读'),
    [content, C] = useState(''),
    [original, O] = useState(''),
    [formalText, FT] = useState(''),
    [base, BA] = useState(0),
    [fileBusy, FB] = useState(false),
    [error, E] = useState(''),
    [notice, N] = useState(''),
    [busy, U] = useState(false),
    [tick, K] = useState(0),
    [review, R] = useState<{ version: string; digest: string }>(),
    [checks, CH] = useState([false, false, false]),
    [notes, NO] = useState(''),
    [confirm, CF] = useState<{ action: string; version: string; enabled?: boolean; baseRevision: number }>();
  const [pending, OP] = useState(store.operations.get(id)),
    [operation, OS] = useState<SkillOperation>(),
    [knowledge, KN] = useState(''),
    [knowledgeText, KT] = useState(store.knowledge.get(id)?.text || ''),
    [knowledgeBase, KB] = useState(store.knowledge.get(id)?.baseRevision || 0),
    [snapshot, SS] = useState(''),
    [snapshotPath, SP] = useState(''),
    [compare, CP] = useState<string>();
  const [knowledgePath, KP] = useState(store.knowledge.get(id)?.file || '');
  const snapshotEpoch = useRef(0);
  const actionPending = useRef(false);
  const epoch = useRef(0),
    mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
      epoch.current++;
    },
    [],
  );
  const latest = detail?.versions.find((v) => v.id === detail.skill.latest);
  const chosen = detail?.versions.find((v) => v.id === (version || detail.skill.latest));
  const draft = store.get(id, path),
    draftCount = store.all(id).length;
  void tick;
  const refresh = () => {
    read.refresh();
  };
  // The detail can refresh from a Host event before the next poll; re-read the operation then so its status is not stale.
  useEffect(() => {
    if (!pending || (operation?.id === pending.id && !['checking', 'waiting'].includes(operation.status))) return;
    let alive = true;
    const load = () =>
      void host
        .api<SkillOperation>(`/skills/operations/${pending.id}`)
        .then((op) => {
          if (alive) {
            OS(op);
            if (!['checking', 'waiting'].includes(op.status)) read.refresh();
          }
        })
        .catch((e) => {
          if (alive) E(e.message);
        });
    load();
    const timer = setInterval(load, 1200);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [host.api, pending?.id, operation?.status, read.refresh, detail?.skill.revision]);
  useEffect(() => {
    if (detail && pending && operation) {
      if (operationApplied(operation, detail.skill, pending)) {
        N(
          pending.enabled === false
            ? '技能已禁用。'
            : pending.enabled === true
              ? '技能已启用。'
              : '当前正式版本已更新。',
        );
      } else if (operation.status === 'applied') {
        N('此操作已完成，当前状态已有后续变化。');
      }
    }
  }, [operation, detail, pending]);
  useEffect(() => {
    snapshotEpoch.current++;
    SS('');
    SP('');
    R(undefined);
    CH([false, false, false]);
    NO('');
  }, [latest?.id, latest?.digest, tab]);
  const run = async (fn: () => Promise<void>) => {
    if (actionPending.current) return;
    actionPending.current = true;
    U(true);
    E('');
    N('');
    try {
      await fn();
    } catch (e) {
      if (mounted.current) {
        E(`${e instanceof Error ? e.message : '操作未完成'}。请刷新核对当前版本；草稿已保留，未自动重试。`);
        read.refresh();
      }
    } finally {
      actionPending.current = false;
      if (mounted.current) U(false);
    }
  };
  const readFile = async (file: string, vid = chosen?.id) => {
    if (!detail || !vid) return;
    const n = ++epoch.current;
    FB(true);
    E('');
    try {
      const saved = store.get(id, file);
      const value =
        saved && !detail.files.includes(file)
          ? { content: saved.before, baseRevision: saved.baseRevision }
          : await host.api<{ content: string; baseRevision: number }>(
              `/skills/${id}/files?${immutableFile(detail, vid, file)}`,
            );
      let current = value.content;
      if (!detail.skill.current) current = '';
      else if (detail.skill.current !== vid) {
        try {
          current = (
            await host.api<{ content: string }>(
              `/skills/${id}/files?${immutableFile(detail, detail.skill.current, file)}`,
            )
          ).content;
        } catch (reason) {
          if (reason && typeof reason === 'object' && 'status' in reason && reason.status === 404) current = '';
          else throw reason;
        }
      }
      if (n !== epoch.current) return;
      P(file);
      V(vid);
      C(saved && saved.version === vid ? (saved.content ?? '') : value.content);
      O(value.content);
      FT(current);
      BA(saved && saved.version === vid ? saved.baseRevision : value.baseRevision);
      M(saved ? '编辑' : '阅读');
    } catch (e) {
      if (n === epoch.current) E(e instanceof Error ? e.message : '文件读取失败');
    } finally {
      if (n === epoch.current) FB(false);
    }
  };
  useEffect(() => {
    if (!detail || path) return;
    const target = route.page === 'result' && route.target.kind === 'skill' ? route.target : undefined;
    if (target?.knowledgeRevision) {
      T('知识');
      KN(target.knowledgeRevision);
    } else if (target?.version) {
      const exact = detail.versions.find((v) => v.id === target.version);
      if (exact) void readFile(target.file || exact.skillFile, exact.id);
      else E('指定能力版本不存在，未用当前版本替代。');
    } else if (target?.file) {
      void readFile(target.file, target.version || detail.skill.latest);
    } else if (latest) {
      void readFile(store.all(id)[0]?.path || latest.skillFile, store.all(id)[0]?.version || detail.skill.latest);
    }
  }, [detail?.skill.id]);
  const edit = (text: string) => {
    C(text);
    if (chosen && detail) {
      store.set({ id, path, baseRevision: base, version: chosen.id, before: original, content: text });
      K((n) => n + 1);
    }
  };
  const save = () =>
    run(async () => {
      if (!detail || host.connection !== 'ready' || fileBusy) return;
      const drafts = store.all(id);
      if (!drafts.length) return;
      if (drafts.some((d) => d.baseRevision !== detail.skill.revision)) throw Error('存在过期草稿，请先比较最新候选');
      const value = await host.api<SkillDetail>(`/skills/${id}/edit`, 'POST', {
        baseRevision: base,
        files: drafts.map((d) => ({ path: d.path, content: d.content })),
      });
      for (const draft of drafts) if (store.get(id, draft.path) === draft) store.files.delete(`${id}:${draft.path}`);
      if (!mounted.current) return;
      O(content);
      BA(value.skill.revision);
      V(value.skill.latest);
      K((n) => n + 1);
      read.refresh();
      N('候选已保存，正式版本保持原样。');
    });
  const operationPost = (action: string, vid: string, enabled?: boolean) =>
    run(async () => {
      if (!detail) return;
      const op = await host.api<SkillOperation>(
        `/skills/${id}/${action}`,
        'POST',
        action === 'enabled'
          ? { baseRevision: confirm?.baseRevision ?? detail.skill.revision, enabled }
          : { baseRevision: confirm?.baseRevision ?? detail.skill.revision, version: vid },
      );
      const target = { id: op.id, version: vid, enabled };
      store.operations.set(id, target);
      OP(target);
      OS(op);
      CF(undefined);
      read.refresh();
    });
  const canWrite = host.connection === 'ready' && !busy && !read.loading && !fileBusy;
  if (!detail)
    return (
      <>
        <Button kind="ghost" onClick={back}>
          <ArrowLeft size={15} />
          返回
        </Button>
        {read.error ? <Failure error={read.error} retry={refresh} /> : <p role="status">正在读取技能…</p>}
        {!!draftCount && <p>未保存文件已保留，重新读取后可继续编辑。</p>}
      </>
    );
  const currentVersion = detail.versions.find((v) => v.id === detail.skill.current);
  const editable = chosen?.id === detail.skill.latest;
  const stale = !!draft && draft.baseRevision !== detail.skill.revision;
  const ks = detail.knowledge.find((k) => k.id === knowledge) || (!knowledge ? detail.knowledge.at(-1) : undefined);
  return (
    <>
      <Button kind="ghost" className="asm-mobile-back" onClick={back}>
        <ArrowLeft size={15} />
        技能目录
      </Button>
      <header className="asm-skill-head">
        <div>
          <h2>{detail.skill.name}</h2>
          <span>{detail.skill.description}</span>
        </div>
      </header>
      <div className="asm-status-row">
        <span>{!detail.skill.current ? '尚未生效' : detail.skill.enabled ? '已启用' : '已禁用'}</span>
        {detail.skill.latest !== detail.skill.current && <span>有候选版本</span>}
        <Button kind="ghost" onClick={refresh} disabled={read.loading}>
          刷新
        </Button>
        {detail.skill.current && (
          <Button
            kind="ghost"
            disabled={!canWrite}
            onClick={() =>
              CF({
                baseRevision: detail.skill.revision,
                action: 'enabled',
                version: detail.skill.current || '',
                enabled: !detail.skill.enabled,
              })
            }
          >
            {detail.skill.enabled ? '禁用' : '启用'}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="live-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {operation && (
        <p role="status" data-operation-status={operation.status}>
          {operation.message}
        </p>
      )}
      <ViewTabs
        items={['内容', '审查与发布', '版本', '知识']}
        value={tab}
        onChange={T}
        id="real-skill-view"
        label="技能内容"
      />
      <ViewPanel items={['内容', '审查与发布', '版本', '知识']} value={tab} id="real-skill-view">
        {tab === '内容' && (
          <>
            <div className="host-file-toolbar">
              <Field label="版本">
                <select
                  aria-label="文件版本"
                  disabled={busy || fileBusy}
                  value={chosen?.id || ''}
                  onChange={(e) => {
                    V(e.target.value);
                    void readFile(path || latest?.skillFile || '', e.target.value);
                  }}
                >
                  {detail.versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.id === detail.skill.current ? '当前正式' : v.id === detail.skill.latest ? '最新候选' : '历史'}{' '}
                      · {versionLabel(v)}
                    </option>
                  ))}
                </select>
              </Field>
              <Button
                kind="ghost"
                disabled={!canWrite || !editable}
                onClick={() => {
                  const name = window.prompt('包内相对文件路径');
                  if (name) {
                    P(name);
                    FT('');
                    O('');
                    C('');
                    BA(detail.skill.revision);
                    M('编辑');
                    store.set({
                      id,
                      path: name,
                      version: detail.skill.latest,
                      baseRevision: detail.skill.revision,
                      before: '',
                      content: '',
                    });
                    K((n) => n + 1);
                  }
                }}
              >
                新文件
              </Button>
            </div>
            <div className="asm-editor-layout">
              <nav className="asm-files" aria-label="Skill 文件">
                {[...new Set([...detail.files, ...store.all(id).map((d) => d.path)])].map((f) => (
                  <button
                    type="button"
                    key={f}
                    aria-pressed={f === path}
                    title={f}
                    disabled={busy || fileBusy}
                    onClick={() => void readFile(f)}
                  >
                    <FileText size={14} />
                    <span>{f}</span>
                    {store.get(id, f) && (
                      <span role="img" aria-label="未保存">
                        •
                      </span>
                    )}
                  </button>
                ))}
              </nav>
              <div className="asm-file-work">
                <div className="asm-section-title">
                  <strong title={path}>{path}</strong>
                  <div className="asm-mode-buttons">
                    {['阅读', '编辑', '改动'].map((m) => (
                      <Button
                        kind="ghost"
                        key={m}
                        aria-pressed={mode === m}
                        disabled={m === '编辑' && !editable}
                        onClick={() => M(m)}
                      >
                        {m}
                      </Button>
                    ))}
                  </div>
                </div>
                {fileBusy ? (
                  <p role="status">正在读取文件…</p>
                ) : mode === '阅读' ? (
                  path.endsWith('.md') ? (
                    <Markdown text={content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')} />
                  ) : (
                    <Code text={content} language={path.endsWith('.json') ? 'json' : 'typescript'} file={path} />
                  )
                ) : mode === '改动' ? (
                  <Diff before={formalText} after={content} file={path} />
                ) : (
                  <div className="asm-code-editor">
                    <div className="asm-line-gutter" aria-hidden="true">
                      {content.split('\n').map((_, i) => (
                        <span key={i}>{i + 1}</span>
                      ))}
                    </div>
                    <textarea
                      aria-label="Skill 内容"
                      value={content}
                      spellCheck={false}
                      readOnly={!editable || busy}
                      onChange={(e) => edit(e.target.value)}
                      onKeyDown={(e) => {
                        if (!editable || busy) return;
                        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                          e.preventDefault();
                          void save();
                        }
                        if (e.key === 'Tab') {
                          e.preventDefault();
                          const t = e.currentTarget,
                            a = t.selectionStart,
                            b = t.selectionEnd;
                          edit(`${content.slice(0, a)}  ${content.slice(b)}`);
                          requestAnimationFrame(() => t.setSelectionRange(a + 2, a + 2));
                        }
                      }}
                    />
                  </div>
                )}
                {editable && (
                  <div className="asm-publishbar">
                    <span>{draftCount ? `${draftCount} 个未保存文件` : ''}</span>
                    {!!draftCount && (
                      <Button
                        kind="ghost"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm('放弃此技能的本页未保存文件修改？已保存候选不受影响。')) {
                            store.clear(id);
                            K((n) => n + 1);
                            void readFile(path, detail.skill.latest);
                          }
                        }}
                      >
                        放弃草稿
                      </Button>
                    )}
                    <Button
                      kind="primary"
                      disabled={
                        !canWrite || !draftCount || store.all(id).some((d) => d.baseRevision !== detail.skill.revision)
                      }
                      onClick={() => void save()}
                    >
                      保存候选
                    </Button>
                  </div>
                )}
                {stale && (
                  <Notice title="候选已被其他窗口修改" tone="warn">
                    草稿仍基于旧修订。先比较新的文件，再决定是否以当前候选继续。
                    <Button
                      onClick={() =>
                        void run(async () => {
                          const value = await host.api<{ content: string; baseRevision: number }>(
                            `/skills/${id}/files?${immutableFile(detail, detail.skill.latest, path)}`,
                          );
                          CP(value.content);
                        })
                      }
                    >
                      比较最新候选
                    </Button>
                    {compare !== undefined && (
                      <>
                        <Diff before={compare || ''} after={content} file={path} />
                        <Button
                          onClick={() => {
                            if (!draft) return;
                            store.set({
                              ...draft,
                              version: detail.skill.latest,
                              baseRevision: detail.skill.revision,
                              before: compare,
                            });
                            BA(detail.skill.revision);
                            V(detail.skill.latest);
                            O(compare);
                            CP(undefined);
                            K((n) => n + 1);
                          }}
                        >
                          以最新候选继续此文件
                        </Button>
                      </>
                    )}
                  </Notice>
                )}
              </div>
            </div>
            <details className="host-technical">
              <summary>本地候选目录</summary>
              <p>外部编辑与网页候选共用基础修订；导入成功前不会生效。</p>
              <code>{detail.draftDir}</code>
              <div className="inline-actions">
                <Button
                  disabled={!canWrite}
                  onClick={() =>
                    void run(async () => {
                      const d = await host.api<{ directory: string }>(`/skills/${id}/draft`, 'POST', {});
                      N(`已准备本地候选：${d.directory}`);
                    })
                  }
                >
                  准备目录
                </Button>
                {onAssist && (
                  <Button
                    disabled={!canWrite}
                    onClick={() =>
                      void run(async () => {
                        const draft = await host.api<{ directory: string }>(`/skills/${id}/draft`, 'POST', {});
                        N(`已准备本地候选：${draft.directory}`);
                        onAssist(
                          `请协助编辑 Skill ${detail.skill.name}。先与我确认具体目标，仅在候选目录 ${draft.directory} 修改文件；不要执行候选代码或变更正式 Skill。完成后我会在能力管理中导入候选并审查。`,
                        );
                      })
                    }
                  >
                    准备编辑目录并进入对话
                  </Button>
                )}
                <Button
                  disabled={!canWrite}
                  onClick={() =>
                    void run(async () => {
                      await host.api(`/skills/${id}/import-draft`, 'POST', { baseRevision: detail.skill.revision });
                      read.refresh();
                      N('目录已导入为候选。');
                    })
                  }
                >
                  导入目录修改
                </Button>
                <Button
                  disabled={!canWrite}
                  onClick={() => {
                    if (window.confirm('删除本地候选目录？其中未导入的修改无法恢复。'))
                      void run(async () => {
                        await host.api(`/skills/${id}/draft`, 'DELETE');
                        N('本地候选目录已删除。');
                      });
                  }}
                >
                  删除目录
                </Button>
              </div>
            </details>
          </>
        )}
        {tab === '审查与发布' && latest && (
          <>
            <h3>候选内容</h3>
            <p>
              {versionLabel(latest)}
              {latest.review?.digest === latest.digest
                ? ' · 此内容已有人工审查'
                : latest.evolution?.digest === latest.digest
                  ? ' · 已获改进授权'
                  : !latest.extensions.length
                    ? ' · 纯说明，不含代码'
                    : ''}
            </p>
            <details>
              <summary>版本与校验值</summary>
              <Evidence
                value={{
                  version: latest.id,
                  digest: latest.digest,
                  extensions: latest.extensions,
                  knowledgeFiles: latest.knowledgeFiles,
                }}
              />
            </details>
            <p>审查完整快照，包含代码、资源引用和锁定依赖。代码会以本机当前用户的权限运行。</p>
            <div className="host-snapshot-browser">
              <Field label="快照文件">
                <select
                  aria-label="审查文件"
                  disabled={busy}
                  value={snapshotPath}
                  onChange={(e) => {
                    const file = e.target.value,
                      request = ++snapshotEpoch.current;
                    SP(file);
                    SS('');
                    void run(async () => {
                      const f = await host.api<{ content: string }>(
                        `/skills/${id}/files?${new URLSearchParams({ version: latest.id, path: file, snapshot: 'true' })}`,
                      );
                      if (request === snapshotEpoch.current) SS(f.content);
                    });
                  }}
                >
                  <option value="">选择完整快照中的文件</option>
                  {detail.snapshotFiles.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </Field>
              {snapshotPath && (
                <Code
                  text={snapshot}
                  file={snapshotPath}
                  language={
                    snapshotPath.endsWith('.json') ? 'json' : snapshotPath.endsWith('.md') ? 'markdown' : 'typescript'
                  }
                />
              )}
            </div>
            {latest.extensions.length > 0 && latest.review?.digest !== latest.digest && (
              <Button
                disabled={!canWrite}
                onClick={() => {
                  R({ version: latest.id, digest: latest.digest });
                  CH([false, false, false]);
                }}
              >
                记录精确内容审查
              </Button>
            )}
            {!!latest.review && <p>审查结论：{latest.review.notes}</p>}
            <div className="asm-publishbar">
              <span>检查通过并切换版本后生效。</span>
              <Button
                kind="primary"
                disabled={!canWrite || !reviewed(latest) || !!draftCount || latest.id === detail.skill.current}
                onClick={() => CF({ baseRevision: detail.skill.revision, action: 'publish', version: latest.id })}
              >
                检查并发布
              </Button>
            </div>
            <OperationHistory detail={detail} />
          </>
        )}
        {tab === '版本' && (
          <>
            <div className="asm-version-list">
              {detail.versions.map((v) => (
                <section key={v.id}>
                  <button
                    type="button"
                    onClick={() => {
                      V(v.id);
                      void readFile(v.skillFile, v.id);
                      T('内容');
                    }}
                  >
                    <strong>{versionLabel(v)}</strong>
                    <span>
                      {v.id === detail.skill.current
                        ? '当前正式'
                        : v.id === detail.skill.latest
                          ? '最新候选'
                          : '历史快照'}
                    </span>
                  </button>
                  {v.id !== detail.skill.current && (
                    <Button
                      disabled={!canWrite || !reviewed(v)}
                      onClick={() => CF({ baseRevision: detail.skill.revision, action: 'rollback', version: v.id })}
                    >
                      恢复此版本
                    </Button>
                  )}
                  <Button
                    kind="ghost"
                    onClick={() =>
                      void run(async () => {
                        const a = await host.api<{ content: string }>(
                          `/skills/${id}/files?${immutableFile(detail, v.id, v.skillFile)}`,
                        );
                        const b = detail.skill.current
                          ? await host.api<{ content: string }>(
                              `/skills/${id}/files?${immutableFile(detail, detail.skill.current, v.skillFile)}`,
                            )
                          : { content: '' };
                        CP(b.content);
                        SS(a.content);
                        SP(v.skillFile);
                      })
                    }
                  >
                    与当前正式比较
                  </Button>
                </section>
              ))}
            </div>
            {snapshotPath && <Diff before={compare || ''} after={snapshot} file={snapshotPath} />}
            <OperationHistory detail={detail} />
          </>
        )}
        {tab === '知识' && (
          <>
            <h3>描述性知识</h3>
            {!currentVersion?.knowledgeFiles.length ? (
              <p>此技能未声明独立知识文件。</p>
            ) : (
              <>
                <Field label="知识修订">
                  <select
                    aria-label="知识修订"
                    value={knowledge}
                    onChange={(e) => {
                      KN(e.target.value);
                    }}
                  >
                    <option value="">最近修订</option>
                    {detail.knowledge.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.file} · {date(k.created)}
                      </option>
                    ))}
                  </select>
                </Field>
                {ks ? (
                  <>
                    <Markdown text={ks.content} />
                    <KnowledgeComparison host={host} detail={detail} revision={ks.id} />
                    <details>
                      <summary>修订依据</summary>
                      {ks.provenance ? (
                        <>
                          <p>{ks.provenance.reason}</p>
                          <Button
                            onClick={() =>
                              go({
                                page: 'source',
                                reference: { sessionId: ks.provenance?.sessionId, entryId: ks.provenance?.entryId },
                                project: detail.skill.project,
                              })
                            }
                          >
                            查看原始来源
                          </Button>
                        </>
                      ) : (
                        <p>此修订没有 Agent 来源记录。</p>
                      )}
                      <Evidence value={ks} />
                    </details>
                  </>
                ) : knowledge ? (
                  <p role="alert">指定知识修订不存在，未用当前内容替代。</p>
                ) : null}
                <details>
                  <summary>修订知识正文</summary>
                  <Field label="知识文件">
                    <select
                      aria-label="知识文件"
                      value={knowledgePath}
                      onChange={(e) => {
                        if (store.knowledge.has(id) && !window.confirm('放弃当前知识正文草稿并切换文件？')) return;
                        KP(e.target.value);
                        KT('');
                        KB(0);
                        store.knowledge.delete(id);
                      }}
                    >
                      <option value="">选择知识文件</option>
                      {currentVersion.knowledgeFiles.map((f) => (
                        <option key={f}>{f}</option>
                      ))}
                    </select>
                  </Field>
                  <Button
                    disabled={!canWrite || !currentVersion.knowledgeFiles.includes(knowledgePath)}
                    onClick={() =>
                      void run(async () => {
                        if (store.knowledge.has(id) && !window.confirm('放弃知识草稿并重新读取当前正文？')) return;
                        const f = await host.api<{ content: string; baseRevision: number }>(
                          `/skills/${id}/files?${new URLSearchParams({ version: detail.skill.current || currentVersion.id, path: knowledgePath })}`,
                        );
                        KT(f.content);
                        KB(f.baseRevision);
                        store.knowledge.delete(id);
                      })
                    }
                  >
                    读取当前知识
                  </Button>
                  {knowledgeBase > 0 && (
                    <>
                      <textarea
                        aria-label="知识正文"
                        readOnly={busy}
                        rows={12}
                        value={knowledgeText}
                        onChange={(e) => {
                          KT(e.target.value);
                          store.knowledge.set(id, {
                            file: knowledgePath,
                            text: e.target.value,
                            baseRevision: knowledgeBase,
                          });
                        }}
                      />
                      <Button
                        disabled={!canWrite || !detail.skill.current}
                        onClick={() =>
                          void run(async () => {
                            const saved = await host.api<{ id: string }>(`/skills/${id}/knowledge`, 'POST', {
                              baseRevision: knowledgeBase,
                              path: knowledgePath,
                              content: knowledgeText,
                            });
                            store.knowledge.delete(id);
                            KN(saved.id);
                            KB(0);
                            read.refresh();
                            N('知识修订已保存，执行版本未变。');
                          })
                        }
                      >
                        保存知识修订
                      </Button>
                    </>
                  )}
                </details>
              </>
            )}
          </>
        )}
      </ViewPanel>
      <Modal
        open={!!review}
        onClose={() => R(undefined)}
        title="记录候选审查"
        description="审查只对当前这一版本有效；编辑后必须重新审查。"
        footer={
          <Button
            kind="primary"
            disabled={
              !canWrite ||
              checks.some((v) => !v) ||
              notes.trim().length < 10 ||
              review?.version !== latest?.id ||
              review?.digest !== latest?.digest
            }
            onClick={() =>
              void run(async () => {
                if (!review) return;
                await host.api(`/skills/${id}/review`, 'POST', {
                  ...review,
                  notes,
                  reviewedCode: true,
                  reviewedDependencies: true,
                  reviewedPermissions: true,
                });
                R(undefined);
                read.refresh();
                N('精确内容审查已记录。');
              })
            }
          >
            记录审查
          </Button>
        }
      >
        <Notice title="本机执行权限" tone="warn">
          人工审查不是操作系统沙箱。请核对已读取的完整代码、文件引用、依赖与权限。
        </Notice>
        {['已审查完整代码与资源引用', '已核对锁定依赖', '已审查执行权限与风险'].map((label, i) => (
          <label className="check-row" key={label}>
            <input
              type="checkbox"
              checked={checks[i]}
              onChange={(e) => CH((a) => a.map((v, j) => (j === i ? e.target.checked : v)))}
            />
            {label}
          </label>
        ))}
        <Field label="审查结论">
          <textarea aria-label="审查结论" value={notes} onChange={(e) => NO(e.target.value)} rows={4} />
        </Field>
        {error && <p role="alert">{error}</p>}
      </Modal>
      <Modal
        open={!!confirm}
        onClose={() => CF(undefined)}
        title={
          confirm?.action === 'rollback'
            ? '恢复正式版本'
            : confirm?.action === 'enabled'
              ? confirm.enabled
                ? '启用技能'
                : '禁用技能'
              : '发布候选'
        }
        footer={
          <Button
            kind="primary"
            disabled={!canWrite || confirm?.baseRevision !== detail.skill.revision}
            onClick={() => {
              if (confirm) void operationPost(confirm.action, confirm.version, confirm.enabled);
            }}
          >
            确认
            {confirm?.action === 'rollback'
              ? '恢复'
              : confirm?.action === 'enabled'
                ? confirm.enabled
                  ? '启用'
                  : '禁用'
                : '发布'}
          </Button>
        }
      >
        <p>{detail.skill.name}</p>
        {confirm && confirm.baseRevision !== detail.skill.revision && (
          <p role="alert">技能修订已变化，请关闭并重新核对版本。</p>
        )}
        <p>
          {confirm?.action === 'rollback'
            ? '只切换能力版本，记忆、历史与已发生的外部操作不会回退。'
            : '会先检查并协调正在进行的会话，再更新实际版本。'}
        </p>
        <p>检查期间可继续阅读，结果会在此更新。</p>
        {error && <p role="alert">{error}</p>}
      </Modal>
    </>
  );
}
function OperationHistory({ detail }: { detail: SkillDetail }) {
  return (
    <details className="host-technical">
      <summary>检查与发布记录</summary>
      {detail.operations.map((op) => (
        <section key={op.id} data-operation-status={op.status}>
          <p>
            {date(op.created)} · {op.message}
          </p>
          {op.checks?.map((c, i) => (
            <p key={`${i}-${c.tool}`}>
              {c.tool} · {c.passed ? '通过' : '失败'}
              <Code text={c.output} />
            </p>
          ))}
          <details>
            <summary>操作依据</summary>
            <Evidence value={op} />
          </details>
        </section>
      ))}
    </details>
  );
}
function KnowledgeComparison({ host, detail, revision }: { host: Host; detail: SkillDetail; revision: string }) {
  const current = detail.knowledge.find((k) => k.id === revision);
  const previous = detail.knowledge
    .filter((k) => k.file === current?.file && k.created < (current?.created || 0))
    .at(-1);
  const [open, O] = useState(false);
  return (
    <details onToggle={(e) => O(e.currentTarget.open)}>
      <summary>与上一知识版本比较</summary>
      {open &&
        current &&
        (previous ? (
          <Diff before={previous.content} after={current.content} file={current.file} />
        ) : (
          <InitialKnowledgeComparison host={host} detail={detail} revision={revision} />
        ))}
    </details>
  );
}
function InitialKnowledgeComparison({ host, detail, revision }: { host: Host; detail: SkillDetail; revision: string }) {
  const current = detail.knowledge.find((k) => k.id === revision);
  const read = useRead<{ content: string }>(
    host.api,
    `/skills/${detail.skill.id}/files?${current ? immutableFile(detail, current.version, current.file) : ''}`,
  );
  return (
    <>
      {read.error && <Failure error={read.error} retry={read.refresh} />}
      {read.value && current && <Diff before={read.value.content} after={current.content} file={current.file} />}
    </>
  );
}
