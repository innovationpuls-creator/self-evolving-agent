import { Fragment, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Clock3,
  FoldVertical,
  ListTree,
  Search,
  User,
  Bot,
  Wrench,
  X,
  Square,
  Circle,
  AlertTriangle,
} from 'lucide-react';
import { useDemo } from '../state/store';
import { files } from '../state/model';
import { loopSteps, loopTool, callRecord, modelRecord, stepContext } from '../state/trace-fixture';
import { Code, JsonTree as JsonView, Markdown } from './content';
import { StateGate, IconButton, TabBar } from './ui';

type RecordKind = 'user' | 'assistant' | 'tool';
interface LedgerRecord {
  id: string;
  kind: RecordKind;
  step: number;
  text: string;
  time: string;
  call?: string;
  error?: boolean;
}
function toolPreview(id: string) {
  const call = loopTool(id);
  if ('content' in call.output) return call.output.content.replace(/\n/g, ' ');
  if ('code' in call.output) return `${call.output.code}: ${call.output.message}`;
  if ('changes' in call.output)
    return call.output.changes
      .map((change) => `${change.section}: ${change.before ?? '—'} → ${change.after}`)
      .join('; ');
  return JSON.stringify(call.output);
}
const kindLabel = { user: '用户', assistant: '模型', tool: '工具' };
const detailTabs = ['概览', '输入', '输出', '原文'];

export function TraceLedger() {
  const x = useDemo();
  const [selected, select] = useState<string | null>(null);
  const [tab, setTab] = useState('概览');
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [folded, fold] = useState<number[]>([]);
  const [overview, setOverview] = useState(true);
  const origin = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const running = x.session.run === 'running';
  const stopped = ['stopped', 'interrupted'].includes(x.session.run);
  const sample =
    !x.session.transcript && x.session.id === 'compare' && x.session.messages.length === 1 && !running && !stopped;
  const steps = sample ? loopSteps.slice(0, history ? 2 : 4) : [];
  const request = x.session.messages.at(-1) ?? '';
  const records: LedgerRecord[] =
    x.session.run === 'idle'
      ? []
      : [
          { id: 'user', kind: 'user', step: 0, text: request, time: sample ? '14:32:04' : '' },
          ...steps.flatMap((step): LedgerRecord[] => [
            { id: `model-${step.id}`, kind: 'assistant', step: step.id, text: step.text, time: step.time },
            ...step.calls.map((id): LedgerRecord => {
              const call = loopTool(id);
              return {
                id,
                kind: 'tool',
                step: step.id,
                text: toolPreview(id),
                time: call.time,
                call: id,
                error: call.status === 'error',
              };
            }),
          ]),
        ];
  const active = records.find((record) => record.id === selected);
  const call = active?.call ? loopTool(active.call) : null;
  const step = active?.kind === 'assistant' ? steps.find((s) => s.id === active.step) : undefined;
  const state = history
    ? '检查点 · 不完整'
    : running
      ? '运行中'
      : stopped
        ? '已中断'
        : x.session.run === 'idle'
          ? '尚未运行'
          : '已结束';
  const raw = call
    ? callRecord(call.id)
    : step
      ? modelRecord(step)
      : { role: 'user', content: request, references: sample ? files.slice(0, 2) : x.session.refs };
  const input = call
    ? call.input
    : step
      ? stepContext(step.id, request)
      : { content: request, references: sample ? files.slice(0, 2) : x.session.refs };
  const output = call ? call.output : (step?.text ?? request);
  const choose = (id: string) => {
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    select(id);
    setTab('概览');
  };
  const close = () => {
    select(null);
    requestAnimationFrame(() => origin.current?.isConnected && origin.current.focus({ preventScroll: true }));
  };
  useEffect(() => {
    select(null);
    setHistory(false);
    fold([]);
    setQuery('');
    setCollapsed(false);
  }, [x.session.id, x.session.messages.length]);
  useEffect(() => {
    if (x.focusRequest.type === 'trace') {
      select(x.objects.trace);
      setTab('概览');
      setHistory(false);
    }
  }, [x.focusRequest, x.objects.trace]);
  useEffect(() => {
    if (selected && x.page === 'trace') closeButton.current?.focus({ preventScroll: true });
  }, [selected, x.page]);
  const matches = (record: LedgerRecord) =>
    !query.trim() ||
    `${record.text} ${record.call ? JSON.stringify(loopTool(record.call)) : kindLabel[record.kind]}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  const visible = records.filter((record) => {
    if (query.trim()) return matches(record);
    return record.kind === 'user' || (!collapsed && (record.kind !== 'tool' || !folded.includes(record.step)));
  });
  const timing = records.filter((record) => record.time);
  const rowRef = (id: string) => document.getElementById(`ledger-${id}`);
  const onRowKey = (event: React.KeyboardEvent<HTMLTableRowElement>, id: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(id);
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const index = visible.findIndex((record) => record.id === id);
      rowRef(
        visible[Math.max(0, Math.min(visible.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))].id,
      )?.focus();
    }
  };
  return (
    <StateGate
      emptyAction={
        <button
          className="ledger-text-button"
          type="button"
          onClick={() => {
            x.setScenario('normal');
            x.go('chat');
          }}
        >
          回到对话
        </button>
      }
    >
      <section
        className="ledger-page"
        aria-label="轨迹"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && active) {
            event.stopPropagation();
            close();
          }
        }}
      >
        <div className="ledger-toolbar" role="toolbar" aria-label="轨迹工具栏">
          <IconButton label="回到对话" onClick={() => x.go('chat')}>
            <ArrowLeft size={14} />
          </IconButton>
          <strong>轨迹</strong>
          <span className={`ledger-run-state ${running ? 'running' : ''}`}>
            <Circle size={6} />
            {state}
          </span>
          <span className="ledger-divider" />
          <IconButton label="显示时间概览" aria-pressed={overview} onClick={() => setOverview(!overview)}>
            <Clock3 size={14} />
          </IconButton>
          <IconButton
            label={collapsed ? '展开轮次' : '折叠轮次'}
            aria-pressed={collapsed}
            disabled={!sample}
            onClick={() => setCollapsed(!collapsed)}
          >
            <FoldVertical size={14} />
          </IconButton>
          <IconButton
            label={folded.length ? '展开工具调用' : '折叠工具调用'}
            aria-pressed={!!folded.length}
            disabled={!sample}
            onClick={() => fold(folded.length ? [] : steps.map((s) => s.id))}
          >
            <ListTree size={14} />
          </IconButton>
          <label className="ledger-search">
            <Search size={12} />
            <input
              aria-label="搜索轨迹"
              placeholder="搜索轨迹"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button
            className="ledger-history"
            type="button"
            onClick={() => {
              setHistory(!history);
              select(null);
            }}
          >
            {history ? '当前记录' : `分支 ${x.session.branch}`}
            <ChevronDown size={11} />
          </button>
        </div>
        {overview && sample && (
          <section className="ledger-overview" aria-label="时间概览">
            <div className="ledger-clock">
              <span>14:32:04</span>
              <span>{history ? '14:32:09' : '14:32:14'}</span>
            </div>
            <div className="ledger-time-axis">
              {timing.map((record, index) => {
                const second = Number(record.time.slice(-2));
                const overlap = timing.slice(0, index).filter((r) => r.time === record.time).length;
                return (
                  <button
                    type="button"
                    key={record.id}
                    className={`ledger-time-mark ${record.kind} ${record.error ? 'error' : ''} ${active?.id === record.id ? 'selected' : ''}`}
                    style={{ left: `${3 + ((second - 4) / (history ? 5 : 10)) * 94}%`, top: `${overlap * 7}px` }}
                    aria-label={`${record.time} ${kindLabel[record.kind]} ${record.call ? loopTool(record.call).tool : record.step ? `调用 ${record.step}` : '请求'}`}
                    title={`${record.time} · ${record.call ? loopTool(record.call).tool : kindLabel[record.kind]}`}
                    onClick={() => choose(record.id)}
                  />
                );
              })}
            </div>
          </section>
        )}
        <div className={`ledger-split ${active ? 'has-inspector' : ''}`}>
          <div className="ledger-table-pane">
            <table className="ledger-table" aria-label="执行轨迹">
              <colgroup>
                <col className="ledger-event-column" />
                <col />
              </colgroup>
              <tbody>
                {visible.map((record) => (
                  <Fragment key={record.id}>
                    {record.kind === 'assistant' && (
                      <tr className="ledger-request-boundary">
                        <td colSpan={2}>
                          <button
                            type="button"
                            aria-label={`检查第 ${record.step} 次模型调用`}
                            onClick={() => choose(record.id)}
                          >
                            <span />#{record.step}
                          </button>
                        </td>
                      </tr>
                    )}
                    <tr
                      id={`ledger-${record.id}`}
                      tabIndex={0}
                      className={`ledger-row ${active?.id === record.id ? 'selected' : ''} ${record.error ? 'error' : ''}`}
                      data-kind={record.kind}
                      aria-label={`${record.call ? loopTool(record.call).purpose : kindLabel[record.kind]} ${record.text}`}
                      aria-selected={active?.id === record.id}
                      onClick={() => choose(record.id)}
                      onKeyDown={(event) => onRowKey(event, record.id)}
                    >
                      <td className="ledger-event">
                        <span className="ledger-turn-rail" />
                        {record.kind === 'user' && (
                          <button
                            className="ledger-turn"
                            type="button"
                            aria-label={collapsed ? '展开轮次 1' : '折叠轮次 1'}
                            onClick={(event) => {
                              event.stopPropagation();
                              setCollapsed(!collapsed);
                            }}
                          >
                            {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}1
                          </button>
                        )}
                        <span className={`ledger-kind ${record.kind}`}>
                          {record.kind === 'user' ? (
                            <User size={10} />
                          ) : record.kind === 'assistant' ? (
                            <Bot size={10} />
                          ) : (
                            <Wrench size={10} />
                          )}
                          <span>{kindLabel[record.kind]}</span>
                        </span>
                      </td>
                      <td
                        className="ledger-content"
                        title={
                          record.call
                            ? `${loopTool(record.call).tool} ${loopTool(record.call).target} → ${record.text}`
                            : record.text
                        }
                      >
                        {record.call ? (
                          <div className="ledger-tool-preview">
                            <span className="ledger-call-preview">
                              <code>{loopTool(record.call).tool}</code>
                              <span>
                                {x.scenario === 'long'
                                  ? `${'归档/长目录_版本[02]/'.repeat(12)}${loopTool(record.call).target}`
                                  : loopTool(record.call).target}
                              </span>
                            </span>
                            <span className="ledger-arrow">→</span>
                            <span className="ledger-result-preview">
                              {record.error && <X size={11} />}
                              {record.text}
                            </span>
                          </div>
                        ) : (
                          <div className="ledger-message-preview">
                            {record.kind === 'assistant' && !!steps.find((s) => s.id === record.step)?.calls.length && (
                              <button
                                type="button"
                                className="ledger-fold-call"
                                aria-label={`${folded.includes(record.step) ? '展开' : '折叠'}第 ${record.step} 次模型调用的工具`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  fold(
                                    folded.includes(record.step)
                                      ? folded.filter((n) => n !== record.step)
                                      : [...folded, record.step],
                                  );
                                }}
                              >
                                {folded.includes(record.step) ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                              </button>
                            )}
                            <span>{record.text}</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  </Fragment>
                ))}
                {collapsed && !query && sample && (
                  <tr className="ledger-collapsed">
                    <td colSpan={2}>
                      <button type="button" onClick={() => setCollapsed(false)}>
                        … {history ? '2 次模型调用 · 4 次工具调用' : '4 次模型调用 · 5 次工具调用'}
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {!visible.length && <div className="ledger-no-records">{query ? '没有匹配的记录' : '尚无执行记录'}</div>}
            {history && (
              <div className="ledger-terminal">
                <AlertTriangle size={11} />
                检查点之后的记录缺失
              </div>
            )}
            {!sample && x.session.run !== 'idle' && (
              <div className="ledger-terminal">
                <span className={`ledger-state-dot ${running ? 'running' : ''}`} />
                {running ? '模型请求中' : stopped ? '模型请求已中断' : '逐轮记录未保存'}
                {running && (
                  <button type="button" onClick={x.stop}>
                    <Square size={10} />
                    停止
                  </button>
                )}
              </div>
            )}
          </div>
          {active && (
            <aside className="ledger-inspector" aria-label="记录详情">
              <header className="ledger-inspector-header">
                <span className={`ledger-kind ${active.kind}`}>{kindLabel[active.kind]}</span>
                <strong>{call?.tool ?? (active.kind === 'user' ? '用户请求' : `模型调用 #${active.step}`)}</strong>
                <button ref={closeButton} type="button" aria-label="关闭记录详情" onClick={close}>
                  <X size={15} />
                </button>
              </header>
              <TabBar items={detailTabs} value={tab} onChange={setTab} />
              <div className="ledger-inspector-body">
                {tab === '原文' ? (
                  <Code text={JSON.stringify(raw, null, 2)} language="json" />
                ) : tab === '输入' ? (
                  <JsonView value={input} />
                ) : tab === '输出' ? (
                  typeof output === 'string' ? (
                    <Markdown text={output} />
                  ) : (
                    <JsonView value={output} />
                  )
                ) : (
                  <>
                    <dl className="ledger-properties">
                      <dt>时间</dt>
                      <dd>{active.time || '—'}</dd>
                      <dt>状态</dt>
                      <dd>
                        {call ? (
                          call.status === 'error' ? (
                            <span className="ledger-error-label">失败 · ENOENT</span>
                          ) : (
                            '已返回'
                          )
                        ) : step ? (
                          `已返回 · ${step.end}`
                        ) : (
                          '已接收'
                        )}
                      </dd>
                      {call && (
                        <>
                          <dt>调用标识</dt>
                          <dd>call_demo_{call.id}</dd>
                        </>
                      )}
                      {step && (
                        <>
                          <dt>工具请求</dt>
                          <dd>{step.calls.length}</dd>
                        </>
                      )}
                    </dl>
                    {call ? (
                      <>
                        <section className="ledger-detail-section">
                          <button type="button" onClick={() => setTab('输入')}>
                            输入 <ChevronRight size={11} />
                          </button>
                          <JsonView value={call.input} />
                        </section>
                        <section className={`ledger-detail-section ${active.error ? 'ledger-error-output' : ''}`}>
                          <button type="button" onClick={() => setTab('输出')}>
                            输出 <ChevronRight size={11} />
                          </button>
                          {'content' in call.output ? (
                            <Code text={call.output.content} language="markdown" />
                          ) : (
                            <JsonView value={call.output} />
                          )}
                        </section>
                      </>
                    ) : step ? (
                      <>
                        <section className="ledger-detail-section">
                          <button type="button" onClick={() => setTab('输入')}>
                            输入 <ChevronRight size={11} />
                          </button>
                          <div className="ledger-context-preview">
                            {stepContext(step.id, request).map((message, index) => (
                              <div key={`${step.id}:${index}`}>
                                <span>
                                  {message.role === 'user'
                                    ? '用户'
                                    : message.role === 'assistant'
                                      ? '模型'
                                      : message.toolName}
                                </span>
                                <p>
                                  {message.role === 'toolResult'
                                    ? loopTool(message.toolCallId.replace('call_demo_', '')).result
                                    : message.content}
                                </p>
                              </div>
                            ))}
                          </div>
                        </section>
                        <section className="ledger-detail-section">
                          <button type="button" onClick={() => setTab('输出')}>
                            输出 <ChevronRight size={11} />
                          </button>
                          <Markdown text={step.text} />
                          {!!step.calls.length && (
                            <ul className="ledger-model-calls">
                              {step.calls.map((id) => (
                                <li key={id}>
                                  <button type="button" onClick={() => choose(id)}>
                                    <Wrench size={11} />
                                    <code>{loopTool(id).tool}</code>
                                    <span>{loopTool(id).target}</span>
                                    <ChevronRight size={11} />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>
                      </>
                    ) : (
                      <>
                        <Markdown text={request} />
                        <ul className="ledger-files">
                          {(sample ? files.slice(0, 2) : x.session.refs).map((file) => (
                            <li key={file}>{file}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                )}
              </div>
            </aside>
          )}
        </div>
      </section>
    </StateGate>
  );
}
