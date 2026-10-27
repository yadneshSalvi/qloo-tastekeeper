import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { addReferenceSchema, referenceSearchSchema } from '../domain/contracts.ts';
import type { Signal } from '../domain/catalog.ts';
import { searchQlooReferences } from '../integrations/qloo-search.ts';
import { bodyDigest, decrypt, encrypt } from './crypto.ts';
import { transaction } from './db.ts';
import { dispatchReferenceSearch } from './dispatch.ts';
import { DomainError, denied } from './errors.ts';
import { reserveReferenceSearch } from './provider-budget.ts';
import { assertTenant, audit, one, readSignals, type ContextRow, type Owner } from './store.ts';

type SearchInput = z.infer<typeof referenceSearchSchema>;
type Candidate = {
  id: string;
  entityId: string;
  title: string;
  subtitle: string;
  type: SearchInput['type'];
  source?: string;
};
type SearchRow = {
  tenant_id: string;
  id: string;
  owner_id: string;
  state: 'queued' | 'searching' | 'complete' | 'failed';
  encrypted_query: string;
  encrypted_results: string | null;
  error_code: string | null;
  http_reserved: boolean;
  lease_until: Date | null;
  expires_at: Date;
};

export async function queueReferenceSearch(owner: Owner, value: unknown) {
  const input = referenceSearchSchema.parse(value);
  if (process.env.QLOO_ENABLED !== 'true') throw denied('UPSTREAM_UNAVAILABLE', 503);
  const queryDigest = bodyDigest(input);
  const queued = await transaction(owner.tenantId, async (db) => {
    await assertTenant(db, owner.tenantId);
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `reference-search:${owner.tenantId}:${queryDigest}`,
    ]);
    // Same query may be resumed after a dropped browser connection without another paid call.
    const prior = (
      await db.query<SearchRow>(
        "SELECT * FROM reference_searches WHERE tenant_id=$1 AND owner_id=$2 AND query_digest=$3 AND expires_at>now() AND state IN ('queued','searching','complete') ORDER BY created_at DESC LIMIT 1",
        [owner.tenantId, owner.ownerId, queryDigest],
      )
    ).rows[0];
    if (prior) return { id: prior.id, state: prior.state };
    const id = randomUUID();
    await db.query(
      "INSERT INTO reference_searches(tenant_id,id,owner_id,query_digest,encrypted_query,state) VALUES($1,$2,$3,$4,$5,'queued')",
      [owner.tenantId, id, owner.ownerId, queryDigest, encrypt(input)],
    );
    await audit(db, owner.tenantId, 'reference_search.queued', id, { type: input.type });
    return { id, state: 'queued' as const };
  });
  if (queued.state === 'queued') {
    try {
      await dispatchReferenceSearch(owner.tenantId, queued.id);
    } catch {
      await transaction(owner.tenantId, (db) =>
        audit(db, owner.tenantId, 'reference_search.dispatch_pending', queued.id),
      );
    }
  }
  return queued;
}

export async function referenceSearchView(owner: Owner, id: string) {
  return transaction(owner.tenantId, async (db) => {
    await assertTenant(db, owner.tenantId);
    const row = await one<SearchRow>(
      db,
      'SELECT * FROM reference_searches WHERE tenant_id=$1 AND id=$2 AND owner_id=$3',
      [owner.tenantId, id, owner.ownerId],
    );
    if (row.expires_at.getTime() <= Date.now())
      throw new DomainError(
        'SEARCH_EXPIRED',
        'These search results expired. Search again before confirming an identity.',
        410,
      );
    const candidates = row.encrypted_results ? decrypt<Candidate[]>(row.encrypted_results) : [];
    return {
      id: row.id,
      state: row.state,
      candidates: candidates.map(({ entityId: _entityId, ...candidate }) => {
        void _entityId;
        return candidate;
      }),
      ...(row.error_code
        ? { error: { code: row.error_code, message: denied(row.error_code).message } }
        : {}),
    };
  });
}

export async function prepareReferenceSearch(tenantId: string, id: string) {
  let owned = false;
  try {
    const captured = await transaction(tenantId, async (db) => {
      await assertTenant(db, tenantId);
      const row = await one<SearchRow>(
        db,
        'SELECT * FROM reference_searches WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
        [tenantId, id],
      );
      if (
        row.state === 'complete' ||
        row.state === 'failed' ||
        row.expires_at.getTime() <= Date.now()
      )
        return null;
      if (row.state === 'searching' && row.lease_until && row.lease_until.getTime() > Date.now())
        return null;
      if (row.http_reserved) {
        await db.query(
          "UPDATE reference_searches SET state='failed',error_code='PROVIDER_ATTEMPT_LIMIT',lease_until=NULL WHERE tenant_id=$1 AND id=$2",
          [tenantId, id],
        );
        return null;
      }
      await db.query(
        "UPDATE reference_searches SET state='searching',lease_until=now()+interval '30 seconds' WHERE tenant_id=$1 AND id=$2",
        [tenantId, id],
      );
      return row;
    });
    if (!captured) return;
    owned = true;
    const input = referenceSearchSchema.parse(decrypt<SearchInput>(captured.encrypted_query));
    const result = await searchQlooReferences(input, {
      beforeProviderCall: async () => {
        await transaction(tenantId, (db) => assertTenant(db, tenantId));
        await reserveReferenceSearch(tenantId, id);
      },
    });
    if (!result.ok) throw denied(result.errorCode, 503);
    const candidates: Candidate[] = result.candidates.map((candidate) => ({
      id: randomUUID(),
      entityId: candidate.entityId,
      title: candidate.name,
      subtitle: candidate.subtitle,
      type: candidate.type,
      ...(candidate.source ? { source: candidate.source } : {}),
    }));
    await transaction(tenantId, async (db) => {
      await assertTenant(db, tenantId);
      const updated = await db.query(
        "UPDATE reference_searches SET state='complete',encrypted_results=$3,lease_until=NULL WHERE tenant_id=$1 AND id=$2 AND state='searching' AND lease_until>clock_timestamp()",
        [tenantId, id, encrypt(candidates)],
      );
      if (updated.rowCount)
        await audit(db, tenantId, 'reference_search.completed', id, {
          candidateCount: candidates.length,
          providerRequests: 1,
        });
    });
  } catch (error) {
    if (!owned) return;
    const code = error instanceof DomainError ? error.code : 'UPSTREAM_UNAVAILABLE';
    await transaction(tenantId, (db) =>
      db.query(
        "UPDATE reference_searches SET state='failed',error_code=$3,lease_until=NULL WHERE tenant_id=$1 AND id=$2 AND state='searching'",
        [tenantId, id, code],
      ),
    );
  }
}

export async function confirmReference(owner: Owner, contextId: string, value: unknown) {
  const input = addReferenceSchema.parse(value);
  return transaction(owner.tenantId, async (db) => {
    const t = owner.tenantId;
    await assertTenant(db, t);
    await db.query('SELECT id FROM clients WHERE tenant_id=$1 ORDER BY id FOR UPDATE', [t]);
    const context = await one<ContextRow>(
      db,
      'SELECT * FROM contexts WHERE tenant_id=$1 AND id=$2 AND owner_id=$3 AND NOT deleted FOR UPDATE',
      [t, contextId, owner.ownerId],
    );
    if (context.revision !== input.expectedRevision)
      throw new DomainError(
        'CORRECTION_CONFLICT',
        'This context changed. Review the latest revision before adding a reference.',
        409,
        { currentRevision: context.revision },
      );
    const search = await one<SearchRow>(
      db,
      "SELECT * FROM reference_searches WHERE tenant_id=$1 AND id=$2 AND owner_id=$3 AND state='complete' AND expires_at>now()",
      [t, input.searchId, owner.ownerId],
    );
    const candidate = decrypt<Candidate[]>(search.encrypted_results!).find(
      (item) => item.id === input.candidateId,
    );
    if (!candidate) throw denied('PRINCIPAL_DENIED', 404);
    const signals = await readSignals(db, context);
    if (signals.filter((signal) => signal.active).length >= 30)
      throw new DomainError(
        'CONTEXT_LIMIT',
        'This context already has 30 active references. Remove one before adding another.',
        422,
      );
    if (signals.some((signal) => signal.active && signal.entityId === candidate.entityId))
      throw new DomainError(
        'REFERENCE_ALREADY_ADDED',
        'This exact reference is already active in this context.',
        409,
      );
    const added: Signal = {
      id: `sig-${randomUUID()}`,
      entityId: candidate.entityId,
      title: candidate.title,
      subtitle: candidate.subtitle,
      type: candidate.type,
      tags: {},
      active: true,
      confirmedAt: new Date().toISOString(),
    };
    await db.query(
      'INSERT INTO context_revisions(tenant_id,context_id,revision,encrypted_signals,reason,author_id) VALUES($1,$2,$3,$4,$5,$6)',
      [
        t,
        context.id,
        context.revision + 1,
        encrypt([...signals, added]),
        'Owner explicitly confirmed a Qloo search identity. Existing approved grant references were not expanded.',
        owner.ownerId,
      ],
    );
    await db.query('UPDATE contexts SET revision=revision+1 WHERE tenant_id=$1 AND id=$2', [
      t,
      context.id,
    ]);
    await db.query(
      "INSERT INTO outbox(tenant_id,id,kind,subject_id) VALUES($1,$2,'context.corrected',$3)",
      [t, randomUUID(), context.id],
    );
    await audit(db, t, 'context.reference_added', context.id, {
      fromRevision: context.revision,
      toRevision: context.revision + 1,
      existingGrantsUnchanged: true,
    });
    return {
      contextId: context.id,
      revision: context.revision + 1,
      added: { id: added.id, title: added.title },
      existingGrantsUnchanged: true,
    };
  });
}
