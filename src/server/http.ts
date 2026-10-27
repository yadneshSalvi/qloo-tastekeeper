import { ZodError } from 'zod';
import { DomainError, denied } from './errors.ts';
import { digest, equalSecret } from './crypto.ts';
import { clientIdSchema } from '../domain/contracts.ts';
import { ownerFromToken, principalFromToken } from './store.ts';
import { transaction } from './db.ts';
import { principalFromBrowserSession } from './client-sessions.ts';
export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache',
      Vary: 'Cookie, Authorization',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
export function failure(error: unknown) {
  if (error instanceof ZodError)
    return json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Check the request fields. Unknown fields and invalid values are not accepted.',
          issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      },
      400,
    );
  if (error instanceof DomainError)
    return json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.detail ? { detail: error.detail } : {}),
        },
      },
      error.status,
    );
  console.error('TASTEKEEPER request failed:', error instanceof Error ? error.name : 'unknown');
  return json(
    {
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The gateway is unavailable. Your existing choices are kept; try again shortly.',
      },
    },
    503,
  );
}
export async function readBody(request: Request) {
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json'))
    throw new DomainError('CONTENT_TYPE_REQUIRED', 'Send a JSON request.', 415);
  const text = await request.text();
  if (Buffer.byteLength(text) > 16384)
    throw new DomainError('BODY_TOO_LARGE', 'This request is too large.', 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new DomainError('INVALID_JSON', 'The request is not valid JSON.', 400);
  }
}
export function verifyOrigin(request: Request) {
  const canonical = process.env.APP_ORIGIN;
  if (!canonical || request.headers.get('origin') !== canonical)
    throw new DomainError(
      'ORIGIN_DENIED',
      'This action must start in the TASTEKEEPER workspace.',
      403,
    );
}
export function cookieValue(request: Request, name: string) {
  return (request.headers.get('cookie') ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
export async function requireOwner(request: Request) {
  return ownerFromToken(cookieValue(request, 'tastekeeper_owner'));
}
export function authenticateClient(request: Request) {
  const parsed = clientIdSchema.safeParse(request.headers.get('x-client-id'));
  if (!parsed.success) throw denied('PRINCIPAL_DENIED', 401);
  const expected = process.env[`CLIENT_${parsed.data.toUpperCase()}_SECRET`];
  const supplied = request.headers.get('x-client-secret');
  if (!expected || !supplied || !equalSecret(expected, supplied))
    throw denied('PRINCIPAL_DENIED', 401);
  return parsed.data;
}
export async function requirePrincipal(request: Request) {
  const client = authenticateClient(request);
  const auth = request.headers.get('authorization');
  const session = request.headers.get('x-client-session');
  if (session) {
    if (auth) throw denied('PRINCIPAL_DENIED');
    return principalFromBrowserSession(client, session);
  }
  if (!auth?.startsWith('Bearer ')) throw denied('TOKEN_EXPIRED', 401);
  return principalFromToken(client, auth.slice(7));
}
export async function rateLimit(bucket: string, max: number, seconds = 60) {
  const accepted = await transaction(null, async (db) => {
    const result = await db.query<{ used: number }>(
      `INSERT INTO request_limits(bucket,window_start,used) VALUES($1,now(),1) ON CONFLICT(bucket) DO UPDATE SET window_start=CASE WHEN request_limits.window_start < now()-($2*interval '1 second') THEN now() ELSE request_limits.window_start END,used=CASE WHEN request_limits.window_start < now()-($2*interval '1 second') THEN 1 ELSE request_limits.used+1 END RETURNING used`,
      [digest(bucket), seconds],
    );
    return result.rows[0].used <= max;
  });
  if (!accepted)
    throw new DomainError(
      'RATE_LIMITED',
      'There have been a few too many requests. Wait a moment and try again.',
      429,
    );
}
