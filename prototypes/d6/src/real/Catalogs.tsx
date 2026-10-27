import type { AgentService } from '../../../../apps/host/runtime/agent';
import type { EvolutionCatalog } from '../../../../apps/host/evolution/evolution';
import { ToolCatalog } from '../../../../apps/web/src/features/skills/ToolCatalog';
import { useRead, type Host, type Route } from './types';
import { Button, Notice } from '../components/ui';
import { Failure, date } from '../../host/src/Reflection';
export function Skills({ host, project, go }: { host: Host; project: string; go: (r: Route) => void }) {
  const read = useRead<Awaited<ReturnType<AgentService['skills']['discover']>>>(
    host.api,
    `/skills?${new URLSearchParams(project ? { project } : {})}`,
    ['agent-skills-changed'],
  );
  return (
    <>
      <header className="aw-heading">
        <h1 tabIndex={-1}>技能与工具</h1>
      </header>
      <p className="aw-muted">此处可阅读已管理技能与工具；导入、发布与开发授权尚未接入。</p>
      {read.loading && <p role="status">正在读取技能…</p>}
      {read.error && <Failure error={read.error} retry={read.refresh} />}
      <div className="asm-items host-skills">
        {read.value?.skills.map((s) => (
          <button
            type="button"
            key={s.id}
            className="asm-item"
            onClick={() => go({ page: 'result', target: { kind: 'skill', id: s.id } })}
          >
            <span>
              <strong>{s.name}</strong>
              <small>{s.description}</small>
            </span>
            <span>{!s.enabled ? '已禁用' : s.current ? '已有生效版本' : '尚未生效'}</span>
          </button>
        ))}
      </div>
      {read.value && !read.value.skills.length && <p className="empty-search">还没有纳入管理的技能</p>}
      {!!read.value?.discovered.length && (
        <details className="host-technical">
          <summary>项目发现的指引</summary>
          {read.value.discovered.map((s) => (
            <section key={s.source}>
              <h2>{s.name}</h2>
              <p>{s.description}</p>
            </section>
          ))}
        </details>
      )}
      <div className="host-tool-catalog">
        <ToolCatalog
          api={host.api}
          project={project}
          onSkill={(id) => go({ page: 'result', target: { kind: 'skill', id } })}
        />
      </div>
    </>
  );
}
export function Evolution({ host, project, go }: { host: Host; project: string; go: (r: Route) => void }) {
  const read = useRead<EvolutionCatalog>(host.api, `/suggestions?${new URLSearchParams(project ? { project } : {})}`, [
    'agent-suggestions-changed',
  ]);
  return (
    <>
      <header className="aw-heading">
        <h1 tabIndex={-1}>改进建议</h1>
      </header>
      <p className="aw-muted">可以阅读已有建议与讨论。开发授权、成果生效与发布尚未接入。</p>
      {read.loading && <p role="status">正在读取建议…</p>}
      {read.error && <Failure error={read.error} retry={read.refresh} />}
      <div className="aw-proposals">
        {read.value?.items.map((s) => (
          <button
            type="button"
            className="aw-proposal-row"
            key={s.id}
            onClick={() => go({ page: 'result', target: { kind: 'suggestion', id: s.id } })}
          >
            <span>
              <strong>{s.title}</strong>
              <p>{s.reason}</p>
              <small>
                {date(s.created)} ·{' '}
                {{ pending: '待处理', adopted: '已有讨论', ignored: '暂不采纳', archived: '已归档' }[s.status]}
              </small>
            </span>
          </button>
        ))}
      </div>
      {read.value && !read.value.items.length && <p className="empty-search">还没有改进建议</p>}
    </>
  );
}
export function Connection({ host }: { host: Host }) {
  return (
    <>
      <header className="aw-heading">
        <h1 tabIndex={-1}>模型与连接</h1>
      </header>
      <section className="aw-note">
        <h2>Agent Host</h2>
        <p>{location.origin}</p>
        <p>{host.connection === 'ready' ? '已连接' : host.connection === 'syncing' ? '正在同步' : '连接尚未就绪'}</p>
        {host.error && (
          <Notice title="连接提示" tone="warn">
            {host.error}
          </Notice>
        )}
        <Button onClick={host.retry}>重新连接</Button>
        <h2>可用模型</h2>
        {host.models.map((m) => (
          <p key={`${m.provider}:${m.id}`}>
            {m.name} · {m.provider}
          </p>
        ))}
      </section>
    </>
  );
}
