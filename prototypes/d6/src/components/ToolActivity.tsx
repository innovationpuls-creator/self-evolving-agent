import { useState } from 'react';
import { ChevronRight, FileText, GitCompareArrows, Info, ArrowUpRight } from 'lucide-react';
import { loopTools, callRecord } from '../state/trace-fixture';
import { useDemo } from '../state/store';
import { Button, Modal, Status, TabBar } from './ui';
import { JsonView } from './content';

export function ToolActivity({ traceAvailable = true }: { traceAvailable?: boolean }) {
  const x = useDemo();
  const [selected, select] = useState<string | null>(null);
  const [tab, setTab] = useState('返回结果');
  const call = loopTools.find((item) => item.id === selected);
  const groups = [
    { tool: 'read', label: '读取项目文件', icon: FileText },
    { tool: 'text_diff', label: '比较正文变化', icon: GitCompareArrows },
    { tool: 'document_info', label: '查询文档信息', icon: Info },
  ];
  const failureCount = loopTools.filter((item) => item.status === 'error').length;
  const activity = (
    <section className="tool-activity" aria-label="工具活动">
      <header>
        <span>工具活动</span>
        <span>
          {loopTools.length} 次调用 · {failureCount} 次失败
        </span>
      </header>
      {groups.map(({ tool, label, icon: Icon }) => {
        const calls = loopTools.filter((item) => item.tool === tool);
        const failed = calls.filter((item) => item.status === 'error').length;
        return (
          <details key={tool}>
            <summary>
              <ChevronRight size={14} className="disclosure-icon" />
              <Icon size={16} />
              <span>{label}</span>
              <span className={failed ? 'bad-text' : 'muted'}>
                {calls.length - failed} 已返回{failed ? ` · ${failed} 失败` : ''}
              </span>
            </summary>
            <div className="tool-activity-calls">
              {calls.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => {
                    select(item.id);
                    setTab('返回结果');
                  }}
                >
                  <span>
                    <code>{item.tool}</code>
                    <span>{item.target}</span>
                  </span>
                  <Status tone={item.status === 'error' ? 'bad' : 'neutral'}>
                    {item.status === 'error'
                      ? 'ENOENT · 文件不存在'
                      : item.status === 'unknown'
                        ? '已返回 · 结论未知'
                        : '已返回'}
                  </Status>
                  <ArrowUpRight size={13} />
                </button>
              ))}
            </div>
          </details>
        );
      })}
      {traceAvailable && (
        <Button kind="ghost" onClick={() => x.go('trace')}>
          查看执行记录 <ArrowUpRight size={14} />
        </Button>
      )}
      <Modal
        open={!!call}
        onClose={() => select(null)}
        title={call?.purpose ?? '工具详情'}
        description={call?.target}
        drawer
      >
        {call && (
          <>
            <Status tone={call.status === 'error' ? 'bad' : 'neutral'}>
              {call.status === 'error' ? 'ENOENT · 文件不存在' : '已返回'}
            </Status>
            <p className="tool-result-summary">{call.result}</p>
            <TabBar items={['返回结果', '调用参数', '原始记录']} value={tab} onChange={setTab} />
            <JsonView
              key={`${call.id}:${tab}`}
              value={tab === '调用参数' ? call.input : tab === '原始记录' ? callRecord(call.id) : call.output}
            />
            {traceAvailable && (
              <Button
                onClick={() => {
                  select(null);
                  x.setObject('trace', call.id);
                  x.go('trace');
                }}
              >
                在轨迹中查看 <ArrowUpRight size={14} />
              </Button>
            )}
          </>
        )}
      </Modal>
    </section>
  );
  return x.mode === 'quiet' ? (
    <details className="execution-summary">
      <summary>
        <ChevronRight size={14} className="disclosure-icon" />
        <span>已比较两份正文</span>
        <span className="execution-gap">兼容附件缺失</span>
      </summary>
      {activity}
    </details>
  ) : (
    activity
  );
}
