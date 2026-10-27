import { z } from 'zod';
import { claimInvitation } from '@/server/store';
import { claimBrowserSession, disconnectBrowserSession } from '@/server/client-sessions';
import { clientSession, queueDecision, releaseDecision, renewCredential } from '@/server/gateway';
import {
  authenticateClient,
  failure,
  json,
  rateLimit,
  readBody,
  requirePrincipal,
} from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Route = { params: Promise<{ path: string[] }> };
export async function GET(request: Request, { params }: Route) {
  try {
    const { path } = await params;
    const principal = await requirePrincipal(request);
    await rateLimit(`client:read:${principal.tenantId}:${principal.clientId}`, 600);
    if (path.join('/') === 'session') return json(await clientSession(principal));
    if (path[0] === 'decisions' && path.length === 2)
      return json(await releaseDecision(principal, z.uuid().parse(path[1])));
    return json({ error: { code: 'NOT_FOUND', message: 'This endpoint does not exist.' } }, 404);
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request, { params }: Route) {
  try {
    const { path } = await params;
    const clientId = authenticateClient(request);
    if (path.join('/') === 'invitations/claim' || path.join('/') === 'browser-sessions/claim') {
      await rateLimit(`client:claim:${clientId}`, 60);
      const { token } = z
        .object({ token: z.string().min(30).max(100) })
        .strict()
        .parse(await readBody(request));
      return json(
        path[0] === 'browser-sessions'
          ? await claimBrowserSession(clientId, token)
          : await claimInvitation(clientId, token),
      );
    }
    const principal = await requirePrincipal(request);
    await rateLimit(`client:write:${principal.tenantId}:${clientId}`, 100);
    const body = await readBody(request);
    if (path.join('/') === 'browser-sessions/disconnect') {
      z.object({}).strict().parse(body);
      return json(await disconnectBrowserSession(principal));
    }
    if (path.join('/') === 'credentials/renew') {
      z.object({}).strict().parse(body);
      return json(await renewCredential(principal));
    }
    if (path.join('/') === 'decisions') return json(await queueDecision(principal, body), 202);
    if (path[0] === 'decisions' && path[2] === 'selection' && path.length === 3) {
      const { itemId } = z
        .object({ itemId: z.string().min(1).max(80) })
        .strict()
        .parse(body);
      return json(await releaseDecision(principal, z.uuid().parse(path[1]), itemId));
    }
    return json({ error: { code: 'NOT_FOUND', message: 'This endpoint does not exist.' } }, 404);
  } catch (error) {
    return failure(error);
  }
}
