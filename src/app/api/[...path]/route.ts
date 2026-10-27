import { z } from 'zod';
import { NextResponse } from 'next/server';
import {
  applyCorrection,
  correctionPreview,
  createContext,
  createDemo,
  createInvitation,
  disableClient,
  endOwnerSession,
  eraseContext,
  eraseWorkspace,
  ownerWorkspace,
  revokeGrant,
} from '@/server/store';
import { health, ownerEvidence } from '@/server/gateway';
import {
  cookieValue,
  failure,
  json,
  rateLimit,
  readBody,
  requireOwner,
  verifyOrigin,
} from '@/server/http';
import {
  clientIdSchema,
  contextCreateSchema,
  correctionSchema,
  invitationSchema,
} from '@/domain/contracts';
import { DomainError } from '@/server/errors';
import {
  confirmReference,
  queueReferenceSearch,
  referenceSearchView,
} from '@/server/reference-search';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Route = { params: Promise<{ path: string[] }> };
export async function GET(request: Request, { params }: Route) {
  try {
    const { path } = await params;
    if (path.join('/') === 'health') return json(await health());
    const owner = await requireOwner(request);
    await rateLimit(`owner:read:${owner.tenantId}`, 300);
    if (path.join('/') === 'workspace') return json(await ownerWorkspace(owner));
    if (path[0] === 'reference-searches' && path.length === 2)
      return json(await referenceSearchView(owner, z.uuid().parse(path[1])));
    if (path[0] === 'decisions' && path[2] === 'evidence' && path.length === 3)
      return json(await ownerEvidence(owner.tenantId, owner.ownerId, z.uuid().parse(path[1])));
    return json({ error: { code: 'NOT_FOUND', message: 'This endpoint does not exist.' } }, 404);
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request, { params }: Route) {
  try {
    verifyOrigin(request);
    const { path } = await params;
    if (path.join('/') === 'demo') {
      // A second landing-page tab must not silently replace the owner's workspace.
      // New browser contexts still receive independent tenants and credentials.
      if (cookieValue(request, 'tastekeeper_owner')) {
        try {
          await ownerWorkspace(await requireOwner(request));
          return json({ created: false, resumed: true });
        } catch (error) {
          if (
            !(error instanceof DomainError) ||
            !['SESSION_REQUIRED', 'SESSION_EXPIRED', 'PRINCIPAL_DENIED', 'DEMO_EXPIRED'].includes(
              error.code,
            )
          )
            throw error;
        }
      }
      await rateLimit('demo:create', 30);
      const demo = await createDemo();
      const response = NextResponse.json(
        { created: true },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
      response.cookies.set('tastekeeper_owner', demo.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.APP_ORIGIN?.startsWith('https:') ?? false,
        path: '/',
        maxAge: 86400,
      });
      return response;
    }
    if (path.join('/') === 'logout') {
      await endOwnerSession(cookieValue(request, 'tastekeeper_owner'));
      const response = NextResponse.json(
        { signedOut: true },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
      response.cookies.delete('tastekeeper_owner');
      return response;
    }
    const owner = await requireOwner(request);
    await rateLimit(`owner:write:${owner.tenantId}`, 60);
    const body = await readBody(request);
    if (path.join('/') === 'reference-searches') {
      await rateLimit(`owner:search:${owner.tenantId}`, 6);
      return json(await queueReferenceSearch(owner, body), 202);
    }
    if (path[0] === 'contexts' && path.length === 3 && path[2] === 'references')
      return json(await confirmReference(owner, z.uuid().parse(path[1]), body));
    if (path.join('/') === 'invitations')
      return json(await createInvitation(owner, invitationSchema.parse(body)), 201);
    if (path.join('/') === 'contexts')
      return json(await createContext(owner, contextCreateSchema.parse(body)), 201);
    if (path.join('/') === 'corrections/preview')
      return json(await correctionPreview(owner, correctionSchema.parse(body)));
    if (path.join('/') === 'corrections')
      return json(await applyCorrection(owner, correctionSchema.parse(body)));
    if (path[0] === 'grants' && path[2] === 'revoke' && path.length === 3) {
      z.object({}).strict().parse(body);
      return json(await revokeGrant(owner, z.uuid().parse(path[1])));
    }
    if (path[0] === 'clients' && path[2] === 'disable' && path.length === 3) {
      z.object({}).strict().parse(body);
      return json(await disableClient(owner, clientIdSchema.parse(path[1])));
    }
    throw new DomainError('NOT_FOUND', 'This endpoint does not exist.', 404);
  } catch (error) {
    return failure(error);
  }
}
export async function DELETE(request: Request, { params }: Route) {
  try {
    verifyOrigin(request);
    const owner = await requireOwner(request);
    const { path } = await params;
    await rateLimit(`owner:erase:${owner.tenantId}`, 10);
    if (path.join('/') === 'workspace') {
      const result = await eraseWorkspace(owner);
      const response = NextResponse.json(result, {
        headers: { 'Cache-Control': 'private, no-store' },
      });
      response.cookies.delete('tastekeeper_owner');
      return response;
    }
    if (path[0] === 'contexts' && path.length === 2)
      return json(await eraseContext(owner, z.uuid().parse(path[1])));
    throw new DomainError('NOT_FOUND', 'This endpoint does not exist.', 404);
  } catch (error) {
    return failure(error);
  }
}
