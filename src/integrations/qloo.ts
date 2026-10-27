/** Persistent Node service only. Never import this module into a browser bundle.
 * The gateway still owns authorization before the call and at final release.
 */
import { fileURLToPath } from 'node:url';
import {
  discardProviderBody,
  ProviderResponseError,
  readProviderJson,
  withinDeadline,
} from './provider-http.ts';

export type QlooStatus = 'ok' | 'empty' | 'needs_input' | 'partial' | 'degraded' | 'error';
export type QlooTransport = 'official-harness' | 'insights';
export type QlooFailureCode =
  | 'NOT_CONFIGURED'
  | 'INVALID_INPUT'
  | 'INVALID_RESPONSE'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'UPSTREAM_LIMIT'
  | 'UPSTREAM_AUTH'
  | 'UPSTREAM_UNAVAILABLE';
export interface QlooRankInput {
  type: 'book' | 'movie' | 'place';
  signalIds: string[];
  candidateIds: string[];
  signal?: AbortSignal;
}
export interface QlooRankResult {
  status: QlooStatus;
  rankedIds: string[];
  warnings: string[];
  errorCode?: QlooFailureCode;
  provenance: { mode: 'qloo'; transport: QlooTransport; liveCallAttempted: boolean };
}
export interface QlooCapability {
  ready: boolean;
  contractVersion: string;
  contractChecksum: string;
  tools: string[];
  liveCallMade: false;
}
export type QlooSettings = {
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  transport?: QlooTransport;
  fetch?: typeof globalThis.fetch;
  /** Insights only: trusted authorization and per-HTTP budget reservation.
   * Errors propagate. Harness-internal retries cannot use this reservation API.
   */
  beforeProviderCall?: () => Promise<void>;
};
type Settings = QlooSettings;
const endpoint = 'https://hackathon.api.qloo.com';
/** Rich Qloo entity metadata needs more room than compact model tool outputs.
 * This bounds decoded response bytes; entity-count and deadline limits still apply.
 */
export const QLOO_MAX_RESPONSE_BYTES = 1024 * 1024;
const statuses = new Set<QlooStatus>([
  'ok',
  'empty',
  'needs_input',
  'partial',
  'degraded',
  'error',
]);
const usable = new Set<QlooStatus>(['ok', 'partial', 'degraded']);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const provenance = (
  liveCallAttempted: boolean,
  transport: QlooTransport = 'official-harness',
): QlooRankResult['provenance'] => ({
  mode: 'qloo',
  transport,
  liveCallAttempted,
});
const warnings: Record<QlooStatus, string> = {
  ok: 'The provider supplied additional evidence notes; private details are withheld.',
  empty: 'Qloo returned no eligible choices for this request.',
  needs_input: 'The owner needs to review the confirmed cultural references or candidate mappings.',
  partial: 'Only part of the requested Qloo evidence is available.',
  degraded: 'Qloo reported reduced evidence quality for this request.',
  error: 'Qloo could not complete this request. No sample recommendation was substituted.',
};
const fail = (
  errorCode: QlooFailureCode,
  liveCallMade = false,
  transport: QlooTransport = 'official-harness',
): QlooRankResult => ({
  status: 'error',
  rankedIds: [],
  errorCode,
  provenance: provenance(liveCallMade, transport),
  warnings: [
    errorCode === 'NOT_CONFIGURED'
      ? 'Live Qloo is not configured. No sample recommendation was substituted.'
      : errorCode === 'INVALID_INPUT'
        ? 'Choose one to ten unique, confirmed Qloo references and candidates.'
        : errorCode === 'CANCELLED'
          ? 'This request was cancelled before a result could be released.'
          : errorCode === 'TIMEOUT'
            ? 'Qloo did not finish within the request time limit.'
            : errorCode === 'UPSTREAM_LIMIT'
              ? 'Qloo has reached its request limit. Try again later.'
              : errorCode === 'UPSTREAM_AUTH'
                ? 'Qloo access could not be verified. Ask the service operator to check access.'
                : errorCode === 'INVALID_RESPONSE'
                  ? 'Qloo returned an unexpected response. No result was released.'
                  : warnings.error,
  ],
});
export function validQlooIds(ids: unknown): ids is string[] {
  return (
    Array.isArray(ids) &&
    ids.length > 0 &&
    ids.length <= 10 &&
    ids.every((id) => typeof id === 'string' && uuid.test(id)) &&
    new Set(ids.map((id) => id.toLowerCase())).size === ids.length
  );
}

/** The only provider-result projection. Provider explanations/warnings can name
 * seeds, so even warning strings and request IDs are never copied through.
 * Candidate names, prices and public descriptions come from the approved catalog.
 */
export function projectRankEnvelope(raw: unknown, candidateIds: string[]): QlooRankResult {
  if (!validQlooIds(candidateIds)) return fail('INVALID_INPUT');
  if (!record(raw) || raw.operation !== 'rank' || !statuses.has(raw.status as QlooStatus))
    return fail('INVALID_RESPONSE', true);
  const status = raw.status as QlooStatus;
  if (
    raw.result_count !== undefined &&
    (!Number.isSafeInteger(raw.result_count) || Number(raw.result_count) < 0)
  )
    return fail('INVALID_RESPONSE', true);
  if (
    status === 'error' &&
    (!record(raw.error) ||
      typeof raw.error.code !== 'string' ||
      typeof raw.error.layer !== 'string' ||
      typeof raw.error.retryable !== 'boolean' ||
      typeof raw.error.recovery !== 'string')
  )
    return fail('INVALID_RESPONSE', true);
  if (!usable.has(status))
    return { status, rankedIds: [], warnings: [warnings[status]], provenance: provenance(true) };
  if (
    !Array.isArray(raw.results) ||
    raw.results.length > candidateIds.length ||
    (raw.result_count !== undefined && raw.result_count !== raw.results.length)
  )
    return fail('INVALID_RESPONSE', true);
  const allowed = new Map(candidateIds.map((id) => [id.toLowerCase(), id]));
  const rankedIds: string[] = [];
  for (const item of raw.results) {
    if (!record(item) || typeof item.entity_id !== 'string') return fail('INVALID_RESPONSE', true);
    const confirmed = allowed.get(item.entity_id.toLowerCase());
    if (!confirmed || rankedIds.includes(confirmed)) return fail('INVALID_RESPONSE', true);
    rankedIds.push(confirmed);
  }
  const notes =
    status !== 'ok' || (Array.isArray(raw.warnings) && raw.warnings.length > 0)
      ? [warnings[status]]
      : [];
  if (status === 'ok' && rankedIds.length === 0) notes.push('Qloo returned no ranked candidates.');
  return { status, rankedIds, warnings: notes, provenance: provenance(true) };
}

/** The documented Insights endpoint used by the pinned harness rank workflow.
 * Only ordered candidate membership leaves this boundary. Affinity, request
 * metadata, provider warnings and explainability may contain private references.
 */
export function projectInsightsResponse(raw: unknown, candidateIds: string[]): QlooRankResult {
  const transport = 'insights';
  if (!validQlooIds(candidateIds)) return fail('INVALID_INPUT', false, transport);
  if (
    !record(raw) ||
    (raw.success !== undefined && raw.success !== true) ||
    (raw.error !== undefined && raw.error !== null) ||
    !record(raw.results) ||
    !Array.isArray(raw.results.entities) ||
    raw.results.entities.length > candidateIds.length
  )
    return fail('INVALID_RESPONSE', true, transport);
  const allowed = new Map(candidateIds.map((id) => [id.toLowerCase(), id]));
  const rankedIds: string[] = [];
  for (const item of raw.results.entities) {
    if (!record(item) || typeof item.entity_id !== 'string')
      return fail('INVALID_RESPONSE', true, transport);
    const id = allowed.get(item.entity_id.toLowerCase());
    if (!id || rankedIds.includes(id)) return fail('INVALID_RESPONSE', true, transport);
    rankedIds.push(id);
  }
  const warned = Array.isArray(raw.warnings) && raw.warnings.length > 0;
  const status =
    rankedIds.length === 0
      ? 'empty'
      : rankedIds.length < candidateIds.length || warned
        ? 'partial'
        : 'ok';
  return {
    status,
    rankedIds,
    warnings: status === 'ok' ? [] : [warnings[status]],
    provenance: provenance(true, transport),
  };
}

async function rankInsights(
  input: QlooRankInput,
  settings: QlooSettings,
  signal: AbortSignal,
  deadline: AbortSignal,
): Promise<QlooRankResult> {
  // Keep the trusted callback outside the provider catch. Authorization, budget,
  // and database failures retain their original domain error in the gateway.
  if (settings.beforeProviderCall) {
    try {
      await withinDeadline(settings.beforeProviderCall(), signal);
    } catch (error) {
      if (!signal.aborted) throw error;
      return fail(input.signal?.aborted ? 'CANCELLED' : 'TIMEOUT', false, 'insights');
    }
  }
  if (signal.aborted)
    return fail(input.signal?.aborted ? 'CANCELLED' : 'TIMEOUT', false, 'insights');
  const url = new URL('/v2/insights', endpoint);
  url.searchParams.set('filter.type', `urn:entity:${input.type}`);
  url.searchParams.set('filter.results.entities', input.candidateIds.join(','));
  url.searchParams.set('signal.interests.entities', input.signalIds.join(','));
  url.searchParams.set('take', String(input.candidateIds.length));
  try {
    // One request, no retries or redirects. Reservation caps can count every
    // actual outbound HTTP request in the callback immediately above.
    const response = await withinDeadline(
      (settings.fetch ?? globalThis.fetch)(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Api-Key': (settings.env ?? process.env).QLOO_API_KEY!.trim(),
        },
        signal,
        redirect: 'error',
        cache: 'no-store',
      }),
      signal,
    );
    if (!response.ok) {
      discardProviderBody(response);
      return fail(
        response.status === 429
          ? 'UPSTREAM_LIMIT'
          : response.status === 401 || response.status === 403
            ? 'UPSTREAM_AUTH'
            : 'UPSTREAM_UNAVAILABLE',
        true,
        'insights',
      );
    }
    const raw = await readProviderJson(response, signal, QLOO_MAX_RESPONSE_BYTES);
    signal.throwIfAborted();
    return projectInsightsResponse(raw, input.candidateIds);
  } catch (error) {
    return fail(
      input.signal?.aborted
        ? 'CANCELLED'
        : deadline.aborted
          ? 'TIMEOUT'
          : error instanceof ProviderResponseError
            ? 'INVALID_RESPONSE'
            : 'UPSTREAM_UNAVAILABLE',
      true,
      'insights',
    );
  }
}

function childEnvironment(source: Record<string, string | undefined>): Record<string, string> {
  if (source.QLOO_BASE_URL && source.QLOO_BASE_URL !== endpoint)
    throw new Error('INVALID_ENDPOINT');
  const env: Record<string, string> = { QLOO_BASE_URL: endpoint, QLOO_TRUSTED_BASE_URL: endpoint };
  // Do not pass database, client, session, or model credentials to the subprocess.
  for (const key of [
    'PATH',
    'HOME',
    'TMPDIR',
    'TEMP',
    'TMP',
    'SystemRoot',
    'LANG',
    'QLOO_API_KEY',
  ]) {
    if (typeof source[key] === 'string') env[key] = source[key]!;
  }
  return env;
}
function timeout(settings: Settings) {
  const ms = settings.timeoutMs ?? 20000;
  if (!Number.isSafeInteger(ms) || ms < 100 || ms > 60000) throw new Error('INVALID_TIMEOUT');
  return ms;
}
async function openHarness(settings: Settings, signal: AbortSignal) {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/stdio.js'),
  ]);
  signal.throwIfAborted();
  const binary = fileURLToPath(new URL('./bin.js', import.meta.resolve('@qloo/qloo-harness')));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [binary, 'mcp'],
    env: childEnvironment(settings.env ?? process.env),
    stderr: 'pipe',
  });
  transport.stderr?.on('data', () => undefined);
  const client = new Client({ name: 'tastekeeper-gateway', version: '0.1.0' });
  const options = {
    signal,
    timeout: timeout(settings),
    maxTotalTimeout: timeout(settings),
    resetTimeoutOnProgress: false,
  };
  try {
    await client.connect(transport, options);
    const tools = await client.listTools({}, options);
    const result = await client.callTool(
      { name: 'qloo_capabilities', arguments: {} },
      undefined,
      options,
    );
    const raw = result.structuredContent;
    if (
      !record(raw) ||
      !record(raw.adapter) ||
      typeof raw.adapter.ready !== 'boolean' ||
      typeof raw.contract_version !== 'string' ||
      typeof raw.contract_checksum !== 'string'
    )
      throw new Error('INVALID_CAPABILITIES');
    const capability: QlooCapability = {
      ready: raw.adapter.ready,
      contractVersion: raw.contract_version,
      contractChecksum: raw.contract_checksum,
      tools: tools.tools.map((t) => t.name),
      liveCallMade: false,
    };
    return { client, capability, options };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

/** Local capability inspection only. Readiness does not verify an API credential. */
export async function probeQloo(settings: Settings = {}): Promise<QlooCapability> {
  const signal = AbortSignal.timeout(timeout(settings));
  const harness = await openHarness(settings, signal);
  try {
    return harness.capability;
  } finally {
    await harness.client.close().catch(() => undefined);
  }
}

/** One bounded ranking call, no retries, batching, fallback, or provider prose.
 * Confirmed entity UUIDs are mandatory; ambiguous names never auto-resolve here.
 */
export async function rankQloo(
  input: QlooRankInput,
  settings: Settings = {},
): Promise<QlooRankResult> {
  const env = settings.env ?? process.env;
  const transport = settings.transport ?? env.QLOO_TRANSPORT ?? 'official-harness';
  if (transport !== 'official-harness' && transport !== 'insights') return fail('INVALID_INPUT');
  if (transport === 'official-harness' && settings.beforeProviderCall) return fail('INVALID_INPUT');
  if (
    !['book', 'movie', 'place'].includes(input.type) ||
    !validQlooIds(input.signalIds) ||
    !validQlooIds(input.candidateIds)
  )
    return fail('INVALID_INPUT', false, transport);
  if (input.signal?.aborted) return fail('CANCELLED', false, transport);
  const candidateIds = [...input.candidateIds];
  const signalIds = [...input.signalIds];
  const optionType = input.type;
  if (!env.QLOO_API_KEY?.trim()) return fail('NOT_CONFIGURED', false, transport);
  let ms: number;
  try {
    ms = timeout(settings);
    childEnvironment(env);
  } catch {
    return fail('INVALID_INPUT', false, transport);
  }
  const deadline = AbortSignal.timeout(ms);
  const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
  if (transport === 'insights')
    return rankInsights({ ...input, candidateIds, signalIds }, settings, signal, deadline);
  let harness: Awaited<ReturnType<typeof openHarness>> | undefined;
  let called = false;
  try {
    harness = await openHarness(settings, signal);
    if (!harness.capability.ready) return fail('NOT_CONFIGURED');
    if (!harness.capability.tools.includes('qloo_rank')) return fail('INVALID_RESPONSE');
    signal.throwIfAborted();
    called = true;
    const result = await harness.client.callTool(
      {
        name: 'qloo_rank',
        arguments: { option_type: optionType, options: candidateIds, signals: signalIds },
      },
      undefined,
      harness.options,
    );
    signal.throwIfAborted();
    return projectRankEnvelope(result.structuredContent, candidateIds);
  } catch {
    // Never reflect upstream messages, recovery strings, stderr or private inputs.
    return fail(
      input.signal?.aborted ? 'CANCELLED' : deadline.aborted ? 'TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
      called,
    );
  } finally {
    await harness?.client.close().catch(() => undefined);
  }
}
