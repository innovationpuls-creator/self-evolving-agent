import type { IncomingMessage, ServerResponse } from 'node:http';
import { body, json } from '../transport/http.js';
import { z } from 'zod';
import { memoryContent, memoryReason } from './memory.js';
import type { AgentService } from '../runtime/agent.js';

export async function memoryRoutes(
  service: Pick<AgentService, 'memory' | 'memoryUserContext'>,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const route = url.pathname;
  const memoryRoute = /^\/api\/memory(?:\/([a-f0-9-]{36})(?:\/(revise))?)?$/.exec(route);
  if (memoryRoute) {
    const query = z
      .object({
        project: z.string().max(4096).optional(),
        query: z.string().max(1000).optional(),
        includeHistory: z.enum(['true', 'false']).optional(),
        scope: z.enum(['global', 'project']).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      })
      .strict()
      .parse(Object.fromEntries(url.searchParams));
    const ctx = await service.memoryUserContext(query.project),
      id = memoryRoute[1];
    if (req.method === 'GET') {
      json(
        res,
        200,
        id
          ? service.memory.get(ctx, id, query.includeHistory === 'true')
          : service.memory.search(ctx, { ...query, includeHistory: query.includeHistory === 'true' }),
      );
      return true;
    }
    if (req.method === 'POST' && !id) {
      const x = z
        .object({ knowledge: memoryContent, reason: memoryReason })
        .strict()
        .parse(await body(req));
      json(res, 201, service.memory.create(ctx, x.knowledge, x.reason));
      return true;
    }
    if (req.method === 'POST' && id && memoryRoute[2] === 'revise') {
      const x = z
        .object({
          baseRevision: z.number().int().positive(),
          knowledge: memoryContent.optional(),
          reason: memoryReason,
          confirm: z.boolean().optional(),
          retire: z.boolean().optional(),
        })
        .strict()
        .parse(await body(req));
      json(res, 200, service.memory.revise(ctx, id, { ...x, content: x.knowledge }));
      return true;
    }
    if (req.method === 'DELETE' && id && !memoryRoute[2]) {
      const x = z
        .object({ baseRevision: z.number().int().positive(), reason: memoryReason })
        .strict()
        .parse(await body(req));
      json(res, 200, service.memory.revise(ctx, id, { ...x, remove: true }));
      return true;
    }
    json(res, 405, { error: '不支持的 Memory 操作' });
    return true;
  }
  return false;
}
