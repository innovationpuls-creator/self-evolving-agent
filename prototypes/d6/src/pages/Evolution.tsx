import { useState, useEffect } from 'react';
import { ArrowUpRight, ArrowLeft, Check, Shield, FileText, Play, X, MessageSquare } from 'lucide-react';
import { useDemo } from '../state/store';
import { Button, SectionTitle, Status, Modal, Field, Notice, StateGate, TabBar } from '../components/ui';
import { Diff, Evidence } from '../components/content';
export function Evolution() {
  const x = useDemo();
  const [discussion, D] = useState('');
  const [grant, G] = useState(false);
  const [goal, V] = useState(x.mode === 'studio' ? x.d.goal : '');
  const [allowed, A] = useState(true);
  const [newSkill, N] = useState('');
  const outcome = x.outcome;
  const [ignored, IG] = useState(false);
  const [tab, T] = useState('待决定');
  const [raw, R] = useState(false);
  const phase = x.d.phase;
  const skill = x.d.skills.find((s) => s.id === 'text-diff');
  const active = ['developing', 'checking'].includes(phase);
  const begun = !['suggestion', 'discussion'].includes(phase);
  const studio = x.mode === 'studio';
  useEffect(() => {
    if (x.mode === 'studio' && phase === 'discussion' && !x.d.grant && x.d.discussion.length === 0)
      D('先完善报告指引，明确材料缺失时的输出边界，不增加新工具。');
  }, [phase, x.d.discussion.length, x.d.grant, x.mode]);
  const begin = () => {
    x.patch({ phase: 'discussion' });
  };
  const approve = () => {
    const g = { goal, skill: allowed ? 'text-diff' : '', base: skill?.version ?? 1, allowNew: newSkill };
    x.patch({ goal, grant: g });
    G(false);
    x.develop(outcome, g);
  };
  const legacySuggestion = (
    <>
      <div className="suggestion-origin">
        <span className="eyebrow">{studio ? '来自一次真实可解释的问题' : 'text-diff · 报告指引'}</span>
        <Status tone="warn">待你决定</Status>
      </div>
      <h2>让差异报告说明证据缺口</h2>
      <p className="suggestion-lead">
        报告已经能列出正文变化。但材料不全时，还需要让使用者一眼看懂：哪些结论已确认，哪些仍需核实。
        {x.scenario === 'long' && '材料覆盖范围可能涉及多个目录、不同版本及外部附件；每项判断都应保留依据。'.repeat(10)}
      </p>
      <div className="suggestion-argument">
        <section>
          <h3>为什么值得讨论</h3>
          <p>本次兼容附件读取失败。若只展示差异表，容易把“没有依据”误读为“没有变化”。</p>
        </section>
        <section hidden={!studio}>
          <h3>建议改进的方向</h3>
          <p>完善 text-diff 的报告指引，把材料覆盖范围与待核实项作为结果的一部分。</p>
        </section>
        <section className="uncertain-note">
          <h3>尚未确定</h3>
          <p>目前只观察到这一次问题；是否值得增加代码，需要在讨论和调查后判断。</p>
        </section>
      </div>
      <div className="suggestion-evidence">
        <button type="button" onClick={() => x.go('reflection')}>
          反思记录 <ArrowUpRight size={13} />
        </button>
        <button
          type="button"
          onClick={() => {
            x.setObject('trace', 'fail');
            x.go('trace');
          }}
        >
          附件读取失败 <ArrowUpRight size={13} />
        </button>
        <button type="button" onClick={() => x.go('memory')}>
          相关认识 <ArrowUpRight size={13} />
        </button>
      </div>
      <div className="suggestion-decision">
        <Button kind="primary" onClick={begin}>
          <MessageSquare size={15} />
          开始讨论目标
        </Button>
        <Button
          kind="ghost"
          onClick={() => {
            IG(true);
            x.notify('建议已忽略，仍可在已处理记录查看。');
          }}
        >
          暂不考虑
        </Button>
        <small>只建立讨论，不发送消息，不授予开发权限。</small>
      </div>
    </>
  );
  const suggestion = studio ? (
    legacySuggestion
  ) : (
    <>
      <div className="suggestion-origin">
        <span className="eyebrow">文档比较 · 报告指引</span>
        <Status tone="neutral">待决定</Status>
      </div>
      <h2>材料缺失，需要修改比较技能吗？</h2>
      <p className="suggestion-lead">
        这条建议提出补充材料缺失时的报告规则。但当前 <code>text-diff</code> 已有这项规则，本次报告也已标明未核实内容。
        {x.scenario === 'long' && '材料覆盖范围可能涉及多个目录、不同版本及外部附件；每项判断都应保留依据。'.repeat(10)}
      </p>
      <div className="proposal-comparison">
        <section>
          <h3>实际发生了什么</h3>
          <p>比较两版项目说明时，兼容附件未找到。正文差异已确认，但旧客户端是否仍受支持，还没有依据。</p>
        </section>
        <section>
          <h3>现有能力已经覆盖</h3>
          <p>
            技能要求对无法读取的材料说明缺口、不补造结论。本次结果遵循了这项规则；附件缺失本身不能证明技能需要修改。
          </p>
        </section>
      </div>
      <p className="suggestion-limit">当前没有足够依据支持这项修改。可以忽略建议；若有其他实际需求，再讨论具体目标。</p>
      <div className="suggestion-decision">
        <div className="decision-state">
          <span>你可以保留现有技能。</span>
          <small>
            <Shield size={14} />
            讨论不会修改文件或授予开发权限。
          </small>
        </div>
        <Button onClick={begin}>
          <MessageSquare size={15} />
          继续讨论
        </Button>
        <Button
          kind="primary"
          onClick={() => {
            IG(true);
            x.notify('建议已忽略，仍可在已处理记录查看。');
          }}
        >
          忽略建议
        </Button>
      </div>
      <details className="proposal-sources">
        <summary>查看建议依据与关联记录</summary>
        <p>来自“比较两版项目说明”的任务检查。兼容附件未找到，旧版支持范围仍待核实。</p>
        <div className="suggestion-evidence">
          <button
            type="button"
            onClick={() => {
              x.setObject('reflection', 'finding');
              x.go('reflection');
            }}
          >
            反思记录 <ArrowUpRight size={13} />
          </button>
          <button
            type="button"
            onClick={() => {
              x.setObject('memory', 'report');
              x.go('memory');
            }}
          >
            关联记忆 <ArrowUpRight size={13} />
          </button>
          <button
            type="button"
            onClick={() => {
              x.setObject('trace', 'fail');
              x.go('trace');
            }}
          >
            附件读取记录 <ArrowUpRight size={13} />
          </button>
        </div>
      </details>
    </>
  );
  const discussionUI = (
    <>
      {!studio && (
        <Button kind="ghost" className="proposal-back" onClick={() => x.patch({ phase: 'suggestion' })}>
          <ArrowLeft size={14} />
          返回建议
        </Button>
      )}
      <div className="discussion-title">
        <Status tone="neutral">{x.d.grant ? '目标已授权' : '只读讨论'}</Status>
        <h2>{studio ? '先把改进目标说清楚' : '讨论这条建议'}</h2>
      </div>
      {!studio && (
        <p className="discussion-permission">
          <Shield size={14} />
          当前仅讨论。修改文件、运行开发命令，需要你另行批准具体目标与范围。
        </p>
      )}
      <div className="discussion-background">
        <span className="eyebrow">建议背景</span>
        <p>
          {studio
            ? '附件缺失时需要明确报告边界。优先完善已有指引，是否需要代码由调查决定。'
            : '现有规则和报告已说明材料缺口，没有确认需要修改的能力。你可以询问依据，或提出另一个具体需求。'}
        </p>
      </div>
      {x.d.discussion.map((t, i) => (
        <div className="discussion-message" key={`${i}-${t}`}>
          <small>你 · 已发送</small>
          <p>{t}</p>
          <div>
            <span className="agent-mark">A</span>
            <p>
              {studio
                ? '可以先检查 text-diff 的现有规则。目标授权前只讨论；不会修改文件或运行开发命令。'
                : 'text-diff 已要求说明材料缺口，本次报告也已遵循。仅凭附件缺失，无需修改技能。如果仍希望调整行为，请在授权中写明具体目标。当前没有修改文件或运行开发命令。'}
            </p>
          </div>
        </div>
      ))}
      {!x.d.grant && (
        <>
          <Field label={studio ? '补充你的目标' : '讨论内容'}>
            <textarea
              aria-label="讨论内容"
              value={discussion}
              onChange={(e) => D(e.target.value)}
              placeholder={studio ? '说明期望结果、保留什么、避免什么…' : '问问建议的依据，或说说你的实际需要…'}
            />
          </Field>
          <div className="inline-actions">
            <Button
              kind={studio ? 'secondary' : 'primary'}
              disabled={!discussion.trim()}
              onClick={() => {
                x.patch({ discussion: [...x.d.discussion, discussion] });
                D('');
              }}
            >
              发送讨论内容
            </Button>
            <Button
              kind={studio ? 'primary' : 'ghost'}
              onClick={() => G(true)}
              disabled={studio && !x.d.discussion.length}
              aria-describedby={!studio && !x.d.discussion.length ? 'discussion-hint' : undefined}
            >
              审阅开发授权 <ArrowUpRight size={14} />
            </Button>
          </div>
          {!studio && !x.d.discussion.length && (
            <p id="discussion-hint" className="decision-hint">
              只有确定需要修改时才授权。你可以直接审阅范围，无需发送消息来解锁。
            </p>
          )}
        </>
      )}
      {x.d.grant && !begun && (
        <div className="authorized-summary">
          <Status tone="good">具体目标与范围已冻结</Status>
          <p>{x.d.grant.goal}</p>
          <p>
            已有 Skill：{x.d.grant.skill || '不允许修改'} · 基础 v{x.d.grant.base}
            {x.d.grant.allowNew && `；允许新建 ${x.d.grant.allowNew}`}
          </p>
          <Button kind="primary" onClick={() => x.develop(outcome)}>
            <Play size={14} />
            开始已授权的开发
          </Button>
        </div>
      )}
    </>
  );
  const development = (
    <>
      <div className="development-heading">
        <Status tone={active ? 'busy' : phase === 'applied' ? 'good' : phase === 'failed' ? 'bad' : 'neutral'}>
          {{
            developing: 'Agent 正在开发',
            checking: '正在检查候选',
            applied: '能力变更已正式生效',
            failed: '检查失败，旧版保留',
            cancelled: '开发已取消',
            nochange: '调查完成，无需修改',
          }[phase as 'developing'] ?? ''}
        </Status>
        <h2>{x.d.grant?.goal}</h2>
        <p>
          {x.d.grant?.skill
            ? `text-diff · 基础 v${x.d.grant.base} · ${phase === 'applied' ? `当前 v${skill?.version}` : '当前正式版本未改变'}`
            : `新建 ${x.d.grant?.allowNew} · 不修改已有 Skill`}
        </p>
      </div>
      <details className="development-records" open={studio || active}>
        <summary>开发与检查记录</summary>
        <div className="development-events">
          {x.d.devEvents.map((t, i) => (
            <div key={t}>
              <span className={`event-dot ${i === x.d.devEvents.length - 1 && phase === 'failed' ? 'negative' : ''}`}>
                {active && i === x.d.devEvents.length - 1 ? (
                  <span className="live-dot" key="running" />
                ) : i === x.d.devEvents.length - 1 && phase === 'failed' ? (
                  <X size={12} />
                ) : i === x.d.devEvents.length - 1 && phase === 'applied' ? (
                  <Check size={12} />
                ) : (
                  <span className="record-point" key="recorded" />
                )}
              </span>
              <div>
                <strong>{t}</strong>
                <small>
                  {i === 0
                    ? '用户授权记录'
                    : i === 1
                      ? 'Agent 实际观察'
                      : i === 2
                        ? '验证记录'
                        : phase === 'applied'
                          ? '生效结果'
                          : phase === 'failed'
                            ? '检查结果'
                            : '活动结果'}
                </small>
              </div>
            </div>
          ))}
        </div>
      </details>
      {phase === 'failed' && (
        <Notice title="候选没有替换正式版本" tone="bad">
          示例中的 Tool 名称与已加载工具冲突。可以查看检查记录，再讨论新的目标；不会自动重放开发。
        </Notice>
      )}
      {phase === 'cancelled' && (
        <Notice title="不继续执行，也不自动重放">取消不逆转已经发生的本机副作用；已有证据和知识保留。</Notice>
      )}
      {phase === 'nochange' && (
        <Notice title="没有产生新版本">
          调查认为现有工具足够，只需在任务中补齐材料。{studio ? '无代码成果是允许的结果。' : '当前能力版本保持不变。'}
        </Notice>
      )}
      {phase === 'applied' && x.d.grant?.skill && (
        <Diff
          before={skill?.snapshots?.[x.d.grant.base]?.content ?? ''}
          after={skill?.content ?? ''}
          file="text-diff / SKILL.md"
        />
      )}
      {phase === 'applied' && x.d.grant?.allowNew && (
        <Notice tone="good" title={`新能力 ${x.d.grant.allowNew} 已生效`}>
          在能力库查看完整指引与当前版本。
        </Notice>
      )}
      <div className="inline-actions">
        {active ? (
          <Button
            kind="danger"
            onClick={() => x.patch({ phase: 'cancelled', devEvents: [...x.d.devEvents, '用户取消；未提交候选'] })}
          >
            <X size={14} />
            取消开发
          </Button>
        ) : (
          <Button onClick={() => x.go('skills')}>
            查看能力与版本 <ArrowUpRight size={14} />
          </Button>
        )}
        <Button kind="ghost" onClick={() => R(true)}>
          授权与检查原始记录
        </Button>
      </div>
    </>
  );
  const grantError = !goal.trim()
    ? '请填写本次授权的具体目标。'
    : !allowed && !newSkill.trim()
      ? '请选择已有 Skill，或填写允许新建的 Skill。'
      : newSkill && x.d.skills.some((s) => s.name === newSkill)
        ? '已有同名 Skill，请使用不同名称。'
        : '';
  const grantActions = (
    <div className="grant-footer">
      <Button onClick={() => G(false)}>返回讨论</Button>
      <Button kind="primary" disabled={!!grantError} onClick={approve}>
        批准这个目标与范围
      </Button>
    </div>
  );
  const grantContent = (
    <div className="grant-layout">
      {studio && (
        <div className="grant-reason">
          <div className="eyebrow">你正在作出什么决定</div>
          <h2>
            {studio ? (
              <>
                允许 Agent 为这个目标
                <br />
                修改能力
              </>
            ) : (
              '审阅开发授权'
            )}
          </h2>
          <p>授权后，Agent 自主调查、开发和测试。通过必要检查后自动生效，无需再次发布审批。</p>
          <dl>
            <dt>来源建议</dt>
            <dd>{studio ? '让差异报告说明证据缺口' : '材料缺失，需要修改比较技能吗？'}</dd>
            <dt>讨论摘要</dt>
            <dd>{x.d.discussion.at(-1) ?? '尚未发送讨论内容'}</dd>
            <dt>版本基础</dt>
            <dd>text-diff · v{skill?.version}</dd>
          </dl>
          {studio && (
            <>
              {' '}
              <div className="grant-permission">
                <Shield size={20} />
                <strong>使用本机用户权限</strong>
                <p>开发 Shell 与加载的 Extension 具有当前用户 / Host 权限。文件范围和候选检查不构成操作系统沙箱。</p>
                <p>取消和版本回退不能撤销已发生的外部副作用。</p>
              </div>
            </>
          )}
        </div>
      )}
      <div className="grant-form">
        {!studio && (
          <div className="grant-context">
            <span>
              已有 Skill <code>text-diff</code> · 基础 v{skill?.version}
            </span>
            <details>
              <summary>来源建议与讨论摘要</summary>
              <dl>
                <dt>来源建议</dt>
                <dd>{studio ? '让差异报告说明证据缺口' : '材料缺失，需要修改比较技能吗？'}</dd>
                <dt>讨论摘要</dt>
                <dd>{x.d.discussion.at(-1) ?? '未发送讨论消息'}</dd>
              </dl>
            </details>
          </div>
        )}
        <Field label="批准的具体目标" error={!studio && !goal.trim() ? '请填写本次授权的具体目标。' : undefined}>
          <textarea aria-label="授权目标" value={goal} onChange={(e) => V(e.target.value)} />
        </Field>
        <fieldset>
          <legend>允许修改的能力范围</legend>
          <label className="check-row">
            <input type="checkbox" checked={allowed} onChange={(e) => A(e.target.checked)} />
            <span>
              <strong>text-diff</strong>
              <small>已有 Skill · 当前 v{skill?.version} · 报告指引与所属文件</small>
            </span>
          </label>
          <Field
            label="允许新建的 Skill"
            hint="留空则不允许新建。名称会写入这次授权。"
            error={
              !studio && newSkill && x.d.skills.some((s) => s.name === newSkill)
                ? '已有同名 Skill，请使用不同名称。'
                : undefined
            }
          >
            <input value={newSkill} onChange={(e) => N(e.target.value)} placeholder="例如：document-coverage" />
          </Field>
        </fieldset>
        {!studio && (
          <>
            {' '}
            <div className="grant-permission">
              <Shield size={20} />
              <strong>使用本机用户权限</strong>
              <p>开发 Shell 与加载的 Extension 具有当前用户 / Host 权限。文件范围和候选检查不构成操作系统沙箱。</p>
              <p>取消和版本回退不能撤销已发生的外部副作用。</p>
            </div>
          </>
        )}
        <div className="grant-conditions">
          <Check size={15} />
          <p>候选须完成 Agent 自测和 Host 必要检查；失败继续使用旧版。授权本身不表示验证通过。</p>
        </div>

        {!studio && !allowed && !newSkill.trim() && (
          <p className="field-error" role="alert">
            请选择已有 Skill，或填写允许新建的 Skill。
          </p>
        )}
        {!studio && <p className="grant-effect">批准后开始自主开发；必要检查通过后自动生效，无需再次发布审批。</p>}
        {studio && grantActions}
      </div>
    </div>
  );
  if (grant && studio)
    return (
      <div className="evolution-page full-grant">
        <Button kind="ghost" onClick={() => G(false)}>
          <ArrowLeft size={14} />
          返回目标讨论
        </Button>
        <SectionTitle
          eyebrow="能力活动 / 具体目标授权"
          title="审阅这次开发决定"
          description="这份授权仅覆盖下面的目标与范围。"
        />
        <div className="inline-grant">{grantContent}</div>
      </div>
    );
  return (
    <StateGate
      emptyAction={
        <Button
          onClick={() => {
            x.setScenario('normal');
            begin();
          }}
        >
          讨论一个改进目标
        </Button>
      }
    >
      <div className="evolution-page">
        <SectionTitle
          eyebrow="能力成长 / Evolution"
          title={studio ? '能力活动' : '改进建议'}
          description={
            studio ? '建议可以讨论，开发需要你明确授权。' : '查看 Agent 对现有技能的改进建议，决定是否继续讨论。'
          }
        />
        {!begun && phase === 'suggestion' && <TabBar items={['待决定', '已处理']} value={tab} onChange={T} />}
        {phase === 'suggestion' ? (
          (ignored && tab !== '已处理') || (!ignored && tab === '已处理') ? (
            <div className="state-view">
              <Check size={24} />
              <h2>{tab === '已处理' ? '还没有已处理的建议' : '没有待决定的建议'}</h2>
              <p>
                {studio
                  ? '不为制造成长感而增加无依据的建议。'
                  : tab === '已处理'
                    ? '处理后的建议会保留在这里。'
                    : '已忽略的建议可以在已处理中恢复。'}
              </p>
              <Button onClick={() => T(tab === '已处理' ? '待决定' : '已处理')}>
                查看{tab === '已处理' ? '待决定' : '已处理'}
              </Button>
            </div>
          ) : (
            <div className={studio ? 'suggestion-workspace' : 'suggestion-reading'}>
              {studio && (
                <aside className="suggestion-queue">
                  <span className="eyebrow">建议队列</span>
                  <div className="queue-selected">
                    <small>text-diff · 行为指引</small>
                    <strong>让差异报告说明证据缺口</strong>
                    <span>来自今天的反思</span>
                  </div>
                </aside>
              )}
              <article className="suggestion-document">
                {ignored ? (
                  <>
                    <Status tone="neutral">已忽略</Status>
                    <h2>{studio ? '让差异报告说明证据缺口' : '材料缺失，需要修改比较技能吗？'}</h2>
                    {!studio && (
                      <p className="suggestion-lead">文档比较技能 · 报告指引。这条建议已忽略，没有授予开发权限。</p>
                    )}
                    <Button
                      onClick={() => {
                        IG(false);
                        T('待决定');
                      }}
                    >
                      恢复为待决定
                    </Button>
                  </>
                ) : (
                  suggestion
                )}
              </article>
            </div>
          )
        ) : (
          <div className={studio ? 'activity-workspace' : 'activity-reading'}>
            {studio && (
              <aside className="activity-outline">
                <span className="eyebrow">这次活动</span>
                {['目标讨论', '具体授权', '自主开发', '检查与生效'].map((s, i) => (
                  <div key={s} className={i === 0 || (x.d.grant && i === 1) || (begun && i > 1) ? 'complete' : ''}>
                    <span>{i + 1}</span>
                    {s}
                  </div>
                ))}
                <small>步骤是已发生的记录，不能点击跳过授权。</small>
              </aside>
            )}
            <article className="activity-main">{begun ? development : discussionUI}</article>
            {studio && (
              <aside className="activity-context">
                <FileText size={18} />
                <span className="eyebrow">目标背景</span>
                <p>材料覆盖不全时，报告需要明确结论边界。</p>
                <button type="button" className="text-link" onClick={() => x.go('reflection')}>
                  打开关联反思 <ArrowUpRight size={12} />
                </button>
              </aside>
            )}
          </div>
        )}
        <Modal
          open={grant}
          onClose={() => G(false)}
          title="开发授权"
          description="审阅目标、范围与本机权限后再决定。"
          wide
          className={!studio ? 'grant-dialog' : ''}
          footer={!studio ? grantActions : undefined}
        >
          {grantContent}
        </Modal>
        <Modal open={raw} onClose={() => R(false)} title="授权与检查记录" drawer>
          <Evidence
            value={{
              grant: x.d.grant,
              events: x.d.devEvents,
              status: phase,
              authority: 'specific_user_goal',
              publish: phase === 'applied' ? 'automatically_applied' : 'unchanged',
            }}
          />
        </Modal>
      </div>
    </StateGate>
  );
}
