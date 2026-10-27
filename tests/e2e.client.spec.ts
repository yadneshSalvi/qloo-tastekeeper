import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';

// Claim links contain disposable invitation tokens. Do not put them in traces.
test.use({ trace: 'off' });
const ownerOrigin = process.env.APP_ORIGIN || 'http://127.0.0.1:3104';
const apps = {
  books: {
    origin: process.env.CLIENT_BOOKS_ORIGIN || 'http://books.localhost:3114',
    purpose: 'gift',
    submit: 'Find a thoughtful book',
    source: 'View book source',
  },
  media: {
    origin: process.env.CLIENT_MEDIA_ORIGIN || 'http://media.localhost:3115',
    purpose: 'personal',
    submit: 'Find tonight’s film',
    source: 'Open title source',
  },
  places: {
    origin: process.env.CLIENT_PLACES_ORIGIN || 'http://places.localhost:3116',
    purpose: 'personal',
    submit: 'Find a place to begin',
    source: 'Open directions',
  },
} as const;
type ClientId = keyof typeof apps;
type Workspace = {
  contexts: {
    id: string;
    purpose: string;
    signals: { id: string; entityId: string; active: boolean }[];
  }[];
  selections: { runId: string; itemId: string }[];
};
type SessionView = {
  execution?: { qlooAvailable: boolean; defaultMode: 'sample' | 'qloo' };
  grant: { id: string };
  delegate: { displayName: string };
  catalog: {
    items: {
      id: string;
      title: string;
      price: number;
      minutes?: number;
      setting?: string;
      url: string;
      identity?: string;
    }[];
  };
};
type Released = {
  id: string;
  state: string;
  items: { id: string; title: string; price: number }[];
  provenance: { mode: string };
  receipt: { fields: string[] };
};

function privateKeys(value: unknown, found: string[] = []): string[] {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    value.forEach((entry) => privateKeys(entry, found));
    return found;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (
      [
        'credential',
        'clientSecret',
        'signals',
        'signalIds',
        'seeds',
        'seedIds',
        'entityId',
        'tags',
        'qlooId',
        'encrypted_signals',
        'ownerId',
        'tenantId',
      ].includes(key)
    )
      found.push(key);
    privateKeys(entry, found);
  }
  return found;
}

async function ownerFixture(context: BrowserContext, clientId: ClientId) {
  const created = await context.request.post(ownerOrigin + '/api/demo', {
    headers: { origin: ownerOrigin },
  });
  expect(created.ok()).toBe(true);
  const loaded = await context.request.get(ownerOrigin + '/api/workspace');
  expect(loaded.ok()).toBe(true);
  const workspace = (await loaded.json()) as Workspace;
  const contextRow = workspace.contexts.find((entry) => entry.purpose === apps[clientId].purpose)!;
  const invited = await context.request.post(ownerOrigin + '/api/invitations', {
    headers: { origin: ownerOrigin },
    data: {
      contextId: contextRow.id,
      clientId,
      purpose: apps[clientId].purpose,
      signalIds: contextRow.signals.filter((signal) => signal.active).map((signal) => signal.id),
      expiresInHours: 1,
      requestLimit: 10,
      snapshotMode: 'pinned',
      delegateName: clientId === 'books' ? 'Jordan · browser test' : 'Mira · browser test',
      acknowledged: true,
    },
  });
  expect(invited.status()).toBe(201);
  const invitation = (await invited.json()) as { id: string; claimUrl: string };
  return {
    ...invitation,
    privateValues: contextRow.signals.flatMap((signal) => [signal.id, signal.entityId]),
  };
}

async function claim(page: Page, claimUrl: string, submit: string) {
  const response = page.waitForResponse((entry) => new URL(entry.url()).pathname === '/api/claim');
  try {
    await page.goto(claimUrl);
  } catch {
    throw new Error('The disposable client claim page could not be opened.');
  }
  const publicView = (await (await response).json()) as SessionView;
  await expect(page.getByRole('button', { name: submit, exact: false })).toBeVisible();
  // Functional sample coverage must never spend a live provider call when live is the default.
  await page.getByRole('button', { name: 'Authored sample', exact: true }).click();
  // Boolean assertions avoid ever printing invitation fragments on a failure.
  expect(Boolean(new URL(page.url()).hash)).toBe(false);
  return publicView;
}

for (const clientId of Object.keys(apps) as ClientId[]) {
  test(`${clientId}: independent claim, grounded choice, source, persisted shortlist, and access denial`, async ({
    page,
    context,
  }, testInfo) => {
    const app = apps[clientId];
    const fixture = await ownerFixture(context, clientId);
    const pageErrors: string[] = [];
    const publicPayloads: unknown[] = [];
    let ownerCookieLeaked = false;
    let otherClientCookieLeaked = false;
    let clientSecretLeaked = false;
    let released: Released | null = null;
    const captures: Promise<void>[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.name));
    page.on('request', (entry) => {
      if (!entry.url().startsWith(app.origin)) return;
      captures.push(
        (async () => {
          const headers = await entry.allHeaders();
          if ((headers.cookie || '').includes('tastekeeper_owner=')) ownerCookieLeaked = true;
          if (
            (Object.keys(apps) as ClientId[]).some(
              (otherId) =>
                otherId !== clientId &&
                (headers.cookie || '').includes(`tastekeeper_${otherId}_session=`),
            )
          )
            otherClientCookieLeaked = true;
          if ('x-client-secret' in headers || 'authorization' in headers) clientSecretLeaked = true;
        })(),
      );
    });
    page.on('response', (entry) => {
      if (!entry.url().startsWith(app.origin + '/api/')) return;
      captures.push(
        (async () => {
          const payload = await entry.json();
          publicPayloads.push(payload);
          if (payload.state === 'released') released = payload;
        })(),
      );
    });
    expect((await context.cookies(ownerOrigin)).map((cookie) => cookie.name)).toContain(
      'tastekeeper_owner',
    );
    if (clientId === 'books') {
      // Genuine media and places claims leave their HttpOnly cookies in this same
      // browser context, so the books request assertion tests host isolation.
      for (const otherId of ['media', 'places'] as const) {
        const otherFixture = await ownerFixture(context, otherId);
        const otherPage = await context.newPage();
        await claim(otherPage, otherFixture.claimUrl, apps[otherId].submit);
        expect((await context.cookies(apps[otherId].origin)).map((cookie) => cookie.name)).toEqual([
          `tastekeeper_${otherId}_session`,
        ]);
        await otherPage.close();
      }
    }
    const session = await claim(page, fixture.claimUrl, app.submit);
    if (clientId === 'books') {
      await expect(page.getByLabel('Demonstration disclosure')).toContainText(
        'Jordan · browser test is the example giver',
      );
      await page.getByLabel(/Illustrative budget/).fill('25');
    }
    if (clientId === 'media')
      await page.getByLabel('Time for a film', { exact: true }).selectOption('120');
    const cookies = await context.cookies(app.origin);
    expect(cookies.map((cookie) => cookie.name)).toEqual([`tastekeeper_${clientId}_session`]);
    expect(cookies[0]!.httpOnly).toBe(true);
    expect(cookies[0]!.secure).toBe(new URL(app.origin).protocol === 'https:');
    expect(cookies[0]!.domain).toBe(new URL(app.origin).hostname);
    await page.getByRole('button', { name: app.submit, exact: false }).click();
    await expect(page.locator('.result-card')).toHaveCount(3);
    await expect.poll(() => released?.state).toBe('released');
    const decision = released as unknown as Released;
    expect(decision.provenance.mode).toBe('authored_sample');
    await expect(page.locator('.result-card h3')).toHaveText(
      decision.items.map((item) => item.title),
    );
    expect(
      decision.items.every((item) =>
        session.catalog.items.some((candidate) => candidate.id === item.id),
      ),
    ).toBe(true);
    if (clientId === 'books') expect(decision.items.every((item) => item.price <= 2500)).toBe(true);
    if (clientId === 'media')
      expect(
        decision.items.every(
          (item) =>
            session.catalog.items.find((candidate) => candidate.id === item.id)!.minutes! <= 120,
        ),
      ).toBe(true);

    const first = decision.items[0]!;
    const source = session.catalog.items.find((item) => item.id === first.id)!;
    const handoff = await page
      .getByRole('link', { name: app.source, exact: false })
      .first()
      .getAttribute('href');
    expect(new URL(handoff!).protocol).toBe('https:');
    if (clientId === 'places') {
      expect(new URL(handoff!).hostname).toBe('www.google.com');
      expect(new URL(handoff!).searchParams.get('query')).toBe(source.identity);
    } else expect(handoff).toBe(source.url);

    await page.getByRole('button', { name: 'View source facts', exact: true }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Illustrative amount');
    if (source.identity) await expect(page.getByRole('dialog')).toContainText(source.identity);
    if (clientId === 'places')
      await expect(
        page.getByRole('link', { name: 'Open official venue page', exact: false }),
      ).toHaveAttribute('href', source.url);
    await page.getByRole('button', { name: 'Close details', exact: true }).press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.getByRole('button', { name: 'View choice receipt', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('AUTHORED SAMPLE · NO QLOO CALL');
    await expect(page.getByRole('dialog')).toContainText('Released fields');
    await page.getByRole('button', { name: 'Close details', exact: true }).press('Escape');

    const savedResponse = page.waitForResponse(
      (entry) =>
        entry.request().method() === 'POST' && new URL(entry.url()).pathname.endsWith('/selection'),
    );
    await page.getByRole('button', { name: 'Keep this choice', exact: true }).first().click();
    expect((await (await savedResponse).json()).saved).toBe(true);
    await expect(page.getByRole('button', { name: '✓ Choice kept', exact: true })).toBeVisible();
    const reloaded = await context.request.get(ownerOrigin + '/api/workspace');
    const authoritative = (await reloaded.json()) as Workspace;
    expect(
      authoritative.selections.some(
        (selection) => selection.runId === decision.id && selection.itemId === first.id,
      ),
    ).toBe(true);
    await page.reload();
    await expect(page.getByRole('button', { name: '✓ Choice kept', exact: true })).toBeVisible();
    await expect(page.locator('.saved-section')).toContainText(first.title);

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    const undersized = await page
      .locator('button:visible,input:visible,select:visible,summary:visible,a.button:visible')
      .evaluateAll((elements) =>
        elements
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.height < 44 || rect.width < 44;
          })
          .map((element) => element.tagName + ':' + element.className),
      );
    expect(undersized).toEqual([]);
    const audit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      audit.violations.map((entry) => ({
        id: entry.id,
        impact: entry.impact,
        targets: entry.nodes.map((node) => node.target),
      })),
    ).toEqual([]);

    const artifactDirectory = resolve('.artifacts/clients');
    await mkdir(artifactDirectory, { recursive: true });
    const screenshot = resolve(artifactDirectory, `${clientId}-${page.viewportSize()!.width}.png`);
    await page.locator('#results-title').click();
    await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });
    await testInfo.attach(`${clientId}-${page.viewportSize()!.width}`, {
      path: screenshot,
      contentType: 'image/png',
    });

    if (clientId === 'books' && session.execution?.qlooAvailable === false) {
      await page.getByRole('button', { name: /Qloo live/ }).click();
      await page.getByRole('button', { name: app.submit, exact: false }).click();
      await expect(
        page.getByRole('heading', { name: 'Qloo live is unavailable.', exact: true }),
      ).toBeVisible();
      await expect(page.locator('.result-card')).toHaveCount(0);
      await expect(page.getByLabel(/Illustrative budget/)).toHaveValue('25');
      await page.getByRole('button', { name: 'Use authored sample', exact: true }).click();
      await expect(page.locator('.result-card')).toHaveCount(3);
    }
    if (clientId === 'places') {
      await page.getByLabel(/Illustrative spend/).fill('0');
      await page.getByLabel('Where sounds good?', { exact: true }).selectOption('outdoors');
      await page.getByRole('button', { name: app.submit, exact: false }).click();
      await expect(page.locator('.result-card')).toHaveCount(1);
      await expect(page.locator('.result-card h3')).toHaveText('St Dunstan in the East');
    }
    if (clientId === 'media') {
      await page.getByLabel('Time for a film', { exact: true }).selectOption('90');
      await page.getByRole('button', { name: app.submit, exact: false }).click();
      await expect(
        page.getByRole('heading', { name: 'Nothing fits this brief just yet.', exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel('Time for a film', { exact: true })).toHaveValue('90');
      await expect(page.locator('.result-card')).toHaveCount(0);
    }

    const revoked = await context.request.post(`${ownerOrigin}/api/grants/${fixture.id}/revoke`, {
      headers: { origin: ownerOrigin },
      data: {},
    });
    expect(revoked.ok()).toBe(true);
    await page.getByRole('button', { name: 'Retry connection', exact: false }).first().click();
    await expect(
      page.getByRole('heading', { name: 'Mira has ended this connection.', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.result-card')).toHaveCount(0);
    await expect(page.getByRole('button', { name: app.submit, exact: false })).toHaveCount(0);

    await Promise.all(captures);
    expect(ownerCookieLeaked).toBe(false);
    expect(otherClientCookieLeaked).toBe(false);
    expect(clientSecretLeaked).toBe(false);
    expect(pageErrors).toEqual([]);
    expect(publicPayloads.flatMap((payload) => privateKeys(payload))).toEqual([]);
    const serializedPublic = JSON.stringify(publicPayloads);
    expect(fixture.privateValues.some((value) => serializedPublic.includes(value))).toBe(false);
  });
}
