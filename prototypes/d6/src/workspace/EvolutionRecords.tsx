import { FilterBar } from './controls';
import { useEffect, useState, useId } from 'react';
import { Plus, MoreHorizontal } from 'lucide-react';
import { Button, Notice, Modal, Menu, SearchBox } from '../components/ui';
import { Evidence } from './content';
import { useDemo } from '../state/store';
import { Heading, Return, RowArrow, Related, skillName } from './shared';
import { projectName } from './Context';
import { References, SourceSession } from './References';
import { manageSuggestion, activityBusy } from './evolution-model';
import {
  useWorkspacePosition,
  useWorkspaceData,
  formatDate,
  suggestionState,
  activityState,
  type EvolutionSuggestion,
  type EvolutionActivity,
} from './host-data';

function ReadingText({ text, label, className = '' }: { text: string; label: string; className?: string }) {
  const [expanded, EXPAND] = useState(false);
  const id = useId();
  if (text.length <= 480) return <p className={className}>{text}</p>;
  return (
    <div className={`ae-reading-text ${expanded ? 'expanded' : ''}`}>
      <div id={id} className="ae-reading-body">
        <p className={className}>{text}</p>
      </div>
      <button type="button" aria-controls={id} aria-expanded={expanded} onClick={() => EXPAND(!expanded)}>
        {expanded ? '收起全文' : label}
      </button>
    </div>
  );
}

export function ActivityOutcome({ activity: a, onCancel }: { activity: EvolutionActivity; onCancel?: () => void }) {
  const [cancel, CANCEL] = useState(false);
  return (
    <section className="ae-outcome" aria-label="开发结果">
      <div className="ae-outcome-heading">
        <strong>{activityState(a)}</strong>
        {onCancel && (
          <Button kind="ghost" onClick={() => CANCEL(true)}>
            取消开发
          </Button>
        )}
      </div>
      {a.error && (
        <Notice tone="warn" title="执行未完成">
          {a.error}
        </Notice>
      )}
      {a.result?.summary && <p className="ae-result-summary">{a.result.summary}</p>}
      {!!a.releases.length && (
        <div className="ae-releases">
          {a.releases.map((r) => (
            <div key={r.operationId}>
              <strong>{skillName(a.grant?.targets.find((t) => t.skillId === r.skillId)?.name ?? '名称未返回')}</strong>
              <span>已有发布记录</span>
              <details>
                <summary>版本与操作标识</summary>
                <Evidence value={r} />
              </details>
            </div>
          ))}
        </div>
      )}
      {!!a.result?.packages.length && (
        <details className="ae-package-results">
          <summary>候选文件与检查条目 · {a.result.packages.length}</summary>
          {a.result.packages.map((p) => (
            <div className="ae-package" key={p.target}>
              <strong>{a.grant?.targets.find((t) => t.key === p.target)?.name ?? p.target}</strong>
              <code>{p.skillFile}</code>
              <Evidence value={p} />
            </div>
          ))}
        </details>
      )}
      {a.grant && (
        <details className="ae-saved-grant">
          <summary>已批准的开发范围</summary>
          <p>{a.grant.goal}</p>
          <ul>
            {a.grant.targets.map((t) => (
              <li key={t.key}>{t.name}</li>
            ))}
          </ul>
          <details>
            <summary>完整授权记录</summary>
            <Evidence value={a.grant} />
          </details>
        </details>
      )}
      <Modal
        className="ae-confirm"
        open={cancel}
        onClose={() => CANCEL(false)}
        title="取消这次开发？"
        footer={
          <>
            <Button onClick={() => CANCEL(false)}>继续开发</Button>
            <Button
              kind="danger"
              onClick={() => {
                onCancel?.();
                CANCEL(false);
              }}
            >
              取消开发
            </Button>
          </>
        }
      >
        <p>已保存的候选、发布记录和已经发生的外部操作会保留。</p>
      </Modal>
    </section>
  );
}

export function EvolutionRecords({
  onDiscuss,
  onActivity,
  busy,
  active,
}: {
  onDiscuss: (s?: EvolutionSuggestion) => void;
  onActivity: (id: string) => void;
  busy: boolean;
  active: boolean;
}) {
  const x = useDemo(),
    w = useWorkspaceData();
  const [tab, TAB] = useState('待决定'),
    [scope, SCOPE] = useState('all'),
    [query, QUERY] = useState('');
  const [limit, LIMIT] = useState(24),
    [decision, DEC] = useState<'ignored' | 'archived'>();
  const [error, ERROR] = useState('');
  const [selected, SELECT] = useState<{ kind: 'suggestion' | 'activity'; id: string }>();
  useEffect(() => {
    if (x.focusRequest.type === 'evolution' && x.objects.evolution !== 'discussion')
      SELECT({ kind: 'suggestion', id: w.resolve('evolution', x.objects.evolution) });
  }, [x.focusRequest]);
  const suggestion = selected?.kind === 'suggestion' && w.data.suggestions.find((s) => s.id === selected.id);
  const activity = selected?.kind === 'activity' && w.data.activities.find((a) => a.id === selected.id);
  useWorkspacePosition(
    'evolution',
    selected ? `${selected.kind}:${selected.id}` : `list:${tab}:${scope}:${query}`,
    active,
  );
  const back = () => {
    SELECT(undefined);
    ERROR('');
  };
  if (suggestion) {
    const refs = [
      ...suggestion.evidence,
      ...(suggestion.reflectionId && !suggestion.evidence.some((e) => e.reflectionId === suggestion.reflectionId)
        ? [{ reflectionId: suggestion.reflectionId }]
        : []),
    ];
    return (
      <>
        <Return onClick={back}>所有改进建议</Return>
        <div className="ae-proposal-top">
          <span>{suggestionState[suggestion.status]}</span>
          <span>
            {projectName(suggestion.project ?? undefined)} · {formatDate(suggestion.updated)}
          </span>
          <Menu
            label="管理建议"
            items={[
              ...(suggestion.status !== 'ignored' ? [{ label: '暂不采纳', onSelect: () => DEC('ignored') }] : []),
              ...(suggestion.status !== 'archived' ? [{ label: '归档', onSelect: () => DEC('archived') }] : []),
            ]}
          >
            <MoreHorizontal size={18} />
          </Menu>
        </div>
        <Heading title={suggestion.title} />
        <div className="ae-proposal-reading">
          <article>
            <ReadingText key={suggestion.id} text={suggestion.reason} label="展开完整发现" className="ae-finding" />
            {suggestion.attentionReason && suggestion.attentionReason !== suggestion.reason && (
              <p className="ae-attention">{suggestion.attentionReason}</p>
            )}
            <div className="ae-proposed-change">
              <ReadingText key={suggestion.id} text={suggestion.goal} label="展开完整拟议内容" />
              {suggestion.value && <span>{suggestion.value}</span>}
            </div>
            {suggestion.uncertainty && <p className="ae-uncertainty">{suggestion.uncertainty}</p>}
            <div className="ae-decision">
              {['pending', 'adopted'].includes(suggestion.status) && (
                <Button kind="primary" disabled={busy || !x.d.connection} onClick={() => onDiscuss(suggestion)}>
                  {busy ? '正在准备讨论…' : suggestion.status === 'adopted' ? '继续讨论' : '讨论这项建议'}
                </Button>
              )}
              {suggestion.status === 'pending' && (
                <Button kind="ghost" onClick={() => DEC('ignored')}>
                  暂不采纳
                </Button>
              )}
            </div>
            {suggestion.discussionError && (
              <Notice tone="warn" title="讨论准备未完成">
                {suggestion.discussionError}
              </Notice>
            )}
            <details className="ae-next-step">
              <summary>建议的下一步</summary>
              <p>{suggestion.action}</p>
            </details>
          </article>
          <aside className="ae-proposal-links">
            {!!refs.length && (
              <>
                <h2>关联记录</h2>
                <References project={suggestion.project ?? undefined} items={refs} identifiers={false} />
              </>
            )}
            {suggestion.source &&
              !refs.some((e) => 'sessionId' in e && e.sessionId === suggestion.source?.sessionId) && (
                <SourceSession id={suggestion.source.sessionId} />
              )}
            {!refs.length && !suggestion.source && <p className="aw-muted">未返回来源引用</p>}
            <details>
              <summary>建议原始记录</summary>
              <Evidence value={suggestion} />
            </details>
          </aside>
        </div>
        <Modal
          className="ae-confirm"
          open={!!decision}
          onClose={() => DEC(undefined)}
          title={decision === 'ignored' ? '暂不采纳这项建议？' : '归档这项建议？'}
          description={suggestion.title}
          footer={
            <>
              <Button onClick={() => DEC(undefined)}>取消</Button>
              <Button
                kind="primary"
                disabled={!x.d.connection}
                onClick={() => {
                  try {
                    if (!decision) return;
                    w.changeData((d) => manageSuggestion(d, suggestion.id, suggestion.revision, decision));
                    DEC(undefined);
                  } catch (e) {
                    ERROR((e as Error).message);
                  }
                }}
              >
                {decision === 'ignored' ? '暂不采纳' : '归档建议'}
              </Button>
            </>
          }
        >
          <p>建议与来源会保留在处理历史中。</p>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      </>
    );
  }
  if (activity)
    return (
      <>
        <Return onClick={back}>处理历史</Return>
        <Heading
          title={activity.goal}
          description={`${projectName(activity.project)} · ${formatDate(activity.updated)}`}
          action={
            <Button onClick={() => onActivity(activity.id)}>
              {activityBusy(activity) ? '查看开发进度' : '打开讨论'}
            </Button>
          }
        />
        <div className="aw-document-layout">
          <article>
            <ActivityOutcome activity={activity} />
          </article>
          <aside className="aw-context">
            {activity.suggestionId &&
              (() => {
                const s = w.data.suggestions.find((s) => s.id === activity.suggestionId);
                return (
                  s && (
                    <Related
                      title={s.title}
                      meta="关联建议"
                      page="evolution"
                      object={{ type: 'evolution', id: s.id }}
                    />
                  )
                );
              })()}
            <SourceSession id={activity.sessionId} />
            <details>
              <summary>开发活动原始记录</summary>
              <Evidence value={activity} />
            </details>
          </aside>
        </div>
      </>
    );
  if (selected)
    return (
      <>
        <Return onClick={back}>所有改进建议</Return>
        <Heading title="记录未载入" />
      </>
    );
  const suggestions = w.data.suggestions
    .filter(
      (s) =>
        (scope === 'all' || s.project === scope) &&
        (tab === '待决定'
          ? s.status === 'pending'
          : tab === '讨论中'
            ? s.status === 'adopted'
            : ['ignored', 'archived'].includes(s.status)) &&
        `${s.title} ${s.goal} ${s.reason}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => b.updated - a.updated);
  const activities = w.data.activities
    .filter(
      (a) =>
        (scope === 'all' || a.project === scope) &&
        a.status !== 'discussion' &&
        `${a.goal} ${a.result?.summary ?? ''}`.includes(query),
    )
    .sort((a, b) => b.updated - a.updated);
  return (
    <>
      <Heading
        title="改进建议"
        action={
          <Button onClick={() => onDiscuss()}>
            <Plus size={16} />
            发起改进讨论
          </Button>
        }
      />
      <div className="ae-list-toolbar">
        <FilterBar
          items={['待决定', '讨论中', '处理历史']}
          value={tab}
          onChange={(v) => {
            TAB(v);
            LIMIT(24);
          }}
          label="改进建议处理状态"
        />
        <select
          aria-label="筛选建议项目"
          value={scope}
          onChange={(e) => {
            SCOPE(e.target.value);
            LIMIT(24);
          }}
        >
          <option value="all">所有项目</option>
          {w.projects.map((p) => (
            <option key={p} value={p}>
              {projectName(p)}
            </option>
          ))}
        </select>
      </div>
      <div className="ae-search">
        <SearchBox
          value={query}
          onChange={(v) => {
            QUERY(v);
            LIMIT(24);
          }}
          placeholder="搜索建议与开发活动"
        />
      </div>
      {suggestions.slice(0, limit).map((s) => (
        <button
          key={s.id}
          type="button"
          className="aw-proposal-row ae-list-row"
          data-aw-key={s.id}
          onClick={() => SELECT({ kind: 'suggestion', id: s.id })}
        >
          <span>
            <strong>{s.title}</strong>
            <p>{s.reason}</p>
            <small>
              {projectName(s.project ?? undefined)} · {formatDate(s.updated)}
              {s.priority === 'high' && ' · 优先关注'}
              {tab === '处理历史' && ` · ${suggestionState[s.status]}`}
            </small>
          </span>
          <RowArrow />
        </button>
      ))}
      {!suggestions.length &&
        tab !== '处理历史' &&
        !(
          tab === '讨论中' &&
          w.data.activities.some(
            (a) =>
              a.status === 'discussion' &&
              !a.suggestionId &&
              (scope === 'all' || a.project === scope) &&
              a.goal.includes(query),
          )
        ) && (
          <div className="empty-search">
            {query ? '没有匹配的建议' : tab === '待决定' ? '没有待决定的改进建议' : '没有正在讨论的建议'}
          </div>
        )}
      {suggestions.length > limit && (
        <Button className="ae-load-more" onClick={() => LIMIT(limit + 24)}>
          显示更多建议（剩余 {suggestions.length - limit}）
        </Button>
      )}
      {tab === '讨论中' &&
        w.data.activities
          .filter(
            (a) =>
              a.status === 'discussion' &&
              !a.suggestionId &&
              (scope === 'all' || a.project === scope) &&
              a.goal.includes(query),
          )
          .map((a) => (
            <button type="button" key={a.id} className="aw-proposal-row" onClick={() => onActivity(a.id)}>
              <span>
                <strong>{a.goal}</strong>
                <small>
                  {projectName(a.project)} · {formatDate(a.updated)}
                </small>
              </span>
              <RowArrow />
            </button>
          ))}
      {tab === '处理历史' && (
        <>
          <h2 className="aw-group-title">开发活动</h2>
          {activities.slice(0, limit).map((a) => (
            <button
              type="button"
              className="aw-proposal-row ae-list-row"
              data-aw-key={a.id}
              key={a.id}
              onClick={() => SELECT({ kind: 'activity', id: a.id })}
            >
              <span>
                <strong>{a.goal}</strong>
                <p>{a.result?.summary ?? a.error}</p>
                <small>
                  {activityState(a)} · {formatDate(a.updated)}
                </small>
              </span>
              <RowArrow />
            </button>
          ))}
          {!activities.length && <div className="empty-search">没有匹配的开发活动</div>}
          {activities.length > limit && <Button onClick={() => LIMIT(limit + 24)}>显示更多开发活动</Button>}
        </>
      )}
    </>
  );
}
