/** Worker-only owner identity lookup. A returned candidate still requires
 * explicit owner confirmation; the adapter never selects an identity itself.
 */
import { z } from 'zod';
import { QLOO_MAX_RESPONSE_BYTES, type QlooFailureCode, type QlooSettings } from './qloo.ts';
import {
  discardProviderBody,
  ProviderResponseError,
  readProviderJson,
  withinDeadline,
} from './provider-http.ts';

const types = ['book', 'movie', 'person', 'artist', 'place'] as const;
export type QlooReferenceType = (typeof types)[number];
export type QlooReferenceCandidate = {
  entityId: string;
  name: string;
  type: QlooReferenceType;
  /** Observed public identity differentiators only; empty when unavailable. */
  subtitle: string;
  source?: string;
};
export type QlooReferenceSearchInput = {
  query: string;
  type: QlooReferenceType;
  signal?: AbortSignal;
};
export type QlooReferenceSearchResult =
  | { ok: true; status: 'ok' | 'empty' | 'partial'; candidates: QlooReferenceCandidate[] }
  | { ok: false; errorCode: QlooFailureCode };
const endpoint = 'https://hackathon.api.qloo.com';
const inputSchema = z.object({ query: z.string().trim().min(2).max(160), type: z.enum(types) });
const uuid = z.uuid();
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (errorCode: QlooFailureCode): QlooReferenceSearchResult => ({ ok: false, errorCode });
function text(value: unknown, max = 200): string | undefined {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /[\u0000-\u001f\u007f<>]/.test(trimmed)) return;
  return trimmed;
}
function names(value: unknown): string | undefined {
  const values = Array.isArray(value) ? value : [value];
  const selected = values
    .slice(0, 3)
    .map((entry) => text(record(entry) ? entry.name : entry, 100))
    .filter((entry): entry is string => Boolean(entry));
  return selected.length ? [...new Set(selected)].join(', ') : undefined;
}
function year(value: unknown): string | undefined {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d{1,4}$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > new Date().getUTCFullYear() + 5) return;
  return String(parsed);
}
function date(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value ||
    parsed.getTime() > Date.now()
  )
    return;
  return value;
}
function isbn(value: unknown): string | undefined {
  const entries = Array.isArray(value) ? value : [value];
  for (const entry of entries.slice(0, 5)) {
    const raw = text(record(entry) ? entry.id : entry, 40)
      ?.replace(/[ -]/g, '')
      .toUpperCase();
    if (!raw) continue;
    if (
      /^97[89]\d{10}$/.test(raw) &&
      [...raw].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3), 0) %
        10 ===
        0
    )
      return raw;
    if (
      /^\d{9}[\dX]$/.test(raw) &&
      [...raw].reduce(
        (sum, digit, index) => sum + (digit === 'X' ? 10 : Number(digit)) * (10 - index),
        0,
      ) %
        11 ===
        0
    )
      return raw;
  }
}
function address(value: unknown): string | undefined {
  if (!record(value)) return text(value, 300);
  // Never stringify an arbitrary address/geocode object or expose contact data.
  const parts = ['street_address', 'street', 'city', 'state', 'postal_code', 'country']
    .map((key) => text(value[key], 100))
    .filter((part): part is string => Boolean(part));
  const rendered = [...new Set(parts)].join(', ');
  return rendered.length <= 300 && rendered ? rendered : undefined;
}
function source(value: unknown): string | undefined {
  const raw = text(value, 1000);
  if (!raw) return;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return;
    return url.href;
  } catch {
    return;
  }
}
function differentiators(entity: Record<string, unknown>, type: QlooReferenceType): string {
  const properties = record(entity.properties) ? entity.properties : {};
  const external = record(entity.external) ? entity.external : {};
  const parts: string[] = [];
  if (type === 'book') {
    const author = names(properties.authors ?? properties.author);
    const publication = year(properties.publication_year);
    const identifier = isbn(external.isbn13) ?? isbn(external.isbn10);
    if (author) parts.push(author);
    if (publication) parts.push(publication);
    if (identifier) parts.push(`ISBN ${identifier}`);
  } else if (type === 'movie') {
    const director = names(properties.directors ?? properties.director);
    const release =
      year(properties.release_year) ??
      (typeof properties.release_date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(properties.release_date)
        ? year(properties.release_date.slice(0, 4))
        : undefined);
    if (director) parts.push(director);
    if (release) parts.push(release);
  } else if (type === 'place') {
    const location = address(properties.address ?? entity.address);
    if (location) parts.push(location);
  } else {
    const born = date(properties.date_of_birth);
    if (born) parts.push(`Born ${born}`);
  }
  return parts.join(' · ').slice(0, 500);
}

/** Supports the two result containers handled by the installed native harness.
 * Unknown taxonomy or malformed identities are omitted, never inferred from the
 * requested type, name match, popularity, or model output.
 */
export function projectReferenceSearch(
  raw: unknown,
  type: QlooReferenceType,
): QlooReferenceSearchResult {
  if (
    !record(raw) ||
    (raw.success !== undefined && raw.success !== true) ||
    (raw.error !== undefined && raw.error !== null)
  )
    return fail('INVALID_RESPONSE');
  const results = Array.isArray(raw.results)
    ? raw.results
    : record(raw.results)
      ? raw.results.entities
      : undefined;
  if (!Array.isArray(results)) return fail('INVALID_RESPONSE');
  const candidates: QlooReferenceCandidate[] = [];
  const seen = new Set<string>();
  let partial = results.length > 5;
  for (const result of results.slice(0, 5)) {
    if (!record(result)) {
      partial = true;
      continue;
    }
    const entityId = uuid.safeParse(result.entity_id ?? result.id);
    const name = text(result.name);
    const declared = [
      result.type,
      result.subtype,
      ...(Array.isArray(result.types) ? result.types : []),
    ];
    if (
      !entityId.success ||
      !name ||
      !declared.some((value) => value === type || value === `urn:entity:${type}`)
    ) {
      partial = true;
      continue;
    }
    const id = entityId.data.toLowerCase();
    if (seen.has(id)) return fail('INVALID_RESPONSE');
    seen.add(id);
    const properties = record(result.properties) ? result.properties : {};
    const url = source(properties.website) ?? source(properties.url) ?? source(result.url);
    candidates.push({
      entityId: id,
      name,
      type,
      subtitle: differentiators(result, type),
      ...(url ? { source: url } : {}),
    });
  }
  if (results.length > 0 && candidates.length === 0) return fail('INVALID_RESPONSE');
  return {
    ok: true,
    status: candidates.length === 0 ? 'empty' : partial ? 'partial' : 'ok',
    candidates,
  };
}

/** One GET /search, at most five choices, no retries, redirects, or LLM.
 * The gateway's trusted callback authorizes and reserves this exact HTTP call.
 */
export async function searchQlooReferences(
  input: QlooReferenceSearchInput,
  settings: QlooSettings = {},
): Promise<QlooReferenceSearchResult> {
  const parsed = inputSchema.safeParse(input);
  const env = settings.env ?? process.env;
  const ms = settings.timeoutMs ?? 10000;
  if (
    !parsed.success ||
    !Number.isSafeInteger(ms) ||
    ms < 100 ||
    ms > 20000 ||
    (env.QLOO_BASE_URL && env.QLOO_BASE_URL !== endpoint)
  )
    return fail('INVALID_INPUT');
  if (input.signal?.aborted) return fail('CANCELLED');
  if (!env.QLOO_API_KEY?.trim()) return fail('NOT_CONFIGURED');
  const deadline = AbortSignal.timeout(ms);
  const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
  if (settings.beforeProviderCall) {
    try {
      await withinDeadline(settings.beforeProviderCall(), signal);
    } catch (error) {
      if (!signal.aborted) throw error;
      return fail(input.signal?.aborted ? 'CANCELLED' : 'TIMEOUT');
    }
  }
  if (signal.aborted) return fail(input.signal?.aborted ? 'CANCELLED' : 'TIMEOUT');
  const url = new URL('/search', endpoint);
  url.searchParams.set('query', parsed.data.query);
  url.searchParams.set('types', `urn:entity:${parsed.data.type}`);
  url.searchParams.set('take', '5');
  try {
    const response = await withinDeadline(
      (settings.fetch ?? globalThis.fetch)(url, {
        method: 'GET',
        headers: { Accept: 'application/json', 'X-Api-Key': env.QLOO_API_KEY.trim() },
        redirect: 'error',
        cache: 'no-store',
        signal,
      }),
      signal,
    );
    if (!response.ok) {
      discardProviderBody(response);
      if (response.status === 404) return { ok: true, status: 'empty', candidates: [] };
      return fail(
        response.status === 429
          ? 'UPSTREAM_LIMIT'
          : response.status === 401 || response.status === 403
            ? 'UPSTREAM_AUTH'
            : 'UPSTREAM_UNAVAILABLE',
      );
    }
    const raw = await readProviderJson(response, signal, QLOO_MAX_RESPONSE_BYTES);
    signal.throwIfAborted();
    return projectReferenceSearch(raw, parsed.data.type);
  } catch (error) {
    return fail(
      input.signal?.aborted
        ? 'CANCELLED'
        : deadline.aborted
          ? 'TIMEOUT'
          : error instanceof ProviderResponseError
            ? 'INVALID_RESPONSE'
            : 'UPSTREAM_UNAVAILABLE',
    );
  }
}
