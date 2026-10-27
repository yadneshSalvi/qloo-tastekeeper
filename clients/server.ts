import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { renderPage } from './view.ts';

export type ClientId = 'books' | 'media' | 'places';
export type ClientConfig = {
  clientId: ClientId;
  port: number;
  host: string;
  clientSecret: string;
  sessionSecret: string;
  gatewayOrigin: string;
  ownerOrigin: string;
  publicOrigin: string;
};

const clientTypes = { books: 'book', media: 'movie', places: 'place' } as const;
const defaultPorts = { books: 3114, media: 3115, places: 3116 };
const date = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const briefSchema = z
  .object({
    occasion: z.enum(['birthday', 'thank_you', 'just_because', 'for_me']),
    note: z.string().trim().max(240).optional(),
  })
  .strict();
const executionSchema = z.object({
  defaultMode: z.enum(['sample', 'qloo']),
  qlooAvailable: z.boolean(),
  agentAvailable: z.boolean(),
  providerLabel: z.string(),
  agentLabel: z.string(),
});
const publicItem = z.object({
  id: z.string().min(1),
  title: z.string(),
  creator: z.string(),
  description: z.string(),
  url: z.string().url(),
  price: z.number().int().nonnegative(),
});
const grantSchema = z.object({
  id: z.string(),
  contextId: z.string(),
  contextName: z.string(),
  purpose: z.enum(['gift', 'personal']),
  expiresAt: date,
  remainingRequests: z.number().int().nonnegative(),
  snapshotId: z.string(),
  fields: z.array(z.string()),
  version: z.number().int(),
});
const catalogSchema = z.object({
  id: z.string(),
  snapshotId: z.string(),
  type: z.enum(['book', 'movie', 'place']),
  source: z.string(),
  retrievedAt: date,
  availabilityNotice: z.string(),
  items: z
    .array(
      publicItem.extend({
        format: z.string().optional(),
        minutes: z.number().optional(),
        setting: z.string().optional(),
        art: z.string(),
        identity: z.string().optional(),
      }),
    )
    .max(10),
});
const sessionViewSchema = z.object({
  credentialExpiresAt: date,
  grant: grantSchema,
  catalog: catalogSchema,
  delegate: z.object({ displayName: z.string() }),
  mode: z.enum(['authored_sample', 'qloo']),
  execution: executionSchema.optional(),
  latestRunId: z.string().optional(),
  brief: z
    .object({
      hardConstraints: z.record(z.string(), z.union([z.string(), z.number()])),
      mode: z.enum(['sample', 'qloo']),
      brief: briefSchema.optional(),
    })
    .optional(),
  runIds: z.array(z.string()).max(40).default([]),
  selections: z
    .array(z.object({ runId: z.string(), itemId: z.string(), title: z.string(), savedAt: date }))
    .default([]),
});
const claimResponseSchema = sessionViewSchema.extend({
  sessionToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
const pendingStates = [
  'queued',
  'authorizing',
  'resolving',
  'ranking',
  'preparing',
  'release_pending',
] as const;
const decisionSchema = z.union([
  z.object({ id: z.string(), state: z.enum(pendingStates) }),
  z.object({
    id: z.string(),
    state: z.literal('released'),
    items: z.array(publicItem),
    provenance: z.object({
      mode: z.enum(['authored_sample', 'qloo']),
      label: z.string(),
      status: z.enum(['ok', 'partial', 'degraded', 'empty', 'needs_input', 'error']),
      candidateCount: z.number().int(),
      selectedCount: z.number().int(),
      mappedCount: z.number().int().optional(),
      unmappedCount: z.number().int().optional(),
      returnedCount: z.number().int().nonnegative().optional(),
      agent: z.object({ enabled: z.boolean(), status: z.string(), label: z.string() }).optional(),
    }),
    explanations: z
      .array(z.object({ itemId: z.string(), text: z.string().max(600) }))
      .max(3)
      .optional(),
    receipt: z.object({
      id: z.string(),
      grantVersion: z.number().int(),
      contextRevision: z.number().int(),
      authorizedAt: date,
      fields: z.array(z.string()),
    }),
    stale: z.boolean(),
  }),
]);
type SessionView = z.infer<typeof sessionViewSchema>;
type ClientSession = {
  sessionToken: string;
  view: SessionView;
  runs: Set<string>;
  latestRunId?: string;
  lastBrief?: {
    hardConstraints: Record<string, string | number>;
    mode: 'sample' | 'qloo';
    brief?: z.infer<typeof briefSchema>;
  };
};

class ClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function normalizedOrigin(value: string, label: string): string {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `${label} must be an HTTP(S) origin without credentials, path, query, or fragment.`,
    );
  }
  return url.origin;
}

export function readClientConfig(
  env: Record<string, string | undefined> = process.env,
): ClientConfig {
  const clientId = z.enum(['books', 'media', 'places']).parse(env.CLIENT_ID);
  const clientSecret = z
    .string()
    .min(16, 'CLIENT_SECRET must contain at least 16 characters.')
    .parse(env.CLIENT_SECRET);
  const sessionSecret = z
    .string()
    .min(32, 'SESSION_SECRET must contain at least 32 characters.')
    .parse(env.SESSION_SECRET);
  const port = z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .parse(env.PORT || defaultPorts[clientId]);
  const config = {
    clientId,
    port,
    host: env.CLIENT_HOST || '127.0.0.1',
    clientSecret,
    sessionSecret,
    gatewayOrigin: normalizedOrigin(
      env.GATEWAY_ORIGIN || 'http://127.0.0.1:3104',
      'GATEWAY_ORIGIN',
    ),
    ownerOrigin: normalizedOrigin(env.OWNER_ORIGIN || 'http://127.0.0.1:3104', 'OWNER_ORIGIN'),
    publicOrigin: normalizedOrigin(
      env.PUBLIC_ORIGIN || `http://${clientId}.localhost:${port}`,
      'PUBLIC_ORIGIN',
    ),
  };
  if (new URL(config.publicOrigin).hostname === new URL(config.ownerOrigin).hostname) {
    throw new Error('The client and owner must use separate browser hosts.');
  }
  if (
    env.NODE_ENV === 'production' &&
    [config.publicOrigin, config.gatewayOrigin, config.ownerOrigin].some(
      (origin) => !origin.startsWith('https://'),
    )
  )
    throw new Error('Production client origins require HTTPS.');
  return config;
}

/** Independent client backend. Credentials never leave this process. No database access. */
export function createClientServer(config: ClientConfig) {
  const cookieName = `tastekeeper_${config.clientId}_session`;
  const assets = new Map<string, Promise<Buffer>>();
  const assetPaths: Record<string, { path: URL; type: string }> = {
    '/client.js': {
      path: new URL('./client.js', import.meta.url),
      type: 'application/javascript; charset=utf-8',
    },
    '/styles.css': {
      path: new URL('./styles.css', import.meta.url),
      type: 'text/css; charset=utf-8',
    },
    '/fonts/source-serif-4.woff2': {
      path: new URL('../public/fonts/source-serif-4.woff2', import.meta.url),
      type: 'font/woff2',
    },
    '/fonts/geist.woff2': {
      path: new URL('../public/fonts/geist.woff2', import.meta.url),
      type: 'font/woff2',
    },
  };
  const secureCookie = config.publicOrigin.startsWith('https://');

  function assetBytes(path: string): Promise<Buffer> {
    const asset = assetPaths[path];
    if (!asset) throw new ClientError(404, 'ASSET_NOT_FOUND', 'This asset is not available.');
    let bytes = assets.get(path);
    if (!bytes) {
      bytes = readFile(asset.path).catch(() => {
        assets.delete(path);
        throw new ClientError(404, 'ASSET_NOT_FOUND', 'This asset is not available.');
      });
      assets.set(path, bytes);
    }
    return bytes;
  }

  function signature(id: string) {
    return createHmac('sha256', config.sessionSecret)
      .update(`${config.clientId}:${id}`)
      .digest('base64url');
  }
  function cookie(value: string, maxAge = 86400) {
    return `${cookieName}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`;
  }
  async function findSession(req: IncomingMessage) {
    const raw = req.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    if (!raw)
      throw new ClientError(
        401,
        'NO_SESSION',
        'Open an invitation from your TASTEKEEPER workspace to connect this app.',
      );
    const [id, provided, extra] = raw.split('.');
    if (!id || !provided || extra || !/^[A-Za-z0-9_-]{43}$/.test(id))
      throw new ClientError(
        401,
        'NO_SESSION',
        'This client session has ended. Open a new invitation.',
      );
    const expected = signature(id);
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    ) {
      throw new ClientError(
        401,
        'NO_SESSION',
        'This client session has ended. Open a new invitation.',
      );
    }
    const view = validateCatalog(
      sessionViewSchema.parse(await gateway('/v1/session', { sessionToken: id })),
    );
    const session: ClientSession = {
      sessionToken: id,
      view,
      runs: new Set(view.runIds),
      latestRunId: view.latestRunId,
      lastBrief: view.brief,
    };
    return { id, session };
  }

  async function gateway(
    path: string,
    options: { method?: string; body?: unknown; sessionToken?: string } = {},
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(new URL(path, config.gatewayOrigin), {
        method: options.method || 'GET',
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(12_000),
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-client-id': config.clientId,
          'x-client-secret': config.clientSecret,
          ...(options.sessionToken ? { 'x-client-session': options.sessionToken } : {}),
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch {
      throw new ClientError(
        503,
        'GATEWAY_UNAVAILABLE',
        'TASTEKEEPER is not responding. Your brief is still here; try the connection again.',
      );
    }
    let payload: unknown;
    try {
      const text = await response.text();
      if (text.length > 1_000_000) throw new Error('Oversized response');
      payload = JSON.parse(text);
    } catch {
      throw new ClientError(
        502,
        'GATEWAY_RESPONSE_INVALID',
        'TASTEKEEPER returned an unreadable response. Try the connection again.',
      );
    }
    if (!response.ok || (typeof payload === 'object' && payload !== null && 'error' in payload)) {
      const parsed = z
        .object({ error: z.object({ code: z.string().max(100), message: z.string().max(1000) }) })
        .safeParse(payload);
      if (parsed.success)
        throw new ClientError(
          response.ok ? 502 : response.status,
          parsed.data.error.code,
          parsed.data.error.message,
        );
      throw new ClientError(
        response.ok ? 502 : response.status,
        'GATEWAY_ERROR',
        'The request could not be completed. Review the connection or try again.',
      );
    }
    return payload;
  }

  async function authorized(
    session: ClientSession,
    path: string,
    options: { method?: string; body?: unknown } = {},
  ) {
    return gateway(path, { ...options, sessionToken: session.sessionToken });
  }

  async function body(req: IncomingMessage): Promise<unknown> {
    if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      throw new ClientError(415, 'JSON_REQUIRED', 'Send a JSON request.');
    }
    if (Number(req.headers['content-length'] || 0) > 8192)
      throw new ClientError(413, 'BODY_TOO_LARGE', 'This request is too large.');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += Buffer.byteLength(chunk);
      if (size > 8192) throw new ClientError(413, 'BODY_TOO_LARGE', 'This request is too large.');
      chunks.push(Buffer.from(chunk));
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new ClientError(400, 'INVALID_JSON', 'The request is not valid JSON.');
    }
  }

  function json(res: ServerResponse, status: number, value: unknown) {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
    });
    res.end(JSON.stringify(value));
  }

  function validateCatalog(view: SessionView) {
    if (
      view.catalog.type !== clientTypes[config.clientId] ||
      view.grant.snapshotId !== view.catalog.snapshotId
    ) {
      throw new ClientError(
        502,
        'CATALOG_MISMATCH',
        'This connection does not match this app’s catalog. Return to TASTEKEEPER to review it.',
      );
    }
    return view;
  }

  const server = createServer(async (req, res) => {
    res.setHeader(
      'content-security-policy',
      "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'",
    );
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('cross-origin-resource-policy', 'same-origin');
    const path = new URL(req.url || '/', 'http://client.invalid').pathname;
    try {
      if (path !== '/health' && req.headers.host !== new URL(config.publicOrigin).host) {
        throw new ClientError(
          403,
          'HOST_DENIED',
          'Open this client on its own configured browser origin.',
        );
      }
      if (req.method === 'POST') {
        if (req.headers.origin !== config.publicOrigin) {
          throw new ClientError(
            403,
            'ORIGIN_DENIED',
            'This request must come from this client’s own page.',
          );
        }
      }

      if ((req.method === 'GET' || req.method === 'HEAD') && (path === '/' || path === '/claim')) {
        // Hash the same cached bytes used by the asset routes, including when
        // HTML and asset requests arrive concurrently during a deployment.
        const [script, stylesheet] = await Promise.all([
          assetBytes('/client.js'),
          assetBytes('/styles.css'),
        ]);
        const assetVersions = {
          script: createHash('sha256').update(script).digest('hex'),
          stylesheet: createHash('sha256').update(stylesheet).digest('hex'),
        };
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'private, no-store',
        });
        res.end(
          req.method === 'HEAD'
            ? undefined
            : renderPage(config.clientId, config.ownerOrigin, assetVersions),
        );
        return;
      }
      if (req.method === 'GET' && path === '/health') {
        json(res, 200, {
          ok: true,
          clientId: config.clientId,
          service: 'tastekeeper-reference-client',
        });
        return;
      }
      const asset = assetPaths[path];
      if ((req.method === 'GET' || req.method === 'HEAD') && asset) {
        const bytes = await assetBytes(path);
        res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'public, max-age=3600' });
        res.end(req.method === 'HEAD' ? undefined : bytes);
        return;
      }
      if (req.method === 'POST' && path === '/api/claim') {
        const input = z
          .object({ token: z.string().min(12).max(1024) })
          .strict()
          .parse(await body(req));
        const claimed = claimResponseSchema.parse(
          await gateway('/v1/browser-sessions/claim', { method: 'POST', body: input }),
        );
        const { sessionToken: id, ...publicView } = claimed;
        const view = validateCatalog(publicView);
        res.setHeader('set-cookie', cookie(`${id}.${signature(id)}`));
        json(res, 200, view);
        return;
      }
      if (req.method === 'GET' && path === '/api/session') {
        const { session } = await findSession(req);
        const { runIds: _runIds, ...view } = session.view;
        void _runIds;
        json(res, 200, view);
        return;
      }
      if (req.method === 'POST' && path === '/api/disconnect') {
        z.object({})
          .strict()
          .parse(await body(req));
        const { session } = await findSession(req);
        await authorized(session, '/v1/browser-sessions/disconnect', { method: 'POST', body: {} });
        res.setHeader('set-cookie', cookie('', 0));
        json(res, 200, { disconnected: true });
        return;
      }
      if (req.method === 'POST' && path === '/api/decisions') {
        const { session } = await findSession(req);
        const constraintSchemas = {
          books: z
            .object({
              maxPrice: z.number().int().min(0).max(100_000).optional(),
              format: z.enum(['any', 'paperback', 'hardback', 'ebook']).optional(),
            })
            .strict(),
          media: z.object({ maxMinutes: z.number().int().min(1).max(600).optional() }).strict(),
          places: z
            .object({
              maxPrice: z.number().int().min(0).max(100_000).optional(),
              setting: z.enum(['any', 'indoors', 'outdoors']).optional(),
            })
            .strict(),
        };
        const input = z
          .object({
            hardConstraints: constraintSchemas[config.clientId],
            mode: z.enum(['sample', 'qloo']),
            idempotencyKey: z.string().uuid().optional(),
            brief: briefSchema.optional(),
          })
          .strict()
          .parse(await body(req));
        session.lastBrief = {
          hardConstraints: input.hardConstraints,
          mode: input.mode,
          ...(input.brief ? { brief: input.brief } : {}),
        };
        const { grant, catalog } = session.view;
        const result = z
          .object({
            id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
            state: z.enum([
              ...pendingStates,
              'released',
              'denied',
              'needs_input',
              'cancelled',
              'stale',
              'failed',
            ]),
            replayed: z.boolean().optional(),
          })
          .parse(
            await authorized(session, '/v1/decisions', {
              method: 'POST',
              body: {
                grantId: grant.id,
                contextId: grant.contextId,
                purpose: grant.purpose,
                operation: 'rank',
                targetType: clientTypes[config.clientId],
                snapshotId: catalog.snapshotId,
                candidateIds: catalog.items.map((item) => item.id),
                fields: ['id', 'title', 'description', 'creator', 'url', 'price'],
                hardConstraints: input.hardConstraints,
                idempotencyKey: input.idempotencyKey || randomUUID(),
                mode: input.mode,
                ...(input.brief ? { brief: input.brief } : {}),
              },
            }),
          );
        session.runs.add(result.id);
        session.latestRunId = result.id;
        json(res, 202, result);
        return;
      }
      const decisionPath = path.match(/^\/api\/decisions\/([A-Za-z0-9_-]{1,128})(\/selection)?$/);
      if (decisionPath) {
        const { session } = await findSession(req);
        const runId = decisionPath[1]!;
        if (!session.runs.has(runId))
          throw new ClientError(
            404,
            'DECISION_NOT_FOUND',
            'This choice is not part of this client session.',
          );
        if (req.method === 'GET' && !decisionPath[2]) {
          const result = decisionSchema.parse(
            await authorized(session, `/v1/decisions/${encodeURIComponent(runId)}`),
          );
          json(res, 200, result);
          return;
        }
        if (req.method === 'POST' && decisionPath[2]) {
          const input = z
            .object({ itemId: z.string().min(1).max(200) })
            .strict()
            .parse(await body(req));
          const result = z
            .object({
              saved: z.literal(true),
              itemId: z.string(),
              title: z.string(),
              savedAt: date,
            })
            .parse(
              await authorized(session, `/v1/decisions/${encodeURIComponent(runId)}/selection`, {
                method: 'POST',
                body: input,
              }),
            );
          json(res, 200, result);
          return;
        }
      }
      throw new ClientError(404, 'NOT_FOUND', 'This page was not found.');
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof ClientError) {
        json(res, error.status, { error: { code: error.code, message: error.message } });
        return;
      }
      if (error instanceof z.ZodError) {
        json(res, 400, {
          error: {
            code: 'INVALID_REQUEST',
            message:
              'The request or gateway response did not match this client’s supported fields. Review your choices and try again.',
          },
        });
        return;
      }
      // Never log request bodies, invitation fragments, cookies, credentials, or upstream errors.
      json(res, 500, {
        error: {
          code: 'CLIENT_ERROR',
          message: 'This client could not complete the request. Try again.',
        },
      });
    }
  });
  return server;
}

if (
  process.argv[1] &&
  pathToFileURL(fileURLToPath(pathToFileURL(process.argv[1]))).href === import.meta.url
) {
  try {
    const config = readClientConfig();
    const server = createClientServer(config);
    server.listen(config.port, config.host, () =>
      console.info(`[${config.clientId}] Reference client listening on ${config.publicOrigin}`),
    );
    server.on('error', () => {
      console.error('The reference client could not start. Check its host and port.');
      process.exitCode = 1;
    });
  } catch {
    console.error(
      'Client configuration is invalid. Set CLIENT_ID, CLIENT_SECRET (16+ characters), and SESSION_SECRET (32+ characters); check origin and port settings.',
    );
    process.exitCode = 1;
  }
}
