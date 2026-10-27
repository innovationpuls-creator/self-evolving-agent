import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from '../transport/http.js';
import type { DiagnosticHistory, DiagnosticReader } from './diagnostic-history.js';

export async function diagnosticRoutes(
  service: DiagnosticReader & Pick<DiagnosticHistory, 'sessions'>,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const route = url.pathname;
  if (route === '/api/diagnostics/sessions' && req.method === 'GET') {
    json(res, 200, await service.sessions({ actor: 'user' }, Object.fromEntries(url.searchParams)));
    return true;
  }
  if (route === '/api/diagnostics/evidence' && req.method === 'GET') {
    json(res, 200, await service.evidence({ actor: 'user' }, Object.fromEntries(url.searchParams)));
    return true;
  }
  if (route === '/api/diagnostics' && req.method === 'GET') {
    json(res, 200, await service.search({ actor: 'user' }, Object.fromEntries(url.searchParams)));
    return true;
  }
  const diagnostic = /^\/api\/diagnostics\/([a-f0-9-]{36})$/.exec(route);
  if (diagnostic && req.method === 'GET') {
    json(res, 200, service.get({ actor: 'user' }, diagnostic[1] ?? '', Object.fromEntries(url.searchParams)));
    return true;
  }
  return false;
}
