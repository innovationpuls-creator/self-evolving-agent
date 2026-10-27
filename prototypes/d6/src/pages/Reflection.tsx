import { useState, useEffect, useRef } from 'react';
import { ArrowUpRight, Check, Minus, AlertTriangle, Clock, ArrowLeft } from 'lucide-react';
import { useDemo } from '../state/store';
import { Button, SectionTitle, TabBar, Status, Notice, Modal, StateGate } from '../components/ui';
import { Evidence } from '../components/content';
const records = [
  {
    id: 'finding',
    date: '今天 14:33',
    title: '材料缺失，不能推断为没有变化',
    source: '比较两版项目说明',
    type: '形成发现',
  },
  { id: 'none', date: '昨天 17:08', title: '没有需要保留的新发现', source: '整理版本发布说明', type: '无新发现' },
  { id: 'unavailable', date: '10月20日 16:40', title: '反思未能启动', source: '整理项目结构', type: '环境不可用' },
];
export function Reflection() {
  const x = useDemo();
  const id = x.objects.reflection;
  const I = (v: string) => x.setObject('reflection', v);
  const [filter, F] = useState('全部记录');
  const [source, S] = useState(false);
  const [mobile, M] = useState(false);
  const listRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (x.mode === 'quiet' && x.page === 'reflection' && mobile) detailRef.current?.focus({ preventScroll: true });
  }, [mobile, id, x.mode, x.page]);
  const returnToList = () => {
    M(false);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>('.selected')?.focus());
  };
  useEffect(() => {
    if (x.focusRequest.type === 'reflection') M(true);
  }, [x.focusRequest]);
  const [recheck, R] = useState(false);
  const record = records.find((r) => r.id === id) ?? records[0];
  const studio = x.mode === 'studio';
  const detail = (
    <>
      <div className="reflection-source">
        <span className="eyebrow">{record.source}</span>
        <time>{record.date}</time>
      </div>
      {id === 'finding' ? (
        <>
          <h2 className="reflection-conclusion">{record.title}</h2>
          <p className="reflection-standfirst">
            {studio
              ? '正文比较已经完成，但兼容附件没有读取成功。报告需要清楚分开已确认的变化与仍待核实的承诺。'
              : '这次审查修正了报告经验，并提出一项尚未授权的能力建议。'}
            {x.scenario === 'long' && '判断需要与直接证据相联系。'.repeat(18)}
          </p>
          {!studio && (
            <div className="reflection-change">
              <span>认识已修正</span>
              <del>默认以表格汇总文档差异。</del>
              <p>汇总差异，并单列尚未核实的内容。</p>
            </div>
          )}
          <div className="reflection-sections">
            <section>
              <div className="finding-label">
                <Check size={16} />
                观察到了什么
              </div>
              <p>两份正文明确描述了设备授权和加密备份；没有证据证明旧客户端支持范围维持不变。</p>
              <button type="button" className="text-link" onClick={() => S(true)}>
                查看执行依据 <ArrowUpRight size={12} />
              </button>
            </section>
            <section className="uncertainty">
              <div className="finding-label">
                <AlertTriangle size={16} />
                仍然不确定
              </div>
              <p>兼容附件可能说明迁移期支持方式，也可能已过时。需要拿到材料才能确认，不提高结论的确定性。</p>
            </section>
          </div>
          <div className="reflection-outcomes">
            <span className="eyebrow">这次反思带来的变化</span>
            <button
              type="button"
              onClick={() => {
                x.setObject('memory', 'report');
                x.go('memory');
              }}
            >
              <span className="change-marker">修正</span>
              <span>
                <strong>差异报告应单列未核实内容</strong>
                <small>通用经验 · 由修订1更新为修订2</small>
              </span>
              <ArrowUpRight size={15} />
            </button>
            <button type="button" onClick={() => x.go('evolution')}>
              <span className="change-marker">建议</span>
              <span>
                <strong>完善 text-diff 的报告指引</strong>
                <small>尚未授权 · 可以先讨论是否值得修改</small>
              </span>
              <ArrowUpRight size={15} />
            </button>
          </div>
          <div className="reflection-boundary" hidden={!studio}>
            反思审查结果与依据，不展示模型内部推理过程，也不获得开发权限。
          </div>
        </>
      ) : id === 'none' ? (
        <div className="no-finding">
          <span className="quiet-symbol">
            <Minus size={22} />
          </span>
          <h2>没有需要保留的新发现</h2>
          <p>这次记录未形成新的认识，也没有建议修改能力。</p>
          <dl hidden={!studio}>
            <dt>审查对象</dt>
            <dd>发布说明整理后的执行记录</dd>
            <dt>知识变化</dt>
            <dd>无</dd>
            <dt>能力建议</dt>
            <dd>无</dd>
          </dl>
          <Button kind="ghost" onClick={() => S(true)}>
            查看本次记录
          </Button>
        </div>
      ) : (
        <>
          <h2>反思未能启动</h2>
          <Notice tone="warn" title="受限执行环境不可用">
            没有运行反思，也没有产生知识或建议。不会退回普通执行环境运行。
          </Notice>
          <p>原任务和执行证据仍保留。可先检查环境，再明确重新发起。</p>
          <Button onClick={() => R(true)}>检查恢复条件</Button>
        </>
      )}
      <div className="reflection-bottom">
        <Button
          kind="ghost"
          onClick={() => {
            x.updateSession({ draft: '请根据这次反思的来源重新审查结论，明确还缺少哪些依据。' });
            x.go('chat');
          }}
        >
          在会话中重新审查
        </Button>
      </div>
    </>
  );
  const results = (
    <>
      <div className="result-meta">
        <span>任务完成后的检查</span>
        <time>{record.date}</time>
      </div>
      <h2 ref={detailRef} tabIndex={-1} className="result-task">
        {record.source}
      </h2>
      {id === 'finding' ? (
        <>
          <Status tone="good">已检查 · 有发现</Status>
          <p className="result-summary">正文差异已确认；兼容附件未找到，旧客户端的支持范围仍不能确认。</p>
          {x.scenario === 'long' && <p className="result-summary">{'判断需要与直接证据相联系。'.repeat(18)}</p>}
          <div className="result-facts">
            <Check size={16} />
            <p>两版正文明确描述了设备授权和加密备份。缺失附件不代表旧版支持没有变化。</p>
          </div>
          <section className="result-changes" aria-label="检查产生的结果">
            <h3>本次留下的结果</h3>
            <button
              type="button"
              onClick={() => {
                x.setObject('memory', 'report');
                x.go('memory');
              }}
            >
              <span className="result-kind">记忆已修订</span>
              <span>
                <strong>差异报告应单列未核实内容</strong>
                <small>修订 1 → 修订 2 · 通用经验</small>
              </span>
              <ArrowUpRight size={15} />
            </button>
            <button type="button" onClick={() => x.go('evolution')}>
              <span className="result-kind">改进建议</span>
              <span>
                <strong>材料缺失，需要修改比较技能吗？</strong>
                <small>现有规则已覆盖 · 查看依据后决定</small>
              </span>
              <ArrowUpRight size={15} />
            </button>
          </section>
          <section className="result-unresolved">
            <h3>
              <AlertTriangle size={15} />
              仍待解决
            </h3>
            <p>需要找到兼容附件，才能确认旧客户端在迁移期的支持方式。</p>
          </section>
          <details className="result-revision">
            <summary>查看记忆修订摘要</summary>
            <del>默认以表格汇总文档差异。</del>
            <p>汇总差异，并单列尚未核实的内容。</p>
          </details>
        </>
      ) : id === 'none' ? (
        <div className="result-empty">
          <Status tone="neutral">已检查 · 无新发现</Status>
          <h3>没有需要保留的新发现</h3>
          <p>本次检查未更新记忆，也未提出改进建议。没有另外记录待解决的问题。</p>
        </div>
      ) : (
        <div className="result-empty">
          <Status tone="warn">未检查 · 环境不可用</Status>
          <h3>本次检查未能启动</h3>
          <p>受限执行环境不可用。没有更新记忆或提出建议，原任务和执行记录仍保留。</p>
          <Notice tone="warn" title="需要恢复受限执行环境">
            不会改用普通环境执行，也不会自动重新发起。
          </Notice>
          <Button onClick={() => R(true)}>检查恢复条件</Button>
        </div>
      )}
      <div className="result-actions">
        <Button kind="ghost" onClick={() => S(true)}>
          查看执行依据 <ArrowUpRight size={14} />
        </Button>
        <Button
          kind="ghost"
          onClick={() => {
            x.updateSession({ draft: '请根据这次反思的来源重新审查结论，明确还缺少哪些依据。' });
            x.go('chat');
          }}
        >
          在会话中重新审查
        </Button>
      </div>
    </>
  );
  return (
    <StateGate
      emptyAction={
        <Button
          onClick={() => {
            x.setScenario('normal');
            x.go('chat');
          }}
        >
          去完成一项工作
        </Button>
      }
    >
      <div className={`reflection-page ${mobile ? 'object-open' : ''}`}>
        <SectionTitle
          eyebrow="长期积累 / Reflection"
          title={studio ? '反思档案' : '反思记录'}
          description={
            studio
              ? '保留实际发现和认识边界。没有新发现时，安静地留下一条记录。'
              : '查看每项工作结束后的检查结果，以及留下的记忆与改进建议。'
          }
        />
        <TabBar
          items={['全部记录', '有发现', '无新发现']}
          value={filter}
          onChange={(v) => {
            F(v);
            I(v === '无新发现' ? 'none' : 'finding');
          }}
        />
        {studio ? (
          <div className="reflection-ledger">
            <div className="reflection-dates">
              <span className="eyebrow">记录时间</span>
              {records
                .filter(
                  (r) =>
                    filter === '全部记录' ||
                    (filter === '有发现' && r.id === 'finding') ||
                    (filter === '无新发现' && r.id === 'none'),
                )
                .map((r) => (
                  <button
                    type="button"
                    key={r.id}
                    className={id === r.id ? 'selected' : ''}
                    aria-current={!studio && id === r.id ? 'true' : undefined}
                    onClick={() => {
                      I(r.id);
                      M(true);
                    }}
                  >
                    <time>{r.date}</time>
                    <strong>{r.source}</strong>
                    <Status tone={r.id === 'finding' ? 'good' : r.id === 'unavailable' ? 'warn' : 'neutral'}>
                      {r.type}
                    </Status>
                  </button>
                ))}
            </div>
            <article className="reflection-document">
              <Button kind="ghost" className="mobile-back" onClick={() => M(false)}>
                <ArrowLeft size={14} />
                反思目录
              </Button>
              {detail}
            </article>
          </div>
        ) : (
          <div className="reflection-journal">
            <nav className="journal-index" ref={listRef} aria-label="任务检查记录">
              {records
                .filter(
                  (r) =>
                    filter === '全部记录' ||
                    (filter === '有发现' && r.id === 'finding') ||
                    (filter === '无新发现' && r.id === 'none'),
                )
                .map((r) => (
                  <button
                    type="button"
                    key={r.id}
                    className={id === r.id ? 'selected' : ''}
                    aria-current={!studio && id === r.id ? 'true' : undefined}
                    onClick={() => {
                      I(r.id);
                      M(true);
                    }}
                  >
                    <Clock size={14} />
                    <span>
                      <small>{r.date}</small>
                      <strong>{r.source}</strong>
                      <span className={`journal-result ${r.id}`}>
                        {r.id === 'finding'
                          ? '记忆已修订 · 提出改进建议'
                          : r.id === 'none'
                            ? '已检查 · 无新发现'
                            : '未检查 · 环境不可用'}
                      </span>
                      <span className="journal-summary">
                        {r.id === 'finding'
                          ? '兼容范围仍待核实'
                          : r.id === 'none'
                            ? '未更新记忆或提出建议'
                            : '没有产生检查结果'}
                      </span>
                    </span>
                  </button>
                ))}
            </nav>
            <article className="reflection-document">
              <Button kind="ghost" className="mobile-back" onClick={returnToList}>
                <ArrowLeft size={14} />
                返回反思记录
              </Button>
              {results}
            </article>
          </div>
        )}
        <Modal open={source} onClose={() => S(false)} title="反思的依据" drawer>
          {!studio && (
            <div className="result-evidence">
              <h3>{record.source}</h3>
              <p>
                {id === 'finding'
                  ? '正文读取成功，兼容附件未找到。设备授权和加密备份来自正文；旧版支持范围没有充分依据。'
                  : id === 'none'
                    ? '本次检查没有记录新发现、记忆修订或能力建议。'
                    : '检查没有启动，因此没有检查执行结果。'}
              </p>
              {id === 'finding' && (
                <Button
                  onClick={() => {
                    S(false);
                    x.setObject('trace', 'fail');
                    x.go('trace');
                  }}
                >
                  查看附件读取记录 <ArrowUpRight size={14} />
                </Button>
              )}
            </div>
          )}
          {studio ? (
            <Evidence
              value={{
                record: id,
                source: record.source,
                observations: id === 'finding' ? ['正文成功读取', '兼容附件 ENOENT'] : [],
                newKnowledge: id === 'finding' ? '修正报告经验' : null,
                uncertainty: id === 'finding' ? '旧版支持范围未知' : null,
              }}
            />
          ) : (
            <details className="result-raw">
              <summary>原始记录</summary>
              <Evidence
                source={`${record.source} · ${record.date}`}
                value={{
                  record: id,
                  source: record.source,
                  observations: id === 'finding' ? ['正文成功读取', '兼容附件 ENOENT'] : [],
                  newKnowledge: id === 'finding' ? '修正报告经验' : null,
                  uncertainty: id === 'finding' ? '旧版支持范围未知' : null,
                }}
              />
            </details>
          )}
        </Modal>
        <Modal open={recheck} onClose={() => R(false)} title="恢复反思环境">
          <Notice title="受限执行环境需要可用" tone="warn">
            {studio
              ? '正式产品需确认原生隔离服务身份与连接。这里仅展示恢复后的界面，不启动本机服务。'
              : '需要确认原生隔离服务的身份与连接。环境恢复后，仍需明确重新发起检查；原任务不受影响。'}
          </Notice>
          {(studio || new URLSearchParams(location.search).get('test') === '1') && (
            <Button
              kind="primary"
              onClick={() => {
                I('none');
                R(false);
                x.notify('已模拟重新审查：没有需要保留的新发现。');
              }}
            >
              模拟环境恢复并重新审查
            </Button>
          )}
          {!studio && new URLSearchParams(location.search).get('test') !== '1' && (
            <Button onClick={() => R(false)}>关闭</Button>
          )}
        </Modal>
      </div>
    </StateGate>
  );
}
