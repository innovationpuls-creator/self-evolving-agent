import type { IncomingMessage, ServerResponse } from 'node:http';
import { body, json } from '../transport/http.js';
import { z } from 'zod';
import type { AgentService } from './agent.js';

const createInput = z
  .object({ cwd: z.string().min(1).max(4096), provider: z.string().min(1), model: z.string().min(1) })
  .strict();
const credentialInput = z
  .object({
    provider: z.string().min(1),
    key: z.string().max(16384).optional(),
    importExisting: z.boolean().optional(),
  })
  .strict();

export async function sessionRoutes(
  service: Pick<
    AgentService,
    | 'models'
    | 'credentials'
    | 'list'
    | 'create'
    | 'recoverSkills'
    | 'viewSession'
    | 'export'
    | 'prompt'
    | 'stop'
    | 'action'
  >,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const route = url.pathname;
  if (route === '/api/models' && req.method === 'GET') {
    json(res, 200, await service.models());
    return true;
  }
  if (route === '/api/credentials' && req.method === 'POST') {
    const x = credentialInput.parse(await body(req));
    await service.credentials(x.provider, x.key, x.importExisting);
    json(res, 200, { ok: true });
    return true;
  }
  if (route === '/api/sessions' && req.method === 'GET') {
    json(res, 200, await service.list());
    return true;
  }
  if (route === '/api/sessions' && req.method === 'POST') {
    const x = createInput.parse(await body(req));
    json(res, 201, await service.create(x.cwd, x.provider, x.model));
    return true;
  }
  const recover = /^\/api\/sessions\/([a-f0-9-]{36})\/recover-skills$/.exec(route);
  if (recover && req.method === 'POST') {
    await service.recoverSkills(recover[1]!);
    json(res, 200, { ok: true });
    return true;
  }
  const match = /^\/api\/sessions\/([a-f0-9-]{36})(?:\/(prompt|stop|compact|branch|model|thinking|export))?$/.exec(
    route,
  );
  if (match) {
    const id = match[1]!,
      action = match[2];
    if (!action && req.method === 'GET') {
      json(res, 200, await service.viewSession(id));
      return true;
    }
    if (action === 'export' && req.method === 'GET') {
      json(res, 200, await service.export(id));
      return true;
    }
    if (req.method === 'POST') {
      if (action === 'prompt') {
        const x = z
          .object({ text: z.string().min(1).max(200000) })
          .strict()
          .parse(await body(req));
        await service.prompt(id, x.text);
        json(res, 202, { ok: true });
        return true;
      }
      if (action === 'stop') {
        await service.stop(id);
        json(res, 200, { ok: true });
        return true;
      }
      if (action === 'compact' || action === 'branch' || action === 'model' || action === 'thinking') {
        const x = z
          .object({ value: z.string().optional(), provider: z.string().optional() })
          .strict()
          .parse(await body(req));
        json(res, 200, await service.action(id, action, x.value, x.provider));
        return true;
      }
    }
  }
  return false;
}
