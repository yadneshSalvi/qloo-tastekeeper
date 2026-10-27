import { readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  CLIENTS,
  INVENTORIES,
  REFERENCE_CHOICES,
  type CatalogItem,
  type ClientId,
  type Signal,
} from '../domain/catalog.ts';

const recordSchema = z
  .object({
    entityId: z.uuid(),
    type: z.enum(['book', 'movie', 'place', 'person', 'artist']),
    name: z.string().trim().min(1).max(200),
    verifiedAt: z.iso.datetime({ offset: true }),
    method: z.string().trim().min(1).max(1000),
    source: z.string().max(1000).optional(),
  })
  .strict();
export const mappingsSchema = z
  .object({
    version: z.literal(1),
    verifiedAt: z.iso.datetime({ offset: true }),
    references: z.record(z.string(), recordSchema),
    items: z.record(z.string(), recordSchema),
  })
  .strict();
export type VerifiedMappings = z.infer<typeof mappingsSchema>;

/** Explicit, operator-reviewed identity records. Never infer UUIDs or resolve by popularity. */
export function readMappings(
  env: Record<string, string | undefined> = process.env,
): VerifiedMappings | null {
  const source =
    env.QLOO_MAPPINGS_JSON ||
    (env.QLOO_MAPPINGS_FILE ? readFileSync(env.QLOO_MAPPINGS_FILE, 'utf8') : undefined);
  if (!source) return null;
  if (Buffer.byteLength(source) > 100_000) throw new Error('MAPPING_CONFIG_TOO_LARGE');
  const parsed = mappingsSchema.parse(JSON.parse(source));
  const references = new Set<string>(REFERENCE_CHOICES.map((item) => item.id));
  const items = new Map(
    Object.entries(INVENTORIES).flatMap(([clientId, values]) =>
      values.map((item) => [item.id, CLIENTS[clientId as ClientId].type] as const),
    ),
  );
  if (
    Object.keys(parsed.references).some((id) => !references.has(id)) ||
    Object.entries(parsed.items).some(([id, value]) => items.get(id) !== value.type)
  ) {
    throw new Error('MAPPING_IDENTITY_MISMATCH');
  }
  return parsed;
}

export function mappedCatalog(clientId: ClientId, mappings = readMappings()): CatalogItem[] {
  return INVENTORIES[clientId].map((item) => ({
    ...item,
    tags: { ...item.tags },
    qlooId: mappings?.items[item.id]?.entityId ?? null,
  }));
}
export function mapSignals(signals: Signal[], mappings = readMappings()): Signal[] {
  return signals.map((signal) => ({
    ...signal,
    entityId: mappings?.references[signal.id]?.entityId ?? signal.entityId,
    // A person's reviewed Qloo taxonomy can differ from the UI's cultural category.
    type: mappings?.references[signal.id]?.type ?? signal.type,
  }));
}
export function reviewedReferences(mappings = readMappings()) {
  return REFERENCE_CHOICES.map(({ id, title, subtitle, type }) => ({
    id,
    title,
    subtitle,
    type,
    verified: Boolean(mappings?.references[id]),
    ...(mappings?.references[id]
      ? {
          verifiedAt: mappings.references[id].verifiedAt,
          method: mappings.references[id].method,
          source: mappings.references[id].source,
        }
      : {}),
  }));
}
export function executionCapabilities(mappings = readMappings()) {
  const qlooAvailable =
    process.env.QLOO_ENABLED === 'true' &&
    Boolean(mappings) &&
    Object.keys(mappings!.references).length > 0 &&
    Object.keys(mappings!.items).length > 0;
  const agentAvailable = process.env.AGENT_ENABLED === 'true';
  return {
    defaultMode: qlooAvailable ? ('qloo' as const) : ('sample' as const),
    qlooAvailable,
    referenceSearchAvailable: process.env.QLOO_ENABLED === 'true',
    agentAvailable,
    providerLabel: qlooAvailable ? 'Live Qloo · reviewed identities' : 'Authored sample rules',
    agentLabel: agentAvailable ? 'Bounded public-only AI concierge' : 'Public catalog descriptions',
  };
}
