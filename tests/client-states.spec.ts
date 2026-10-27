import { test, expect } from '@playwright/test';

// Deliberately synthetic UI fixtures. Every API request is intercepted, so these
// state tests cannot call Qloo, an AI provider, or a real owner workspace.
test.use({ trace: 'off' });

const origin = process.env.CLIENT_BOOKS_ORIGIN || 'http://books.localhost:3114';
const item = {
  id: 'ui-test-book',
  title: 'A Synthetic UI Test Book',
  creator: 'Test fixture',
  description: 'Public facts used only to exercise the client interface.',
  url: 'https://example.com/book',
  price: 2200,
  format: 'hardback',
  art: 'botanical',
};
const session = {
  mode: 'qloo',
  execution: {
    defaultMode: 'qloo',
    qlooAvailable: true,
    agentAvailable: false,
    providerLabel: 'Qloo live · synthetic UI capability fixture',
    agentLabel: 'Public catalog descriptions',
  },
  grant: {
    id: 'ui-test-grant',
    contextId: 'ui-test-context',
    contextName: 'Gift context',
    purpose: 'gift',
    expiresAt: '2099-10-27T12:00:00.000Z',
    remainingRequests: 3,
    snapshotId: 'ui-test-snapshot',
    fields: ['id', 'title', 'creator', 'description', 'url', 'price'],
    version: 1,
  },
  delegate: { displayName: 'UI-test giver' },
  catalog: {
    id: 'ui-test-catalog',
    snapshotId: 'ui-test-snapshot',
    source: 'Synthetic browser-test fixture',
    retrievedAt: '2026-10-27T10:00:00.000Z',
    availabilityNotice: 'Synthetic test catalog. Amounts and artwork are illustrative.',
    items: [item],
  },
  selections: [],
};
const released = {
  id: 'ui-test-run',
  state: 'released',
  items: [item],
  provenance: {
    mode: 'authored_sample',
    label: 'Synthetic sample response for a UI state test',
    status: 'ok',
    candidateCount: 1,
    selectedCount: 1,
  },
  receipt: {
    id: 'ui-test-receipt',
    grantVersion: 1,
    contextRevision: 1,
    authorizedAt: '2026-10-27T10:00:00.000Z',
    fields: ['id', 'title', 'creator', 'description', 'url', 'price'],
  },
  stale: false,
};

test('synthetic UI state: live is the reported default, a provider failure preserves the brief, and sample fallback is explicit', async ({
  page,
}) => {
  const requests: { mode: string; brief: { occasion: string; note?: string } }[] = [];
  await page.route(`${origin}/api/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: session });
    if (path === '/api/decisions' && request.method() === 'POST') {
      const body = request.postDataJSON();
      requests.push(body);
      if (body.mode === 'qloo')
        return route.fulfill({
          status: 503,
          json: { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Synthetic provider failure' } },
        });
      return route.fulfill({ status: 202, json: { id: 'ui-test-run', state: 'queued' } });
    }
    if (path === '/api/decisions/ui-test-run') return route.fulfill({ json: released });
    return route.abort();
  });
  await page.goto(origin);
  await expect(page.getByRole('button', { name: /Qloo live/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.unavailable-label')).toHaveCount(0);
  await page.getByLabel('The occasion', { exact: true }).selectOption('birthday');
  await page
    .getByLabel('A little more about the gift', { exact: false })
    .fill('Something to dip into on a quiet Sunday.');
  await page.getByLabel(/Illustrative budget/).fill('25');
  await page.getByRole('button', { name: 'Find a thoughtful book', exact: false }).click();
  await expect(
    page.getByRole('heading', { name: 'Qloo live is unavailable.', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.result-card')).toHaveCount(0);
  await expect(page.getByLabel('A little more about the gift', { exact: false })).toHaveValue(
    'Something to dip into on a quiet Sunday.',
  );
  await expect(page.getByLabel(/Illustrative budget/)).toHaveValue('25');
  expect(requests[0].mode).toBe('qloo');
  expect(requests[0].brief).toEqual({
    occasion: 'birthday',
    note: 'Something to dip into on a quiet Sunday.',
  });
  await expect(page.getByRole('button', { name: 'Authored sample', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: 'Use authored sample', exact: true }).click();
  await expect(page.locator('.result-card')).toHaveCount(1);
  expect(requests.map((request) => request.mode)).toEqual(['qloo', 'sample']);
  await expect(page.locator('.provenance-label')).toHaveText('Authored sample');
});

test('synthetic UI state: a late response cannot repaint results after server-reported revocation', async ({
  page,
}) => {
  let revoked = false;
  let releaseResult: () => void = () => {};
  const delayedResult = new Promise<void>((resolve) => {
    releaseResult = resolve;
  });
  let decisionRead = false;
  await page.route(`${origin}/api/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/session')
      return route.fulfill(
        revoked
          ? {
              status: 403,
              json: { error: { code: 'GRANT_REVOKED', message: 'Synthetic server denial' } },
            }
          : { json: session },
      );
    if (path === '/api/decisions' && request.method() === 'POST')
      return route.fulfill({ status: 202, json: { id: 'ui-test-run', state: 'queued' } });
    if (path === '/api/decisions/ui-test-run') {
      decisionRead = true;
      await delayedResult;
      return route.fulfill({ json: released });
    }
    return route.abort();
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Find a thoughtful book', exact: false }).click();
  await expect.poll(() => decisionRead).toBe(true);
  await expect(page.getByRole('heading', { name: 'A choice is on its way.' })).toBeVisible();
  revoked = true;
  await page.getByRole('button', { name: 'Retry connection', exact: false }).click();
  await expect(
    page.getByRole('heading', { name: 'Mira has ended this connection.' }),
  ).toBeVisible();
  const lateResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/decisions/ui-test-run',
  );
  releaseResult();
  await (await lateResponse).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.locator('.result-card')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Find a thoughtful book', exact: false }),
  ).toHaveCount(0);
  await expect(page.locator('.blocked-panel')).toContainText('GRANT_REVOKED');
});

for (const coverage of [
  {
    name: 'partial Qloo coverage with complete AI explanations',
    status: 'partial',
    candidateCount: 6,
    mappedCount: 5,
    unmappedCount: 1,
    returnedCount: 4,
    shownCount: 3,
    agentStatus: 'complete',
    explanationUnavailable: false,
  },
  {
    name: 'complete Qloo coverage with unavailable AI explanations',
    status: 'degraded',
    candidateCount: 8,
    mappedCount: 6,
    unmappedCount: 2,
    returnedCount: 6,
    shownCount: 2,
    agentStatus: 'unavailable',
    explanationUnavailable: true,
  },
]) {
  test(`synthetic UI state: ${coverage.name} keeps provider coverage and choices shown separate`, async ({
    page,
  }) => {
    const catalogItems = Array.from({ length: coverage.candidateCount }, (_, index) => ({
      ...item,
      id: `ui-test-book-${index + 1}`,
      title: `Synthetic UI Test Book ${index + 1}`,
      url: `https://example.com/ui-test-book-${index + 1}`,
    }));
    const shownItems = catalogItems.slice(0, coverage.shownCount);
    const result = {
      ...released,
      items: shownItems,
      provenance: {
        mode: 'qloo',
        label: 'Synthetic Qloo coverage fixture; no provider call',
        status: coverage.status,
        candidateCount: coverage.candidateCount,
        selectedCount: coverage.shownCount,
        mappedCount: coverage.mappedCount,
        unmappedCount: coverage.unmappedCount,
        returnedCount: coverage.returnedCount,
        agent: {
          enabled: true,
          status: coverage.agentStatus,
          label: 'Synthetic public AI explanation fixture',
        },
      },
      ...(coverage.explanationUnavailable
        ? {}
        : {
            explanations: shownItems.map((entry) => ({
              itemId: entry.id,
              text: 'A synthetic explanation using this public item’s facts.',
            })),
          }),
    };
    await page.route(`${origin}/api/**`, async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === '/api/session')
        return route.fulfill({
          json: {
            ...session,
            execution: { ...session.execution, agentAvailable: true },
            catalog: { ...session.catalog, items: catalogItems },
          },
        });
      if (path === '/api/decisions' && request.method() === 'POST')
        return route.fulfill({ status: 202, json: { id: 'ui-test-run', state: 'queued' } });
      if (path === '/api/decisions/ui-test-run') return route.fulfill({ json: result });
      return route.abort();
    });
    await page.goto(origin);
    await page.getByRole('button', { name: 'Find a thoughtful book', exact: false }).click();
    await expect(page.locator('.result-card')).toHaveCount(coverage.shownCount);
    const coverageCopy = `Qloo returned ${coverage.returnedCount} of ${coverage.mappedCount} eligible approved options. Showing ${coverage.shownCount}.${coverage.returnedCount < coverage.mappedCount ? ' Unreturned options were not filled in.' : ''}`;
    const results = page.locator('.results-section');
    await expect(results.locator('.provider-coverage')).toHaveText(coverageCopy);
    await expect(results.locator('.mapping-summary').first()).toContainText(
      `${coverage.mappedCount} reviewed Qloo mappings`,
    );
    await expect(results.locator('.mapping-summary').first()).toContainText(
      `${coverage.unmappedCount} unmapped inventory option`,
    );
    await expect(results.locator('.explanation-warning')).toHaveCount(
      coverage.explanationUnavailable ? 1 : 0,
    );
    await expect(results.locator('.choice-explanation')).toHaveCount(
      coverage.explanationUnavailable ? 0 : coverage.shownCount,
    );
    await page.getByRole('button', { name: 'View choice receipt', exact: true }).click();
    const receipt = page.getByRole('dialog');
    const rows = receipt.locator('.evidence-facts > div');
    await expect(receipt.locator('.provider-coverage')).toHaveText(coverageCopy);
    await expect(rows.filter({ hasText: 'Choices shown' }).locator('dd')).toHaveText(
      String(coverage.shownCount),
    );
    await expect(rows.filter({ hasText: 'Qloo options returned' }).locator('dd')).toHaveText(
      String(coverage.returnedCount),
    );
    await expect(
      rows.filter({ hasText: 'Eligible approved Qloo options' }).locator('dd'),
    ).toHaveText(String(coverage.mappedCount));
    await expect(rows.filter({ hasText: 'Explanation status' }).locator('dd')).toHaveText(
      coverage.agentStatus,
    );
    await expect(receipt.getByText('Choices returned', { exact: true })).toHaveCount(0);
    await expect(receipt.locator('.explanation-warning')).toHaveCount(
      coverage.explanationUnavailable ? 1 : 0,
    );
  });
}
