import { useState, useEffect } from 'react';
import { BookOpen, ArrowUpRight, Pencil, Plus, Clock, ArrowLeft, MoreHorizontal } from 'lucide-react';
import { useDemo } from '../state/store';
import type { Knowledge } from '../state/model';
import {
  Button,
  SectionTitle,
  SearchBox,
  EmptySearch,
  Status,
  Modal,
  Field,
  Notice,
  TabBar,
  Menu,
  StateGate,
} from '../components/ui';
import { Diff, Evidence } from '../components/content';
export function Memory() {
  const x = useDemo();
  const id = x.objects.memory;
  const I = (v: string) => x.setObject('memory', v);
  const [query, Q] = useState('');
  const [scope, S] = useState('全部');
  const [revision, R] = useState(-1);
  const [tab, T] = useState('当前认识');
  const [edit, E] = useState(false);
  const [text, V] = useState('');
  const [reason, B] = useState('');
  const [base, BS] = useState(0);
  const [conflict, C] = useState(false);
  const [source, SO] = useState(false);
  const [add, A] = useState(false);
  const [title, TT] = useState('');
  const [mobile, M] = useState(false);
  const [saved, setSaved] = useState<{ id: string; revision: number } | null>(null);
  useEffect(() => {
    if (x.focusRequest.type === 'memory') M(true);
  }, [x.focusRequest]);
  const [scopeEdit, SE] = useState(false);
  const [newScope, NS] = useState<'项目' | '全局'>('项目');
  const m = x.d.memories.find((v) => v.id === id) ?? x.d.memories[0];
  const current = m.revisions.length - 1;
  const selected = tab === '当前认识' || revision < 0 ? current : Math.min(revision, current);
  const rev = m.revisions[selected];
  const list = x.d.memories.filter(
    (m) =>
      m.status !== 'deleted' &&
      (scope === '全部' || scope === '历史' ? scope !== '历史' || m.status === 'revoked' : m.scope === scope) &&
      m.title.includes(query),
  );
  const select = (m: Knowledge) => {
    I(m.id);
    R(-1);
    T('当前认识');
    M(true);
    if (x.mode === 'studio' && innerWidth > 700)
      requestAnimationFrame(() => document.querySelector('.register-reading')?.scrollIntoView({ block: 'start' }));
  };
  const openEdit = () => {
    V(m.revisions[current].text);
    B('');
    BS(current);
    C(x.mode === 'quiet' && x.memoryConflict);
    x.setMemoryConflict(false);
    E(true);
  };
  const save = () => {
    if (conflict || base !== current) {
      C(true);
      return;
    }
    x.mutate((s) => ({
      ...s,
      memories: s.memories.map((k) =>
        k.id === m.id ? { ...k, revisions: [...k.revisions, { text, reason, author: '用户', date: '刚刚' }] } : k,
      ),
    }));
    E(false);
    R(-1);
    setSaved({ id: m.id, revision: current + 2 });
    x.notify('修正已保存，旧修订仍可追溯。');
  };
  const listUI = (
    <>
      <div className="memory-index-head">
        <span className="eyebrow">知识索引</span>
        <SearchBox value={query} onChange={Q} placeholder="查找认识" />
      </div>
      <div className="scope-filter">
        {['全部', '项目', '全局', '历史'].map((s) => (
          <button type="button" key={s} aria-pressed={scope === s} onClick={() => S(s)}>
            {s}
          </button>
        ))}
      </div>
      {list.length ? (
        list.map((k) => (
          <button
            type="button"
            className={`knowledge-item ${id === k.id ? 'selected' : ''}`}
            key={k.id}
            onClick={() => select(k)}
          >
            <span className={`knowledge-kind ${k.kind === '怀疑' ? 'uncertain' : ''}`}>{k.kind}</span>
            <strong>{k.title}</strong>
            <small>
              {k.scope} · {k.status === 'revoked' ? '已撤销' : `${k.revisions.length} 次修订`}
            </small>
          </button>
        ))
      ) : (
        <EmptySearch />
      )}
    </>
  );
  const detail = (
    <>
      {x.mode === 'studio' && (
        <Button
          kind="ghost"
          className="directory-return"
          onClick={() => {
            M(false);
            document.querySelector('.register-controls')?.scrollIntoView({ block: 'start' });
          }}
        >
          返回认识目录
        </Button>
      )}
      <div className="memory-detail-head">
        <div>
          <div className="eyebrow">
            {m.scope}认识 / {m.kind}
          </div>
          <h2>{m.title}</h2>
        </div>
        <div className="inline-actions">
          <Button kind="ghost" onClick={openEdit}>
            <Pencil size={14} />
            {x.mode === 'quiet' ? '编辑当前版本' : '修正'}
          </Button>
          <Menu
            label="管理这条记忆"
            items={[
              {
                label: '调整作用域',
                onSelect: () => {
                  NS(m.scope);
                  SE(true);
                },
              },
              {
                label: '删除当前记忆',
                onSelect: () => {
                  x.mutate((s) => ({
                    ...s,
                    memories: s.memories.map((k) => (k.id === m.id ? { ...k, status: 'deleted' } : k)),
                  }));
                  I(x.d.memories.find((k) => k.id !== m.id && k.status === 'current')?.id ?? 'report');
                  x.notify('已从当前检索删除；历史记录保留。');
                },
                danger: true,
              },
            ]}
          >
            <MoreHorizontal size={16} />
          </Menu>
        </div>
      </div>
      <TabBar items={['当前认识', '修订比较']} value={tab} onChange={T} />
      {x.mode === 'quiet' && (
        <div className="revision-context" key={`${m.id}:${selected}`} aria-live="polite">
          <div>
            <strong>{selected === current ? '当前版本' : '历史修订 · 只读'}</strong>
            <span>
              修订 {selected + 1} · {rev.date}
            </span>
          </div>
          <span>
            {tab === '修订比较'
              ? selected > 0
                ? `比较方向：修订 ${selected} → ${selected + 1}`
                : '首个修订 · 无前序版本'
              : `${m.revisions.length} 次修订`}
          </span>
          {saved?.id === m.id && saved.revision === current + 1 && (
            <span className="revision-saved">已保存修订 {saved.revision}</span>
          )}
        </div>
      )}
      {m.status === 'revoked' && (
        <Notice tone="warn" title="这项决定已撤销">
          来源分支已改变，不再作为当前决定；历史仍保留，切回分支不会自动恢复。
        </Notice>
      )}
      {tab === '当前认识' ? (
        <>
          <div className="knowledge-current">
            <div className="knowledge-state" hidden={x.mode === 'quiet'}>
              <Status tone={m.status === 'current' ? 'good' : 'warn'}>
                {m.status === 'current' ? '当前有效' : '不再适用'}
              </Status>
              <span>
                修订 {current + 1} · {m.revisions[current].date}
              </span>
            </div>
            <p>
              {m.revisions[current].text}
              {x.scenario === 'long' && '项目文件可能具有很长的路径；认识需要保留适用范围和来源。'.repeat(16)}
            </p>
          </div>
          <div className="knowledge-reason">
            <span className="eyebrow">{x.mode === 'quiet' ? '修订原因' : '形成这项认识的依据'}</span>
            <p>{m.revisions[current].reason}</p>
            <button type="button" className="source-inline" onClick={() => SO(true)}>
              <BookOpen size={15} />
              {m.revisions[current].author === '用户' ? '用户补充' : '比较两版项目说明'}{' '}
              <span>来源修订 {current + 1}</span>
              <ArrowUpRight size={13} />
            </button>
          </div>
          <div className="knowledge-use" hidden={x.mode === 'quiet' && m.status === 'current' && m.kind !== '怀疑'}>
            <h3>在后续工作中如何使用</h3>
            <p>
              {m.kind === '怀疑'
                ? '作为待核实的问题保留，不能当作确定事实。'
                : m.status === 'revoked'
                  ? '只作为历史背景，不再用于当前任务判断。'
                  : 'Agent 根据任务按需检索；这项认识不授予执行权限，也不会自动作为每轮指令。'}
            </p>
          </div>
        </>
      ) : (
        <div className="revision-workspace">
          <div className="revision-selector">
            <label>
              选择修订
              <select value={selected} onChange={(e) => R(Number(e.target.value))}>
                {m.revisions.map((r, i) => (
                  <option key={r.date} value={i}>
                    修订 {i + 1} · {r.date}
                    {i === current ? ' · 当前' : ''}
                  </option>
                ))}
              </select>
            </label>
            <span>{selected === current ? '当前修订' : '历史修订 · 只读'}</span>
          </div>
          <p>{rev.reason}</p>
          {selected > 0 ? (
            <Diff
              before={m.revisions[selected - 1].text}
              after={rev.text}
              file={`认识修订 ${selected} → ${selected + 1}`}
            />
          ) : (
            <div className="knowledge-current">
              <p>{rev.text}</p>
              <small>这是第一条保存的认识，没有更早的修订可比较。</small>
            </div>
          )}
          <button type="button" className="source-inline" onClick={() => SO(true)}>
            查看此修订的来源 <ArrowUpRight size={13} />
          </button>
          <div className="revision-history">
            {m.revisions.map((r, i) => (
              <button
                type="button"
                key={`${i}-${r.date}`}
                className={selected === i ? 'selected' : ''}
                aria-pressed={selected === i}
                onClick={() => R(i)}
              >
                <Clock size={14} />
                <span>
                  修订 {i + 1}
                  <small>{r.reason}</small>
                </span>
                <time>{r.date}</time>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
  return (
    <StateGate
      emptyAction={
        <Button
          onClick={() => {
            x.setScenario('normal');
            A(true);
          }}
        >
          补充认识
        </Button>
      }
    >
      <div className={`memory-page ${mobile ? 'object-open' : ''}`}>
        <SectionTitle
          eyebrow="长期积累 / Memory"
          title={x.mode === 'studio' ? '认识登记册' : '记忆'}
          description={
            x.mode === 'studio'
              ? '认识会随证据修正。当前状态与每一次历史修订分别保留。'
              : 'Agent 会记住的事实、偏好与经验。查看依据，或修正不再准确的内容。'
          }
          action={
            <Button onClick={() => A(true)}>
              <Plus size={15} />
              补充认识
            </Button>
          }
        />
        {x.mode === 'quiet' ? (
          <div className="knowledge-library">
            <section className="memory-index">{listUI}</section>
            <section className="memory-detail">
              <Button kind="ghost" className="mobile-back" onClick={() => M(false)}>
                <ArrowLeft size={14} />
                知识索引
              </Button>
              {detail}
            </section>
          </div>
        ) : (
          <>
            <div className="register-controls">
              <SearchBox value={query} onChange={Q} placeholder="查找认识" />
              <div className="scope-filter">
                {['全部', '项目', '全局', '历史'].map((s) => (
                  <button type="button" key={s} aria-pressed={scope === s} onClick={() => S(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="knowledge-register table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>认识</th>
                    <th>性质</th>
                    <th>范围</th>
                    <th>状态 / 修订</th>
                    <th>最近修正</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((k) => (
                    <tr key={k.id} className={id === k.id ? 'selected' : ''}>
                      <td>
                        <button type="button" onClick={() => select(k)}>
                          {k.title}
                        </button>
                      </td>
                      <td>{k.kind}</td>
                      <td>{k.scope}</td>
                      <td>{k.status === 'revoked' ? '已撤销' : `当前 · r${k.revisions.length}`}</td>
                      <td>{k.revisions.at(-1)?.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="register-reading">
              <div className="register-outline">
                <span className="eyebrow">选中认识</span>
                <p>阅读当前状态，或比较修订。</p>
                <small>不因新的认识覆盖历史依据。</small>
              </div>
              <section className="memory-detail">
                <Button kind="ghost" className="mobile-back" onClick={() => M(false)}>
                  <ArrowLeft size={14} />
                  返回登记册
                </Button>
                {detail}
              </section>
            </div>
          </>
        )}
        <Modal
          open={edit}
          onClose={() => E(false)}
          title={x.mode === 'quiet' ? '编辑当前版本' : '修正这项认识'}
          description="保存为新修订，保留之前的内容与来源。"
        >
          <Field
            label="当前内容"
            hint={x.mode === 'quiet' ? `基于修订 ${base + 1}；保存后追加新修订，历史内容不变。` : undefined}
          >
            <textarea value={text} onChange={(e) => V(e.target.value)} />
          </Field>
          <Field label="修正理由" hint={x.mode === 'quiet' ? '说明这次修改的依据。' : undefined}>
            <input value={reason} onChange={(e) => B(e.target.value)} placeholder="哪些新依据改变了原来的判断？" />
          </Field>
          {conflict && (
            <Notice title={x.mode === 'quiet' ? '版本冲突：请先核对最新修订' : '这条认识已被另一处更新'} tone="warn">
              你的文字保留在编辑框中。先读取最新修订，再决定如何合并。
              {x.mode === 'quiet' && (
                <Diff before={m.revisions[current].text} after={text} file="已保存内容 → 我的草稿" />
              )}
              <Button
                kind="ghost"
                onClick={() => {
                  C(false);
                  BS(current);
                  B(`${reason}（已核对最新修订）`);
                }}
              >
                已核对最新修订
              </Button>
            </Notice>
          )}
          <div className="modal-footer">
            {x.mode === 'studio' && (
              <Button kind="ghost" onClick={() => C(true)}>
                模拟编辑冲突
              </Button>
            )}
            <Button kind="primary" disabled={!text.trim() || !reason.trim() || conflict} onClick={save}>
              保存新修订
            </Button>
          </div>
        </Modal>
        <Modal open={add} onClose={() => A(false)} title="补充一项认识">
          <Field label="标题">
            <input value={title} onChange={(e) => TT(e.target.value)} />
          </Field>
          <Field label="内容">
            <textarea value={text} onChange={(e) => V(e.target.value)} />
          </Field>
          <Field label="适用范围">
            <select value={newScope} onChange={(e) => NS(e.target.value as '项目' | '全局')}>
              <option>项目</option>
              <option>全局</option>
            </select>
          </Field>
          <div className="modal-footer">
            <Button
              kind="primary"
              disabled={!title.trim() || !text.trim()}
              onClick={() => {
                const key = `m-${Date.now()}`;
                x.mutate((s) => ({
                  ...s,
                  memories: [
                    ...s.memories,
                    {
                      id: key,
                      title,
                      kind: '事实',
                      scope: newScope,
                      status: 'current',
                      revisions: [{ text, reason: '用户补充', date: '刚刚', author: '用户' }],
                    },
                  ],
                }));
                I(key);
                A(false);
                TT('');
                V('');
              }}
            >
              保存认识
            </Button>
          </div>
        </Modal>
        <Modal open={scopeEdit} onClose={() => SE(false)} title="调整适用范围">
          <Field label="适用范围">
            <select value={newScope} onChange={(e) => NS(e.target.value as '项目' | '全局')}>
              <option>项目</option>
              <option>全局</option>
            </select>
          </Field>
          <Notice title="范围扩大不公开原项目历史">
            改为全局仅调整当前认识的适用范围；原项目的历史和来源仍按原权限查看。
          </Notice>
          <div className="modal-footer">
            <Button
              kind="primary"
              onClick={() => {
                x.mutate((s) => ({
                  ...s,
                  memories: s.memories.map((k) => (k.id === id ? { ...k, scope: newScope } : k)),
                }));
                SE(false);
              }}
            >
              确认范围
            </Button>
          </div>
        </Modal>
        <Modal open={source} onClose={() => SO(false)} title="这项认识的来源" drawer>
          <p className="lead">{rev.author === '用户' ? '用户补充或修正' : rev.reason}</p>
          {x.mode === 'quiet' && (
            <dl className="source-facts">
              <dt>来源记录</dt>
              <dd>{rev.author === '用户' ? '用户输入，未关联会话' : '比较两版项目说明'}</dd>
              <dt>对应版本</dt>
              <dd>
                修订 {selected + 1} · {rev.date}
              </dd>
              <dt>分支</dt>
              <dd>{m.status === 'revoked' ? '旧分支 · 决定已撤销' : '当前分支'}</dd>
              <dt>修订原因</dt>
              <dd>{rev.reason}</dd>
            </dl>
          )}
          <details className="source-record" open={x.mode === 'studio'}>
            <summary>查看原始来源记录</summary>
            <Evidence
              value={{
                memory: m.id,
                revision: selected + 1,
                source: {
                  session: rev.author === '用户' ? '用户输入，未关联会话' : '比较两版项目说明',
                  branch: m.status === 'revoked' ? '旧分支' : '当前分支',
                  entry: m.title,
                },
                reason: rev.reason,
              }}
              incomplete={m.status === 'revoked'}
            />
          </details>
          {x.mode === 'quiet' && rev.author === '用户' && (
            <p className="source-unavailable">此修订来自用户输入，没有可进入的来源会话。</p>
          )}
          <Button
            disabled={rev.author === '用户'}
            onClick={() => {
              SO(false);
              x.setSid('compare');
              x.go('trace');
            }}
          >
            进入来源会话的轨迹
          </Button>
        </Modal>
      </div>
    </StateGate>
  );
}
