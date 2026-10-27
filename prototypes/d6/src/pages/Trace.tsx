import { useState, useEffect, useRef } from 'react';
import { X, ChevronRight, Terminal, Clock, ArrowLeft, FileText } from 'lucide-react';
import { useDemo } from '../state/store';
import { rawTool, toolEvents } from '../state/model';
import { Button, TabBar, Status, Notice, SectionTitle, Modal, StateGate } from '../components/ui';
import { JsonView, Evidence, Code } from '../components/content';
import { TraceLedger } from '../components/TraceLedger';
import { loopTools, callRecord } from '../state/trace-fixture';
export function Trace() {
  const { mode } = useDemo();
  return mode === 'quiet' ? <TraceLedger /> : <StudioTrace />;
}

function StudioTrace() {
  const x = useDemo();
  const event = x.objects.trace;
  const E = (id: string) => x.setObject('trace', id);
  const [tab, T] = useState('结果');
  const [raw, R] = useState(false);
  const [history, H] = useState(false);
  const [mobile, D] = useState(false);
  const origin = useRef<HTMLElement | null>(null);
  const position = useRef(0);
  const closeInspector = () => {
    D(false);
    requestAnimationFrame(() => {
      const workspace = document.querySelector('.workspace');
      if (workspace) workspace.scrollTop = position.current;
      origin.current?.focus({ preventScroll: true });
    });
  };
  useEffect(() => {
    if (x.mode !== 'quiet' || !mobile || x.page !== 'trace') return;
    const frame = requestAnimationFrame(() => {
      const detail = document.querySelector<HTMLElement>('.tool-detail');
      if (innerWidth <= 1100) detail?.scrollIntoView({ block: 'start' });
      const button = detail?.querySelector<HTMLButtonElement>(innerWidth <= 1100 ? '.mobile-back' : '.inspector-close');
      button?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [mobile, event, x.mode, x.page]);
  useEffect(() => {
    if (x.focusRequest.type === 'trace') D(true);
  }, [x.focusRequest]);
  useEffect(() => {
    D(false);
    R(false);
    H(false);
  }, [x.session.id, x.session.messages.length]);
  const quiet = x.mode === 'quiet';
  const item = quiet
    ? (loopTools.find((e) => e.id === event) ?? loopTools[0])
    : (toolEvents.find((e) => e.id === event) ?? toolEvents[0]);
  const running = x.session.run === 'running';
  const fail = item.status === 'error';
  const unknown = item.status === 'unknown';
  const sample =
    x.session.id === 'compare' &&
    x.session.messages.length === 1 &&
    !['running', 'stopped', 'interrupted'].includes(x.session.run);
  const data = quiet
    ? callRecord(item.id)
    : fail
      ? {
          tool: 'read',
          input: { path: '资料/兼容说明.md' },
          error: { code: 'ENOENT', message: '文件不存在' },
          retried: false,
        }
      : unknown
        ? {
            tool: 'document_info',
            output: {
              schemaVersion: 2,
              data: [
                {
                  path: 'docs/项目说明-v2.md',
                  metadata: { encoding: 'utf-8', tags: ['draft', 'review'], source: null },
                },
              ],
            },
            businessOutcome: 'unknown',
          }
        : item.id === 'read'
          ? {
              tool: 'read',
              status: 'returned',
              input: { paths: ['docs/项目说明-v1.md', 'docs/项目说明-v2.md'] },
              output: {
                documents: [
                  {
                    path: 'docs/项目说明-v1.md',
                    content: '# 项目说明 v1\n使用用户名与密码登录。数据保存在本地。',
                    complete: true,
                  },
                  {
                    path: 'docs/项目说明-v2.md',
                    content: '# 项目说明 v2\n在浏览器完成设备授权。支持加密备份并恢复到新目录。',
                    complete: true,
                  },
                ],
              },
              durationMs: null,
            }
          : rawTool;
  return (
    <StateGate
      emptyAction={
        <Button
          onClick={() => {
            x.setScenario('normal');
            x.go('chat');
          }}
        >
          回到会话
        </Button>
      }
    >
      <div className="trace-page">
        <SectionTitle
          eyebrow="会话 / 执行记录"
          title={quiet ? '执行轨迹' : '这份报告是怎样得到的'}
          action={
            <Button kind="ghost" onClick={() => x.go('chat')}>
              <ArrowLeft size={14} />
              回到对话
            </Button>
          }
        />
        <div className="trace-heading">
          <div>
            <Status tone={running ? 'busy' : 'neutral'}>
              {running
                ? '正在执行'
                : history
                  ? '历史记录 · 不完整'
                  : ['stopped', 'interrupted'].includes(x.session.run)
                    ? '已停止'
                    : x.session.run === 'idle'
                      ? '尚未执行'
                      : '执行已结束'}
            </Status>
            <span>当前分支 {x.session.branch}</span>
            <button
              type="button"
              onClick={() => {
                H(!history);
                D(false);
                R(false);
              }}
            >
              {history ? '返回当前记录' : '查看旧分支'}
            </button>
          </div>
          <span className="trace-time">
            <Clock size={13} />
            {running
              ? '运行中'
              : quiet && !sample
                ? '时间未记录'
                : history
                  ? '14:32:04 — 14:32:09 · 检查点'
                  : '14:32:04 — 14:32:14'}
          </span>
        </div>
        {history && (
          <Notice title="历史分支 · 只读">
            当前显示旧分支的已保存记录，不切换执行位置。上一检查点之后的内容可能缺失。
          </Notice>
        )}
        {x.session.run === 'idle' ? (
          <div className="state-view">
            <FileText size={28} />
            <h2>尚未执行任务</h2>
            <p>发送任务后，这里会保留模型轮次与调用依据。</p>
            <Button onClick={() => x.go('chat')}>回到会话</Button>
          </div>
        ) : (
          <div className={`trace-workspace ${mobile && (!quiet || sample) ? 'detail-open' : ''}`}>
            <section className="trace-story">
              {
                <>
                  <div className="turn-head">
                    <span className="turn-number">01</span>
                    <div>
                      <strong>理解材料，形成比较报告</strong>
                      <p>模型轮次 · {running ? '正在读取' : '工具返回后整理结果'}</p>
                    </div>
                  </div>
                  {x.mode === 'studio' && (
                    <div className="trace-register table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>时间</th>
                            <th>执行目的</th>
                            <th>Tool</th>
                            <th>结果</th>
                          </tr>
                        </thead>
                        <tbody>
                          {toolEvents.slice(0, running ? 2 : 4).map((e) => (
                            <tr key={e.id} className={event === e.id ? 'selected' : ''}>
                              <td>{e.time}</td>
                              <td>
                                <button
                                  type="button"
                                  onClick={() => {
                                    E(e.id);
                                    T('结果');
                                    D(true);
                                    if (x.mode === 'studio' && innerWidth > 950)
                                      requestAnimationFrame(() =>
                                        document.querySelector('.tool-detail')?.scrollIntoView({ block: 'start' }),
                                      );
                                  }}
                                >
                                  {e.purpose}
                                </button>
                                <small>
                                  {x.scenario === 'long'
                                    ? `项目归档／${'多层目录与特殊字符_版本[02]／'.repeat(9)}${e.target}`
                                    : e.target}
                                </small>
                              </td>
                              <td>
                                <code>{e.tool}</code>
                              </td>
                              <td>
                                <Status
                                  tone={e.status === 'error' ? 'bad' : e.status === 'success' ? 'good' : 'neutral'}
                                >
                                  {e.status === 'error' ? '失败' : e.status === 'success' ? '已返回' : '待解释'}
                                </Status>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="turn-ending">
                    <span className="tiny-dot" />{' '}
                    {running ? '等待 Tool 返回，不推断任务结论' : '模型已返回报告 · 附件缺口保留在结果中'}
                  </div>
                </>
              }
              <details className="context-details">
                <summary>上下文与记录完整性</summary>
                <dl>
                  <dt>上下文</dt>
                  <dd>
                    {quiet
                      ? '各轮输入快照可展开；未记录系统提示与思考内容'
                      : '项目说明、用户目标、按需读取的 text-diff'}
                  </dd>
                  <dt>耗时与成本</dt>
                  <dd>未采集完整数据，保持未知</dd>
                  <dt>来源</dt>
                  <dd>
                    {history
                      ? '上一检查点 · 不完整'
                      : quiet && !sample
                        ? '当前请求 · 未保存逐轮事件'
                        : '当前分支 · 模拟完整记录'}
                  </dd>
                </dl>
              </details>
            </section>
            {(!quiet || (mobile && sample)) && (
              <section
                className="tool-detail"
                aria-label="记录详情"
                onKeyDown={(e) => {
                  if (quiet && e.key === 'Escape') {
                    e.stopPropagation();
                    closeInspector();
                  }
                }}
              >
                {quiet && (
                  <Button kind="ghost" className="inspector-close" onClick={closeInspector}>
                    收起记录详情 <X size={13} />
                  </Button>
                )}
                <Button kind="ghost" className="mobile-back" onClick={closeInspector}>
                  <ArrowLeft size={14} />
                  返回调用列表
                </Button>
                <div className="tool-heading">
                  <span className="tool-symbol">
                    <Terminal size={18} />
                  </span>
                  <div>
                    <div className="eyebrow">
                      {unknown ? 'Extension Tool' : item.tool === 'read' ? 'Pi 原生 Tool' : 'text-diff / Extension'}
                    </div>
                    <h2>{item.purpose}</h2>
                  </div>
                  <Status tone={fail ? 'bad' : unknown ? 'neutral' : 'good'}>
                    {fail ? '读取失败' : unknown ? '结果待解释' : '已返回'}
                  </Status>
                </div>
                <p className="tool-target">
                  {item.target}
                  {x.scenario === 'long' &&
                    ' / docs/迁移说明/非常长的目录名称与特殊字符-版本(2)/登录与恢复/兼容附件.md'.repeat(8)}
                </p>
                <TabBar items={['结果', '参数', '原始记录']} value={tab} onChange={T} />
                {tab === '结果' ? (
                  fail ? (
                    <>
                      <Notice tone="bad" title="没有找到兼容说明文件">
                        这条错误会返回模型；是否继续、如何处理，可沿模型轮次核对。
                      </Notice>
                      <dl className="error-facts">
                        <dt>位置</dt>
                        <dd>资料/兼容说明.md</dd>
                        <dt>原因</dt>
                        <dd>
                          路径对应的文件不存在 <code>ENOENT</code>
                        </dd>
                        <dt>下一步</dt>
                        <dd>补齐文件后发送新的核对请求。</dd>
                      </dl>
                      <Button
                        onClick={() => {
                          x.updateSession({ draft: '请重新核实兼容说明；先确认文件是否存在。' });
                          x.go('chat');
                        }}
                      >
                        准备核对请求
                      </Button>
                      <details className="context-details">
                        <summary>查看原始错误</summary>
                        <Code text="ENOENT: no such file or directory, open '资料/兼容说明.md'" />
                      </details>
                    </>
                  ) : unknown ? (
                    <>
                      <Notice title="返回值没有可靠的业务摘要">
                        保留字段与类型供检查，不将未知 Extension 的返回等同于任务成功。
                      </Notice>
                      <JsonView value={data} />
                    </>
                  ) : quiet && item.tool === 'read' ? (
                    <>
                      <div className="tool-result-summary">
                        <span className="eyebrow">工具返回的文件正文</span>
                        <p>以下正文将作为工具结果，加入下一次模型调用的上下文。</p>
                      </div>
                      <Code
                        text={String(
                          'output' in data && data.output && 'content' in data.output ? data.output.content : '',
                        )}
                        language="markdown"
                        file={item.target}
                      />
                    </>
                  ) : (
                    <>
                      <div className="tool-result-summary">
                        <span className="eyebrow">返回内容</span>
                        <h3>正文中发现两类变化</h3>
                        <p>身份认证改用设备授权；数据备份增加恢复路径说明。</p>
                      </div>
                      <div className="semantic-changes">
                        <div>
                          <span>身份认证</span>
                          <p>
                            <del>用户名与密码</del>
                            <ChevronRight size={13} />
                            <ins>浏览器设备授权</ins>
                          </p>
                          <small>{quiet ? '来自 text_diff 的身份认证字段' : '说明 v2 · 第12—19行'}</small>
                        </div>
                        <div>
                          <span>数据恢复</span>
                          <p>新增加密备份与恢复到新目录的说明</p>
                          <small>{quiet ? '来自 text_diff 的数据恢复字段' : '说明 v2 · 第28—35行'}</small>
                        </div>
                      </div>
                      <Notice title="这个工具只比较正文" tone="warn">
                        兼容附件由后续 read 调用读取；本次差异结果不包含兼容性结论。
                      </Notice>
                      <Button kind="ghost" onClick={() => T('原始记录')}>
                        查看完整输入输出 <ChevronRight size={13} />
                      </Button>
                    </>
                  )
                ) : tab === '参数' ? (
                  <JsonView
                    value={
                      quiet
                        ? callRecord(item.id).input
                        : fail
                          ? { path: '资料/兼容说明.md' }
                          : 'input' in data
                            ? data.input
                            : {}
                    }
                  />
                ) : (
                  <Evidence value={data} incomplete={history} />
                )}
                <div className="tool-source">
                  <span>调用标识</span>
                  <code>call_demo_{item.id}</code>
                  <button type="button" onClick={() => R(true)}>
                    取证说明
                  </button>
                </div>
              </section>
            )}
          </div>
        )}
        <Modal open={raw} onClose={() => R(false)} title="记录与脱敏边界">
          <p>
            这里展示的是脱敏模拟数据。真实产品以加密 Session
            快照为原文依据；未知耗时、未保存片段与上一检查点不能补成完整记录。
          </p>
          <Evidence value={data} incomplete={history} />
        </Modal>
      </div>
    </StateGate>
  );
}
