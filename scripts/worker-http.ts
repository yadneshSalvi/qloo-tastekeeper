import { createServer } from 'node:http';
import { z } from 'zod';
import { health, prepareDecision, workerTick } from '../src/server/gateway.ts';
import { transaction, shutdownDb } from '../src/server/db.ts';
import { prepareReferenceSearch } from '../src/server/reference-search.ts';

if (process.env.NODE_ENV === 'production' && process.env.WORKER_AUTH_MODE !== 'cloud-run-iam') {
  throw new Error('Private Cloud Run IAM authentication is required for the production worker.');
}
const port = z.coerce
  .number()
  .int()
  .min(1)
  .max(65535)
  .parse(process.env.PORT || 8080);
const server = createServer(async (request, response) => {
  const path = new URL(request.url || '/', 'http://worker.internal').pathname;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json');
  try {
    if (request.method === 'GET' && path === '/health') {
      response.end(JSON.stringify(await health()));
      return;
    }
    if (
      request.method !== 'POST' ||
      !['/tasks/decision', '/tasks/reference-search', '/tasks/maintenance'].includes(path)
    ) {
      response.writeHead(404);
      response.end(JSON.stringify({ error: 'NOT_FOUND' }));
      return;
    }
    if (!(request.headers['content-type'] || '').startsWith('application/json')) {
      response.writeHead(415);
      response.end(JSON.stringify({ error: 'JSON_REQUIRED' }));
      return;
    }
    let text = '';
    for await (const chunk of request) {
      text += chunk.toString();
      if (Buffer.byteLength(text) > 2048) throw new Error('BODY_TOO_LARGE');
    }
    const body: unknown = JSON.parse(text);
    await transaction(null, (db) =>
      db.query(
        "INSERT INTO worker_heartbeats(id,last_seen) VALUES('main',now()) ON CONFLICT(id) DO UPDATE SET last_seen=now()",
      ),
    );
    if (path === '/tasks/decision') {
      const input = z.object({ tenantId: z.uuid(), runId: z.uuid() }).strict().parse(body);
      await prepareDecision(input.tenantId, input.runId);
    } else if (path === '/tasks/reference-search') {
      const input = z.object({ tenantId: z.uuid(), searchId: z.uuid() }).strict().parse(body);
      await prepareReferenceSearch(input.tenantId, input.searchId);
    } else {
      z.object({}).strict().parse(body);
      await workerTick();
    }
    response.end(JSON.stringify({ processed: true }));
  } catch (error) {
    const status = error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503;
    response.writeHead(status);
    response.end(JSON.stringify({ error: status === 400 ? 'INVALID_TASK' : 'TASK_UNAVAILABLE' }));
  }
});
server.listen(port, '0.0.0.0', () => console.log('TASTEKEEPER private task worker is listening.'));
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    server.close(() => {
      void shutdownDb();
    });
  });
