import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type View = 'chat' | 'trace' | 'memory' | 'reflection' | 'evolution' | 'skills' | 'settings';
type Mode = 'quiet' | 'studio';

const sessions = [
  { id: 's1', title: '整理项目说明', meta: '刚刚 · 有 1 个待处理建议', tone: 'active' },
  { id: 's2', title: '迁移登录流程', meta: '昨天 · 已完成', tone: 'done' },
  { id: 's3', title: '空白新会话', meta: '未发送消息', tone: 'empty' }
];

const steps = [
  { label: '建议已采纳', detail: '把项目说明整理成可复用的检查清单', state: 'done' },
  { label: '讨论目标', detail: '确认范围：只改文档结构，不改正式 Skill', state: 'done' },
  { label: '具体授权', detail: '允许修改 project-notes Skill 的文档内容', state: 'current' },
  { label: '开发与检查', detail: '待授权后在独立会话中执行', state: 'next' },
  { label: '正式生效', detail: '通过检查后启用；失败保留旧版本', state: 'next' }
];

function App() {
  const initialMode = new URLSearchParams(window.location.search).get('route') === 'studio' ? 'studio' : 'quiet';
  const [mode, setMode] = useState<Mode>(initialMode);
  const [view, setView] = useState<View>('chat');
  const [session, setSession] = useState('s1');
  const [mobileNav, setMobileNav] = useState(false);
  const [inspector, setInspector] = useState(false);
  const [raw, setRaw] = useState(false);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [memoryRevision, setMemoryRevision] = useState(1);
  const [growthStep, setGrowthStep] = useState(2);
  const [toast, setToast] = useState('');

  const activeSession = sessions.find((item) => item.id === session) ?? sessions[0];
  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2200);
  };
  const changeMode = (next: Mode) => {
    setMode(next);
    window.history.replaceState({}, '', `?route=${next}`);
    setView('chat');
    setInspector(false);
  };
  const openView = (next: View) => {
    setView(next);
    setMobileNav(false);
  };
  const reload = () => {
    setLoading(true);
    window.setTimeout(() => setLoading(false), 700);
  };

  return (
    <div className={`app-shell ${mode}`}>
      <DemoRibbon mode={mode} onModeChange={changeMode} />
      <button className="mobile-menu" type="button" aria-label="打开导航" onClick={() => setMobileNav(true)}>☰</button>
      <div className={`nav-scrim ${mobileNav ? 'visible' : ''}`} onClick={() => setMobileNav(false)} />
      {mode === 'quiet' ? (
        <QuietNav view={view} session={session} onView={openView} onSession={(id) => { setSession(id); setView('chat'); }} open={mobileNav} />
      ) : (
        <StudioNav view={view} session={session} onView={openView} onSession={(id) => { setSession(id); setView('chat'); }} open={mobileNav} />
      )}
      <main className="app-main">
        <Topbar
          view={view}
          session={activeSession}
          offline={offline}
          onBack={() => openView('chat')}
          onToggleInspector={() => setInspector((value) => !value)}
          onToggleOffline={() => { setOffline((value) => !value); showToast(offline ? '已恢复连接' : '已切换为离线演示'); }}
        />
        {offline && <div className="offline-bar" role="status"><span className="status-dot danger" />离线：当前任务仍保留在本机草稿中 <button type="button" onClick={() => setOffline(false)}>重试连接</button></div>}
        <div className={`content-grid ${inspector ? 'with-inspector' : ''}`}>
          <section className="content-view" aria-live="polite">
            {loading ? <LoadingState /> : <ViewContent
              view={view}
              mode={mode}
              session={activeSession}
              raw={raw}
              growthStep={growthStep}
              memoryRevision={memoryRevision}
              onRaw={() => setRaw((value) => !value)}
              onOpenView={openView}
              onToast={showToast}
              onGrowth={(step) => setGrowthStep(step)}
              onMemoryRevision={() => setMemoryRevision((value) => value + 1)}
              onReload={reload}
            />}
          </section>
          {inspector && <Inspector raw={raw} onRaw={() => setRaw((value) => !value)} onClose={() => setInspector(false)} onToast={showToast} />}
        </div>
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function DemoRibbon({ mode, onModeChange }: { mode: Mode; onModeChange: (mode: Mode) => void }) {
  return <div className="demo-ribbon"><span>D6 独立设计探索 · 演示模拟，不连接正式 Host</span><span className="route-switch"><button type="button" className={mode === 'quiet' ? 'selected' : ''} onClick={() => onModeChange('quiet')}>安静工作台</button><button type="button" className={mode === 'studio' ? 'selected' : ''} onClick={() => onModeChange('studio')}>能力工作室</button></span></div>;
}

function QuietNav({ view, session, onView, onSession, open }: { view: View; session: string; onView: (view: View) => void; onSession: (id: string) => void; open: boolean }) {
  return <aside className={`sidebar quiet-nav ${open ? 'open' : ''}`}>
    <div className="brand"><span className="brand-mark">A</span><div><strong>Agent</strong><small>安静工作台</small></div></div>
    <button className="new-session" type="button" onClick={() => onSession('s3')}><span>＋</span> 新会话</button>
    <div className="nav-heading">最近会话</div>
    <div className="session-list">{sessions.map((item) => <button key={item.id} type="button" className={`session-row ${item.id === session ? 'active' : ''}`} onClick={() => onSession(item.id)}><span className={`session-dot ${item.tone}`} /><span><b>{item.title}</b><small>{item.meta}</small></span></button>)}</div>
    <div className="nav-divider" />
    <div className="nav-heading">当前会话</div>
    <NavItem icon="◌" label="对话" active={view === 'chat'} onClick={() => onView('chat')} />
    <NavItem icon="⌁" label="轨迹" active={view === 'trace'} onClick={() => onView('trace')} />
    <button className="quiet-more" type="button" onClick={() => onView('memory')}>更多工作区 <span>Memory · 反思 · 能力</span></button>
    <div className="sidebar-bottom"><button type="button" className="profile-button" onClick={() => onView('settings')}><span className="avatar">T</span><span><b>本地工作区</b><small>模型已授权</small></span><span>⋯</span></button></div>
  </aside>;
}

function StudioNav({ view, session, onView, onSession, open }: { view: View; session: string; onView: (view: View) => void; onSession: (id: string) => void; open: boolean }) {
  return <aside className={`sidebar studio-nav ${open ? 'open' : ''}`}>
    <div className="brand"><span className="brand-mark studio-mark">✦</span><div><strong>Agent</strong><small>能力工作室</small></div></div>
    <div className="workspace-title"><span className="status-dot success" />我的工作区 <span className="chevron">⌄</span></div>
    <button className="studio-new" type="button" onClick={() => onSession('s3')}><span>＋</span> 开始一项工作</button>
    <div className="nav-heading">工作流</div>
    <NavItem icon="▣" label="工作台" active={view === 'chat'} onClick={() => onView('chat')} />
    <NavItem icon="↗" label="运行轨迹" active={view === 'trace'} onClick={() => onView('trace')} badge="1" />
    <div className="nav-heading spaced">可复用能力</div>
    <NavItem icon="◇" label="Memory" active={view === 'memory'} onClick={() => onView('memory')} />
    <NavItem icon="✦" label="Reflection" active={view === 'reflection'} onClick={() => onView('reflection')} />
    <NavItem icon="↻" label="Evolution" active={view === 'evolution'} onClick={() => onView('evolution')} badge="1" />
    <NavItem icon="⌘" label="Skills & Tools" active={view === 'skills'} onClick={() => onView('skills')} />
    <div className="sidebar-bottom"><button type="button" className="profile-button" onClick={() => onView('settings')}><span className="avatar studio-avatar">T</span><span><b>本地工作区</b><small>Provider 已连接</small></span><span>⋯</span></button></div>
  </aside>;
}

function NavItem({ icon, label, active, onClick, badge }: { icon: string; label: string; active: boolean; onClick: () => void; badge?: string }) {
  return <button type="button" className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><span className="nav-icon">{icon}</span><span>{label}</span>{badge && <em>{badge}</em>}</button>;
}

function Topbar({ view, session, offline, onBack, onToggleInspector, onToggleOffline }: { view: View; session: { title: string; meta: string }; offline: boolean; onBack: () => void; onToggleInspector: () => void; onToggleOffline: () => void }) {
  const labels: Record<View, string> = { chat: session.title, trace: '运行轨迹', memory: 'Memory', reflection: 'Reflection', evolution: 'Evolution', skills: 'Skills & Tools', settings: '模型与连接' };
  return <header className="topbar"><div className="crumbs"><span className="eyebrow">{view === 'chat' ? '当前工作' : '工作区'}</span><h1>{labels[view]}</h1>{view === 'chat' && <span className="live-pill"><span className="status-dot success" />已连接</span>}</div><div className="top-actions">{view !== 'chat' && <button type="button" className="text-button" onClick={onBack}>‹ 回到对话</button>}<button type="button" className="icon-button" aria-label="切换离线演示" onClick={onToggleOffline}>{offline ? '↗' : '⇄'}</button><button type="button" className="icon-button" aria-label="打开当前上下文" onClick={onToggleInspector}>☷</button></div></header>;
}

function ViewContent({ view, mode, session, raw, growthStep, memoryRevision, onRaw, onOpenView, onToast, onGrowth, onMemoryRevision, onReload }: { view: View; mode: Mode; session: { title: string; meta: string }; raw: boolean; growthStep: number; memoryRevision: number; onRaw: () => void; onOpenView: (view: View) => void; onToast: (message: string) => void; onGrowth: (step: number) => void; onMemoryRevision: () => void; onReload: () => void }) {
  if (view === 'trace') return <TraceView raw={raw} onRaw={onRaw} onToast={onToast} />;
  if (view === 'memory') return <MemoryView revision={memoryRevision} onRevision={onMemoryRevision} onOpenView={onOpenView} onToast={onToast} />;
  if (view === 'reflection') return <ReflectionView onOpenView={onOpenView} onToast={onToast} />;
  if (view === 'evolution') return <EvolutionView step={growthStep} onStep={onGrowth} onOpenView={onOpenView} onToast={onToast} />;
  if (view === 'skills') return <SkillsView onToast={onToast} />;
  if (view === 'settings') return <SettingsView onToast={onToast} onReload={onReload} />;
  return <ChatView mode={mode} session={session} raw={raw} onRaw={onRaw} onOpenView={onOpenView} onToast={onToast} onGrowth={onGrowth} />;
}

function ChatView({ mode, session, raw, onRaw, onOpenView, onToast, onGrowth }: { mode: Mode; session: { title: string; meta: string }; raw: boolean; onRaw: () => void; onOpenView: (view: View) => void; onToast: (message: string) => void; onGrowth: (step: number) => void }) {
  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState(false);
  const [toolOpen, setToolOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const isEmpty = session.title === '空白新会话';
  return <div className={`chat-page ${isEmpty ? 'empty-chat' : ''}`}>
    {mode === 'studio' && <div className="work-context"><div><span className="eyebrow">工作目标</span><strong>把项目说明整理成一份可复用的检查清单</strong></div><div className="context-progress"><span>能力成长</span><b>{sent ? '讨论中' : '待确认'}</b></div></div>}
    {isEmpty ? <EmptyChat onToast={onToast} /> : <>
      <div className="message user-message"><div className="message-label"><span className="avatar small-avatar">T</span><span>你 · 10:42</span></div><p>请帮我把项目说明整理成一份可复用的检查清单，并说明哪些内容还需要我确认。</p><div className="reference-row"><button type="button" className="reference-chip" onClick={() => onToast('已打开文件预览：project-notes.md')}>⌁ project-notes.md</button><button type="button" className="reference-chip" onClick={() => onToast('已加载 Skill：project-notes')}>/skill project-notes</button></div></div>
      <div className="message agent-message"><div className="message-label"><span className="agent-avatar">✦</span><span>Agent · 已完成一轮整理</span><span className="message-state">可继续讨论</span></div><p>我先按“目标—检查项—待确认”整理了一版。现有文档里有一处范围描述可能已经过时，我没有替你修改正式能力。</p><div className="markdown-card"><h3>项目说明检查清单</h3><p>先确认使用边界，再进入能力变更。下面三项可以直接作为日常检查：</p><ol><li>这次任务要解决的用户问题是什么？</li><li>需要引用哪些已有文件或 Memory？</li><li>是否会改变正式 Skill 或 Tool？</li></ol><blockquote>当前判断：建议先讨论范围，再决定是否采纳能力改进。</blockquote><details open><summary>查看一段代码示例</summary><pre><code>{'const scope = await confirm("目标范围");\nif (!scope.approved) return "保留现状";'}</code></pre><button type="button" className="copy-button" onClick={() => onToast('代码已复制到剪贴板（演示）')}>复制代码</button></details></div></div>
      <div className="tool-row"><button type="button" className="tool-summary" onClick={() => setToolOpen((value) => !value)}><span className="tool-icon">⌁</span><span><b>读取文件</b><small>project-notes.md · 1.2 KB</small></span><span className="tool-status success">已完成</span><span>{toolOpen ? '⌃' : '›'}</span></button>{toolOpen && <div className="tool-detail"><div className="detail-heading"><span>输入</span><button type="button" onClick={onRaw}>查看原始 JSON</button></div><pre>{raw ? '{\n  "path": "project-notes.md",\n  "sessionId": "sess_demo_41",\n  "redacted": true\n}' : '读取了当前会话引用的文件。路径和会话标识默认隐藏。'}</pre><div className="detail-heading"><span>结果</span><span className="success-text">已返回 18 行</span></div></div>}</div>
      <div className="tool-row failed"><button type="button" className="tool-summary" onClick={() => onToast('失败详情已在轨迹中定位')}><span className="tool-icon">!</span><span><b>检查链接</b><small>一个外部链接暂时无法访问</small></span><span className="tool-status danger">需要处理</span><span>›</span></button></div>
      <div className="json-row"><button type="button" onClick={() => setJsonOpen((value) => !value)}><span>结果摘要</span><b>{jsonOpen ? '收起 JSON' : '查看结构化结果'}</b><span>{jsonOpen ? '⌃' : '›'}</span></button>{jsonOpen && <pre className="json-block">{`{
  "checked": 12,
  "needs_confirmation": 1,
  "source": "project-notes.md"
}`}</pre>}</div>
      {sent && <div className="message agent-message follow-up"><div className="message-label"><span className="agent-avatar">✦</span><span>Agent · 等待你的决定</span></div><p>我可以把这份整理作为“项目说明”能力的改进目标。采纳只会打开讨论，不会立即修改正式 Skill。</p><div className="choice-row"><button type="button" className="primary-button" onClick={() => { onGrowth(2); onOpenView('evolution'); }}>开始讨论目标</button><button type="button" className="quiet-button" onClick={() => onToast('已保留这条建议，稍后可从 Evolution 进入')}>稍后再说</button></div></div>}
    </>}
    <div className="composer-wrap"><div className="composer-hint"><span>可用</span><button type="button" onClick={() => onToast('文件引用：选择 project-notes.md（演示）')}>@ 文件</button><button type="button" onClick={() => onToast('Skill：选择 project-notes（演示）')}>/ skill</button><button type="button" className="composer-mode" onClick={() => onToast('当前为普通任务，不会自动修改正式能力')}>普通任务 ⓘ</button></div><div className="composer"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="描述你想完成的事情…" aria-label="消息输入" /><button type="button" className="send-button" disabled={!draft.trim()} onClick={() => { setSent(true); setDraft(''); onToast('消息已加入当前会话'); }}>发送 ↗</button></div><div className="composer-foot"><span>Enter 发送 · Shift + Enter 换行</span><button type="button" onClick={() => onOpenView('trace')}>查看本次轨迹 →</button></div></div>
  </div>;
}

function EmptyChat({ onToast }: { onToast: (message: string) => void }) { return <div className="empty-state"><div className="empty-orbit">✦</div><h2>从一个具体目标开始</h2><p>你可以让我整理文件、检查一段代码，或回到之前的任务继续工作。</p><div className="suggestion-grid"><button type="button" onClick={() => onToast('已填入：整理 project-notes.md')}>整理一份文件</button><button type="button" onClick={() => onToast('已填入：检查最近一次运行')}>检查最近一次运行</button><button type="button" onClick={() => onToast('已填入：回顾一个决定')}>回顾一个决定</button></div></div>; }

function TraceView({ raw, onRaw, onToast }: { raw: boolean; onRaw: () => void; onToast: (message: string) => void }) { const [selected, setSelected] = useState('tool'); return <div className="trace-page"><div className="page-intro"><div><span className="eyebrow">当前会话 · 4 个阶段</span><h2>任务运行轨迹</h2><p>按“你说了什么 → Agent 做了什么 → 得到了什么”查看。原始证据保持可追溯，但不抢占默认阅读。</p></div><button type="button" className="quiet-button" onClick={() => onToast('只复制当前可见摘要（演示）')}>复制摘要</button></div><div className="trace-layout"><div className="trace-list"><div className="trace-line" />{['理解目标', '读取文件', '检查链接', '形成结论'].map((label, index) => <button type="button" className={`trace-node ${selected === (index === 1 ? 'tool' : index === 2 ? 'error' : 'other') ? 'selected' : ''}`} key={label} onClick={() => setSelected(index === 1 ? 'tool' : index === 2 ? 'error' : 'other')}><span className={`node-marker ${index === 2 ? 'danger' : 'success'}`}>{index === 2 ? '!' : '✓'}</span><span><b>{label}</b><small>{index === 2 ? '1 个结果需要处理' : index === 3 ? '已完成 · 10:43' : '已完成'}</small></span></button>)}</div><div className="trace-inspect">{selected === 'error' ? <div className="trace-error"><span className="large-state danger">!</span><h3>检查链接没有完成</h3><p>外部站点拒绝了本次请求。它不影响已整理的本地文件内容。</p><div className="choice-row"><button type="button" className="primary-button" onClick={() => onToast('已加入待重试列表')}>稍后重试</button><button type="button" className="quiet-button" onClick={() => onToast('已复制可操作错误说明')}>复制说明</button></div></div> : <><div className="inspect-head"><div><span className="eyebrow">阶段 2 · Tool</span><h3>读取文件</h3></div><span className="status-chip success">已完成</span></div><p>读取了会话引用的文件，结果已用于当前回答。</p><div className="evidence-card"><div className="detail-heading"><b>语义摘要</b><button type="button" onClick={onRaw}>{raw ? '隐藏原始信息' : '查看原始信息'}</button></div><p>发现 3 个检查项，其中 1 项需要你确认范围。</p>{raw && <pre>{'{\n  "trace": "trace_demo_02",\n  "tool": "read",\n  "input": { "path": "project-notes.md" },\n  "redaction": "default"\n}'}</pre>}</div><div className="evidence-links"><button type="button" onClick={() => onToast('已定位到对话中的文件引用')}>↗ 在对话中查看</button><button type="button" onClick={() => onToast('证据已复制（演示）')}>复制证据</button></div></>}</div></div></div>; }

function MemoryView({ revision, onRevision, onOpenView, onToast }: { revision: number; onRevision: () => void; onOpenView: (view: View) => void; onToast: (message: string) => void }) { const [editing, setEditing] = useState(false); return <div className="page-body memory-page"><div className="page-intro"><div><span className="eyebrow">长期认识 · 项目范围</span><h2>项目说明</h2><p>一条可被质疑和修正的认识。来源用于追溯，不代替当前判断。</p></div><div className="intro-actions"><button type="button" className="quiet-button" onClick={() => setEditing((value) => !value)}>{editing ? '取消编辑' : '编辑认识'}</button><button type="button" className="primary-button" onClick={onRevision}>保存修订</button></div></div><div className="scope-tabs"><button className="active" type="button">Project Memory</button><button type="button" onClick={() => onToast('Global Memory 暂无演示数据')}>Global Memory</button><span>修订 #{revision}</span></div><article className="memory-article"><div className="memory-state-line"><span className="status-chip warning">待重新确认</span><span>最近来源：当前会话 · 10:43</span></div>{editing ? <textarea className="memory-editor" defaultValue="项目说明应先确认使用边界，再进入能力变更。" aria-label="Memory 内容" /> : <><h3>项目说明应先确认使用边界，再进入能力变更。</h3><p>这条认识来自最近一次整理任务。它适用于当前项目，不代表所有任务都需要相同流程。</p></>}<div className="memory-table"><div><span>作用域</span><b>Project</b></div><div><span>来源</span><button type="button" onClick={() => onOpenView('trace')}>当前会话 · 读取文件 ↗</button></div><div><span>历史</span><button type="button" onClick={() => onToast('已展开修订 #1 与 #2')}>查看 2 次修订</button></div></div><details className="history-detail"><summary>修订历史 · 为什么发生变化</summary><div className="history-item"><b>#2 · 当前版本</b><p>把“必须审批”改为“先确认范围”；依据是 D4 业务流程。</p></div><div className="history-item"><b>#1 · 初始认识</b><p>项目说明需要经过审批后才能继续。</p></div></details></article><div className="memory-footer"><button type="button" onClick={() => onOpenView('reflection')}>请求 Agent 重新审查 →</button><span>删除只影响这条认识，不删除来源和原始证据。</span></div></div>; }

function ReflectionView({ onOpenView, onToast }: { onOpenView: (view: View) => void; onToast: (message: string) => void }) { const [empty, setEmpty] = useState(false); return <div className="page-body reflection-page"><div className="page-intro"><div><span className="eyebrow">安静运行 · 可按需查看</span><h2>Reflection</h2><p>反思说明审查了什么、依据是什么，以及哪些事情仍不确定。</p></div><button type="button" className="quiet-button" onClick={() => onToast('已安排一次重新审查（演示）')}>重新审查</button></div><div className="reflection-switch"><button type="button" className={!empty ? 'active' : ''} onClick={() => setEmpty(false)}>最近一次</button><button type="button" className={empty ? 'active' : ''} onClick={() => setEmpty(true)}>无新发现示例</button></div>{empty ? <div className="no-findings"><span className="large-state neutral">—</span><h3>这次没有新的发现</h3><p>没有足够新证据改变已有认识。已有记录仍可继续查看，不制造一条空结论。</p><button type="button" className="quiet-button" onClick={() => onOpenView('trace')}>查看相关轨迹</button></div> : <div className="reflection-result"><div className="result-label"><span className="status-chip success">已完成</span><span>2026-10-22 10:45 · 2 个依据</span></div><h3>当前流程可以保留，但“采纳建议”和“具体授权”需要明确分开。</h3><div className="finding-grid"><div><span>审查了什么</span><b>最近一次项目说明整理任务</b></div><div><span>形成的判断</span><b>先讨论范围，再决定是否开发</b></div><div><span>仍不确定</span><b>这套检查清单是否适用于其他项目</b></div></div><details><summary>依据与原始证据</summary><p>关联 1 个会话、1 条 Memory 修订和 2 个 Tool 结果。</p><button type="button" onClick={() => onOpenView('trace')}>打开轨迹定位</button></details></div>}<div className="reflection-note">Reflection 默认不插入普通聊天；重要结论会保留在这里，并可从相关会话再次进入。</div></div>; }

function EvolutionView({ step, onStep, onOpenView, onToast }: { step: number; onStep: (step: number) => void; onOpenView: (view: View) => void; onToast: (message: string) => void }) { const current = steps[step]; return <div className="page-body evolution-page"><div className="page-intro"><div><span className="eyebrow">1 条建议 · 具体授权前不执行</span><h2>把整理方法变成可复用能力</h2><p>采纳建议只会打开讨论。只有你确认具体修改范围后，Agent 才能进入开发和检查。</p></div><span className={`status-chip ${step >= 4 ? 'success' : 'warning'}`}>{step >= 4 ? '已生效' : current.label}</span></div><div className="evolution-layout"><div className="evolution-timeline"><div className="timeline-rule" />{steps.map((item, index) => <button type="button" key={item.label} className={`evolution-step ${index <= step ? 'visited' : ''} ${index === step ? 'current' : ''}`} onClick={() => onStep(index)}><span className="step-marker">{index < step ? '✓' : index + 1}</span><span><b>{item.label}</b><small>{item.detail}</small></span></button>)}</div><div className="evolution-detail"><div className="detail-kicker">当前阶段</div><h3>{current.label}</h3><p>{step === 0 ? '这条建议来自 Reflection 与本次任务的关联，不是已经确认的缺陷。' : step === 1 ? '讨论会带入必要背景和证据引用，不把全部原始日志塞进新会话。' : step === 2 ? '请明确允许修改的 Skill、文件范围和验证方向。下面的按钮只模拟这个授权关口。' : step === 3 ? '开发会在独立会话中进行。保存、检查、正式生效是三个不同状态。' : '检查通过后新版本生效；若失败，上一可用版本继续工作。'} </p><div className="authorization-box"><div><span className="eyebrow">授权范围（演示）</span><strong>允许修改 project-notes 的 Markdown 文档</strong><small>不包含 Tool、Hooks、依赖或其他 Skill</small></div>{step === 2 && <button type="button" className="primary-button" onClick={() => { onStep(3); onToast('已记录具体范围授权（演示）'); }}>确认这个范围</button>}{step === 3 && <button type="button" className="primary-button" onClick={() => { onStep(4); onToast('模拟检查通过，Skill 已生效'); }}>模拟开发并检查</button>}{step === 4 && <button type="button" className="quiet-button" onClick={() => { onStep(2); onToast('已模拟回退到上一可用版本'); }}>回退上一版本</button>}</div><div className="activity-log"><div><span className="log-dot success" /><span>建议依据已保留</span><small>Reflection · 2 个依据</small></div><div><span className={`log-dot ${step >= 3 ? 'success' : 'neutral'}`} /><span>{step >= 3 ? '开发会话已完成检查' : '等待明确授权'}</span><small>{step >= 3 ? 'project-notes v2' : '不影响现有能力'}</small></div></div><div className="evidence-links"><button type="button" onClick={() => onOpenView('trace')}>打开相关轨迹</button><button type="button" onClick={() => onToast('已复制授权摘要（演示）')}>复制授权摘要</button></div></div></div></div>; }

function SkillsView({ onToast }: { onToast: (message: string) => void }) { const [open, setOpen] = useState('project'); return <div className="page-body skills-page"><div className="page-intro"><div><span className="eyebrow">能力与工具 · 统一入口</span><h2>Skills & Tools</h2><p>先看用途和可做什么；代码、依赖、版本和 Tool 输入按需展开。</p></div><button type="button" className="primary-button" onClick={() => onToast('添加 Skill 流程已打开（演示）')}>添加能力</button></div><div className="skill-grid"><div className="skill-cards"><button type="button" className={`skill-card ${open === 'project' ? 'active' : ''}`} onClick={() => setOpen('project')}><span className="skill-symbol">✦</span><span><b>project-notes</b><small>整理项目说明和检查清单</small></span><span className="status-chip success">已启用</span></button><button type="button" className={`skill-card ${open === 'search' ? 'active' : ''}`} onClick={() => setOpen('search')}><span className="skill-symbol muted-symbol">⌕</span><span><b>web-research</b><small>按需检索公开资料</small></span><span className="status-chip neutral">普通 Skill</span></button><button type="button" className="skill-card" onClick={() => onToast('Pi 基础能力不提供普通 Skill 的禁用开关') }><span className="skill-symbol">⌘</span><span><b>Pi 基础能力</b><small>Agent Loop · Session · Tool Calling</small></span><span className="status-chip neutral">系统能力</span></button></div><div className="skill-detail-card">{open === 'project' ? <><div className="detail-heading"><div><span className="eyebrow">已启用 · 当前版本 v1</span><h3>project-notes</h3></div><button type="button" onClick={() => onToast('已打开 AI 协助编辑对话（演示）')}>让 Agent 协助编辑</button></div><p>整理项目说明和检查清单，帮助任务先明确范围，再进入能力变更。</p><div className="skill-actions"><button type="button" className="quiet-button" onClick={() => onToast('已切换为禁用（演示）')}>暂时禁用</button><button type="button" className="quiet-button" onClick={() => onToast('已打开 Markdown 编辑器（演示）')}>直接编辑 Markdown</button></div><details><summary>文件与知识</summary><p><code>SKILL.md</code> · 说明文档 · 2 次修订</p><button type="button" onClick={() => onToast('文件预览已打开')}>查看文件</button></details><details><summary>Tool、依赖与执行信任</summary><p>当前 Skill 不包含 Tool 或 Hooks。若未来加入执行内容，会在检查和生效状态中明确显示。</p></details><details><summary>版本历史与回退</summary><p>v1 当前正式生效 · v0 上一可用版本</p><button type="button" onClick={() => onToast('已模拟回退确认入口')}>查看回退选项</button></details></> : <><span className="eyebrow">普通 Skill</span><h3>web-research</h3><p>按需检索公开资料，默认不在每次任务中自动展开。</p><div className="empty-panel"><span className="large-state neutral">⌕</span><b>尚未加载详细信息</b><button type="button" className="quiet-button" onClick={() => onToast('已按需加载 Skill 说明')}>按需查看</button></div></>}</div></div></div>; }

function SettingsView({ onToast, onReload }: { onToast: (message: string) => void; onReload: () => void }) { const [authorized, setAuthorized] = useState(true); const [provider, setProvider] = useState('openai-codex'); return <div className="page-body settings-page"><div className="page-intro"><div><span className="eyebrow">本机连接 · 只显示状态</span><h2>模型与连接</h2><p>凭证由 Host 和系统安全存储管理；这里显示可做什么，不显示密钥内容。</p></div><span className={`status-chip ${authorized ? 'success' : 'danger'}`}>{authorized ? '已授权' : '未授权'}</span></div><div className="settings-stack"><section className="settings-section"><div className="section-heading"><div><h3>当前模型</h3><p>选择提供方后，任务会在已连接的 Host 中执行。</p></div><select value={provider} onChange={(event) => setProvider(event.target.value)} aria-label="选择模型提供方"><option>openai-codex</option><option>deepseek</option><option>本地模型（演示）</option></select></div><div className="setting-row"><span><b>{provider}</b><small>连接状态和模型能力由 Host 返回</small></span><span className="status-chip success">可用</span></div></section><section className="settings-section"><div className="section-heading"><div><h3>授权状态</h3><p>{authorized ? '当前会话可以继续使用模型；退出后不会删除本地会话。' : '需要重新授权后才能发送新消息。已有草稿会保留。'}</p></div><button type="button" className={authorized ? 'quiet-button' : 'primary-button'} onClick={() => { setAuthorized((value) => !value); onToast(authorized ? '已退出模型授权（演示）' : '已重新授权（演示）'); }}>{authorized ? '退出授权' : '重新授权'}</button></div><div className="secure-note"><span>▣</span><span>密钥内容不会在界面、日志或 Demo 中展示。退出授权是 Provider 状态变化，不等于删除本地数据。</span></div></section><section className="settings-section"><div className="section-heading"><div><h3>连接与恢复</h3><p>适合桌面端和 Web 共同使用的明确状态反馈。</p></div><button type="button" className="quiet-button" onClick={onReload}>重新连接</button></div><div className="connection-states"><div><span className="status-dot success" /><b>Host 在线</b><small>上次同步：刚刚</small></div><div><span className="status-dot warning" /><b>最近一次任务已保存</b><small>离线时仍可继续编辑草稿</small></div></div></section></div></div>; }

function Inspector({ raw, onRaw, onClose, onToast }: { raw: boolean; onRaw: () => void; onClose: () => void; onToast: (message: string) => void }) { return <aside className="inspector"><div className="inspector-head"><div><span className="eyebrow">当前会话</span><h2>上下文</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭上下文">×</button></div><div className="inspector-section"><span className="eyebrow">正在使用</span><button type="button" className="context-link" onClick={() => onToast('已定位到 project-notes Skill')}>✦ project-notes <small>Skill · v1</small></button><button type="button" className="context-link" onClick={() => onToast('已定位到 project-notes.md')}>⌁ project-notes.md <small>文件引用</small></button></div><div className="inspector-section"><div className="detail-heading"><span className="eyebrow">运行状态</span><button type="button" onClick={onRaw}>{raw ? '隐藏原始信息' : '原始信息'}</button></div><div className="mini-status"><span className="status-dot success" /><span>任务已完成</span><b>1 个待处理建议</b></div>{raw && <pre>{'{\n  "session": "sess_demo_41",\n  "branch": "main",\n  "redacted": true\n}'}</pre>}</div><div className="inspector-section"><span className="eyebrow">下一步</span><button type="button" className="next-action" onClick={() => onToast('已打开 Reflection 结论（演示）')}>查看本次结论 <span>→</span></button><button type="button" className="next-action" onClick={() => onToast('已打开待处理建议（演示）')}>处理 1 条建议 <span>→</span></button></div><div className="inspector-footer">技术证据默认收纳；需要审计、复制或重新审查时再展开。</div></aside>; }

function LoadingState() { return <div className="loading-state"><div className="skeleton skeleton-title" /><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line short" /><div className="skeleton skeleton-card" /><span>正在恢复当前会话…</span></div>; }

createRoot(document.getElementById('root')!).render(<App />);
