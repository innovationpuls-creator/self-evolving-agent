// biome-ignore lint/correctness/noUnusedImports: tsx runs tests/web-state.test.ts with the classic JSX transform (apps/web is outside the root tsconfig), which needs React in scope.
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ alt }) => <span className="image-reference">{alt ? `图片：${alt}` : '图片引用'}</span>,
          a: ({ children, href }) =>
            href ? (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          table: ({ children }) => (
            <div className="table-scroll">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
