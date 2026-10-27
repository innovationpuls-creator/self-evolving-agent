import { FolderOpen, Globe2 } from 'lucide-react';
import { useWorkspaceData } from './host-data';
export const projectName = (path?: string) => path?.split('/').filter(Boolean).at(-1) || '全局';
export function MemoryScope({ disabled = false, onChange }: { disabled?: boolean; onChange?: () => void }) {
  const w = useWorkspaceData();
  const count = w.data.sessions.filter((s) => s.cwd === w.project && s.purpose === 'chat').length;
  return (
    <div className="aw-scope-bar">
      {w.project ? <FolderOpen size={19} /> : <Globe2 size={19} />}
      <div className="aw-scope-control">
        <label className="aw-visually-hidden" htmlFor="aw-memory-scope">
          浏览范围
        </label>
        <select
          id="aw-memory-scope"
          value={w.projectChoice}
          disabled={disabled}
          onChange={(e) => {
            onChange?.();
            w.requestMemory(undefined);
            w.chooseProject(e.target.value);
          }}
        >
          <option value="follow">随参考会话 · {w.contextSession ? projectName(w.contextSession.cwd) : '仅全局'}</option>
          <option value="global">仅全局记忆</option>
          <optgroup label="已有会话的项目">
            {w.projects.map((p) => (
              <option value={p} key={p}>
                {w.projects.filter((v) => projectName(v) === projectName(p)).length > 1 ? p : projectName(p)}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
      <details className="aw-scope-path">
        <summary>{w.project ? '项目范围' : '全局范围'}</summary>
        <p>{w.project ?? '跨项目使用'}</p>
        {w.project && <p>{count} 个会话共享 · 包含全局记忆</p>}
      </details>
    </div>
  );
}
export function SessionContext() {
  const w = useWorkspaceData();
  return (
    <div className="aw-session-selector">
      <label className="aw-visually-hidden" htmlFor="aw-tool-session">
        查看会话中的工具
      </label>
      <select id="aw-tool-session" value={w.sessionChoice} onChange={(e) => w.chooseSession(e.target.value)}>
        <option value="follow">跟随当前会话</option>
        <option value="">不选择会话</option>
        {w.data.sessions
          .filter((s) => s.purpose === 'chat')
          .map((s) => (
            <option value={s.id} key={s.id}>
              {s.title} · {projectName(s.cwd)}
            </option>
          ))}
      </select>
    </div>
  );
}
