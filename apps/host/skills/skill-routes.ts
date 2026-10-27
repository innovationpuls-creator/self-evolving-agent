import type { IncomingMessage, ServerResponse } from 'node:http';
import { body, json } from '../transport/http.js';
import { z } from 'zod';
import type { AgentService } from '../runtime/agent.js';

export async function skillRoutes(
  service: Pick<AgentService, 'skills' | 'sensitive' | 'skillDetail' | 'refreshSkillKnowledge' | 'tools'>,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const route = url.pathname;
  if (route === '/api/tools' && req.method === 'GET') {
    json(res, 200, await service.tools(url.searchParams.get('project') || undefined));
    return true;
  }
  if (route === '/api/skills' && req.method === 'GET') {
    json(res, 200, service.sensitive.copy(await service.skills.discover(url.searchParams.get('project') ?? undefined)));
    return true;
  }
  if (route === '/api/skills' && req.method === 'POST') {
    const input = z
      .object({
        source: z.string().min(1).max(4096),
        project: z.string().optional(),
        bindings: z
          .array(
            z
              .object({
                skill: z.string(),
                extensions: z.array(z.string()),
                knowledgeFiles: z.array(z.string()).optional(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict()
      .parse(await body(req));
    json(res, 202, service.sensitive.copy(service.skills.startImport(input)));
    return true;
  }
  const operation = /^\/api\/skills\/operations\/([a-f0-9-]{36})$/.exec(route);
  if (operation && req.method === 'GET') {
    json(res, 200, service.sensitive.copy(service.skills.operation(operation[1]!)));
    return true;
  }
  const skillRoute =
    /^\/api\/skills\/([a-f0-9-]{36})(?:\/(files|edit|review|publish|enabled|rollback|knowledge|draft|import-draft))?$/.exec(
      route,
    );
  if (skillRoute) {
    const id = skillRoute[1]!,
      action = skillRoute[2];
    if (!action && req.method === 'GET') {
      json(res, 200, service.sensitive.copy(await service.skillDetail(id)));
      return true;
    }
    if (action === 'files' && req.method === 'GET') {
      json(
        res,
        200,
        service.sensitive.copy(
          await service.skills.read(
            id,
            url.searchParams.get('version') ?? '',
            url.searchParams.get('path') ?? '',
            url.searchParams.get('snapshot') === 'true',
          ),
        ),
      );
      return true;
    }
    if (action === 'draft' && req.method === 'DELETE') {
      await service.skills.discardDraft(id);
      json(res, 200, { ok: true });
      return true;
    }
    if (req.method === 'POST') {
      if (action === 'edit') {
        const x = z
          .object({
            baseRevision: z.number().int(),
            files: z
              .array(z.object({ path: z.string(), content: z.string().max(1000000).nullable() }).strict())
              .min(1)
              .max(50),
          })
          .strict()
          .parse(await body(req));
        json(res, 201, service.sensitive.copy(await service.skills.edit(id, x.baseRevision, x.files)));
        return true;
      }
      if (action === 'review') {
        const x = z
          .object({
            version: z.string().uuid(),
            digest: z.string(),
            notes: z.string().max(10000),
            reviewedCode: z.literal(true),
            reviewedDependencies: z.literal(true),
            reviewedPermissions: z.literal(true),
          })
          .strict()
          .parse(await body(req));
        json(res, 200, service.sensitive.copy(await service.skills.review(id, x.version, x.digest, x.notes)));
        return true;
      }
      if (action === 'publish' || action === 'rollback') {
        const x = z
          .object({ version: z.string().uuid(), baseRevision: z.number().int() })
          .strict()
          .parse(await body(req));
        json(res, 202, service.sensitive.copy(service.skills.publish(id, x.version, x.baseRevision)));
        return true;
      }
      if (action === 'enabled') {
        const x = z
          .object({ enabled: z.boolean(), baseRevision: z.number().int() })
          .strict()
          .parse(await body(req));
        const r = service.skills.record(id);
        json(
          res,
          202,
          service.sensitive.copy(service.skills.publish(id, r.current ?? r.latest, x.baseRevision, x.enabled)),
        );
        return true;
      }
      if (action === 'knowledge') {
        const x = z
          .object({ baseRevision: z.number().int(), path: z.string(), content: z.string().max(1000000) })
          .strict()
          .parse(await body(req));
        const result = await service.skills.setKnowledge(id, x.baseRevision, x.path, x.content);
        await service.refreshSkillKnowledge();
        json(res, 200, service.sensitive.copy(result));
        return true;
      }
      if (action === 'draft') {
        await body(req);
        json(res, 201, await service.skills.prepareDraft(id));
        return true;
      }
      if (action === 'import-draft') {
        const x = z
          .object({ baseRevision: z.number().int() })
          .strict()
          .parse(await body(req));
        json(res, 201, service.sensitive.copy(await service.skills.importDraft(id, x.baseRevision)));
        return true;
      }
    }
  }
  return false;
}
