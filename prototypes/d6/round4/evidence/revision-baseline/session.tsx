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
      M((v) => [
        ...v,
        { role: 'Agent', text: '这是自由输入的模拟回复；没有调用模型或执行 Tool。你可以继续输入，检查多轮阅读体验。' },
      ]);
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
        {messages.length === 0 && <p className="reading">提供任务与材料，开始一个新的 Session。</p>}
        {messages.map((m, i) => (
          <article className={`message ${m.role === '你' ? 'user' : ''}`} key={`${i}-${m.role}`}>
            <div className="speaker">
              {m.role === 'Agent' ? <Node /> : null}
              {m.role}
              <small>{i === 0 ? '14:32' : ''}</small>
            </div>
            {m.role === 'Agent' && i === 1 && events && (
              <div className="execution">
                <button type="button" onClick={() => T('read')}>
                  <Node />
                  read <span>两份正文已返回</span>
                </button>
                <button type="button" className="failure" onClick={() => T('missing')}>
                  <Node />
                  read <span>兼容附件不存在</span>
                </button>
                <small>模型继续分析后已返回答复 · 包含未核实内容</small>
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
              <span>模拟请求处理中，尚无模型或 Tool 返回</span>
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
          <select aria-label="模型">
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
        <p>来自文档比较的模拟执行记录。Tool 返回与最终答复分别保留。</p>
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
