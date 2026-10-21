import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { AgentService } from '../runtime/agent.js';
import { body, json } from '../transport/http.js';
import { activityGrant } from './activities.js';

export async function activityRoutes(service: AgentService, req: IncomingMessage, res: ServerResponse, url: URL) {
  if (url.pathname === '/api/activities') {
    if (req.method === 'GET') json(res, 200, service.activities.list());
    else if (req.method === 'POST') {
      const input = z
        .object({ sessionId: z.string().uuid(), goal: z.string().trim().min(1).max(8000) })
        .strict()
        .parse(await body(req));
      json(res, 201, await service.createActivity(input.sessionId, input.goal));
    } else json(res, 405, { error: '不支持的活动操作' });
    return true;
  }
  const match = /^\/api\/activities\/([a-f0-9-]{36})(?:\/(authorize|cancel))?$/.exec(url.pathname);
  if (!match) return false;
  const id = match[1]!;
  if (!match[2] && req.method === 'GET') json(res, 200, service.activities.get(id));
  else if (match[2] === 'authorize' && req.method === 'POST')
    json(res, 202, await service.authorizeActivity(id, activityGrant.parse(await body(req))));
  else if (match[2] === 'cancel' && req.method === 'POST') {
    await body(req);
    json(res, 200, await service.cancelActivity(id));
  } else json(res, 405, { error: '不支持的活动操作' });
  return true;
}
