import { mkdir } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import type { Workspace } from '../src/server/store.ts';

// Qloo search and reference confirmation are intercepted synthetic fixtures.
// These tests verify the owner UI and cannot send a paid provider request.
test.use({ trace: 'off' });
const ownerOrigin = process.env.APP_ORIGIN || 'http://127.0.0.1:3104';
const searchId = '11111111-1111-4111-8111-111111111111';
const candidates = [
  {
    id: '22222222-2222-4222-8222-222222222222',
    title: 'UI Fixture: Quiet Places',
    subtitle: 'Author One · Book · 1999',
    type: 'book',
    source: 'https://example.com/ui-fixture-one',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    title: 'UI Fixture: Quiet Places',
    subtitle: 'Author Two · Book · 2020',
    type: 'book',
    source: 'https://example.com/ui-fixture-two',
  },
];

async function fixture(page: Page) {
  expect((await page.request.post('/api/demo', { headers: { origin: ownerOrigin } })).ok()).toBe(
    true,
  );
  const snapshot = (await (await page.request.get('/api/workspace')).json()) as Workspace;
  snapshot.execution.referenceSearchAvailable = true;
  const gift = snapshot.contexts.find((entry) => entry.purpose === 'gift')!;
  return { snapshot, gift };
}

async function accessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('synthetic identity-search state: choose an exact match, explicitly confirm it, and see the new context revision', async ({
  page,
}, testInfo) => {
  const { snapshot, gift } = await fixture(page);
  const submitted: unknown[] = [];
  const added: unknown[] = [];
  let polls = 0;
  await page.route(`${ownerOrigin}/api/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/workspace') return route.fulfill({ json: snapshot });
    if (path === '/api/reference-searches' && request.method() === 'POST') {
      submitted.push(request.postDataJSON());
      return route.fulfill({ status: 202, json: { id: searchId, state: 'queued' } });
    }
    if (path === `/api/reference-searches/${searchId}`) {
      polls += 1;
      return route.fulfill({
        json: {
          id: searchId,
          state: polls === 1 ? 'searching' : 'complete',
          candidates: polls === 1 ? [] : candidates,
        },
      });
    }
    if (path === `/api/contexts/${gift.id}/references` && request.method() === 'POST') {
      added.push(request.postDataJSON());
      const context = snapshot.contexts.find((entry) => entry.id === gift.id)!;
      context.revision += 1;
      context.signals.push({
        id: 'synthetic-ui-confirmed-reference',
        entityId: 'synthetic-ui-test-only',
        title: candidates[1].title,
        subtitle: candidates[1].subtitle,
        type: 'book',
        tags: {},
        active: true,
        confirmedAt: '2026-10-27T10:00:00.000Z',
      });
      return route.fulfill({
        status: 201,
        json: {
          contextId: gift.id,
          revision: context.revision,
          added: { id: 'synthetic-ui-confirmed-reference', title: candidates[1].title },
          existingGrantsUnchanged: true,
        },
      });
    }
    if (path.includes('reference-searches') || path.endsWith('/references')) return route.abort();
    return route.continue();
  });
  await page.goto(`/contexts/${gift.id}`);
  await page.getByRole('button', { name: 'Find a reference', exact: true }).click();
  await page.getByLabel('Title, creator, or place', { exact: true }).fill('Quiet Places');
  await page.getByRole('button', { name: 'Search Qloo', exact: true }).click();
  await expect(
    page.getByText('2 matches returned. No reference has been added.', { exact: true }),
  ).toBeVisible();
  expect(submitted).toEqual([{ query: 'Quiet Places', type: 'book' }]);
  await expect(
    page.getByRole('button', { name: 'Review this identity', exact: true }),
  ).toBeDisabled();
  expect(added).toHaveLength(0);
  await expect(page.getByRole('radio').first()).not.toBeChecked();
  await expect(page.getByRole('radio').nth(1)).not.toBeChecked();
  await accessible(page);
  await page.getByRole('radio').nth(1).check();
  await page.getByRole('button', { name: 'Review this identity', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Review this reference', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Author Two · Book · 2020');
  await expect(page.getByRole('dialog')).toContainText(
    'Existing invitations keep their approved subset.',
  );
  await expect(
    page.getByRole('button', { name: 'Add to this context', exact: true }),
  ).toBeDisabled();
  expect(added).toHaveLength(0);
  await accessible(page);
  await mkdir('.artifacts/ui-states', { recursive: true });
  await page.screenshot({
    path: `.artifacts/ui-states/synthetic-reference-review-${testInfo.project.name}.png`,
    animations: 'disabled',
  });
  await page.getByLabel('I confirm this is the identity I mean.').check();
  await page.getByRole('button', { name: 'Add to this context', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(added).toEqual([{ expectedRevision: 1, searchId, candidateId: candidates[1].id }]);
  await expect(
    page.locator('.reference-detail').filter({ hasText: candidates[1].title }),
  ).toContainText('Author Two');
  await expect(page.getByRole('status')).toContainText('Existing invitations were not expanded.');
  await expect(page.getByText('GIFT / REVISION 2', { exact: true })).toBeVisible();
});

test('synthetic identity-search state: a failed provider search preserves the query and a stale confirmation requires reviewing the context', async ({
  page,
}) => {
  const { snapshot, gift } = await fixture(page);
  let searches = 0;
  await page.route(`${ownerOrigin}/api/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/workspace') return route.fulfill({ json: snapshot });
    if (path === '/api/reference-searches' && request.method() === 'POST') {
      searches += 1;
      return route.fulfill({ status: 202, json: { id: searchId, state: 'queued' } });
    }
    if (path === `/api/reference-searches/${searchId}`)
      return route.fulfill({
        json:
          searches === 1
            ? {
                id: searchId,
                state: 'failed',
                candidates: [],
                error: {
                  code: 'UPSTREAM_UNAVAILABLE',
                  message: 'Synthetic provider failure. Your search text is preserved.',
                },
              }
            : { id: searchId, state: 'complete', candidates },
      });
    if (path === `/api/contexts/${gift.id}/references` && request.method() === 'POST') {
      snapshot.contexts.find((entry) => entry.id === gift.id)!.revision = 2;
      return route.fulfill({
        status: 409,
        json: {
          error: {
            code: 'CORRECTION_CONFLICT',
            message: 'This context changed. Review the latest revision before adding a reference.',
          },
        },
      });
    }
    if (path.includes('reference-searches') || path.endsWith('/references')) return route.abort();
    return route.continue();
  });
  await page.goto(`/contexts/${gift.id}`);
  await page.getByRole('button', { name: 'Find a reference', exact: true }).click();
  await page.getByLabel('Title, creator, or place', { exact: true }).fill('Quiet Places');
  await page.getByRole('button', { name: 'Search Qloo', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic provider failure.');
  await expect(page.getByLabel('Title, creator, or place', { exact: true })).toHaveValue(
    'Quiet Places',
  );
  await page.getByRole('button', { name: 'Search Qloo', exact: true }).click();
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Review this identity', exact: true }).click();
  await page.getByLabel('I confirm this is the identity I mean.').check();
  await page.getByRole('button', { name: 'Add to this context', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('This context changed.');
  await expect(page.getByRole('button', { name: 'Add to this context', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Review current context', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('GIFT / REVISION 2', { exact: true })).toBeVisible();
});
