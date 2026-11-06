import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { body, json } from '../transport/http.js';
import { ReflectionError, type ReflectionService } from './reflection-service.js';

export async function reflectionRoutes(
  service: Pick<ReflectionService, 'jobs' | 'list' | 'catalog' | 'get' | 'availability' | 'recheck' | 'wake'>,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const route = url.pathname;
  if (!/^\/api\/reflections(?:\/|$)/.test(route)) return false;
  try {
    if (route === '/api/reflections' && req.method === 'GET') {
      const query = z
        .object({
          sessionId: z.string().uuid().optional(),
          view: z.enum(['summary', 'status']).optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(),
          offset: z.coerce.number().int().min(0).optional(),
        })
        .strict()
        .parse(Object.fromEntries(url.searchParams));
      if (query.view) {
        json(res, 200, service.catalog({ ...query, statusOnly: query.view === 'status' }));
        return true;
      }
      json(res, 200, {
        records: await service.list(query.sessionId),
        jobs: service.jobs.list(query),
        availability: await service.availability(),
      });
      return true;
    }
    if (route === '/api/reflections/expedite' && req.method === 'POST') {
      const input = z
        .object({ sessionId: z.string().uuid() })
        .strict()
        .parse(await body(req));
      const updated = service.jobs.expedite(input.sessionId);
      service.wake();
      json(res, 200, { ok: true, updated });
      return true;
    }
    if (route === '/api/reflections/recheck' && req.method === 'POST') {
      z.object({})
        .strict()
        .parse(await body(req));
      const controller = new AbortController();
      const cancel = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.once('close', cancel);
      try {
        await service.recheck(controller.signal);
      } finally {
        res.off('close', cancel);
      }
      json(res, 200, { ok: true, availability: await service.availability() });
      return true;
    }
    const jobMatch = /^\/api\/reflections\/jobs\/([a-f0-9-]{36})$/.exec(route);
    if (jobMatch?.[1] && req.method === 'GET') {
      const job = service.jobs.get(jobMatch[1]);
      if (!job) json(res, 404, { error: '反思任务不存在', code: 'REFLECTION_NOT_FOUND' });
      else json(res, 200, { job });
      return true;
    }
    const match = /^\/api\/reflections\/([a-f0-9-]{36})$/.exec(route);
    if (match?.[1] && req.method === 'GET') {
      const record = await service.get(match[1]);
      if (!record) json(res, 404, { error: '反思记录不存在', code: 'REFLECTION_NOT_FOUND' });
      else json(res, 200, { record, job: service.jobs.get(record.jobId) });
      return true;
    }
    if (
      route === '/api/reflections' ||
      route === '/api/reflections/expedite' ||
      route === '/api/reflections/recheck' ||
      match ||
      jobMatch
    )
      json(res, 405, { error: '不支持的反思操作', code: 'REFLECTION_METHOD' });
    else json(res, 404, { error: '反思接口不存在', code: 'REFLECTION_NOT_FOUND' });
  } catch (error) {
    if (error instanceof ReflectionError) json(res, error.status, { error: error.message, code: error.code });
    else if (error instanceof z.ZodError) json(res, 400, { error: '反思字段无效', code: 'REFLECTION_INPUT' });
    else json(res, 503, { error: '反思状态读取或操作未完成，请重试', code: 'REFLECTION_UNAVAILABLE' });
  }
  return true;
}
