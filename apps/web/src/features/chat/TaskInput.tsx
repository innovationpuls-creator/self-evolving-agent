import { useEffect, useId, useRef, useState } from 'react';
import type { ReflectionApi } from '../reflection/reflection-state';
import { inputQuery } from './input-completion';

interface Candidate {
  value: string;
  description: string;
  directory?: boolean;
}

export function TaskInput({
  api,
  sessionId,
  value,
  ready,
  onChange,
  onSend,
}: {
  api: ReflectionApi;
  sessionId: string;
  value: string;
  ready: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [cursor, setCursor] = useState(value.length);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState('');
  const query = inputQuery(value, cursor);
  const queryKey = query ? `${query.kind}:${query.query}:${query.start}:${query.end}` : '';
  useEffect(() => {
    const controller = new AbortController();
    setCandidates([]);
    setSelected(0);
    setError('');
    if (!query || !ready || dismissed) return () => controller.abort();
    const timer = setTimeout(() => {
      void api<{
        skills?: Array<{ name: string; description: string }>;
        files?: Array<{ path: string; directory: boolean }>;
      }>(
        `/sessions/${sessionId}/input-resources?${new URLSearchParams({ kind: query.kind, query: query.query })}`,
        'GET',
        undefined,
        controller.signal,
      )
        .then((result) => {
          if (controller.signal.aborted) return;
          setCandidates(
            query.kind === 'skills'
              ? (result.skills ?? []).map((skill) => ({
                  value: `/skill:${skill.name}`,
                  description: skill.description,
                }))
              : (result.files ?? []).map((file) => ({
                  value: file.path,
                  directory: file.directory,
                  description: file.directory ? '目录 · 继续选择文件' : '文件内容将通过当前会话的 read 权限读取',
                })),
          );
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '候选读取失败');
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [api, sessionId, queryKey, ready, dismissed]);
  useEffect(() => {
    setCursor(value.length);
    setDismissed(false);
  }, [sessionId]);
  const choose = (candidate: Candidate) => {
    if (!query) return;
    const replacement =
      query.kind === 'skills'
        ? `${candidate.value} `
        : candidate.directory
          ? `@${JSON.stringify(candidate.value).slice(0, -1)}`
          : `@${JSON.stringify(candidate.value)} `;
    const next = value.slice(0, query.start) + replacement + value.slice(query.end);
    const position = query.start + replacement.length;
    onChange(next);
    setCursor(position);
    setDismissed(false);
    setCandidates([]);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(position, position);
    });
  };
  return (
    <>
      <textarea
        ref={textarea}
        aria-label="任务"
        placeholder="描述任务，输入 /skill: 选择能力，@ 引用项目文件…"
        value={value}
        aria-controls={candidates.length ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={candidates.length ? `${listId}-${selected}` : undefined}
        onChange={(event) => {
          onChange(event.target.value);
          setCursor(event.target.selectionStart);
          setDismissed(false);
        }}
        onSelect={(event) => setCursor(event.currentTarget.selectionStart)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSend();
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setDismissed(true);
            setCandidates([]);
            return;
          }
          if (!candidates.length || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setSelected(
              (index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + candidates.length) % candidates.length,
            );
          }
          if (event.key === 'Tab' || event.key === 'Enter') {
            const candidate = candidates[selected];
            if (candidate) {
              event.preventDefault();
              choose(candidate);
            }
          }
        }}
      />
      {!!candidates.length && (
        <div id={listId} className="input-candidates" role="listbox" aria-label="输入候选">
          {candidates.map((candidate, index) => (
            <div
              key={candidate.value}
              role="option"
              tabIndex={-1}
              id={`${listId}-${index}`}
              aria-selected={index === selected}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(candidate)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  choose(candidate);
                }
              }}
            >
              <strong>{candidate.value}</strong>
              <small>{candidate.description}</small>
            </div>
          ))}
        </div>
      )}
      {error && <p role="status">{error}</p>}
    </>
  );
}
