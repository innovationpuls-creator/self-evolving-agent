import { callStatuses } from './presentation';
import { SourceEvidence } from './SourceEvidence';
import type { DiagnosticService } from '../../../../host/diagnostics/diagnostics';
import { Button, Notice } from '../../components/ui';
import { useRead, type Api } from '../../app/data';
import type { Route } from '../../app/reference-route';
import { Back, Failure } from '../../components/reading';
export function Source({
  api,
  route,
  go,
  back,
  showBack,
}: {
  api: Api;
  route: Extract<Route, { page: 'source' }>;
  go: (route: Route) => void;
  back: () => void;
  showBack: boolean;
}) {
  const ref = route.reference;
  return (
    <>
      {showBack && <Back back={back}>返回上一页</Back>}
      <h1 tabIndex={-1}>依据与来源</h1>
      <div className="live-source-actions">
        {ref.sessionId && ref.entryId && (
          <Button
            data-focus="locate-session"
            onClick={() => go({ page: 'session', sessionId: ref.sessionId, entryId: ref.entryId })}
          >
            在来源会话中定位
          </Button>
        )}
        {route.originSession && (
          <Button data-focus="origin-session" onClick={() => go({ page: 'session', sessionId: route.originSession })}>
            返回原会话
          </Button>
        )}
      </div>
      {ref.sessionId && ref.entryId ? (
        <SourceEvidence
          key={`${ref.sessionId}:${ref.entryId}`}
          api={api}
          route={route}
          go={go}
          reference={{ sessionId: ref.sessionId, entryId: ref.entryId }}
        />
      ) : ref.traceId ? (
        <TraceSource api={api} traceId={ref.traceId} route={route} go={go} />
      ) : ref.sessionId ? (
        <Button onClick={() => go({ page: 'session', sessionId: ref.sessionId })}>打开来源会话</Button>
      ) : ref.memoryId ? (
        <Button
          onClick={() =>
            go({
              page: 'result',
              target: { kind: 'memory', id: ref.memoryId || '', revision: ref.revision, project: route.project },
              originSession: route.originSession,
            })
          }
        >
          打开引用记忆{ref.revision ? ` · 修订 ${ref.revision}` : ''}
        </Button>
      ) : ref.skillId ? (
        <Button
          onClick={() =>
            go({
              page: 'result',
              target: { kind: 'skill', id: ref.skillId || '', knowledgeRevision: ref.knowledgeRevision },
              originSession: route.originSession,
            })
          }
        >
          打开技能知识
        </Button>
      ) : ref.reflectionId ? (
        <ReflectionReference route={route} go={go} />
      ) : (
        <Notice title="缺少可定位的来源">这条依据没有记录来源位置，无法跳转。</Notice>
      )}
    </>
  );
}
function TraceSource({
  api,
  traceId,
  route,
  go,
}: {
  api: Api;
  traceId: string;
  route: Extract<Route, { page: 'source' }>;
  go: (route: Route) => void;
}) {
  const read = useRead<ReturnType<DiagnosticService['get']>>(api, `/diagnostics/${encodeURIComponent(traceId)}`);
  return (
    <>
      {read.loading && <p role="status">正在读取来源执行过程…</p>}
      {read.error && <Failure error={read.error} retry={read.refresh} />}
      {read.value && (
        <section>
          <h2>执行步骤</h2>
          {read.value.calls.map(
            (call) =>
              call.resultEntryId && (
                <Button
                  key={call.id}
                  onClick={() =>
                    go({
                      ...route,
                      reference: { sessionId: read.value?.trace.sessionId, entryId: call.resultEntryId ?? undefined },
                    })
                  }
                >
                  {call.toolName} · {callStatuses[call.status] || call.status}
                </Button>
              ),
          )}
          {!read.value.calls.length && <p>这段执行过程没有步骤结果。</p>}
          <Button onClick={() => go({ page: 'session', sessionId: read.value?.trace.sessionId })}>打开所属会话</Button>
        </section>
      )}
    </>
  );
}
function ReflectionReference({ route, go }: { route: Extract<Route, { page: 'source' }>; go: (route: Route) => void }) {
  return (
    <Button
      onClick={() =>
        go({
          page: 'reflection',
          jobId: route.reference.reflectionId || '',
          recordId: route.reference.reflectionId || '',
          originSession: route.originSession,
        })
      }
    >
      打开引用的自动复盘
    </Button>
  );
}
