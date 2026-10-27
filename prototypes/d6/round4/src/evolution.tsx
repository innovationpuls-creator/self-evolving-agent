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
            <span className="status-indicator is-pending" />
            待讨论 · 未授权
          </div>
          <h2>建议修改 text-diff 的报告规则</h2>
          <p className="proposal-summary">在差异报告中单列未核实项，不将附件缺失视为没有变化。</p>
          <div className="source-event">
            <strong>来源记录</strong>
            <code>read 资料/兼容说明.md</code>
            <span className="error-code">ENOENT</span>
          </div>
          <p className="proposal-context">正文差异已读取；旧版兼容性附件未取得，相关结论需要补充依据。</p>
          <p className="proposal-qualification">观察次数：1 · 是否需要修改代码：待讨论</p>
          <button type="button" className="primary" onClick={() => P('discussion')}>
            创建目标讨论 →
          </button>
        </div>
      ) : phase === 'discussion' ? (
        <div className="discussion">
          <h2>目标讨论</h2>
          <p className="discussion-context">仅讨论需求；授权前不修改 Skill 或执行开发命令。</p>
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
          <ol className="event-list">
            {events.map((e, i) => (
              <li key={`${i}-${e}`}>{e}</li>
            ))}
          </ol>
          {phase === 'applied' && (
            <>
              <Diff before="列出文档差异。" after="列出文档差异。\n单列未核实的材料，保留原始依据。" />
              <button
                type="button"
                onClick={() => {
                  V(grant?.base ?? version);
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
          <p>必要检查通过后自动生效，不再请求发布确认。</p>
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
