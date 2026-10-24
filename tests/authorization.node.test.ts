import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeDecision,
  projectPublicItem,
  releaseRevisionMatches,
  type AuthorizationRecords,
  type DecisionRequest,
} from '../src/domain/authorization.ts';

const now = 1000;
function fixture(): { records: AuthorizationRecords; request: DecisionRequest } {
  return {
    records: {
      principal: { tenantId: 'tenant', clientId: 'books', delegateId: 'giver' },
      client: { id: 'books', tenantId: 'tenant', active: true, epoch: 1 },
      token: {
        tenantId: 'tenant',
        clientId: 'books',
        clientEpoch: 1,
        delegateId: 'giver',
        grantId: 'grant',
        grantVersion: 1,
        expiresAt: 2000,
      },
      context: {
        id: 'gift',
        tenantId: 'tenant',
        ownerId: 'recipient',
        revision: 1,
        deleted: false,
        signals: [
          { id: 's1', entityId: 'entity1', active: true },
          { id: 's2', entityId: 'entity2', active: true },
        ],
      },
      grant: {
        id: 'grant',
        tenantId: 'tenant',
        ownerId: 'recipient',
        delegateId: 'giver',
        clientId: 'books',
        contextId: 'gift',
        version: 1,
        active: true,
        expiresAt: 3000,
        signalIds: ['s1'],
        catalogIds: ['bookshelf'],
        snapshotMode: 'pinned',
        snapshotIds: ['edition1'],
        operations: ['rank'],
        purposes: ['gift'],
        types: ['book'],
        fields: ['id', 'title'],
        remainingRequests: 1,
      },
      snapshot: {
        id: 'edition1',
        tenantId: 'tenant',
        clientId: 'books',
        catalogId: 'bookshelf',
        type: 'book',
        itemIds: ['book1', 'book2'],
      },
    },
    request: {
      grantId: 'grant',
      contextId: 'gift',
      purpose: 'gift',
      operation: 'rank',
      targetType: 'book',
      snapshotId: 'edition1',
      candidateIds: ['book1', 'book2'],
      fields: ['id', 'title'],
    },
  };
}

test('a complete single grant allows only explicitly selected active references', () => {
  const { records, request } = fixture();
  const result = authorizeDecision(records, request, now);
  assert.equal(result.allowed, true);
  if (result.allowed) assert.deepEqual(result.signalIds, ['s1']);
});

const cases: [string, (f: ReturnType<typeof fixture>) => void, string][] = [
  [
    'foreign tenant',
    (f) => {
      f.records.snapshot.tenantId = 'other';
    },
    'PRINCIPAL_DENIED',
  ],
  [
    'different delegate',
    (f) => {
      f.records.principal.delegateId = 'stranger';
    },
    'PRINCIPAL_DENIED',
  ],
  [
    'foreign context',
    (f) => {
      f.request.contextId = 'personal';
    },
    'PRINCIPAL_DENIED',
  ],
  [
    'deleted context',
    (f) => {
      f.records.context.deleted = true;
    },
    'PRINCIPAL_DENIED',
  ],
  [
    'disabled client',
    (f) => {
      f.records.client.active = false;
    },
    'CLIENT_DISABLED',
  ],
  [
    'expired credential',
    (f) => {
      f.records.token.expiresAt = now;
    },
    'TOKEN_EXPIRED',
  ],
  [
    'revoked grant',
    (f) => {
      f.records.grant.active = false;
    },
    'GRANT_REVOKED',
  ],
  [
    'expired grant',
    (f) => {
      f.records.grant.expiresAt = now;
    },
    'GRANT_EXPIRED',
  ],
  [
    'rotated credential',
    (f) => {
      f.records.client.epoch++;
    },
    'REVISION_CHANGED',
  ],
  [
    'narrowed grant',
    (f) => {
      f.records.grant.version++;
    },
    'REVISION_CHANGED',
  ],
  [
    'different purpose',
    (f) => {
      f.request.purpose = 'advertising';
    },
    'SCOPE_DENIED',
  ],
  [
    'extra disclosure',
    (f) => {
      f.request.fields = ['id', 'description'];
    },
    'SCOPE_DENIED',
  ],
  [
    'same-client catalog substitution',
    (f) => {
      f.records.snapshot.catalogId = 'other-bookshelf';
    },
    'CATALOG_DENIED',
  ],
  [
    'replaced pinned snapshot',
    (f) => {
      f.records.snapshot.id = 'edition2';
      f.request.snapshotId = 'edition2';
    },
    'CATALOG_DENIED',
  ],
  [
    'unapproved candidate',
    (f) => {
      f.request.candidateIds = ['foreign-book'];
    },
    'CANDIDATE_DENIED',
  ],
  [
    'duplicate candidate',
    (f) => {
      f.request.candidateIds = ['book1', 'book1'];
    },
    'CANDIDATE_DENIED',
  ],
  [
    'eleven references',
    (f) => {
      f.records.grant.signalIds = Array.from({ length: 11 }, (_, i) => `s${i}`);
    },
    'SIGNAL_SELECTION_REQUIRED',
  ],
  [
    'removed selected reference',
    (f) => {
      f.records.context.signals = [{ id: 's1', entityId: 'entity1', active: false }];
    },
    'SIGNAL_SELECTION_REQUIRED',
  ],
  [
    'spent budget',
    (f) => {
      f.records.grant.remainingRequests = 0;
    },
    'BUDGET_EXHAUSTED',
  ],
];
for (const [name, mutate, code] of cases)
  test(`denies ${name}`, () => {
    const f = fixture();
    mutate(f);
    assert.deepEqual(authorizeDecision(f.records, f.request, now), { allowed: false, code });
  });

test('follow-current access remains confined to the explicitly approved catalog', () => {
  const { records, request } = fixture();
  records.grant.snapshotMode = 'follow_current';
  records.snapshot.id = 'edition2';
  request.snapshotId = 'edition2';
  assert.equal(authorizeDecision(records, request, now).allowed, true);
  records.snapshot.catalogId = 'other';
  assert.deepEqual(authorizeDecision(records, request, now), {
    allowed: false,
    code: 'CATALOG_DENIED',
  });
});

test('any context revision makes an earlier release snapshot stale', () => {
  const { records, request } = fixture();
  const result = authorizeDecision(records, request, now);
  assert.equal(result.allowed, true);
  if (!result.allowed) return;
  assert.equal(releaseRevisionMatches(result, records), true);
  records.context.revision++;
  assert.equal(releaseRevisionMatches(result, records), false);
});

test('projection creates a fresh public object and cannot release seeds or provider payloads', () => {
  const item = {
    id: 'book1',
    title: 'A public book',
    seeds: ['private'],
    raw: { secret: true },
    description: 'Public description',
  };
  assert.deepEqual(projectPublicItem(item, ['id', 'title']), {
    id: 'book1',
    title: 'A public book',
  });
  assert.deepEqual(projectPublicItem(item, ['seeds' as 'id']), {});
});

test('public field names cannot smuggle nested private payloads or executable URLs', () => {
  assert.deepEqual(
    projectPublicItem(
      { title: { seeds: ['private'] }, url: 'javascript:alert(1)', price: Number.NaN },
      ['title', 'url', 'price'],
    ),
    {},
  );
  assert.deepEqual(
    projectPublicItem({ id: 'one', price: 1200, url: 'https://example.com/book' }, [
      'id',
      'price',
      'url',
    ]),
    { id: 'one', price: 1200, url: 'https://example.com/book' },
  );
});
