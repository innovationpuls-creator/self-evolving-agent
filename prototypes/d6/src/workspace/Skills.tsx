import { FilterBar, ViewTabs, ViewPanel } from './controls';
import { measureWorkspace } from './quality-probe';
import { useEffect, useRef, useState } from 'react';
import {
  Plus,
  Files,
  FileText,
  FileCode,
  NotebookPen,
  Library,
  Terminal,
  Pencil,
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  Check,
  ShieldCheck,
  History,
  GitCompareArrows,
  LoaderCircle,
  Circle,
} from 'lucide-react';
import { Button, SearchBox, Field, Modal, Notice, Status, StateGate, EmptySearch } from '../components/ui';
import type { SkillOperation } from '../../../../apps/host/skills/skills';
import { Markdown, Code } from '../components/content';
import { Diff, Evidence } from './content';
import { useDemo } from '../state/store';
import { skillName } from './shared';
import type { Skill } from '../state/model';
import { useWorkspacePosition, useWorkspaceData } from './host-data';
import { SessionContext } from './Context';
import { project as skillProject } from './host-fixtures';
import { toolMembership, toolObservations } from './tool-observations';
import './skills.css';

const extensionCode =
  'export function compare(before: string, after: string) {\n  return { before, after, context: true };\n}';
const dependencies = '@agent/text-compare 1.2.0 → diff 8.0.2';
const tools = [
  {
    id: 'read',
    name: '读取文件',
    source: 'Pi 基础工具',
    description: '读取项目文件内容。',
    parameter: 'path',
    detail: '要读取的文件路径',
    known: true,
  },
  {
    id: 'bash',
    name: '执行命令',
    source: 'Pi 基础工具',
    description: '执行 Shell 命令，使用 Host 本机用户权限。',
    parameter: 'command',
    detail: '要执行的 Shell 命令',
    known: true,
  },
  {
    id: 'text_diff',
    name: '比较文本',
    source: '文档比较',
    description: '比较两份文本，返回结构化差异与上下文。',
    parameter: 'before',
    detail: '修改前的文本',
    known: true,
  },
  {
    id: 'document_info',
    name: '文档信息',
    source: '文档扩展 · 归属待确认',
    description: '扩展未提供可靠的业务摘要。',
    parameter: 'path',
    detail: '文件路径',
    known: false,
  },
];
function Icon({ id, size = 20 }: { id: string; size?: number }) {
  const I = id === 'text-diff' ? Files : id === 'project-notes' ? NotebookPen : Library;
  return <I size={size} />;
}
function currentFile(s: Skill, f: string) {
  return f === 'SKILL.md' ? s.content : (s.code ?? extensionCode);
}
function usable(s: Skill) {
  return !!s.version && s.enabled && (!s.extension || s.trusted);
}
function stateLabel(s: Skill) {
  return !s.version ? '尚未生效' : !s.enabled ? '已停用' : s.extension && !s.trusted ? '等待信任审查' : '已启用';
}
type Review = {
  id: string;
  content: string;
  code: string;
  candidate: string;
  file: string;
  base: number;
  version: string;
  digest: string;
};

function SkillsPage() {
  const w = useWorkspaceData();
  const x = useDemo();
  const [catalog, C] = useState('技能'),
    [query, Q] = useState(''),
    [filter, FI] = useState('全部');
  const [detail, D] = useState(false),
    [toolId, TI] = useState('text_diff');
  const [tab, T] = useState('内容'),
    [layer, L] = useState('正式版本'),
    [file, F] = useState('SKILL.md');
  const [mode, M] = useState('编辑'),
    [drafts, DS] = useState<Record<string, string>>({});
  const [review, R] = useState<Review | null>(null),
    [approved, A] = useState(false);
  const [dependenciesReviewed, DR] = useState(false),
    [permissionsReviewed, PR] = useState(false),
    [reviewNotes, NOTES] = useState('');
  const [savedReviews, SAVE_REVIEW] = useState<Record<string, { version: string; digest: string; notes: string }>>({});
  const [importing, IM] = useState(false),
    [name, N] = useState('document-coverage');
  const [rollback, RB] = useState<number | null>(null),
    [version, VE] = useState<number | null>(null);
  const [checking, CH] = useState(false),
    [failure, FA] = useState(false),
    [error, ER] = useState('');
  const [result, RS] = useState('');
  const [runtimeStale, STALE] = useState(false);
  const [operation, OP] = useState<SkillOperation>();
  const binding = useRef(w.skillBindings);
  binding.current = w.skillBindings;
  const pending = useRef(0);
  const pendingRead = useRef<(() => void) | undefined>(undefined);
  const views = useRef<
    Record<string, { tab: string; layer: string; file: string; mode: string; version: number | null }>
  >({});
  useEffect(() => {
    if (x.d.connection && pendingRead.current) {
      const settle = pendingRead.current;
      pendingRead.current = undefined;
      settle();
    }
  }, [x.d.connection]);
  function settleWhenConnected(settle: () => void) {
    if (live.current.connection) settle();
    else {
      pendingRead.current = settle;
      ER('连接已断开，操作结果待确认。恢复连接后将重新读取，请勿重复提交。');
    }
  }
  const live = useRef(x.d);
  live.current = x.d;
  const skill = x.d.skills.find((s) => s.id === x.objects.skills) ?? x.d.skills[0];
  useWorkspacePosition('skills', `${catalog}:${detail}:${skill.id}:${tab}:${layer}:${mode}:${file}`);
  const gutter = useRef<HTMLDivElement>(null);
  const dirtyDraft = Object.keys(drafts).length > 0;
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (dirtyDraft) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirtyDraft]);
  const key = `${skill.id}:${file}`;
  const hasDraft = drafts[key] !== undefined;
  const value =
    drafts[key] ??
    (skill.candidate && (skill.candidateFile ?? 'SKILL.md') === file ? skill.candidate : currentFile(skill, file));
  const baseText = skill.version ? currentFile(skill, file) : '';
  const changed =
    value !==
    (skill.candidate && (skill.candidateFile ?? 'SKILL.md') === file ? skill.candidate : currentFile(skill, file));
  const otherCandidate = !!skill.candidate && (skill.candidateFile ?? 'SKILL.md') !== file;
  const update = (patch: Partial<Skill>, id = skill.id) =>
    x.mutate((s) => ({ ...s, skills: s.skills.map((k) => (k.id === id ? { ...k, ...patch } : k)) }));
  useEffect(
    () => () => {
      pending.current++;
    },
    [],
  );
  useEffect(() => {
    if (x.focusRequest.type === 'skills') {
      D(true);
      C('技能');
      const saved = views.current[skill.id];
      if (saved) {
        T(saved.tab);
        L(saved.layer);
        F(saved.file);
        M(saved.mode);
        VE(saved.version);
        ER('');
        RS('');
        return;
      }
      T('内容');
      L(!skill.version && skill.candidate ? '候选' : '正式版本');
      M('改动');
      F(skill.candidateFile ?? 'SKILL.md');
      ER('');
      RS('');
    }
  }, [x.focusRequest]);
  function requestChange(patch: Partial<Skill>, message: string) {
    if (checking || !x.d.connection) return;
    const target = skill.id,
      base = w.skillBindings[target],
      token = ++pending.current;
    const op: SkillOperation = {
      id: crypto.randomUUID(),
      skillId: base.id,
      status: 'checking',
      message: '正在检查并等待生效…',
      created: Date.now(),
    };
    OP(op);
    CH(true);
    ER('');
    RS('');
    RB(null);
    setTimeout(() => {
      if (pending.current !== token) return;
      settleWhenConnected(() => {
        CH(false);
        ER('');
        if (binding.current[target]?.revision !== base.revision) {
          OP({ ...op, status: 'failed', message: '技能修订已变化，请重新读取后操作。' });
          ER('操作未生效，正式版本保持原样。');
          return;
        }
        update(patch, target);
        if (target === 'text-diff') STALE(true);
        OP({ ...op, status: 'applied', message });
        if (patch.version) VE(patch.version);
        RS(message);
        x.notify(message);
      });
    }, 1000);
  }
  function select(id: string) {
    views.current[skill.id] = { tab, layer, file, mode, version };
    x.setObject('skills', id);
  }
  function edit(f = file) {
    F(f);
    L('候选');
    M('编辑');
    T('内容');
    ER('');
    RS('');
  }
  function candidate() {
    F(skill.candidateFile ?? 'SKILL.md');
    L('候选');
    T('内容');
    M('改动');
    ER('');
    RS('');
  }
  function clearDraft() {
    DS((all) => {
      const next = { ...all };
      delete next[key];
      return next;
    });
  }
  function save() {
    if (!x.d.connection) {
      ER('连接已断开，候选尚未保存。编辑内容已保留。');
      return;
    }
    if (!value.trim() || !changed || otherCandidate || checking) return;
    pending.current++;
    update({ candidate: value, candidateFile: file, candidateTrusted: !skill.extension });
    clearDraft();
    M('改动');
    ER('');
    RS('');
  }
  function check() {
    if (checking || !skill.candidate || (skill.extension && !skill.candidateTrusted) || !x.d.connection) return;
    const candidateText = skill.candidate,
      target = skill.id,
      base = skill.version,
      content = skill.content,
      code = skill.code;
    const token = ++pending.current;
    CH(true);
    const op: SkillOperation = {
      id: crypto.randomUUID(),
      skillId: w.skillBindings[target].id,
      status: 'checking',
      message: '正在检查候选版本',
      created: Date.now(),
    };
    OP(op);
    ER('');
    RS('');
    setTimeout(() => {
      if (pending.current !== token) return;
      settleWhenConnected(() => {
        CH(false);
        ER('');
        const latest = live.current.skills.find((k) => k.id === target);
        if (
          !latest ||
          latest.version !== base ||
          latest.content !== content ||
          latest.code !== code ||
          latest.candidate !== candidateText
        ) {
          OP({ ...op, status: 'failed', message: '正式内容已变化' });
          ER('正式内容已变化，候选仍保留，请重新核对后检查。');
          return;
        }
        if (failure) {
          OP({ ...op, status: 'failed', message: '必要检查失败' });
          ER('锁定依赖与候选声明不一致。请核对依赖后重试；正式版本未改变。');
          return;
        }
        const candidateVersion = w.candidateBindings[target]?.version;
        if (!candidateVersion) {
          ER('候选版本尚未返回，请重新读取。');
          return;
        }
        w.bindPublishedVersion(target, Math.max(...latest.versions, 0) + 1, candidateVersion);
        x.mutate((s) => ({
          ...s,
          skills: s.skills.map((k) => {
            if (
              k.id !== target ||
              k.candidate !== candidateText ||
              k.version !== base ||
              k.content !== content ||
              k.code !== code ||
              (k.extension && !k.candidateTrusted)
            )
              return k;
            const v = Math.max(...k.versions, 0) + 1;
            const next = {
              content: k.candidateFile === 'extension.ts' ? k.content : k.candidate,
              code: k.candidateFile === 'extension.ts' ? k.candidate : k.code,
            };
            return {
              ...k,
              ...next,
              snapshots: {
                ...k.snapshots,
                ...(k.version ? { [k.version]: { content: k.content, code: k.code } } : {}),
                [v]: next,
              },
              versions: [...k.versions, v],
              version: v,
              candidate: '',
              candidateTrusted: false,
              trusted: true,
              enabled: true,
            };
          }),
        }));
        L('正式版本');
        T('内容');
        if (target === 'text-diff') STALE(true);
        OP({ ...op, status: 'applied', message: '必要检查通过，新版本已生效。' });
        RS('必要检查通过，新版本已生效。');
        x.notify('新版本已生效，可在版本历史中恢复。');
      });
    }, 1500);
  }
  const selectedTool = tools.find((t) => t.id === toolId) ?? tools[2];
  const owner = x.d.skills.find((s) => s.id === 'text-diff');
  const inProject = !w.contextSession || w.contextSession.cwd === skillProject;
  const supplied = selectedTool.id === 'text_diff' ? !!owner && usable(owner) && inProject : selectedTool.known;
  const observation = toolObservations.find((t) => t.name === selectedTool.id);
  const fresh =
    x.d.connection &&
    (selectedTool.id !== 'text_diff' || (!!owner && owner.version === 1 && usable(owner) && !runtimeStale));
  const membership = toolMembership(observation, w.contextSession?.id, fresh);
  const toolState = !selectedTool.known
    ? '状态未确认'
    : !supplied
      ? '来源不可用'
      : membership.callable === true
        ? '可调用'
        : membership.callable === false
          ? '当前会话不可调用'
          : '会话状态未确认';
  const membershipLabel = (value: boolean | undefined) => (value === undefined ? '未确认' : value ? '是' : '否');
  const list = x.d.skills.filter(
    (s) =>
      `${skillName(s.id)} ${s.name} ${s.description}`.toLowerCase().includes(query.toLowerCase()) &&
      (filter === '全部' || (filter === '已启用' ? s.enabled && !!s.version : !!s.candidate)),
  );
  const toolList = tools.filter((t) => `${t.name} ${t.id} ${t.source}`.toLowerCase().includes(query.toLowerCase()));
  const files = ['SKILL.md', ...(skill.extension ? ['extension.ts'] : [])];
  const candidateSaved = !!skill.candidate && !changed && !otherCandidate;
  const historical = version ?? skill.version;
  const snapshot =
    historical === skill.version ? { content: skill.content, code: skill.code } : skill.snapshots?.[historical];
  return (
    <StateGate
      emptyAction={
        <Button
          onClick={() => {
            x.setScenario('normal');
            IM(true);
          }}
        >
          导入技能
        </Button>
      }
    >
      <div
        data-aw-page="skills"
        className={`aw asm ${detail ? 'asm-detail-open' : ''} ${catalog === '技能' && tab === '内容' && layer === '候选' && mode === '编辑' ? 'asm-editing' : ''}`}
      >
        <header className="asm-heading">
          <h1>技能与工具</h1>
          <Button onClick={() => IM(true)}>
            <Plus size={15} />
            导入技能
          </Button>
        </header>
        <div className="asm-manager">
          <aside className="asm-library" aria-label="能力列表">
            <FilterBar
              items={['技能', '工具']}
              value={catalog}
              label="能力类型"
              onChange={(v) => {
                C(v);
                Q('');
                D(false);
              }}
            />
            <SearchBox
              value={query}
              onChange={Q}
              placeholder={catalog === '技能' ? '搜索已添加的技能' : '搜索工具名称或来源'}
            />
            {catalog === '技能' && (
              <div className="asm-filters">
                {['全部', '已启用', '有候选'].map((f) => (
                  <button type="button" key={f} aria-pressed={filter === f} onClick={() => FI(f)}>
                    {f}
                  </button>
                ))}
              </div>
            )}
            <div className="asm-list-label">
              {catalog === '技能' ? '已添加' : '工具目录'}
              <span>{catalog === '技能' ? list.length : toolList.length}</span>
            </div>
            <div className="asm-items">
              {catalog === '技能'
                ? list.map((s) => (
                    <button
                      type="button"
                      key={s.id}
                      className={`asm-item ${s.id === skill.id ? 'selected' : ''}`}
                      data-aw-key={s.id}
                      disabled={checking}
                      aria-current={s.id === skill.id ? 'true' : undefined}
                      onClick={() => select(s.id)}
                    >
                      <span className="asm-item-icon">
                        <Icon id={s.id} />
                      </span>
                      <span className="asm-item-text">
                        <strong>{skillName(s.id)}</strong>
                        <span>{s.name}</span>
                        <small>
                          <i className={usable(s) ? 'on' : ''} />
                          {stateLabel(s)}
                          {s.version ? ` · v${s.version}` : ''}
                        </small>
                        {s.candidate && <em>候选待处理</em>}
                        {Object.keys(drafts).some((k) => k.startsWith(`${s.id}:`)) && <em>有未保存编辑</em>}
                      </span>
                      <ChevronRight size={14} className="asm-row-arrow" />
                    </button>
                  ))
                : toolList.map((t) => (
                    <button
                      type="button"
                      key={t.id}
                      className={`asm-item ${toolId === t.id ? 'selected' : ''}`}
                      onClick={() => {
                        TI(t.id);
                        D(true);
                      }}
                    >
                      <span className="asm-item-icon">
                        <Terminal size={19} />
                      </span>
                      <span className="asm-item-text">
                        <strong>{t.name}</strong>
                        <span>{t.id}</span>
                        <small>{t.source}</small>
                      </span>
                      <ChevronRight size={14} className="asm-row-arrow" />
                    </button>
                  ))}
              {(catalog === '技能' ? !list.length : !toolList.length) && <EmptySearch />}
            </div>
          </aside>
          <section className="asm-detail" aria-label={catalog === '技能' ? '技能管理' : '工具详情'}>
            <Button kind="ghost" className="asm-mobile-back" onClick={() => D(false)}>
              <ArrowLeft size={15} />
              返回{catalog === '技能' ? '技能列表' : '工具列表'}
            </Button>
            {catalog === '技能' ? (
              <>
                <header className="asm-skill-head">
                  <span className="asm-large-icon">
                    <Icon id={skill.id} size={28} />
                  </span>
                  <div>
                    <h2>{skillName(skill.id)}</h2>
                    <span>{skill.name}</span>
                  </div>
                  <label className="switch-label">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label="启用当前技能"
                      aria-checked={skill.enabled}
                      checked={skill.enabled}
                      disabled={!skill.version || checking || !x.d.connection || (skill.extension && !skill.trusted)}
                      onChange={(e) =>
                        requestChange({ enabled: e.target.checked }, e.target.checked ? '技能已启用。' : '技能已停用。')
                      }
                    />
                    <span>{skill.enabled ? '已启用' : '已停用'}</span>
                  </label>
                </header>
                <p className="asm-description">{skill.description}</p>
                {skill.extension && skill.enabled && skill.version > 0 && !skill.trusted && (
                  <div className="asm-status-row">
                    <Status tone="warn">正式版本未获信任</Status>
                  </div>
                )}
                <div className="asm-actions">
                  <Button
                    kind="primary"
                    disabled={checking}
                    onClick={() => edit(skill.candidate ? (skill.candidateFile ?? 'SKILL.md') : 'SKILL.md')}
                  >
                    <Pencil size={14} />
                    {skill.candidate ? '继续编辑候选' : '编辑技能'}
                  </Button>
                  <Button
                    kind="ghost"
                    onClick={() => {
                      x.updateSession({ refs: [...new Set([...x.session.refs, `/skill:${skill.name}`])] });
                      x.go('chat');
                    }}
                    disabled={!usable(skill)}
                  >
                    在会话中引用
                    <ArrowUpRight size={13} />
                  </Button>
                </div>
                {error && (
                  <div role="alert">
                    <Notice title="操作未完成" tone="warn">
                      {error}
                    </Notice>
                  </div>
                )}
                {operation && operation.skillId === w.skillBindings[skill.id]?.id && operation.status !== 'applied' && (
                  <div className="asm-operation" role="status">
                    <LoaderCircle size={14} className={checking ? 'spin' : ''} />
                    <span>{operation.message}</span>
                  </div>
                )}
                {result && (
                  <div className="asm-success" role="status">
                    <Check size={16} />
                    <span>{result}</span>
                    <button
                      type="button"
                      onClick={() => {
                        T('版本');
                        VE(null);
                        L('正式版本');
                      }}
                    >
                      查看版本
                    </button>
                  </div>
                )}
                {operation?.skillId === w.skillBindings[skill.id]?.id && (
                  <details className="asm-operation-record">
                    <summary>本次版本操作</summary>
                    <Evidence value={operation} />
                  </details>
                )}
                <div className="asm-tabs-line">
                  <ViewTabs
                    id="asm-content"
                    items={['内容', '工具', '版本']}
                    value={tab}
                    onChange={(v) => {
                      T(v);
                      VE(null);
                    }}
                    label="技能管理内容"
                  />
                  {skill.candidate && !(tab === '内容' && layer === '候选') && (
                    <Button kind="ghost" disabled={checking} onClick={candidate}>
                      <GitCompareArrows size={14} />
                      审阅候选
                    </Button>
                  )}
                </div>
                <ViewPanel id="asm-content" items={['内容', '工具', '版本']} value={tab}>
                  {tab === '内容' ? (
                    <>
                      <div className="asm-layerbar">
                        {['正式版本', '候选'].map((l) => (
                          <button
                            type="button"
                            key={l}
                            aria-pressed={layer === l}
                            disabled={checking}
                            onClick={() => {
                              L(l);
                              if (l === '候选') {
                                F(skill.candidateFile ?? file);
                                M(skill.candidate ? '改动' : '编辑');
                              }
                            }}
                          >
                            <span className={`asm-dot ${l === '候选' ? 'candidate' : ''}`} />
                            {l === '正式版本' ? `正式版本${skill.version ? ` v${skill.version}` : ' · 无'}` : '候选'}
                            {l === '候选' && (skill.candidate || hasDraft) && <span className="asm-unsaved-dot" />}
                          </button>
                        ))}
                        <span className="asm-layer-hint">
                          {layer === '候选' ? '未生效' : usable(skill) ? '正在使用' : '未在使用'}
                        </span>
                      </div>
                      {layer === '正式版本' ? (
                        <>
                          {skill.candidate && (
                            <div className="asm-pending">
                              <span>候选尚未生效</span>
                              <button type="button" onClick={candidate}>
                                查看改动
                                <ChevronRight size={14} />
                              </button>
                            </div>
                          )}
                          <div className="asm-filebar">
                            <div className="asm-file-tabs">
                              {files.map((f) => (
                                <button type="button" key={f} aria-pressed={file === f} onClick={() => F(f)}>
                                  {f === 'SKILL.md' ? <FileText size={14} /> : <FileCode size={14} />}
                                  {f}
                                </button>
                              ))}
                            </div>
                            <Button kind="ghost" disabled={checking} onClick={() => edit()}>
                              <Pencil size={13} />
                              编辑
                            </Button>
                          </div>
                          {!skill.version ? (
                            <div className="asm-empty">
                              <h3>尚未发布正式版本</h3>
                              <p>导入的内容保存在候选中，检查通过后才能使用。</p>
                              <Button onClick={candidate}>查看候选</Button>
                            </div>
                          ) : file === 'SKILL.md' ? (
                            <article className="asm-markdown">
                              <Markdown text={skill.content.replace(/^# .*\n/, '')} />
                            </article>
                          ) : (
                            <div className="asm-code">
                              <Code
                                text={currentFile(skill, file)}
                                language="typescript"
                                file="extension.ts / 正式版本"
                              />
                            </div>
                          )}
                          {skill.extension && (
                            <details className="asm-dependencies">
                              <summary>{skill.trusted ? '正式内容已审查' : '执行内容待审查'} · 锁定依赖</summary>
                              <p>{skill.id === 'text-diff' ? dependencies : '导入演示包 · 锁定依赖随候选审查'}</p>
                            </details>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="asm-candidate-head">
                            <ViewTabs
                              id="asm-candidate"
                              items={['编辑', '改动', '审查与发布']}
                              value={mode}
                              label="候选操作"
                              onChange={M}
                            />
                          </div>
                          <ViewPanel id="asm-candidate" items={['编辑', '改动', '审查与发布']} value={mode}>
                            {mode === '编辑' ? (
                              <>
                                <div className="asm-filebar">
                                  <div className="asm-file-tabs">
                                    {files.map((f) => (
                                      <button
                                        type="button"
                                        key={f}
                                        aria-pressed={file === f}
                                        disabled={checking}
                                        onClick={() => F(f)}
                                      >
                                        {f === 'SKILL.md' ? <FileText size={14} /> : <FileCode size={14} />}
                                        {f}
                                      </button>
                                    ))}
                                  </div>
                                  <span>{file === 'SKILL.md' ? 'Markdown' : 'TypeScript'}</span>
                                </div>
                                <label className="sr-only" htmlFor="asm-editor">
                                  编辑 {file}
                                </label>
                                <div className="asm-editor">
                                  <div className="asm-line-numbers" aria-hidden="true" ref={gutter}>
                                    {value.split('\n').map((_, i) => (
                                      <div key={`line-${i + 1}`}>{i + 1}</div>
                                    ))}
                                  </div>
                                  <textarea
                                    id="asm-editor"
                                    aria-label={`编辑 ${file}`}
                                    spellCheck={false}
                                    wrap="off"
                                    onScroll={(event) => {
                                      if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop;
                                    }}
                                    value={value}
                                    disabled={checking}
                                    onChange={(e) => {
                                      const next = e.target.value;
                                      const stored =
                                        skill.candidate && (skill.candidateFile ?? 'SKILL.md') === file
                                          ? skill.candidate
                                          : currentFile(skill, file);
                                      DS((all) => {
                                        const drafts = { ...all };
                                        if (next === stored) delete drafts[key];
                                        else drafts[key] = next;
                                        return drafts;
                                      });
                                    }}
                                    onKeyDown={(e) => {
                                      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                                        e.preventDefault();
                                        save();
                                      }
                                    }}
                                  />
                                </div>
                                {otherCandidate && (
                                  <Notice title={`${skill.candidateFile} 已有候选`}>
                                    请先处理这份候选；当前编辑会保留在这里。
                                  </Notice>
                                )}
                                <div className="asm-savebar">
                                  <span>保存只创建候选</span>
                                  <div>
                                    <Button kind="ghost" disabled={!hasDraft || checking} onClick={clearDraft}>
                                      撤销未保存编辑
                                    </Button>
                                    <Button
                                      kind="primary"
                                      disabled={
                                        !changed || !value.trim() || otherCandidate || checking || !x.d.connection
                                      }
                                      onClick={save}
                                    >
                                      保存候选
                                    </Button>
                                  </div>
                                </div>
                              </>
                            ) : mode === '改动' ? (
                              <>
                                <div className="asm-comparison-label">
                                  <span>
                                    {skill.version ? `正式 v${skill.version}` : '无正式内容'} →{' '}
                                    {changed ? '未保存编辑' : '候选'}
                                  </span>
                                  <span>{file}</span>
                                </div>
                                <Diff before={baseText} after={value} file={file} />
                                <div className="asm-savebar">
                                  <span>{candidateSaved ? '候选尚未生效' : '请先保存编辑'}</span>
                                  <Button
                                    kind="primary"
                                    disabled={!candidateSaved || checking}
                                    onClick={() => M('审查与发布')}
                                  >
                                    审查与发布
                                    <ChevronRight size={14} />
                                  </Button>
                                </div>
                              </>
                            ) : (
                              <section className="asm-release">
                                <p>
                                  {skill.version
                                    ? `替换正式 v${skill.version}，检查通过后启用新版本。`
                                    : '检查通过后启用第一个正式版本。'}
                                </p>
                                <dl className="asm-checklist">
                                  <div>
                                    <dt>
                                      <FileText size={16} />
                                      候选内容
                                    </dt>
                                    <dd>{candidateSaved ? `${skill.candidateFile} · 已保存` : '尚有编辑未保存'}</dd>
                                  </div>
                                  <div>
                                    <dt>
                                      <ShieldCheck size={16} />
                                      内容与依赖审查
                                    </dt>
                                    <dd>
                                      {!skill.extension
                                        ? '文本指引 · 无执行权限'
                                        : skill.candidateTrusted
                                          ? '精确内容已审查'
                                          : '尚未审查'}
                                      {skill.extension && (
                                        <Button
                                          kind="ghost"
                                          disabled={!candidateSaved || checking || !x.d.connection}
                                          onClick={() => {
                                            A(false);
                                            DR(false);
                                            PR(false);
                                            NOTES(savedReviews[skill.id]?.notes ?? '');
                                            R({
                                              id: skill.id,
                                              content: skill.content,
                                              code: skill.code ?? extensionCode,
                                              candidate: skill.candidate,
                                              file: skill.candidateFile ?? 'SKILL.md',
                                              base: skill.version,
                                              version: w.candidateBindings[skill.id].version,
                                              digest: w.candidateBindings[skill.id].digest,
                                            });
                                          }}
                                        >
                                          {skill.candidateTrusted ? '查看审查内容' : '审查内容与依赖'}
                                        </Button>
                                      )}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>
                                      {checking ? <LoaderCircle size={16} className="spin" /> : <Circle size={16} />}
                                      必要检查
                                    </dt>
                                    <dd>
                                      {checking
                                        ? '正在检查候选，正式版本保持不变…'
                                        : error
                                          ? '未通过 · 正式版本未改变'
                                          : '尚未运行'}
                                    </dd>
                                  </div>
                                </dl>
                                {!candidateSaved && <Button onClick={() => M('编辑')}>返回编辑并保存</Button>}
                                <div className="asm-publishbar">
                                  <p>
                                    {skill.extension && !skill.candidateTrusted
                                      ? '审查记录绑定精确内容；再次编辑需重新审查。'
                                      : '通过必要检查后自动生效。失败保留当前正式版本。'}
                                  </p>
                                  <Button
                                    kind="primary"
                                    disabled={
                                      !candidateSaved ||
                                      checking ||
                                      (skill.extension && !skill.candidateTrusted) ||
                                      !x.d.connection
                                    }
                                    onClick={check}
                                  >
                                    {checking ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}
                                    {checking ? '正在检查…' : error ? '重新检查并生效' : '检查并生效'}
                                  </Button>
                                </div>
                                {new URLSearchParams(location.search).get('test') === '1' && (
                                  <label className="check-row demo-option">
                                    <input
                                      type="checkbox"
                                      checked={failure}
                                      onChange={(e) => FA(e.target.checked)}
                                      disabled={checking}
                                    />
                                    模拟依赖检查失败
                                  </label>
                                )}
                              </section>
                            )}
                          </ViewPanel>
                        </>
                      )}
                    </>
                  ) : tab === '工具' ? (
                    <section className="asm-contributions">
                      <h3>这项技能提供的工具</h3>
                      {skill.id === 'text-diff' ? (
                        <button
                          type="button"
                          className="asm-contribution"
                          onClick={() => {
                            C('工具');
                            TI('text_diff');
                            D(true);
                            Q('');
                          }}
                        >
                          <Terminal size={19} />
                          <span>
                            <strong>比较文本</strong>
                            <code>text_diff</code>
                          </span>
                          <span>{usable(skill) ? '来源已启用' : '来源不可用'}</span>
                          <ChevronRight size={16} />
                        </button>
                      ) : (
                        <p>{skill.extension ? '尚无已确认归属的工具声明。' : '这是一项工作指引，不提供执行工具。'}</p>
                      )}
                    </section>
                  ) : (
                    <section className="asm-history">
                      <div className="asm-section-title">
                        <h3>版本历史</h3>
                        <span>当前正式 {skill.version ? `v${skill.version}` : '无'}</span>
                      </div>
                      <div className="asm-version-list">
                        {[...skill.versions].reverse().map((v) => (
                          <button type="button" key={v} aria-pressed={historical === v} onClick={() => VE(v)}>
                            <History size={16} />
                            <strong>v{v}</strong>
                            <span>{v === skill.version ? '当前正式' : '历史版本'}</span>
                            <ChevronRight size={15} />
                          </button>
                        ))}
                      </div>
                      {snapshot ? (
                        <>
                          <div className="asm-section-title">
                            <h3>v{historical} 内容</h3>
                            {historical !== skill.version && (
                              <Button disabled={checking} onClick={() => RB(historical)}>
                                恢复此版本
                              </Button>
                            )}
                          </div>
                          <Code text={snapshot.content} language="markdown" file={`SKILL.md / v${historical}`} />
                          {skill.extension && (
                            <Code
                              text={snapshot.code ?? extensionCode}
                              language="typescript"
                              file={`extension.ts / v${historical}`}
                            />
                          )}
                        </>
                      ) : (
                        <p className="asm-footnote">
                          {skill.versions.length ? '这份历史快照不可用，不能恢复。' : '尚无正式版本。'}
                        </p>
                      )}
                    </section>
                  )}
                </ViewPanel>
              </>
            ) : (
              <>
                <header className="asm-skill-head">
                  <span className="asm-large-icon">
                    <Terminal size={26} />
                  </span>
                  <div>
                    <h2>{selectedTool.name}</h2>
                    <span>{selectedTool.id}</span>
                  </div>
                </header>
                <p className="asm-description">{selectedTool.description}</p>
                <SessionContext />
                <section className="asm-tool-session">
                  <div className="asm-tool-verdict">
                    <Status tone={membership.callable === true && supplied ? 'good' : 'warn'}>{toolState}</Status>
                    {selectedTool.id === 'text_diff' && (
                      <Button kind="ghost" onClick={() => select('text-diff')}>
                        管理文档比较
                        <ArrowUpRight size={14} />
                      </Button>
                    )}
                  </div>
                  {membership.callable === false && supplied && (
                    <p className="asm-tool-cause">
                      {membership.loaded === false
                        ? '此会话尚未加载该工具。'
                        : membership.active === false
                          ? '已加载，尚未向此会话的模型声明。'
                          : '当前会话没有调用权限。'}
                    </p>
                  )}
                  <details className="asm-tool-loading">
                    <summary>加载与模型声明</summary>
                    <dl className="asm-tool-states">
                      {[
                        ['来源可提供', !selectedTool.known ? '未确认' : supplied ? '是' : '否'],
                        ['已加载到会话', membershipLabel(membership.loaded)],
                        ['已向模型声明', membershipLabel(membership.active)],
                      ].map(([label, state]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd>{state}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="asm-footnote">
                      {selectedTool.source}
                      {selectedTool.id === 'text_diff' && owner ? ` · 正式 v${owner.version}` : ''}
                    </p>
                  </details>
                </section>
                <section className="asm-parameters">
                  <h3>参数</h3>
                  {!observation || !fresh || (selectedTool.id === 'text_diff' && !inProject) ? (
                    <p>未取得当前项目的运行时参数；不会为了读取参数加载扩展代码。</p>
                  ) : (
                    <>
                      <table>
                        <thead>
                          <tr>
                            <th>名称</th>
                            <th>类型</th>
                            <th>说明</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>
                              <code>{selectedTool.parameter}</code>
                              <small>必填</small>
                            </td>
                            <td>string</td>
                            <td>{selectedTool.detail}</td>
                          </tr>
                          {toolId === 'text_diff' && (
                            <tr>
                              <td>
                                <code>after</code>
                                <small>必填</small>
                              </td>
                              <td>string</td>
                              <td>修改后的文本</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                      <details>
                        <summary>查看原始参数声明</summary>
                        <Code
                          text={JSON.stringify(
                            {
                              name: toolId,
                              source: selectedTool.source,
                              inputSchema: {
                                type: 'object',
                                properties: Object.fromEntries(
                                  (toolId === 'text_diff' ? ['before', 'after'] : [selectedTool.parameter]).map((p) => [
                                    p,
                                    { type: 'string' },
                                  ]),
                                ),
                                required: toolId === 'text_diff' ? ['before', 'after'] : [selectedTool.parameter],
                              },
                            },
                            null,
                            2,
                          )}
                          language="json"
                        />
                      </details>
                    </>
                  )}
                </section>
              </>
            )}
          </section>
        </div>
        <Modal
          open={!!review}
          onClose={() => R(null)}
          title="审查候选的精确内容"
          description="审查记录只绑定这份内容与锁定依赖，再次编辑后需重新审查。"
          wide
          className="asm-review-dialog"
          footer={
            review ? (
              <>
                <Button onClick={() => R(null)}>返回候选</Button>
                <Button
                  kind="primary"
                  disabled={
                    !approved ||
                    !dependenciesReviewed ||
                    !permissionsReviewed ||
                    reviewNotes.trim().length < 10 ||
                    !x.d.connection
                  }
                  onClick={() => {
                    if (
                      skill.id === review.id &&
                      skill.candidate === review.candidate &&
                      skill.version === review.base &&
                      skill.content === review.content &&
                      (skill.code ?? extensionCode) === review.code &&
                      w.candidateBindings[skill.id]?.version === review.version &&
                      w.candidateBindings[skill.id]?.digest === review.digest
                    ) {
                      SAVE_REVIEW((all) => ({
                        ...all,
                        [skill.id]: { version: review.version, digest: review.digest, notes: reviewNotes.trim() },
                      }));
                      update({ candidateTrusted: true });
                      R(null);
                    } else {
                      R(null);
                      ER('候选或正式版本已变化，请重新核对。');
                    }
                  }}
                >
                  记录本次内容审查
                </Button>
              </>
            ) : undefined
          }
        >
          {review && (
            <>
              <Notice title="执行代码使用 Host 本机用户权限" tone="warn">
                请核对完整文件、跨资源引用与依赖。人工审查不是操作系统沙箱。
              </Notice>
              <Code
                text={review.file === 'SKILL.md' ? review.candidate : review.content}
                language="markdown"
                file="SKILL.md / 随候选审查"
              />
              <Code
                text={review.file === 'extension.ts' ? review.candidate : review.code}
                language="typescript"
                file="extension.ts / 随候选审查"
              />
              <div className="asm-review-deps">
                <h3>锁定依赖</h3>
                <p>{dependencies}</p>
                <p>extension.ts · 独占绑定</p>
              </div>
              <label className="check-row">
                <input type="checkbox" checked={approved} onChange={(e) => A(e.target.checked)} />
                已审查完整代码与文件引用
              </label>
              <label className="check-row">
                <input type="checkbox" checked={dependenciesReviewed} onChange={(e) => DR(e.target.checked)} />
                已核对锁定依赖
              </label>
              <label className="check-row">
                <input type="checkbox" checked={permissionsReviewed} onChange={(e) => PR(e.target.checked)} />
                已审查执行权限与风险
              </label>
              <Field label="审查结论">
                <textarea
                  value={reviewNotes}
                  minLength={10}
                  onChange={(e) => NOTES(e.target.value)}
                  placeholder="记录代码、依赖和权限的实际审查结论"
                  rows={3}
                />
              </Field>
              <details>
                <summary>审查绑定的版本</summary>
                <Evidence value={{ version: review.version, digest: review.digest }} />
              </details>
            </>
          )}
        </Modal>
        <Modal
          open={importing}
          onClose={() => IM(false)}
          title="导入技能"
          description="选择脱敏演示包，只保存候选，不加载代码。"
        >
          <Field label="候选名称">
            <input value={name} onChange={(e) => N(e.target.value)} />
          </Field>
          <Notice title="导入后仍需审查">
            项目技能包含 SKILL.md、extension.ts 与锁定依赖。导入不会执行包入口、安装脚本或授予信任。
          </Notice>
          {x.d.skills.some((s) => s.name === name.trim()) && (
            <p className="field-error">已有同名技能，请使用其他名称。</p>
          )}
          <div className="modal-footer">
            <Button
              kind="primary"
              disabled={!name.trim() || x.d.skills.some((s) => s.name === name.trim())}
              onClick={() => {
                const id = name.trim();
                x.mutate((s) => ({
                  ...s,
                  skills: [
                    ...s.skills,
                    {
                      id,
                      name: id,
                      description: '核对输入材料范围，保留未核实内容。',
                      enabled: false,
                      extension: true,
                      version: 0,
                      versions: [],
                      candidate: `# ${id}\n检查输入材料是否完整；不补造缺失结论。`,
                      candidateTrusted: false,
                      candidateFile: 'SKILL.md',
                      trusted: false,
                      content: `# ${id}\n尚未生效的导入候选。`,
                    },
                  ],
                }));
                select(id);
                IM(false);
                L('候选');
                M('改动');
              }}
            >
              保存候选
            </Button>
          </div>
        </Modal>
        <Modal open={rollback !== null} onClose={() => RB(null)} title="恢复能力版本">
          <p>
            将 {skillName(skill.id)} 从 v{skill.version} 切换到 v{rollback}。
          </p>
          <Notice title="只恢复能力内容" tone="warn">
            记忆、执行历史与已发生的外部操作不会回退；执行中的调用不被中途替换。
            {skill.candidate ? '现有候选仍保留。' : ''}
          </Notice>
          <div className="modal-footer">
            <Button onClick={() => RB(null)}>取消</Button>
            <Button
              kind="primary"
              disabled={rollback === null || !skill.snapshots?.[rollback] || checking || !x.d.connection}
              onClick={() => {
                if (rollback === null || !skill.snapshots?.[rollback]) return;
                requestChange(
                  {
                    version: rollback,
                    ...skill.snapshots[rollback],
                    candidateTrusted: skill.extension ? false : skill.candidateTrusted,
                  },
                  `已恢复 v${rollback}，版本历史仍保留。`,
                );
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

export const WorkspaceSkills = measureWorkspace('skills', SkillsPage);
