import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { body, json } from '../transport/http.js';
import {
  EvolutionError,
  evolutionInput,
  evolutionSelection,
  type EnsureDiscussion,
  type AuthorizeSuggestion,
  type EvolutionService,
} from './evolution.js';

export async function evolutionRoutes(
  evolution: EvolutionService,
  ensureDiscussion: EnsureDiscussion,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  authorize?: AuthorizeSuggestion,
): Promise<boolean> {
  const route = url.pathname;
  if (!/^\/api\/suggestions(?:\/|$)/.test(route)) return false;
  try {
    if (route === '/api/suggestions') {
      if (req.method === 'GET') {
        json(res, 200, evolution.list({ actor: 'user' }, Object.fromEntries(url.searchParams)));
        return true;
      }
      if (req.method === 'POST') {
        const input = evolutionInput.parse(await body(req));
        await authorize?.({ actor: 'user' }, input);
        json(res, 201, evolution.create({ actor: 'user' }, input));
        return true;
      }
    }
    if (route === '/api/suggestions/manage' && req.method === 'POST') {
      const input = z
        .object({ items: evolutionSelection, status: z.enum(['ignored', 'archived']) })
        .strict()
        .parse(await body(req));
      json(res, 200, evolution.manage(input.items, input.status));
      return true;
    }
    const match = /^\/api\/suggestions\/([a-f0-9-]{36})(?:\/(adopt))?$/.exec(route);
    if (match) {
      const id = match[1];
      if (!id) return false;
      if (!match[2] && req.method === 'GET') {
        json(res, 200, evolution.get({ actor: 'user' }, id));
        return true;
      }
      if (match[2] === 'adopt' && req.method === 'POST') {
        const input = z
          .object({ baseRevision: z.number().int().positive() })
          .strict()
          .parse(await body(req));
        json(res, 200, await evolution.adopt(id, input.baseRevision, ensureDiscussion));
        return true;
      }
    }
    json(res, 405, { error: '不支持的建议操作' });
  } catch (error) {
    if (error instanceof EvolutionError) json(res, error.status, { error: error.message, code: error.code });
    else if (error instanceof z.ZodError) json(res, 400, { error: '建议字段无效', code: 'EVOLUTION_INPUT' });
    else json(res, 503, { error: '建议操作未完成，请刷新后重试', code: 'EVOLUTION_FAILED' });
  }
  return true;
}
