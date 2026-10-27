import { useState } from 'react';
import { sourceEvidence } from './source-fixtures';
import { ArrowUpRight } from 'lucide-react';
import { Button, Modal, Notice } from '../components/ui';
import { Evidence } from './content';
import { useDemo } from '../state/store';
import { useWorkspaceData, type EvolutionEvidence } from './host-data';
import { projectMemory } from './memory-model';
import { projectName } from './Context';
import { loadedDemoSessions, fixtureProjects } from './host-fixtures';
import { Related } from './shared';

function sourceText(content: string) {
  try {
    const value = JSON.parse(content);
    const blocks: unknown = value?.message?.content;
    if (Array.isArray(blocks) && blocks.every((c) => c?.type === 'text' && typeof c.text === 'string'))
      return blocks.map((c) => c.text).join('\n');
  } catch {
    /* Keep malformed or non-text evidence readable as returned. */
  }
  return content;
}

export function SourceSession({ id, onNavigate, entryId }: { id: string; onNavigate?: () => void; entryId?: string }) {
  const x = useDemo(),
    w = useWorkspaceData();
  const [reading, READ] = useState(false);
  const entries = sourceEvidence.filter((e) => e.sessionId === id && (!entryId || e.entryId === entryId));
  const session = w.data.sessions.find((s) => s.id === id);
  const loaded = loadedDemoSessions[id];
  return (
    <div className="aw-source-session">
      <strong>{session?.title || '来源会话标题未返回'}</strong>
      {session && (
        <small>
          {projectName(session.cwd)} · {session.cwd}
        </small>
      )}
      {loaded && (
        <Button
          kind="ghost"
          onClick={() => {
            onNavigate?.();
            x.setSid(loaded);
            x.go('chat');
          }}
        >
          打开来源会话
          <ArrowUpRight size={14} />
        </Button>
      )}
      <Button kind="ghost" onClick={() => READ(true)}>
        {entryId ? '查看来源片段' : '查看来源记录'}
        <ArrowUpRight size={14} />
      </Button>
      {!session && <code>{id}</code>}
      <Modal
        open={reading}
        onClose={() => READ(false)}
        title={session?.title || '来源记录'}
        description={session?.cwd}
        drawer
      >
        {entries.length ? (
          entries.map((entry) => (
            <section className="aw-source-entry" key={entry.entryId}>
              <h3>保存的来源片段</h3>
              <p className="aw-muted">
                {entry.onSelectedBranch ? '当前选中分支' : '不在当前选中分支'} ·{' '}
                {entry.source === 'checkpoint' ? '保存的检查点' : '上一检查点'}
              </p>
              {entry.available ? (
                <>
                  <pre>{sourceText(('content' in entry && entry.content) || '')}</pre>
                  {entry.truncated && <Notice title="来源仅返回部分内容">当前片段不代表完整来源。</Notice>}
                </>
              ) : (
                <Notice title="来源片段不可用">
                  {('reason' in entry && entry.reason) === 'entry_missing_from_checkpoint'
                    ? '保存的检查点中未找到这条引用。'
                    : '当前无法读取已保存的来源，不能据此核实结论。'}
                </Notice>
              )}
              <details>
                <summary>查看完整来源条目</summary>
                <Evidence value={entry} />
              </details>
            </section>
          ))
        ) : (
          <Notice title="来源正文未载入">
            保留的引用仍可查看，当前不能据此核实原文。
            <Evidence value={{ sessionId: id, ...(entryId ? { entryId } : {}) }} />
          </Notice>
        )}
      </Modal>
    </div>
  );
}

export function References({
  items,
  onNavigate,
  project,
  identifiers = true,
}: {
  items: EvolutionEvidence[];
  onNavigate?: () => void;
  project?: string;
  identifiers?: boolean;
}) {
  const x = useDemo(),
    w = useWorkspaceData();
  return (
    <div className="aw-references">
      {!items.length && <p className="aw-muted">未返回可查看的证据引用</p>}
      {items.map((ref, i) => {
        const rawMemory = ref.memoryId ? w.data.memories.find((m) => m.current.id === ref.memoryId) : undefined;
        const memory = rawMemory && projectMemory(rawMemory, fixtureProjects[project ?? w.project ?? '']);
        const rev = ref.revision ? memory?.history.find((r) => r.revision === ref.revision) : memory?.current;
        const reflection = w.data.reflections.find((r) => r.job.id === ref.reflectionId);
        const source = reflection && w.data.sessions.find((s) => s.id === reflection.job.sessionId);
        return (
          <div className="aw-reference" key={JSON.stringify(ref) + i}>
            {ref.sessionId && <SourceSession id={ref.sessionId} entryId={ref.entryId} onNavigate={onNavigate} />}
            {ref.memoryId &&
              (rev ? (
                <button
                  className="aw-related"
                  type="button"
                  onClick={() => {
                    onNavigate?.();
                    w.requestMemory({ id: rev.id, revision: ref.revision, project: project ?? w.project });
                    x.setObject('memory', rev.id);
                    x.go('memory');
                  }}
                >
                  <span>
                    <small>记忆 · 修订 {rev.revision}</small>
                    <strong>{rev.title}</strong>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ) : (
                <p>
                  记忆修订未载入 · <code>{ref.memoryId}</code>
                  {ref.revision && ` · 修订 ${ref.revision}`}
                </p>
              ))}
            {ref.reflectionId &&
              (reflection ? (
                <Related
                  onNavigate={onNavigate}
                  title={source?.title || '任务检查记录'}
                  meta="反思记录"
                  page="reflection"
                  object={{ type: 'reflection', id: reflection.job.id }}
                />
              ) : (
                <p>
                  检查记录未载入 · <code>{ref.reflectionId}</code>
                </p>
              ))}
            {ref.skillId && (
              <p>
                技能引用 · <code>{ref.skillId}</code>
                {ref.knowledgeRevision && ` · 知识修订 ${ref.knowledgeRevision}`}
              </p>
            )}
            {ref.traceId && !ref.sessionId && (
              <p>
                执行轨迹引用 · <code>{ref.traceId}</code>
              </p>
            )}
            {identifiers && (
              <details>
                <summary>来源标识</summary>
                <Evidence value={ref} />
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
