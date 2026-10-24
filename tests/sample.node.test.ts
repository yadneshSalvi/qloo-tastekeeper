import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankSample } from '../src/domain/sample.ts';
import { INVENTORIES, initialSignals } from '../src/domain/catalog.ts';
import { decisionSchema } from '../src/domain/contracts.ts';
import { bodyDigest } from '../src/server/crypto.ts';
test('explicit correction changes future authored ordering in books, films and places', () => {
  const initial = initialSignals('personal');
  const corrected = initial.map((s) => (s.id === 'ref-forest' ? { ...s, active: false } : s));
  for (const catalog of Object.values(INVENTORIES))
    assert.notEqual(
      rankSample(catalog, initial, {})[0].id,
      rankSample(catalog, corrected, {})[0].id,
    );
});
test('constraints intersect and empty signals never fall back to popularity', () => {
  assert.deepEqual(rankSample(INVENTORIES.books, [], {}), []);
  assert.deepEqual(rankSample(INVENTORIES.books, initialSignals('gift'), { maxPrice: 0 }), []);
  assert.ok(
    rankSample(INVENTORIES.media, initialSignals('personal'), { maxMinutes: 100 }).every(
      (item) => item.minutes! <= 100,
    ),
  );
});
test('request body digest is canonical, but different constraints are different', () => {
  assert.equal(bodyDigest({ a: 1, b: { c: 2 } }), bodyDigest({ b: { c: 2 }, a: 1 }));
  assert.notEqual(bodyDigest({ maxPrice: 100 }), bodyDigest({ maxPrice: 200 }));
});
test('strict contract does not accept profile or eleven candidate inputs', () => {
  assert.equal(decisionSchema.safeParse({ seed: 'secret' }).success, false);
});
