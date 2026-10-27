import { useEffect, useState } from 'react';
import type { toolCatalog } from '../../../../host/skills/tool-catalog';
import type { ReflectionApi } from '../reflection/reflection-state';
type Catalog = ReturnType<typeof toolCatalog>;
const status: Record<string, string> = {
  provided: 'Pi 可提供 · 尚未加载',
  available: '可调用',
  disabled: '未启用',
  enabled: '已启用',
  unloaded: '尚未生效',
};
export function ToolCatalog({
  api,
  project,
  onSkill,
}: {
  api: ReflectionApi;
  project: string;
  onSkill: (id: string) => void;
}) {
  const [loaded, setLoaded] = useState<{ project: string; catalog: Catalog }>();
  const catalog = loaded?.project === project ? loaded.catalog : undefined;
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let controller: AbortController | undefined;
    const load = () => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      void api<Catalog>(`/tools?${new URLSearchParams({ project })}`, 'GET', undefined, signal)
        .then((result) => {
          if (!signal.aborted) {
            setLoaded({ project, catalog: result });
            setError('');
          }
        })
        .catch((reason: unknown) => {
          if (!signal.aborted) setError(reason instanceof Error ? reason.message : 'Tool 列表读取失败');
        });
    };
    load();
    window.addEventListener('agent-skills-changed', load);
    window.addEventListener('agent-reconnected', load);
    window.addEventListener('agent-tools-changed', load);
    return () => {
      controller?.abort();
      window.removeEventListener('agent-skills-changed', load);
      window.removeEventListener('agent-reconnected', load);
      window.removeEventListener('agent-tools-changed', load);
    };
  }, [api, project, revision]);
  return (
    <details>
      <summary>Tool 列表与来源{catalog ? ` · ${catalog.tools.length}` : ''}</summary>
      <p>
        普通 Skill 是按需读取的指引，不一定提供执行 Tool。这里只展示原生 Tool 和会话已加载的
        Tool；未审查的来源不会为了展示而加载代码。
      </p>
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => setRevision((value) => value + 1)}>
            重试
          </button>
        </p>
      )}
      {catalog?.tools.map((tool) => (
        <details key={`${tool.source}:${tool.name}`}>
          <summary>
            {tool.name} · {status[tool.status]}
            {tool.skillName ? ` · ${tool.skillName}` : ''}
          </summary>
          <p>{tool.description}</p>
          <p>
            来源：{tool.source} · {tool.exposure}
          </p>
          <p>
            {tool.sessions.length} 个会话已加载 · {tool.activeSessions.length} 个会话向模型声明 ·{' '}
            {tool.callableSessions.length} 个会话可调用
          </p>
          {tool.skillId && (
            <button type="button" onClick={() => onSkill(tool.skillId ?? '')}>
              管理对应 Skill
            </button>
          )}
          <details>
            <summary>参数</summary>
            <pre>{JSON.stringify(tool.parameters, null, 2)}</pre>
          </details>
        </details>
      ))}
      {catalog?.sources.map((source) => (
        <div key={source.skillId}>
          <button type="button" onClick={() => onSkill(source.skillId)}>
            {source.name}
          </button>{' '}
          · {source.status === 'disabled' ? '已禁用' : status[source.status]} ·{' '}
          {source.review === 'not_required'
            ? '普通 Skill · 无执行 Extension，无需代码审查'
            : source.review === 'approved'
              ? '当前代码已审查'
              : source.review === 'evolution'
                ? '开发活动授权版本'
                : '执行代码尚未通过审查'}
          <p>
            {source.extensions.length
              ? source.loaded
                ? '执行 Tool 已加载，见上方列表'
                : 'Extension 尚未加载，不能读取运行时 Tool 参数'
              : '按需读取原生指引'}
          </p>
        </div>
      ))}
    </details>
  );
}
