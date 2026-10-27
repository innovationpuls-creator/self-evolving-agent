import { useRef, useState } from 'react';
import { useSessionViewport } from './useSessionViewport';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  FileText,
  GitBranch,
  Paperclip,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import { useDemo } from '../../state/store';
import { files, report } from '../../state/model';
import { Markdown } from '../../components/content';
import { ToolActivity } from '../../components/ToolActivity';
import { Button, Field, IconButton, Modal, Notice, StateGate, Status } from '../../components/ui';
import './session-room.css';

/** A owns its reading viewport. B keeps the original result layout. */
export function SessionRoom() {
  const x = useDemo();
  const session = x.session;
  const active = x.page === 'chat' && x.mode === 'quiet' && !['loading', 'empty', 'error'].includes(x.scenario);
  const key = `${session.id}:${session.branch}`;
  const { room, reader, dock, input, following, readingTop, focused, readerFocused, selection, away, setAway, header } =
    useSessionViewport({
      key,
      active,
      draft: session.draft,
      empty: session.messages.length === 0,
      messageSignature: `${session.transcript?.length ?? session.messages.length}:${session.transcript?.at(-1)?.text.length}:${session.run}:${x.scenario}`,
    });
  const [picker, setPicker] = useState<'files' | 'skills' | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const composing = useRef(false);
  const running = session.run === 'running';
  const stopped = session.run === 'stopped' || session.run === 'interrupted';
  const ready = x.d.connection && (x.d.auth === 'saved' || x.d.env);
  const projectFiles = session.project === '~/Projects/agent' ? files : [];
  const messages = session.transcript ?? session.messages.map((text) => ({ role: 'user' as const, text }));
  const initialReport = session.id === 'compare' && !session.transcript && session.run === 'done';

  const send = () => {
    if (!ready || running || !session.draft.trim() || composing.current) return;
    following.current = true;
    x.send();
    // Host auto-titles only unnamed sessions; retain a name the user supplied.
    if (session.messages.length === 0 && session.title !== '新会话') x.updateSession({ title: session.title });
    input.current?.focus({ preventScroll: true });
  };
  const toggleRef = (value: string) =>
    x.updateSession({
      refs: session.refs.includes(value) ? session.refs.filter((r) => r !== value) : [...session.refs, value],
    });
  const branchControl = (
    <button
      type="button"
      className="session-branch"
      aria-label={`会话历史与分支，当前分支 ${session.branch}`}
      onClick={() => setBranchOpen(true)}
    >
      <GitBranch size={15} />
      <span>{session.branch}</span>
    </button>
  );
  const originalTools = (text: string) => session.id === 'compare' && text === report;

  return (
    <>
      {header && createPortal(branchControl, header)}
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
        <section className="session-room" ref={room} aria-label="会话内容">
          <p className="sr-only" role="status">
            {running
              ? '正在处理请求'
              : stopped
                ? session.run === 'interrupted'
                  ? '执行被中断'
                  : '执行已停止'
                : session.run === 'done'
                  ? '执行已结束'
                  : '尚未发送'}
          </p>
          <section
            className="session-scroll"
            ref={reader}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: The independent reading scroller must support PageUp/PageDown without focusing a message action.
            tabIndex={0}
            aria-label="对话消息"
            onFocusCapture={() => {
              readerFocused.current = true;
              focused.current = false;
            }}
            onScroll={(event) => {
              const el = event.currentTarget;
              readingTop.current = el.scrollTop;
              following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
              setAway(!following.current);
            }}
          >
            <div className="session-column">
              {messages.length === 0 ? (
                <div className="session-start">
                  <h2>想一起完成什么？</h2>
                  <div>
                    {['梳理项目说明的结构', '比较两版文档，指出不确定的内容'].map((text) => (
                      <button
                        type="button"
                        key={text}
                        onClick={() => {
                          x.updateSession({ draft: text });
                          input.current?.focus({ preventScroll: true });
                        }}
                      >
                        {text}
                        <ArrowUpRight size={15} />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((m, i) => (
                    <article
                      className={`session-message ${m.role}`}
                      key={`${key}:${i}`}
                      aria-label={m.role === 'user' ? '你的消息' : 'Agent 回复'}
                    >
                      {m.role === 'assistant' && <div className="session-author">Agent</div>}
                      {m.role === 'assistant' && originalTools(m.text) && <ToolActivity traceAvailable={false} />}
                      <Markdown text={m.text} />
                    </article>
                  ))}
                  {initialReport && (
                    <article className="session-message assistant" aria-label="Agent 回复">
                      <div className="session-author">
                        Agent <span>执行已结束</span>
                      </div>
                      <ToolActivity />
                      <Markdown
                        text={
                          report +
                          (x.scenario === 'long'
                            ? '\n### 附加核对说明\n' +
                              '兼容性结论必须以材料为依据。相关证据可以按需展开，未核实内容保留在报告中。\n\n'.repeat(
                                12,
                              )
                            : '')
                        }
                      />
                      <nav className="session-related" aria-label="关联工作空间">
                        <button type="button" onClick={() => x.go('memory')}>
                          记忆 <ArrowUpRight size={13} />
                        </button>
                        <button type="button" onClick={() => x.go('reflection')}>
                          反思记录 <ArrowUpRight size={13} />
                        </button>
                        <button type="button" onClick={() => x.go('evolution')}>
                          改进建议 <ArrowUpRight size={13} />
                        </button>
                      </nav>
                    </article>
                  )}
                </>
              )}
              {running && (
                <div className="session-run" role="status">
                  <Status tone="busy">正在处理请求</Status>
                  <Button kind="ghost" onClick={() => x.go('trace')}>
                    查看轨迹
                  </Button>
                  <p>模拟运行中，尚未产生模型回复或工具调用。</p>
                </div>
              )}
              {stopped && (
                <Notice title={session.run === 'interrupted' ? '执行被中断' : '执行已停止'} tone="warn">
                  已记录的操作仍保留，结果可能不完整。
                  <div>
                    <Button kind="ghost" onClick={() => x.go('trace')}>
                      检查执行记录
                    </Button>
                    <Button
                      kind="ghost"
                      onClick={() => {
                        x.updateSession({ draft: '根据已保留的执行记录，重新核对未完成部分。' });
                        input.current?.focus({ preventScroll: true });
                      }}
                    >
                      准备新的请求
                    </Button>
                  </div>
                </Notice>
              )}
            </div>
          </section>
          <div className="session-dock" ref={dock}>
            {away && (
              <button
                type="button"
                className="session-latest"
                aria-label="回到最新消息"
                onClick={() => {
                  following.current = true;
                  reader.current?.scrollTo({ top: reader.current.scrollHeight });
                  setAway(false);
                }}
              >
                <ArrowDown size={16} />
              </button>
            )}
            <div className="session-composer">
              {session.refs.length > 0 && (
                <section className="session-references" aria-label="引用材料">
                  {session.refs.map((r) => (
                    <span key={r} title={r}>
                      {r.startsWith('/skill:') ? <Sparkles size={14} /> : <FileText size={14} />}
                      <span>{r.split('/').at(-1)}</span>
                      <button
                        type="button"
                        aria-label={`移除 ${r}`}
                        onClick={() => {
                          toggleRef(r);
                          input.current?.focus({ preventScroll: true });
                        }}
                      >
                        <X size={14} />
                      </button>
                    </span>
                  ))}
                </section>
              )}
              <textarea
                ref={input}
                aria-label="发送给 Agent"
                placeholder="发送消息…"
                rows={1}
                value={session.draft}
                onFocus={() => {
                  focused.current = true;
                  readerFocused.current = false;
                }}
                onBlur={(e) => {
                  if (e.relatedTarget && room.current?.contains(e.relatedTarget)) focused.current = false;
                }}
                onSelect={(e) => {
                  selection.current = [e.currentTarget.selectionStart, e.currentTarget.selectionEnd];
                }}
                onCompositionStart={() => {
                  composing.current = true;
                }}
                onCompositionEnd={() => {
                  composing.current = false;
                }}
                onChange={(e) => x.updateSession({ draft: e.target.value })}
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    (e.metaKey || e.ctrlKey) &&
                    !e.nativeEvent.isComposing &&
                    e.keyCode !== 229
                  ) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <div className="session-compose-actions">
                <div>
                  <IconButton label="引用项目文件" onClick={() => setPicker('files')}>
                    <Paperclip size={18} />
                  </IconButton>
                  <IconButton label="引用 Skill" onClick={() => setPicker('skills')}>
                    <Sparkles size={18} />
                  </IconButton>
                  <button type="button" className="session-model" onClick={() => setModelOpen(true)}>
                    {session.model}
                    <ChevronDown size={12} />
                  </button>
                </div>
                <div>
                  {running ? (
                    <IconButton
                      label="停止当前执行"
                      onClick={() => {
                        x.stop();
                        input.current?.focus({ preventScroll: true });
                      }}
                    >
                      <Square size={16} />
                    </IconButton>
                  ) : (
                    <button
                      type="button"
                      className="session-send"
                      aria-label="发送任务"
                      title="发送任务 (⌘/Ctrl + Enter)"
                      disabled={!session.draft.trim() || !ready}
                      onClick={send}
                    >
                      <ArrowUp size={19} />
                    </button>
                  )}
                </div>
              </div>
              {!ready && (
                <div className="session-compose-error" role="status">
                  {!x.d.connection ? (
                    '连接中断，草稿已保留。'
                  ) : (
                    <button type="button" onClick={() => x.go('settings')}>
                      配置模型授权后发送 <ArrowUpRight size={13} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      </StateGate>
      <Modal
        open={!!picker}
        onClose={() => setPicker(null)}
        title={picker === 'files' ? '引用项目文件' : '引用 Skill'}
        description={
          picker === 'files' ? `来自模拟 Host 的 ${session.project}，不是浏览器上传。` : '指引不会改变执行权限。'
        }
        footer={
          <Button kind="primary" onClick={() => setPicker(null)}>
            完成引用
          </Button>
        }
      >
        {picker === 'files' && projectFiles.length === 0 && <p className="muted">此项目尚未提供文件候选。</p>}
        {(picker === 'files' ? projectFiles : x.d.skills.filter((s) => s.enabled).map((s) => `/skill:${s.name}`)).map(
          (f) => (
            <button
              type="button"
              className="picker-row"
              key={f}
              aria-pressed={session.refs.includes(f)}
              onClick={() => toggleRef(f)}
            >
              <FileText size={17} />
              <span>
                {f}
                <small>
                  {f.includes('兼容') ? '示例中缺失，读取会失败' : picker === 'files' ? '项目文件' : '已启用的指引'}
                </small>
              </span>
              {session.refs.includes(f) ? <Check size={16} /> : <span>＋</span>}
            </button>
          ),
        )}
      </Modal>
      <Modal
        open={modelOpen}
        onClose={() => setModelOpen(false)}
        title="模型与推理"
        footer={
          <Button kind="primary" onClick={() => setModelOpen(false)}>
            完成
          </Button>
        }
      >
        <Field label="当前会话模型">
          <select value={session.model} onChange={(e) => x.updateSession({ model: e.target.value })}>
            <option>通用模型</option>
            <option>推理模型</option>
          </select>
        </Field>
        <Field label="推理投入">
          <select value={session.reasoning} onChange={(e) => x.updateSession({ reasoning: e.target.value })}>
            <option>标准</option>
            <option>深入</option>
          </select>
        </Field>
        <Button
          kind="ghost"
          onClick={() => {
            setModelOpen(false);
            x.go('settings');
          }}
        >
          管理模型授权
        </Button>
      </Modal>
      <Modal
        open={branchOpen}
        onClose={() => setBranchOpen(false)}
        title="会话历史与分支"
        description="查看历史不会改变 Agent 的执行位置。"
      >
        <div className="branch-tree">
          <div>
            <span className="branch-node" />
            当前分支 {session.branch}
            <small>当前执行位置</small>
          </div>
          <div>
            <span className="branch-node muted-node" />
            历史分支 0<small>历史内容在轨迹中只读查看</small>
          </div>
        </div>
        <Notice title="切换执行位置会影响来源决定" tone="warn">
          依赖旧分支的项目决定会被撤销。执行事实与通用经验仍保留；切回不会自动恢复已撤销决定。
        </Notice>
        <div className="inline-actions">
          <Button
            onClick={() => {
              setBranchOpen(false);
              x.go('trace');
            }}
          >
            只读查看历史
          </Button>
          <Button
            onClick={() => {
              x.updateSession({ branch: session.branch === 1 ? 0 : 1, run: 'idle' });
              setBranchOpen(false);
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
            setBranchOpen(false);
          }}
        >
          压缩当前上下文
        </Button>
      </Modal>
    </>
  );
}
