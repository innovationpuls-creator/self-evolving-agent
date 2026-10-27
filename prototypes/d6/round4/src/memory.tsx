import { useState } from 'react';
import { motion } from 'motion/react';
import { Diff } from '../../src/components/content';
import { Node, Panel } from './ui';
const seed = [
  {
    text: '默认以表格汇总文档差异。',
    reason: '首次比较形成的报告习惯',
    source: 'Session · 整理发布说明',
    date: '10月20日',
  },
  {
    text: '默认以表格汇总差异，并单列尚未核实的内容。不要把材料缺失推断为没有变化。',
    reason: '兼容附件缺失，结论需要明确覆盖边界。',
    source: 'Session · 项目说明比较',
    date: '10月23日',
  },
];
export function Memory() {
  const [revs, R] = useState(seed),
    [selected, S] = useState(1),
    [edit, E] = useState(false),
    [draft, D] = useState(''),
    [reason, Q] = useState(''),
    [conflict, C] = useState(false),
    [source, O] = useState(false),
    [availability, V] = useState('可访问');
  const rev = revs[selected];
  return (
    <section className="memory">
      <div className="page-heading">
        <div>
          <small>Memory / 全局经验</small>
          <h1>差异报告规范</h1>
        </div>
        <button
          type="button"
          onClick={() => {
            D(revs.at(-1)?.text ?? '');
            E(true);
          }}
        >
          修订认识 ↗
        </button>
      </div>
      <div className="memory-layout">
        <div className="revision-rail">
          <small>修订记录</small>
          {revs.map((r, i) => (
            <button
              type="button"
              key={`${i}-${r.date}`}
              className={i === selected ? 'selected' : ''}
              onClick={() => S(i)}
            >
              <Node selected={selected === i} />
              <span>
                v{i + 1} {i === revs.length - 1 ? '· 当前' : ''}
                <small>{r.date}</small>
              </span>
            </button>
          ))}
        </div>
        <div>
          <motion.div
            key={selected}
            initial={{ opacity: 0.4 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.22 }}
          >
            <div className="eyebrow">
              {selected === revs.length - 1 ? '当前认识' : '历史修订'} · v{selected + 1}
            </div>
            <p className="knowledge reading">{rev.text}</p>
            <div className="reason">
              <span>修订原因</span>
              <p>{rev.reason}</p>
            </div>
            <button type="button" className="source-link" onClick={() => O(true)}>
              {rev.source} ↗
            </button>
          </motion.div>
          {selected > 0 && (
            <div className="comparison">
              <h2>与上一版本的差异</h2>
              <Diff before={revs[selected - 1].text} after={rev.text} file={`Memory v${selected} → v${selected + 1}`} />
            </div>
          )}
          {edit && (
            <div className="editor">
              <h2>保存新的修订</h2>
              <label>
                认识正文
                <textarea value={draft} onChange={(e) => D(e.target.value)} />
              </label>
              <label>
                修改理由
                <input value={reason} onChange={(e) => Q(e.target.value)} />
              </label>
              <label className="inline">
                <input type="checkbox" checked={conflict} onChange={(e) => C(e.target.checked)} />
                演示：保存时已有更新
              </label>
              {conflict && (
                <div role="alert" className="conflict-notice">
                  <strong>版本冲突</strong>
                  <p>保存已阻止。当前版本与草稿对比如下，核对后解除演示冲突。</p>
                  <Diff before={revs.at(-1)?.text ?? ''} after={draft} />
                </div>
              )}
              <button
                type="button"
                className="primary"
                disabled={!draft.trim() || !reason.trim() || conflict}
                onClick={() => {
                  R([...revs, { text: draft, reason, source: '用户修订 · 当前编辑', date: '刚刚' }]);
                  S(revs.length);
                  E(false);
                  C(false);
                }}
              >
                保存修订
              </button>
              <button type="button" onClick={() => E(false)}>
                取消
              </button>
            </div>
          )}
        </div>
      </div>
      <Panel title={`来源 · 修订 v${selected + 1}`} open={source} close={() => O(false)} drawer>
        <select aria-label="来源可用性" value={availability} onChange={(e) => V(e.target.value)}>
          {['可访问', '来源缺失', '来源已撤销', '无访问权限'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <h2>{rev.source}</h2>
        {availability === '可访问' ? (
          <>
            <p className="reading">{rev.reason}</p>
            <p className="record-caption">历史来源只读。</p>
            <code>memory/report/revision/{selected + 1}</code>
          </>
        ) : (
          <p role="alert">{availability}。保留来源引用，当前不能查看完整内容。</p>
        )}
      </Panel>
    </section>
  );
}
