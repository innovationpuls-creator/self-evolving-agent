import { useState, useRef, useEffect } from 'react';
import { Diff } from '../../src/components/content';
import { Node, Scope, Panel } from './ui';
export function Evolution() {
  const [phase, P] = useState('suggestion'),
    [discussion, D] = useState<string[]>([]),
    [draft, T] = useState(''),
    [goal, G] = useState('完善 text-diff 报告指引，单列未核实的材料，保留原始依据。'),
    [allowed, A] = useState(true),
    [newSkill, N] = useState(''),
    [open, O] = useState(false),
    [outcome, U] = useState('成功'),
    [version, V] = useState(1),
    [events, E] = useState<string[]>([]),
    [grant, B] = useState<{ goal: string; names: string[]; base: number } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  function cancel() {
    timers.current.forEach(clearTimeout);
    P('cancelled');
    E((v) => [...v, '用户取消，候选未提交']);
  }
  function approve() {
    const frozen = {
      goal,
      names: [...(allowed ? ['text-diff'] : []), ...(newSkill.trim() ? [newSkill.trim()] : [])],
      base: version,
    };
    B(frozen);
    O(false);
    P('developing');
    E(['具体目标与范围已授权', 'Agent 已开始调查与开发']);
    timers.current.push(
      setTimeout(() => {
        P('checking');
        E((v) => [...v, '候选已提交，开始必要检查']);
      }, 1800),
      setTimeout(() => {
        P(outcome === '成功' ? 'applied' : outcome === '失败' ? 'failed' : 'nochange');
        E((v) => [
          ...v,
          outcome === '成功'
            ? '检查通过，候选自动生效'
            : outcome === '失败'
              ? 'Tool 名称冲突，旧版继续生效'
              : '调查后无需修改，没有新版本',
        ]);
        if (outcome === '成功') V(version + 1);
      }, 3600),
    );
  }
  return (
    <section className="evolution">
      <div className="page-heading">
        <div>
          <small>Evolution / text-diff</small>
          <h1>让报告说明证据缺口</h1>
        </div>
        <select
          aria-label="开发结果"
          value={outcome}
          disabled={['developing', 'checking'].includes(phase)}
          onChange={(e) => U(e.target.value)}
        >
          {['成功', '失败', '无需修改'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      {phase === 'suggestion' ? (
        <div className="proposal">
          <div className="proposal-mark">
            <svg width="80" height="65" viewBox="0 0 80 65" aria-hidden="true">
              <path d="M8 15H34V48H69M34 15H69" fill="none" stroke="currentColor" />
              <circle cx="8" cy="15" r="4" fill="currentColor" />
              <circle cx="69" cy="48" r="5" fill="none" stroke="currentColor" />
            </svg>
            <small>建议 · 尚未授权</small>
          </div>
          <p className="reading lead">将“尚未核实的材料”作为差异报告的一部分，而不是让读者从执行记录中自行推断。</p>
          <blockquote>read 返回 ENOENT：兼容说明.md 不存在</blockquote>
          <p>这次比较暴露了一个边界：正文有变化，但旧版兼容性没有足够依据。</p>
          <p className="uncertain">仅观察到一次问题。是否需要新增代码，应在讨论和调查后决定。</p>
          <button type="button" className="primary" onClick={() => P('discussion')}>
            创建目标讨论 →
          </button>
        </div>
      ) : phase === 'discussion' ? (
        <div className="discussion">
          <p className="reading">先明确要改变的行为，再决定允许修改的范围。</p>
          {discussion.map((m, i) => (
            <div className="discussion-message" key={`${i}-${m}`}>
              <small>你 · 目标讨论</small>
              <p>{m}</p>
            </div>
          ))}
          <label>
            讨论内容
            <textarea
              value={draft}
              onChange={(e) => T(e.target.value)}
              placeholder="例如：只完善报告指引，不增加工具。"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              if (draft.trim()) {
                D([...discussion, draft]);
                T('');
              }
            }}
          >
            发送讨论
          </button>
          <button type="button" className="primary" disabled={!discussion.length} onClick={() => O(true)}>
            审阅开发授权 ↗
          </button>
        </div>
      ) : (
        <div className="development">
          <div className="terminal-title">
            <Node active={['developing', 'checking'].includes(phase)} />
            <h2>
              {
                {
                  developing: 'Agent 正在开发',
                  checking: '候选正在检查',
                  applied: '新版本已生效',
                  failed: '检查未通过',
                  cancelled: '开发已取消',
                  nochange: '无需修改',
                  rolledback: '已恢复旧版本',
                }[phase]
              }
            </h2>
          </div>
          <p>
            text-diff · 当前 v{version}
            {phase === 'failed' ? '，继续使用原版本。' : ''}
          </p>
          {grant && (
            <>
              <p className="reading">{grant.goal}</p>
              <Scope names={grant.names} />
              <small>授权基础 v{grant.base}</small>
            </>
          )}
          <div className="event-list">
            {events.map((e, i) => (
              <div key={`${i}-${e}`}>
                <Node />
                {e}
              </div>
            ))}
          </div>
          {phase === 'applied' && (
            <>
              <Diff before="列出文档差异。" after="列出文档差异。\n单列未核实的材料，保留原始依据。" />
              <button
                type="button"
                onClick={() => {
                  V(grant!.base);
                  P('rolledback');
                  E([...events, '用户恢复基础版本；历史与已发生事实保留']);
                }}
              >
                恢复 v{grant?.base}
              </button>
            </>
          )}
          {['developing', 'checking'].includes(phase) && (
            <button type="button" onClick={cancel}>
              取消开发
            </button>
          )}
        </div>
      )}
      <Panel title="授权开发此目标" open={open} close={() => O(false)}>
        <label>
          具体目标
          <textarea value={goal} onChange={(e) => G(e.target.value)} />
        </label>
        <label className="inline">
          <input type="checkbox" checked={allowed} onChange={(e) => A(e.target.checked)} />
          允许修改 text-diff · 基础 v{version}
        </label>
        <label>
          允许新建的 Skill
          <input value={newSkill} onChange={(e) => N(e.target.value)} placeholder="留空则不允许新建" />
        </label>
        <Scope names={[...(allowed ? ['text-diff'] : []), ...(newSkill.trim() ? [newSkill.trim()] : [])]} />
        <div className="permission">
          <strong>使用本机用户 / Host 权限</strong>
          <p>
            开发 Shell 与 Extension 可使用本机权限。范围检查不是操作系统沙箱；取消与回退不能撤销已发生的外部副作用。
          </p>
          <p>通过必要检查后自动生效，无需再次发布审批。</p>
        </div>
        <button
          type="button"
          className="primary"
          disabled={!goal.trim() || (!allowed && !newSkill.trim())}
          onClick={approve}
        >
          授权此目标与范围
        </button>
      </Panel>
    </section>
  );
}
