export function inputQuery(text: string, cursor: number) {
  const prefix = text.slice(0, cursor);
  const skill = /^\/skill:([^\s]*)$/.exec(prefix);
  if (skill)
    return {
      kind: 'skills' as const,
      query: skill[1] ?? '',
      start: 0,
      end: cursor + (text.slice(cursor).match(/^\S*/)?.[0].length ?? 0),
    };
  const file = /(?:^|\s)@("(?:\\.|[^"\\\r\n])*|[^\s"\r\n]*)$/.exec(prefix);
  if (file?.[1] !== undefined) {
    const token = file[1];
    const start = cursor - token.length - 1;
    let end = cursor;
    let query = token;
    if (token.startsWith('"')) {
      try {
        query = JSON.parse(`${token}"`) as string;
      } catch {
        return undefined;
      }
      let escaped = false;
      for (; end < text.length && !/[\r\n]/.test(text[end] ?? ''); end++) {
        const character = text[end];
        if (!escaped && character === '"') {
          end++;
          break;
        }
        escaped = !escaped && character === '\\';
      }
    } else end += text.slice(cursor).match(/^[^\s"]*/)?.[0].length ?? 0;
    return { kind: 'files' as const, query, start, end };
  }
  return undefined;
}

export function referencedFiles(text: string) {
  return [
    ...new Set(
      [...text.matchAll(/(?:^|\s)@("(?:\\.|[^"\\\r\n])*")/g)].flatMap((match) => {
        try {
          const path: unknown = JSON.parse(match[1] ?? '');
          return typeof path === 'string' && path ? [path] : [];
        } catch {
          return [];
        }
      }),
    ),
  ];
}
