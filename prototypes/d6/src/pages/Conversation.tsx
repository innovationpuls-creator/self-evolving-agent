import { useState, useLayoutEffect, useRef } from 'react';
import { SessionRoom } from './conversation/SessionRoom';
import {
  ArrowUp,
  Square,
  Paperclip,
  ChevronDown,
  Sparkles,
  GitBranch,
  ArrowUpRight,
  FileText,
  X,
  Check,
  Activity,
} from 'lucide-react';
import { useDemo } from '../state/store';
import { files, report } from '../state/model';
import { ToolActivity } from '../components/ToolActivity';
import { Markdown } from '../components/content';
import { Button, Modal, IconButton, Status, Notice, TabBar, StateGate, Field } from '../components/ui';
export function Conversation() {
  const { mode } = useDemo();
  return mode === 'quiet' ? <SessionRoom /> : <LegacyConversation />;
}
function LegacyConversation() {
  const x = useDemo();
  const [picker, P] = useState('');
  const [model, M] = useState(false);
  const [result, R] = useState('报告');
  const [branch, B] = useState(false);
  const studio = x.mode === 'studio';
  const session = x.session;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!inputRef.current || studio) return;
    inputRef.current.style.height = 'auto';
    inputRef.current.style.height = `${Math.min(160, Math.max(44, inputRef.current.scrollHeight))}px`;
  }, [session.draft, studio]);
  const running = session.run === 'running';
  const stopped = ['stopped', 'interrupted'].includes(session.run);
  const addRef = (r: string) => {
    x.updateSession({ refs: [...new Set([...session.refs, r])] });
  };
  const compose = (
    <div className="composer">
      <div className="composer-refs">
        {session.refs.map((r) => (
          <span key={r}>
            <FileText size={13} />
            {r}
            <button
              type="button"
              aria-label={`移除 ${r}`}
              onClick={() => x.updateSession({ refs: session.refs.filter((v) => v !== r) })}
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <textarea
        ref={inputRef}
        aria-label="发送给 Agent"
        value={session.draft}
        placeholder="交代目标，Agent 会选择合适的工具与能力…"
        onChange={(e) => x.updateSession({ draft: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            x.send();
          }
        }}
      />
      <div className="composer-toolbar">
        <div>
          <IconButton label="引用项目文件" onClick={() => P('文件')}>
            <Paperclip size={17} />
          </IconButton>
          <IconButton label="引用 Skill" onClick={() => P('Skill')}>
            <Sparkles size={17} />
          </IconButton>
          <button type="button" className="model-pick" onClick={() => M(true)}>
            {session.model}
            <ChevronDown size={12} />
          </button>
          <span className="composer-hint">⌘ ↵</span>
        </div>
        {running ? (
          <IconButton label="停止当前执行" onClick={x.stop}>
            <Square size={16} />
          </IconButton>
        ) : (
          <button
            type="button"
            className="send"
            aria-label="发送任务"
            disabled={!session.draft.trim() || !x.d.connection || (x.d.auth !== 'saved' && !x.d.env)}
            onClick={x.send}
          >
            <ArrowUp size={18} />
          </button>
        )}
      </div>
    </div>
  );
  const output = (
    <>
      <div className="response-meta">
        <span className="agent-mark">A</span>
        <strong>Agent</strong>
        <span>今天 14:32</span>
        <Status tone="neutral">执行已结束</Status>
      </div>
      {!studio && <ToolActivity />}
      <Markdown
        text={
          report +
          (x.scenario === 'long'
            ? '\n### 附加核对说明\n' +
              '兼容性结论必须以材料为依据。长文仍保留章节与阅读节奏，相关证据可以按需展开。\n\n'.repeat(12)
            : '')
        }
      />
      <div className="result-footer" hidden={!studio}>
        <button type="button" onClick={() => x.go('trace')}>
          <Activity size={14} />
          查看执行依据 <span>4 次调用 · 1 次失败</span>
          <ArrowUpRight size={13} />
        </button>
      </div>
    </>
  );
  return (
    <StateGate
      emptyAction={
        <Button
          kind="primary"
          onClick={() => {
            x.setScenario('normal');
            x.createSession();
          }}
        >
          开始新会话
        </Button>
      }
    >
      <div className={`conversation ${studio ? 'work-result' : 'chat-reading'}`}>
        <div className="conversation-top">
          <div>
            {studio && <span className="eyebrow">会话 / 工作结果</span>}
            <h1>{session.title}</h1>
          </div>
          <Button kind="ghost" onClick={() => B(true)}>
            <GitBranch size={14} />
            分支 {session.branch}
          </Button>
        </div>
        <TabBar
          items={studio ? ['报告', '对话'] : ['对话', '轨迹']}
          value={studio ? result : '对话'}
          onChange={(v) => (studio ? R(v) : x.go(v === '轨迹' ? 'trace' : 'chat'))}
        />
        <div className="conversation-grid">
          <section className="conversation-content">
            <div className="reading-scroll">
              {session.messages.length === 0 ? (
                <div className="start-work">
                  <span className="agent-large">A</span>
                  <h2>从想完成的事开始</h2>
                  <p>提供目标和必要材料。Agent 会自主选择工具，过程与依据随时可查。</p>
                  <div className="prompt-options">
                    {['梳理项目说明的结构', '比较两版文档，指出不确定的内容'].map((t) => (
                      <button type="button" key={t} onClick={() => x.updateSession({ draft: t })}>
                        {t}
                        <ArrowUpRight size={14} />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {!studio && session.transcript
                    ? session.transcript.map((m, i) => (
                        <article className={`transcript-message ${m.role}`} key={i}>
                          <div className="message-person">{m.role === 'user' ? '你' : 'Agent'}</div>
                          <Markdown text={m.text} />
                        </article>
                      ))
                    : null}
                  {((!studio && !session.transcript) || (studio && result === '对话')) &&
                    session.messages.map((m, i) => (
                      <div className="user-message" key={`${i}-${m}`}>
                        <div className="message-person">
                          你 <span>{i === 0 ? '14:32' : '刚刚'}</span>
                        </div>
                        <p>{m}</p>
                      </div>
                    ))}
                  {session.run === 'done' &&
                    ((!studio && !session.transcript && session.id === 'compare') || (studio && result === '报告')) &&
                    output}
                  {running && (
                    <div className="live-run">
                      <Status tone="busy">{studio ? '正在阅读材料' : '正在处理请求'}</Status>
                      <p>
                        {studio
                          ? '已开始执行。工具调用会保留在当前会话的轨迹中。'
                          : '模拟运行中；尚未产生模型回复或工具调用。'}
                      </p>
                      <div className="activity-line" hidden={!studio}>
                        <Check size={13} />
                        已确认项目目录 <span>正在比较正文…</span>
                      </div>
                      <Button kind="ghost" onClick={() => x.go('trace')}>
                        查看实时轨迹
                      </Button>
                    </div>
                  )}
                  {stopped && (
                    <Notice title={session.run === 'interrupted' ? '执行被中断' : '执行已停止'} tone="warn">
                      已记录的操作仍保留。结果可能不完整；不会自动重新执行。
                      <div>
                        <Button kind="ghost" onClick={() => x.go('trace')}>
                          先检查执行记录
                        </Button>
                        <Button
                          kind="ghost"
                          onClick={() => x.updateSession({ draft: '根据已保留的执行记录，重新核对未完成部分。' })}
                        >
                          准备新的请求
                        </Button>
                      </div>
                    </Notice>
                  )}
                </>
              )}
              {!studio && session.id === 'compare' && !session.transcript && session.run === 'done' && (
                <div className="after-work">
                  <span className="eyebrow">这次工作留下了什么</span>
                  <div>
                    <button type="button" onClick={() => x.go('memory')}>
                      <BookIcon />
                      修正了报告经验<span>认识 →</span>
                    </button>
                    <button type="button" onClick={() => x.go('reflection')}>
                      <Activity size={15} />
                      发现一处证据缺口<span>反思 →</span>
                    </button>
                    <button type="button" onClick={() => x.go('evolution')}>
                      <Sparkles size={15} />
                      有一条建议待判断<span>查看依据 →</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="compose-dock">
              {compose}
              {(studio || running || (x.d.auth !== 'saved' && !x.d.env)) && (
                <div className="compose-footnote">
                  {running
                    ? '执行中的输入不会自动发送。'
                    : x.d.auth !== 'saved' && !x.d.env
                      ? '需要先配置模型授权。'
                      : '文件来自 Host 项目；引用 Skill 是提供指引，执行权限另有边界。'}
                </div>
              )}
            </div>
          </section>
          {studio && (
            <aside className="work-context">
              <span className="eyebrow">本次工作</span>
              <dl>
                <dt>材料</dt>
                <dd>两份正文</dd>
                <dt>覆盖范围</dt>
                <dd>
                  正文已比较
                  <br />
                  <span className="warn-text">兼容附件缺失</span>
                </dd>
                <dt>执行</dt>
                <dd>已结束，未自动重试</dd>
              </dl>
              <button type="button" className="context-link" onClick={() => x.go('trace')}>
                检查调用与原文 <ArrowUpRight size={14} />
              </button>
              <div className="context-divider" />
              <span className="eyebrow">关联认识</span>
              <button type="button" className="context-object" onClick={() => x.go('memory')}>
                <small>经验 · 已修正</small>
                <strong>差异报告应单列未核实内容</strong>
                <ArrowUpRight size={14} />
              </button>
              <button type="button" className="context-object" onClick={() => x.go('reflection')}>
                <small>反思 · 今天 14:33</small>
                <strong>材料缺失不能证明没有变化</strong>
              </button>
              <div className="context-divider" />
              <span className="eyebrow">下一项决定</span>
              <p>是否讨论对 text-diff 的改进？</p>
              <Button onClick={() => x.go('evolution')}>
                查看建议 <ArrowUpRight size={13} />
              </Button>
            </aside>
          )}
        </div>
        <Modal
          open={!!picker}
          onClose={() => P('')}
          title={picker === '文件' ? '引用项目文件' : '引用 Skill'}
          description={
            picker === '文件'
              ? '来自模拟 Host 的 ~/Projects/agent；不是浏览器上传。'
              : 'Agent 仍会根据任务选择如何使用这些指引。'
          }
        >
          {(picker === '文件' ? files : x.d.skills.filter((s) => s.enabled).map((s) => `/skill:${s.name}`)).map((f) => (
            <button type="button" className="picker-row" key={f} onClick={() => addRef(f)}>
              <FileText size={17} />
              <span>
                {f}
                <small>
                  {f.includes('兼容') ? '示例中缺失，读取会失败' : picker === '文件' ? '项目文件' : '已启用的指引'}
                </small>
              </span>
              {session.refs.includes(f) ? <Check size={16} /> : <span>＋</span>}
            </button>
          ))}
          <div className="modal-footer">
            <Button kind="primary" onClick={() => P('')}>
              完成引用
            </Button>
          </div>
        </Modal>
        <Modal open={model} onClose={() => M(false)} title="选择模型与推理方式">
          <Field label="当前会话模型">
            <select value={session.model} onChange={(e) => x.updateSession({ model: e.target.value })}>
              <option>通用模型</option>
              <option>推理模型</option>
            </select>
          </Field>
          <Field label="推理投入" hint="这是模型的推理配置，不展示内部推理过程。">
            <select value={session.reasoning} onChange={(e) => x.updateSession({ reasoning: e.target.value })}>
              <option>标准</option>
              <option>深入</option>
            </select>
          </Field>
          <div className="inline-actions">
            <Button
              kind="ghost"
              onClick={() => {
                M(false);
                x.go('settings');
              }}
            >
              管理模型授权
            </Button>
            <Button kind="primary" onClick={() => M(false)}>
              完成
            </Button>
          </div>
        </Modal>
        <Modal
          open={branch}
          onClose={() => B(false)}
          title="会话历史与分支"
          description="查看历史不会改变 Agent 的执行位置。"
        >
          <div className="branch-tree">
            <div>
              <span className="branch-node" />
              当前分支 {session.branch}
              <small>正文比较与当前报告</small>
            </div>
            <div>
              <span className="branch-node muted-node" />
              历史分支 0<small>旧版密码登录的讨论 · 只读</small>
            </div>
          </div>
          <Notice title="切换执行位置会影响来源决定" tone="warn">
            依赖旧分支的项目决定会被撤销。执行事实与通用经验仍保留；切回不会自动恢复已撤销决定。
          </Notice>
          <div className="inline-actions">
            <Button
              onClick={() => {
                B(false);
                x.go('trace');
              }}
            >
              只读查看历史
            </Button>
            <Button
              onClick={() => {
                x.updateSession({ branch: session.branch === 1 ? 0 : 1, run: 'idle' });
                B(false);
                x.notify('执行位置已切换；项目决定保留撤销状态。');
              }}
            >
              切换执行位置
            </Button>
          </div>
          <Button
            kind="ghost"
            onClick={() => {
              x.notify('上下文已模拟压缩；完整历史保留。');
              B(false);
            }}
          >
            压缩当前上下文
          </Button>
        </Modal>
      </div>
    </StateGate>
  );
}
function BookIcon() {
  return <FileText size={15} />;
}
