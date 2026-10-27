import type { EvolutionSuggestion } from '../../../../apps/host/evolution/evolution';
import { Button, Notice } from './ui';
import { Markdown, Diff } from '../../src/components/content';
import { useRead, resultPath, type Api, type MemoryDetail, type SkillDetail } from './data';
import type { Route } from './navigation';
import { Back, Failure, date } from './Reflection';
export function Result({
  api,
  route,
  go,
  back,
}: {
  api: Api;
  route: Extract<Route, { page: 'result' }>;
  go: (route: Route) => void;
  back: () => void;
}) {
  const target = route.target;
  return (
    <>
      <Back back={back}>返回上一页</Back>
      {target.kind === 'memory' ? (
        <MemoryResult api={api} route={route} go={go} />
      ) : target.kind === 'skill' ? (
        <SkillResult api={api} route={route} go={go} />
      ) : (
        <SuggestionResult api={api} route={route} go={go} />
      )}
      {route.originSession && (
        <Button data-focus="origin-session" onClick={() => go({ page: 'session', sessionId: route.originSession })}>
          返回原会话
        </Button>
      )}
    </>
  );
}
function MemoryResult({
  api,
  route,
  go,
}: {
  api: Api;
  route: Extract<Route, { page: 'result' }>;
  go: (route: Route) => void;
}) {
  const target = route.target;
  const read = useRead<MemoryDetail>(api, resultPath(target), ['agent-memory-changed']);
  if (target.kind !== 'memory') return null;
  const value = read.value;
  const revision =
    value && (target.revision ? value.history.find((r) => r.revision === target.revision) : value.current);
  const previous = revision && value?.history.find((r) => r.revision === revision.previousRevision);
  return (
    <>
      <h1 tabIndex={-1}>{revision?.title || '记忆修订'}</h1>
      {read.loading && <p role="status">正在读取记忆…</p>}
      {read.error && <Failure error={read.error} retry={read.refresh} />}
      {value && !revision && (
        <Notice title="引用的修订未返回" tone="warn">
          当前内容不能替代记录中引用的历史修订。
        </Notice>
      )}
      {revision && (
        <article className="aw-review-article live-result">
          <p className="aw-muted">
            修订 {revision.revision} · {date(revision.created)} ·{' '}
            {{ current: '有效', withdrawn: '已撤销', deleted: '已移除' }[revision.status]}
          </p>
          {value && value.current.revision !== revision.revision && (
            <Notice title="历史修订">当前记忆已是修订 {value.current.revision}；此处展示检查记录所引用的内容。</Notice>
          )}
          {!revision.usable && (
            <Notice title="当前不可用于检索" tone="warn">
              {revision.unavailable ? '来源尚未恢复，内容仍可阅读。' : '这项内容已失效或属于历史修订。'}
            </Notice>
          )}
          <Markdown text={revision.content} />
          <section>
            <h2>修订依据</h2>
            <p>{revision.reason}</p>
          </section>
          {previous && (
            <section>
              <h2>实际变化</h2>
              <Diff file="记忆正文" before={previous.content} after={revision.content} />
            </section>
          )}
          <section>
            <h2>来源</h2>
            {[...revision.sources, ...revision.basis].map((ref, i) => (
              <Button
                key={`${ref.entryId}-${i}`}
                data-focus={`memory-source-${i}`}
                onClick={() =>
                  go({
                    page: 'source',
                    reference: { sessionId: ref.sessionId, entryId: ref.entryId },
                    project: target.project,
                    originSession: route.originSession,
                  })
                }
              >
                记忆来源 {i + 1}
              </Button>
            ))}
            {!revision.sources.length && !revision.basis.length && <p>这次修订未保存来源引用。</p>}
          </section>
        </article>
      )}
    </>
  );
}
function SuggestionResult({
  api,
  route,
  go,
}: {
  api: Api;
  route: Extract<Route, { page: 'result' }>;
  go: (route: Route) => void;
}) {
  const read = useRead<EvolutionSuggestion>(api, resultPath(route.target), ['agent-suggestions-changed']);
  const value = read.value;
  return (
    <>
      <h1 tabIndex={-1}>{value?.title || '改进建议'}</h1>
      {read.loading && <p role="status">正在读取建议…</p>}
      {read.error && <Failure error={read.error} retry={read.refresh} />}
      {value && (
        <article className="aw-review-article live-result">
          <p className="aw-muted">
            {{ pending: '待处理', adopted: '已采纳', ignored: '暂不采纳', archived: '已归档' }[value.status]} ·{' '}
            {date(value.created)}
          </p>
          <Markdown text={value.goal} />
          {(
            [
              ['提出原因', value.reason],
              ['预期价值', value.value],
              ['不确定性', value.uncertainty],
              ['建议行动', value.action],
            ] as const
          ).map(([name, text]) => (
            <section key={name}>
              <h2>{name}</h2>
              <Markdown text={text} />
            </section>
          ))}
          <section>
            <h2>依据与来源</h2>
            {value.evidence.map((reference, i) => (
              <Button
                key={`ref-${i}`}
                data-focus={`suggestion-source-${i}`}
                onClick={() =>
                  go({ page: 'source', reference, project: value.project || '', originSession: route.originSession })
                }
              >
                建议来源 {i + 1}
              </Button>
            ))}
          </section>
          {value.discussionSessionId && (
            <Button onClick={() => go({ page: 'session', sessionId: value.discussionSessionId })}>打开已有讨论</Button>
          )}
        </article>
      )}
    </>
  );
}
function SkillResult({
  api,
  route,
  go,
}: {
  api: Api;
  route: Extract<Route, { page: 'result' }>;
  go: (route: Route) => void;
}) {
  const read = useRead<SkillDetail>(api, resultPath(route.target), ['agent-skills-changed']);
  const target = route.target;
  if (target.kind !== 'skill') return null;
  const value = read.value;
  const revisions = value?.knowledge.filter(
    (k) =>
      (!target.knowledgeRevision || k.id === target.knowledgeRevision) &&
      (!target.file || k.file === target.file) &&
      (!target.version || k.version === target.version),
  );
  return (
    <>
      <h1 tabIndex={-1}>{value?.skill.name || '技能知识'}</h1>
      {read.loading && <p role="status">正在读取技能知识…</p>}
      {read.error && <Failure error={read.error} retry={read.refresh} />}
      {value && (
        <article className="aw-review-article live-result">
          {!revisions?.length && (
            <Notice title="引用的知识修订未返回" tone="warn">
              不以当前技能说明替代历史知识。
            </Notice>
          )}
          {revisions?.map((k) => (
            <section key={k.id}>
              <h2>{k.file}</h2>
              <p className="aw-muted">
                {date(k.created)} · {k.version === value.skill.current ? '当前技能版本' : '历史技能版本'}
              </p>
              <Markdown text={k.content} />
              <p>{k.provenance?.reason}</p>
              {k.provenance?.sessionId && k.provenance.entryId && (
                <Button
                  onClick={() =>
                    go({
                      page: 'source',
                      reference: { sessionId: k.provenance?.sessionId, entryId: k.provenance?.entryId },
                      project: value.skill.project,
                      originSession: route.originSession,
                    })
                  }
                >
                  知识修订来源
                </Button>
              )}
            </section>
          ))}
        </article>
      )}
    </>
  );
}
