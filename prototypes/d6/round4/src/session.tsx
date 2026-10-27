import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Markdown, JsonView } from '../../src/components/content';
import { report } from '../../src/state/model';
import { samples } from '../../src/state/samples';
import { Node, Panel } from './ui';
export function Session({ compact = false }: { compact?: boolean }) {
  const [messages, M] = useState([
      { role: '你', text: '比较两版项目说明，列出变化、影响和仍需确认的内容。' },
      { role: 'Agent', text: report },
    ]),
    [draft, D] = useState(''),
    [active, A] = useState(false),
    [events, E] = useState(true),
    [tool, T] = useState(''),
    [refs, R] = useState(['项目说明-v1.md', '项目说明-v2.md']),
    [picker, P] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  function send() {
    if (!draft.trim() || active) return;
    M((v) => [...v, { role: '你', text: draft }]);
    D('');
    A(true);
    timer.current = setTimeout(() => {
      A(false);
      M((v) => [...v, { role: 'Agent', text: '演示回复（未调用模型或工具）。' }]);
    }, 2400);
  }
  return (
    <section className={`session ${compact ? 'compact' : ''}`}>
      <div className="page-heading">
        <div>
          <small>Session / 当前分支</small>
          <h1>项目说明比较</h1>
        </div>
        <select
          aria-label="内容样例"
          onChange={(e) => {
            if (e.target.value === '空白会话') {
              M([]);
              E(false);
              R([]);
              return;
            }
            const s = samples.find((s) => s.title === e.target.value);
            if (s) {
              M([
                { role: '你', text: s.text },
                { role: 'Agent', text: s.answer },
              ]);
              E(false);
            } else {
              M([
                { role: '你', text: '比较两版项目说明。' },
                { role: 'Agent', text: report },
              ]);
              E(true);
            }
          }}
        >
          <option>文档比较</option>
          <option>空白会话</option>
          {samples.map((s) => (
            <option key={s.title}>{s.title}</option>
          ))}
        </select>
      </div>
      <div className="messages">
        {messages.length === 0 && <p className="empty-session">输入任务或引用项目文件。</p>}
        {messages.map((m, i) => (
          <article className={`message ${m.role === '你' ? 'user' : ''}`} key={`${i}-${m.role}`}>
            <div className="speaker">
              {m.role}
              <small>{i === 0 ? '14:32' : ''}</small>
            </div>
            {m.role === 'Agent' && i === 1 && events && (
              <div className="execution">
                <button type="button" onClick={() => T('read')}>
                  <span className="status-indicator is-success" aria-hidden="true" />
                  <code>read</code>
                  <span>项目说明-v1.md、v2.md</span>
                  <small>已返回</small>
                </button>
                <button type="button" onClick={() => T('missing')}>
                  <span className="status-indicator is-error" aria-hidden="true" />
                  <code>read</code>
                  <span>资料/兼容说明.md</span>
                  <small>ENOENT</small>
                </button>
              </div>
            )}
            <Markdown text={m.text} />
          </article>
        ))}
        <AnimatePresence>
          {active && (
            <motion.div
              className="running"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <Node active />
              <span role="status">正在处理请求</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="composer">
        <div className="references">
          {refs.map((r) => (
            <button type="button" key={r} onClick={() => R(refs.filter((x) => x !== r))}>
              ↗ {r} ×
            </button>
          ))}
        </div>
        <textarea
          aria-label="发送给 Agent"
          rows={2}
          value={draft}
          placeholder="输入任务，或继续追问…"
          onChange={(e) => D(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="compose-actions">
          <button type="button" onClick={() => P(true)}>
            ＋ 引用
          </button>
          <select aria-label="模型（演示）">
            <option>通用模型 · 标准推理</option>
            <option>代码模型 · 深入推理</option>
          </select>
          <span>⌘ ↵</span>
          {active ? (
            <button
              type="button"
              onClick={() => {
                if (timer.current) clearTimeout(timer.current);
                A(false);
                M((v) => [...v, { role: 'Agent', text: '执行已停止，没有产生最终结果。' }]);
              }}
            >
              停止
            </button>
          ) : (
            <button type="button" className="primary" disabled={!draft.trim()} onClick={send}>
              发送 ↑
            </button>
          )}
        </div>
      </div>
      <Panel title="引用材料" open={picker} close={() => P(false)}>
        {['资料/兼容说明.md', 'Skill: text-diff'].map((s) => (
          <button
            type="button"
            className="pick"
            key={s}
            onClick={() => {
              R([...new Set([...refs, s])]);
              P(false);
            }}
          >
            {s} ＋
          </button>
        ))}
      </Panel>
      <Panel
        title={tool === 'missing' ? 'read · 文件未找到' : 'read · 正文已返回'}
        open={!!tool}
        close={() => T('')}
        drawer
      >
        <p className="record-caption">演示记录 · 非真实 Host 调用</p>
        <JsonView
          value={
            tool === 'missing'
              ? {
                  input: { path: '资料/兼容说明.md' },
                  error: { code: 'ENOENT', message: '文件不存在' },
                  status: 'failed',
                }
              : {
                  input: { paths: ['docs/项目说明-v1.md', 'docs/项目说明-v2.md'] },
                  output: {
                    files: [
                      { version: 1, login: 'password' },
                      { version: 2, login: 'device' },
                    ],
                  },
                  status: 'returned',
                }
          }
        />
      </Panel>
    </section>
  );
}
