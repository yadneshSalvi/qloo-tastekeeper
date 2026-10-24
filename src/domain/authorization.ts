/** Pure authorization only. The caller must load trusted records and reserve budget
 * inside a transaction; this function never substitutes for live release checks. */
export type EntityType = 'book' | 'movie' | 'place';
export type PublicField = 'id' | 'title' | 'description' | 'creator' | 'url' | 'price';
export type Denial =
  | 'PRINCIPAL_DENIED'
  | 'CLIENT_DISABLED'
  | 'TOKEN_EXPIRED'
  | 'GRANT_REVOKED'
  | 'GRANT_EXPIRED'
  | 'REVISION_CHANGED'
  | 'SCOPE_DENIED'
  | 'CATALOG_DENIED'
  | 'CANDIDATE_DENIED'
  | 'SIGNAL_SELECTION_REQUIRED'
  | 'BUDGET_EXHAUSTED';

export interface DecisionRequest {
  grantId: string;
  contextId: string;
  purpose: string;
  operation: 'rank';
  targetType: EntityType;
  snapshotId: string;
  candidateIds: readonly string[];
  fields: readonly PublicField[];
}

export interface AuthorizationRecords {
  principal: { tenantId: string; clientId: string; delegateId: string };
  client: { id: string; tenantId: string; active: boolean; epoch: number };
  token: {
    tenantId: string;
    clientId: string;
    clientEpoch: number;
    delegateId: string;
    grantId: string;
    grantVersion: number;
    expiresAt: number;
  };
  context: {
    id: string;
    tenantId: string;
    ownerId: string;
    revision: number;
    deleted: boolean;
    signals: readonly { id: string; entityId: string; active: boolean }[];
  };
  grant: {
    id: string;
    tenantId: string;
    ownerId: string;
    delegateId: string;
    clientId: string;
    contextId: string;
    version: number;
    active: boolean;
    expiresAt: number;
    signalIds: readonly string[];
    catalogIds: readonly string[];
    snapshotMode: 'pinned' | 'follow_current';
    snapshotIds: readonly string[];
    operations: readonly string[];
    purposes: readonly string[];
    types: readonly EntityType[];
    fields: readonly PublicField[];
    remainingRequests: number;
  };
  snapshot: {
    id: string;
    tenantId: string;
    clientId: string;
    catalogId: string;
    type: EntityType;
    itemIds: readonly string[];
  };
}

export type AuthorizationResult =
  | { allowed: false; code: Denial }
  | {
      allowed: true;
      signalIds: string[];
      entityIds: string[];
      fields: PublicField[];
      revisions: { clientEpoch: number; contextRevision: number; grantVersion: number };
    };

const publicFields = new Set<PublicField>([
  'id',
  'title',
  'description',
  'creator',
  'url',
  'price',
]);
const subset = <T>(items: readonly T[], allowed: readonly T[]) =>
  items.every((item) => allowed.includes(item));
const unique = <T>(items: readonly T[]) => new Set(items).size === items.length;

export function authorizeDecision(
  records: AuthorizationRecords,
  request: DecisionRequest,
  now: number,
): AuthorizationResult {
  const { principal, client, token, context, grant, snapshot } = records;
  const deny = (code: Denial): AuthorizationResult => ({ allowed: false, code });
  if (
    ![client.tenantId, token.tenantId, context.tenantId, grant.tenantId, snapshot.tenantId].every(
      (id) => id === principal.tenantId,
    ) ||
    client.id !== principal.clientId ||
    token.clientId !== client.id ||
    grant.clientId !== client.id ||
    snapshot.clientId !== client.id ||
    token.delegateId !== principal.delegateId ||
    grant.delegateId !== principal.delegateId ||
    grant.ownerId !== context.ownerId ||
    token.grantId !== grant.id ||
    request.grantId !== grant.id ||
    grant.contextId !== context.id ||
    request.contextId !== context.id ||
    context.deleted
  )
    return deny('PRINCIPAL_DENIED');
  if (!client.active) return deny('CLIENT_DISABLED');
  if (!Number.isFinite(now) || !Number.isFinite(token.expiresAt) || token.expiresAt <= now)
    return deny('TOKEN_EXPIRED');
  if (!grant.active) return deny('GRANT_REVOKED');
  if (!Number.isFinite(grant.expiresAt) || grant.expiresAt <= now) return deny('GRANT_EXPIRED');
  if (token.clientEpoch !== client.epoch || token.grantVersion !== grant.version)
    return deny('REVISION_CHANGED');
  if (
    !grant.operations.includes(request.operation) ||
    !grant.purposes.includes(request.purpose) ||
    !grant.types.includes(request.targetType) ||
    request.fields.length === 0 ||
    !unique(request.fields) ||
    !request.fields.every((field) => publicFields.has(field)) ||
    !subset(request.fields, grant.fields)
  )
    return deny('SCOPE_DENIED');
  if (
    snapshot.id !== request.snapshotId ||
    !grant.catalogIds.includes(snapshot.catalogId) ||
    snapshot.type !== request.targetType ||
    !['pinned', 'follow_current'].includes(grant.snapshotMode) ||
    (grant.snapshotMode === 'pinned' && !grant.snapshotIds.includes(snapshot.id))
  )
    return deny('CATALOG_DENIED');
  if (
    request.candidateIds.length === 0 ||
    request.candidateIds.length > 10 ||
    !unique(request.candidateIds) ||
    !subset(request.candidateIds, snapshot.itemIds)
  )
    return deny('CANDIDATE_DENIED');
  if (grant.signalIds.length === 0 || grant.signalIds.length > 10 || !unique(grant.signalIds))
    return deny('SIGNAL_SELECTION_REQUIRED');
  const signals = context.signals.filter(
    (signal) => signal.active && grant.signalIds.includes(signal.id),
  );
  if (
    signals.length === 0 ||
    signals.length > 10 ||
    !unique(signals.map((signal) => signal.id)) ||
    signals.some((signal) => !signal.entityId)
  )
    return deny('SIGNAL_SELECTION_REQUIRED');
  if (!Number.isSafeInteger(grant.remainingRequests) || grant.remainingRequests <= 0)
    return deny('BUDGET_EXHAUSTED');
  return {
    allowed: true,
    signalIds: signals.map((signal) => signal.id),
    entityIds: [...new Set(signals.map((signal) => signal.entityId))],
    fields: [...request.fields],
    revisions: {
      clientEpoch: client.epoch,
      contextRevision: context.revision,
      grantVersion: grant.version,
    },
  };
}

/** Compare the authorized snapshot again under client → context → grant locks. */
export function releaseRevisionMatches(
  authorized: Extract<AuthorizationResult, { allowed: true }>,
  records: AuthorizationRecords,
): boolean {
  return (
    authorized.revisions.clientEpoch === records.client.epoch &&
    authorized.revisions.contextRevision === records.context.revision &&
    authorized.revisions.grantVersion === records.grant.version
  );
}

/** Construct a fresh object from public fields. Never forward a provider result. */
export function projectPublicItem(
  item: Partial<Record<PublicField, unknown>>,
  fields: readonly PublicField[],
): Partial<Record<PublicField, unknown>> {
  const output: Partial<Record<PublicField, unknown>> = {};
  for (const field of fields) {
    if (!publicFields.has(field) || !Object.hasOwn(item, field)) continue;
    const value = item[field];
    if (field === 'price') {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) output.price = value;
    } else if (typeof value === 'string') {
      if (field === 'url') {
        try {
          const url = new URL(value);
          if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
        } catch {
          continue;
        }
      }
      output[field] = value;
    }
  }
  return output;
}
