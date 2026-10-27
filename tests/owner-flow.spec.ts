import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Workspace } from '../src/server/store.ts';
import { mkdir } from 'node:fs/promises';

// Invitation fragments are short-lived capabilities, so do not record traces.
test.use({ trace: 'off' });

async function workspace(page: Page): Promise<Workspace> {
  const response = await page.request.get('/api/workspace');
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function accessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    result.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
}

async function capture(page: Page, name: string, project: string, fullPage = true) {
  await mkdir('.artifacts/owner', { recursive: true });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.screenshot({
    path: `.artifacts/owner/${name}-${project}.png`,
    fullPage,
    animations: 'disabled',
  });
}

test('recipient gift approval, a kept choice, explicit correction and revocation cross the real client boundary', async ({
  page,
  context,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a thoughtful gift' }).click();
  await expect(page).toHaveURL(/\/gifts\/new$/);
  const original = await workspace(page);
  const gift = original.contexts.find((c) => c.purpose === 'gift')!;
  const personal = original.contexts.find((c) => c.purpose === 'personal')!;
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Giver’s display name').fill('Alex Example');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create invitation' })).toBeDisabled();
  await accessible(page);
  await capture(page, 'gift-consent', testInfo.project.name);
  await page.getByLabel('I understand this scope and allow this gift invitation.').check();
  await page.getByRole('button', { name: 'Create invitation' }).click();
  await expect(page.getByRole('heading', { name: 'Your invitation is ready.' })).toBeVisible();
  const granted = await workspace(page);
  const grant = granted.grants[0];
  expect(grant.status).toBe('pending');
  expect([...grant.scope.signalIds].sort()).toEqual(gift.signals.map((s) => s.id).sort());

  const popup = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Open as Alex Example' }).click();
  const client = await popup;
  client.on('pageerror', (error) => browserErrors.push(error.message));
  await expect(client.getByRole('heading', { name: 'A thoughtful brief.' })).toBeVisible();
  expect(new URL(client.url()).hostname).toBe('books.localhost');
  expect(Boolean(new URL(client.url()).hash)).toBe(false);
  expect((await context.cookies(client.url())).some((c) => c.name === 'tastekeeper_owner')).toBe(
    false,
  );
  const session = await (
    await client.request.get('http://books.localhost:3114/api/session')
  ).json();
  const serialized = JSON.stringify(session);
  for (const signal of gift.signals) {
    expect(serialized).not.toContain(signal.title);
    expect(serialized).not.toContain(signal.entityId);
  }
  for (const forbidden of [
    'credential',
    'signalIds',
    'encrypted_signals',
    'tokenHash',
    'selectedReferences',
  ])
    expect(serialized).not.toContain(`"${forbidden}"`);
  await client.getByRole('button', { name: 'Authored sample', exact: true }).click();
  await client.getByRole('button', { name: 'Find a thoughtful book' }).click();
  await expect(client.locator('.result-card')).toHaveCount(3);
  const firstTitle = await client.locator('.result-card h3').first().innerText();
  await client.getByRole('button', { name: 'Keep this choice', exact: true }).first().click();
  await expect(client.getByRole('button', { name: '✓ Choice kept' })).toBeDisabled();
  expect((await workspace(page)).selections[0].title).toBe(firstTitle);
  const oldRun = (await workspace(page)).decisions[0].id;

  await page.goto(`/contexts/${gift.id}`);
  const correct = page
    .locator('.reference-detail')
    .filter({ hasText: 'Braiding Sweetgrass' })
    .getByRole('button', { name: 'Correct this' });
  await correct.click();
  await page.getByLabel('What feels wrong?').selectOption('wrong_situation');
  await page.getByRole('button', { name: 'Preview correction' }).click();
  await expect(page.getByRole('heading', { name: 'Review this correction' })).toBeVisible();
  expect((await workspace(page)).contexts.find((c) => c.id === gift.id)?.revision).toBe(1);
  await page.getByRole('button', { name: 'Keep it as it is' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await workspace(page)).contexts.find((c) => c.id === gift.id)?.revision).toBe(1);
  await correct.click();
  await page.getByRole('button', { name: 'Preview correction' }).click();
  await page.getByRole('button', { name: 'Apply to this context' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Updated Gift');
  const corrected = await workspace(page);
  expect(corrected.contexts.find((c) => c.id === gift.id)?.revision).toBe(2);
  expect(corrected.contexts.find((c) => c.id === personal.id)).toEqual(personal);
  expect(corrected.decisions.find((d) => d.id === oldRun)?.stale).toBe(true);
  await capture(page, 'correction', testInfo.project.name);
  const staleRead = await client.request.get(`http://books.localhost:3114/api/decisions/${oldRun}`);
  expect(staleRead.status()).toBe(409);
  expect((await staleRead.json()).error.code).toBe('REVISION_CHANGED');
  await client.getByRole('button', { name: 'Find a thoughtful book' }).click();
  await expect(client.locator('.result-card')).toHaveCount(3);
  await expect(client.locator('.result-card h3').first()).not.toHaveText(firstTitle);
  const latestRun = (await workspace(page)).decisions[0].id;

  await page.goto('/decisions');
  await page.getByRole('button', { name: 'View receipt' }).first().click();
  await expect(page.getByRole('heading', { name: 'The story behind this choice' })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Owner-only evidence');
  await accessible(page);
  await capture(page, 'owner-evidence', testInfo.project.name, false);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto(`/connections/${grant.id}`);
  await page.getByRole('button', { name: 'End access' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Keep connection' }).click();
  expect((await workspace(page)).grants[0].status).toBe('active');
  await page.getByRole('button', { name: 'End access' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'End access' }).click();
  await expect(page.getByRole('status')).toContainText('Access ended');
  const deniedRead = await client.request.get(
    `http://books.localhost:3114/api/decisions/${latestRun}`,
  );
  expect(deniedRead.status()).toBe(403);
  expect((await deniedRead.json()).error.code).toBe('GRANT_REVOKED');
  await client.getByRole('button', { name: 'Retry connection', exact: true }).click();
  await expect(client.getByRole('alert')).toContainText('GRANT_REVOKED');
  await expect(client.locator('.result-card')).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test('a second landing tab resumes the owner workspace; keyboard dialogs and new context confirmation work', async ({
  page,
  context,
}, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore the demo' }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('heading', { name: /Good gifts begin/ })).toBeVisible();
  await accessible(page);
  await capture(page, 'home', testInfo.project.name);
  const first = await workspace(page);
  if (testInfo.project.name === 'mobile') {
    await expect(
      page.getByRole('navigation', { name: 'Workspace navigation', exact: true }),
    ).toHaveCount(0);
    const trigger = page.getByRole('button', { name: 'Open navigation' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog', { name: 'Workspace navigation' });
    await expect(drawer).toHaveAttribute('aria-modal', 'true');
    await expect(drawer.getByRole('button', { name: 'Close navigation' })).toBeFocused();
    for (let tab = 0; tab < 12; tab++) {
      await page.keyboard.press('Tab');
      expect(
        await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null),
      ).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(
      page.getByRole('navigation', { name: 'Workspace navigation', exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Open access journal' })).toBeFocused();
  }
  const second = await context.newPage();
  await second.goto('/');
  await second.getByRole('button', { name: 'Explore the demo' }).click();
  await expect(second).toHaveURL(/\/home$/);
  await expect(second.getByRole('heading', { name: /Good gifts begin/ })).toBeVisible();
  expect((await workspace(second)).contexts.map((c) => c.id)).toEqual(
    first.contexts.map((c) => c.id),
  );
  await page.getByRole('button', { name: 'Open access journal' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open access journal' })).toBeFocused();
  await page.goto('/contexts/new');
  await page.getByLabel('Name this space').fill('Small weekend rituals');
  await page.getByLabel('Find a reference in the quickstart library').fill('Agnes');
  await page.getByRole('button', { name: /Agnes Martin.*Choose this one/ }).click();
  await page.getByRole('button', { name: 'Review identities' }).click();
  expect((await workspace(page)).contexts).toHaveLength(2);
  await page.getByRole('button', { name: 'Confirm & create context' }).click();
  await expect(page.getByRole('heading', { name: 'Small weekend rituals' })).toBeVisible();
  const created = (await workspace(page)).contexts.find((c) => c.name === 'Small weekend rituals')!;
  expect(created.signals.map((s) => s.title)).toEqual(['Agnes Martin']);
  expect((await workspace(page)).grants).toHaveLength(0);
});

test('owner controls explain retention, require deliberate context deletion, and erase the demo workspace', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore the demo' }).click();
  await expect(page).toHaveURL(/\/home$/);
  const original = await workspace(page);
  const gift = original.contexts.find((entry) => entry.purpose === 'gift')!;
  const personal = original.contexts.find((entry) => entry.purpose === 'personal')!;
  await page.goto(`/contexts/${gift.id}`);
  await page.getByRole('button', { name: 'Delete this context', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete context', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Keep this context', exact: true }).click();
  expect((await workspace(page)).contexts.some((entry) => entry.id === gift.id)).toBe(true);
  await page.getByRole('button', { name: 'Delete this context', exact: true }).click();
  await page.getByLabel(`Delete ${gift.name} and end its future access.`).check();
  await page.getByRole('button', { name: 'Delete context', exact: true }).click();
  await expect(page).toHaveURL(/\/contexts$/);
  const remaining = await workspace(page);
  expect(remaining.contexts.some((entry) => entry.id === gift.id)).toBe(false);
  expect(remaining.contexts.find((entry) => entry.id === personal.id)).toEqual(personal);
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Demo ownership & privacy', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Your demo space, clearly owned.' });
  await expect(dialog).toContainText('24 hours');
  await expect(dialog).toContainText('Existing invitations and records remain until expiry.');
  await expect(
    dialog.getByRole('button', { name: 'Delete demo workspace', exact: true }),
  ).toBeDisabled();
  await accessible(page);
  await dialog.getByLabel('Delete this demo workspace and end all its connections.').check();
  await dialog.getByRole('button', { name: 'Delete demo workspace', exact: true }).click();
  await expect(page).toHaveURL('/');
  const denied = await page.request.get('/api/workspace');
  expect(denied.status()).toBe(401);
});
