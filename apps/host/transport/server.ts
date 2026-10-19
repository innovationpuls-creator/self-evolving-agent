import { createServer, type IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { SkillError } from '../skills/skills.js';
import { AgentService } from '../runtime/agent.js';
import { MemoryError } from '../memory/memory.js';
import { DiagnosticError } from '../diagnostics/diagnostics.js';
import { body, json } from './http.js';
import { diagnosticRoutes } from '../diagnostics/diagnostic-routes.js';
import { memoryRoutes } from '../memory/memory-routes.js';
import { sessionRoutes } from '../runtime/session-routes.js';
import { skillRoutes } from '../skills/skill-routes.js';

function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function startHost(options: {
  dataDir: string;
  key: Buffer;
  token: string;
  port?: number;
  webDir?: string;
  service?: AgentService;
}) {
  if (options.token.length < 32) throw new Error('连接令牌至少需要 32 个字符');
  const service = options.service ?? new AgentService(options.dataDir, options.key);
  try {
    await service.init();
  } catch (error) {
    await service.close().catch(() => {});
    throw error;
  }
  service.sensitive.add(options.token);
  service.sensitive.add(options.key.toString('base64'));
  let origin = '';
  const authenticated = (req: IncomingMessage) => equal(req.headers.authorization ?? '', `Bearer ${options.token}`);
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
    );
    try {
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) {
        json(res, 403, { error: '来源不受信任' });
        return;
      }
      const url = new URL(req.url ?? '/', origin);
      if (url.pathname === '/api/connect' && req.method === 'POST') {
        const input = z
          .object({ token: z.string() })
          .strict()
          .parse(await body(req));
        if (!equal(input.token, options.token)) {
          json(res, 401, { error: '连接令牌无效' });
          return;
        }
        // Remove the legacy cookie; cookies are shared across ports on a host.
        res.setHeader('Set-Cookie', `agent-${new URL(origin).port}=; Max-Age=0; Path=/`);
        json(res, 200, { ok: true });
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        if (!authenticated(req)) {
          json(res, 401, { error: '请连接 Agent Host' });
          return;
        }
        if (
          (await diagnosticRoutes(service.diagnosticHistory, req, res, url)) ||
          (await memoryRoutes(service, req, res, url)) ||
          (await sessionRoutes(service, req, res, url)) ||
          (await skillRoutes(service, req, res, url))
        )
          return;
        json(res, 404, { error: '接口不存在' });
        return;
      }
      if (req.method !== 'GET') {
        json(res, 405, { error: '请求方法不支持' });
        return;
      }
      const root = options.webDir ?? fileURLToPath(new URL('../../web/', import.meta.url));
      const path = resolve(root, url.pathname === '/' ? 'index.html' : `.${decodeURIComponent(url.pathname)}`);
      if (!path.startsWith(resolve(root) + sep)) {
        json(res, 404, { error: '页面不存在' });
        return;
      }
      const data = await readFile(path);
      res.writeHead(200, {
        'Content-Type':
          (
            {
              '.html': 'text/html; charset=utf-8',
              '.js': 'text/javascript',
              '.css': 'text/css',
              '.svg': 'image/svg+xml',
            } as Record<string, string>
          )[extname(path)] ?? 'application/octet-stream',
      });
      res.end(data);
    } catch (error) {
      if (error instanceof DiagnosticError) json(res, error.status, { error: error.message, code: error.code });
      else if (error instanceof MemoryError) json(res, error.status, { error: error.message, code: error.code });
      else if (error instanceof SkillError) json(res, error.status, { error: error.message });
      else if (error instanceof z.ZodError) json(res, 400, { error: '请求字段无效' });
      else
        json(res, 409, {
          error:
            error instanceof Error && error.message === 'Nothing to compact (session too small)'
              ? '当前对话较短，暂时无需压缩'
              : '操作未完成，请检查会话状态、模型凭据或数据目录',
        });
    }
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const verified = new Set<WebSocket>();
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/events' || req.headers.host !== new URL(origin).host || req.headers.origin !== origin) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) => {
      ws.on('error', () => ws.terminate());
      const authorize = () => {
        verified.add(ws);
        ws.send(JSON.stringify({ type: 'connected' }));
      };
      ws.once('close', () => verified.delete(ws));
      if (authenticated(req)) {
        authorize();
        return;
      }
      const timer = setTimeout(() => ws.close(4401, '认证超时'), 5000);
      timer.unref();
      ws.once('close', () => clearTimeout(timer));
      ws.once('message', (bytes) => {
        clearTimeout(timer);
        try {
          const input = z
            .object({ type: z.literal('authenticate'), token: z.string().max(512) })
            .strict()
            .parse(JSON.parse(bytes.toString()));
          if (equal(input.token, options.token)) authorize();
          else ws.close(4401, '认证失败');
        } catch {
          ws.close(4401, '认证失败');
        }
      });
    });
  });
  const broadcast = (event: unknown) => {
    const data = JSON.stringify(event);
    for (const ws of verified)
      if (ws.readyState === WebSocket.OPEN) {
        if (ws.bufferedAmount > 4 * 1024 * 1024) ws.close(1013, '请重新连接');
        else ws.send(data);
      }
  };
  service.on('event', broadcast);
  const heartbeat = setInterval(() => {
    for (const ws of verified) ws.ping();
  }, 30000);
  heartbeat.unref();
  try {
    await new Promise<void>((ok, fail) => {
      server.once('error', fail);
      server.listen(options.port ?? 0, '127.0.0.1', ok);
    });
  } catch (error) {
    clearInterval(heartbeat);
    service.off('event', broadcast);
    sockets.close();
    await service.close().catch(() => {});
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Host 启动失败');
  origin = `http://127.0.0.1:${address.port}`;
  let closing: Promise<void> | undefined;
  return {
    origin,
    service,
    close() {
      closing ??= (async () => {
        clearInterval(heartbeat);
        service.off('event', broadcast);
        for (const ws of sockets.clients) ws.terminate();
        sockets.close();
        const stopped = new Promise<void>((ok, fail) => server.close((error) => (error ? fail(error) : ok())));
        try {
          await service.close();
        } finally {
          await stopped;
        }
      })();
      return closing;
    },
  };
}
