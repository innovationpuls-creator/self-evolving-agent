import { ViewTabs, ViewPanel } from './controls';
import { diffLines } from 'diff';
import { useId, useState, isValidElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import { Copy, Check, ChevronDown, ChevronRight, FileCode, Braces } from 'lucide-react';
import { Button, TabBar } from './ui';
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', typescript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
export function Code({ text, language = 'text', file }: { text: string; language?: string; file?: string }) {
  const [copied, C] = useState<'idle' | 'done' | 'error'>('idle');
  const [wrap, W] = useState(false);
  return (
    <div className="code-view">
      <header>
        <span>
          <FileCode size={14} />
          {file ?? language}
        </span>
        <div>
          <button type="button" onClick={() => W(!wrap)} aria-pressed={wrap}>
            折行
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                C('done');
              } catch {
                C('error');
              }
              setTimeout(() => C('idle'), 1800);
            }}
          >
            {copied === 'done' ? <Check size={13} /> : <Copy size={13} />}{' '}
            {copied === 'done' ? '已复制' : copied === 'error' ? '复制失败' : '复制'}
          </button>
        </div>
      </header>
      <pre className={wrap ? 'wrap' : ''}>
        <code>
          {text
            .trimEnd()
            .split('\n')
            .map((line, i) => (
              <span className="code-line" key={`${i}-${line}`}>
                <span className="line-number" aria-hidden="true">
                  {i + 1}
                </span>
                {hljs.getLanguage(language) ? (
                  // Highlight.js escapes the source; only locally generated highlighting markup is inserted.
                  <span dangerouslySetInnerHTML={{ __html: hljs.highlight(line, { language }).value }} />
                ) : (
                  <span>{line || ' '}</span>
                )}
              </span>
            ))}
        </code>
      </pre>
    </div>
  );
}
export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ alt }) => <span className="muted">图片引用：{alt}</span>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          pre: ({ children }) => {
            const c = isValidElement<{ children?: string; className?: string }>(children) ? children.props : null;
            return (
              <Code text={String(c?.children ?? '')} language={c?.className?.replace('language-', '') ?? 'text'} />
            );
          },
          table: ({ children }) => (
            <div className="table-scroll">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
function JsonNode({ name, value, depth = 0 }: { name: string; value: unknown; depth?: number }) {
  const [open, O] = useState(depth < 1);
  const obj = value !== null && typeof value === 'object';
  if (!obj)
    return (
      <div className="json-leaf">
        <span className="json-key">{name}</span>
        <span className={`json-value ${typeof value}`}>{JSON.stringify(value)}</span>
      </div>
    );
  const entries = Object.entries(value);
  return (
    <div className="json-node">
      <button type="button" onClick={() => O(!open)} aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{name}</span>
        <small>{Array.isArray(value) ? `数组 · ${entries.length}` : `对象 · ${entries.length} 字段`}</small>
      </button>
      {open && (
        <div className="json-children">
          {entries.length ? (
            entries.map(([k, v]) => <JsonNode name={k} value={v} depth={depth + 1} key={k} />)
          ) : (
            <span className="muted">空{Array.isArray(value) ? '数组' : '对象'}</span>
          )}
        </div>
      )}
    </div>
  );
}
export function JsonTree({ value }: { value: unknown }) {
  return (
    <div className="json-tree">
      <JsonNode name="record" value={value} />
    </div>
  );
}

export function JsonView({ value }: { value: unknown }) {
  const [tab, T] = useState('字段');
  return (
    <div className="json-view">
      <div className="json-toolbar">
        <span>
          <Braces size={14} />
          结构化记录
        </span>
        <TabBar items={['字段', '原文']} value={tab} onChange={T} />
      </div>
      {tab === '字段' ? (
        <JsonNode name="record" value={value} />
      ) : (
        <Code text={JSON.stringify(value, null, 2)} language="json" />
      )}
    </div>
  );
}
export function Diff({
  before,
  after,
  file = 'SKILL.md',
  workspace = false,
}: {
  before: string;
  after: string;
  file?: string;
  workspace?: boolean;
}) {
  const panelId = useId();
  const [view, V] = useState('对比');
  const [expanded, EX] = useState<Record<number, boolean>>({});
  let oldLine = 1;
  let newLine = 1;
  const lines = diffLines(before, after).flatMap((part) =>
    part.value
      .replace(/\n$/, '')
      .split('\n')
      .map((text) => ({
        text,
        type: part.added ? 'added' : part.removed ? 'removed' : 'context',
        old: part.added ? '' : oldLine++,
        next: part.removed ? '' : newLine++,
      })),
  );
  const contents =
    view === '对比' ? (
      <div className="diff-lines">
        {(() => {
          const display: React.ReactNode[] = [];
          const row = (line: (typeof lines)[number], i: number) => (
            <div className={line.type === 'context' ? 'diff-context' : line.type} key={`${i}-${line.type}`}>
              <span>{line.old}</span>
              <span>{line.next}</span>
              <span className="diff-sign">{line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' '}</span>
              <div>{line.text || ' '}</div>
            </div>
          );
          for (let i = 0; i < lines.length; ) {
            const current = lines[i];
            if (!current) break;
            if (current.type !== 'context') {
              display.push(row(current, i));
              i++;
              continue;
            }
            let end = i;
            while (end < lines.length && lines[end]?.type === 'context') end++;
            const leading = i === 0,
              trailing = end === lines.length;
            const keepHead = leading ? 0 : 3,
              keepTail = trailing ? 0 : 3;
            const hidden = end - i - keepHead - keepTail;
            if (hidden > 2 && !expanded[i]) {
              for (const [offset, line] of lines.slice(i, i + keepHead).entries()) display.push(row(line, i + offset));
              const key = i;
              display.push(
                <button
                  type="button"
                  className="diff-fold"
                  key={`fold-${i}`}
                  onClick={() => EX({ ...expanded, [key]: true })}
                >
                  <ChevronDown size={13} />
                  展开 {hidden} 行未改内容
                </button>,
              );
              for (const [offset, line] of lines.slice(end - keepTail, end).entries())
                display.push(row(line, end - keepTail + offset));
            } else for (const [offset, line] of lines.slice(i, end).entries()) display.push(row(line, i + offset));
            i = end;
          }
          return display;
        })()}
      </div>
    ) : (
      <div className="diff-originals">
        <Code text={before} language="markdown" file={`${file} / 修改前`} />
        <Code text={after} language="markdown" file={`${file} / 修改后`} />
      </div>
    );
  return (
    <div className="diff-view">
      <header>
        <span>
          <FileCode size={14} />
          {file}
        </span>
        {workspace ? (
          <ViewTabs id={panelId} items={['对比', '完整内容']} value={view} onChange={V} label="差异视图" />
        ) : (
          <TabBar items={['对比', '完整内容']} value={view} onChange={V} />
        )}
      </header>
      {workspace ? (
        <ViewPanel id={panelId} items={['对比', '完整内容']} value={view}>
          {contents}
        </ViewPanel>
      ) : (
        contents
      )}
    </div>
  );
}
