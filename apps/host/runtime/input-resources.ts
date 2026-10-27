import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { runToolCall } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { randomUUID } from 'node:crypto';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { contained, SkillError } from '../skills/skills.js';
import type { SensitiveData } from '../storage/storage.js';

const excluded = new Set(['.git', '.pi', '.ssh', '.aws', 'node_modules']);
const privateName = /^(?:\.env(?:\..*)?|auth\.json|credentials(?:\..*)?|.*\.(?:pem|key|enc))$/i;

async function referencePath(cwd: string, path: string, protectedRoot: string) {
  if (!path || isAbsolute(path) || path.includes('\\') || path.includes('\0'))
    throw new SkillError('文件引用须使用项目内相对路径', 400);
  const root = await realpath(cwd);
  const absolute = resolve(root, path);
  if (!contained(root, absolute) || path.split('/').some((part) => excluded.has(part) || privateName.test(part)))
    throw new SkillError('不能引用项目外文件或凭据文件', 403);
  const actual = await realpath(absolute).catch(() => {
    throw new SkillError('引用文件不存在或不可访问', 400);
  });
  if (
    !contained(root, actual) ||
    contained(await realpath(protectedRoot), actual) ||
    relative(root, actual)
      .split(sep)
      .some((part) => excluded.has(part) || privateName.test(part))
  )
    throw new SkillError('文件引用超出当前项目权限', 403);
  return actual;
}

export async function fileCandidates(cwd: string, query: string, protectedRoot: string) {
  const root = await realpath(cwd);
  const normalized = query.replaceAll('\\', '/');
  const directory = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/') + 1) : '.';
  const prefix = normalized.includes('/') ? normalized.slice(normalized.lastIndexOf('/') + 1) : normalized;
  const parent = directory === '.' ? root : await referencePath(root, directory, protectedRoot);
  if (contained(await realpath(protectedRoot), parent)) throw new SkillError('不能浏览 Host 数据目录', 403);
  const entries = await readdir(parent, { withFileTypes: true });
  const matches = entries.filter(
    (entry) =>
      !excluded.has(entry.name) &&
      !privateName.test(entry.name) &&
      entry.name.toLowerCase().startsWith(prefix.toLowerCase()) &&
      (entry.isFile() || entry.isDirectory()),
  );
  return matches
    .sort(
      (left, right) => Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name),
    )
    .slice(0, 80)
    .map((entry) => ({
      path: relative(root, resolve(parent, entry.name)).split(sep).join('/') + (entry.isDirectory() ? '/' : ''),
      directory: entry.isDirectory(),
    }));
}

export async function prepareFileReferences(
  session: AgentSession,
  cwd: string,
  files: string[],
  protectedRoot: string,
  sensitive: SensitiveData,
  signal?: AbortSignal,
) {
  if (files.length > 8 || new Set(files).size !== files.length) throw new SkillError('每次最多引用 8 个不同文件', 400);
  const blocks: string[] = [];
  const images: NonNullable<Parameters<AgentSession['prompt']>[1]>['images'] = [];
  for (const path of files) {
    signal?.throwIfAborted();
    const actual = await referencePath(cwd, path, protectedRoot);
    const info = await lstat(actual);
    if (!info.isFile() || info.size > 1024 * 1024) throw new SkillError('只能引用不超过 1 MB 的普通文件', 400);
    const call = { type: 'toolCall' as const, id: randomUUID(), name: 'read', arguments: { path: actual } };
    const model = session.model;
    if (!model) throw new SkillError('当前会话没有可用模型', 409);
    const message: AssistantMessage = {
      role: 'assistant',
      content: [call],
      api: model.api,
      provider: model.provider,
      model: model.id,
      stopReason: 'toolUse',
      timestamp: Date.now(),
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    const outcome = await runToolCall(call, {
      tools: session.agent.state.tools,
      assistantMessage: message,
      context: session.agent.state,
      beforeToolCall: session.agent.beforeToolCall,
      afterToolCall: session.agent.afterToolCall,
      signal,
    });
    if (outcome.isError) throw new SkillError('文件读取失败或被当前会话权限拒绝', 403);
    for (const content of outcome.result.content) {
      if (content.type === 'image') images.push(content);
      else if (content.type === 'text')
        blocks.push(
          `<file-reference path=${JSON.stringify(path)}>\n${sensitive.text(content.text)}\n</file-reference>`,
        );
    }
  }
  return { text: blocks.join('\n\n'), images };
}
