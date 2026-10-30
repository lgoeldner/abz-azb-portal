import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function login(page: Page, suffix: string) {
  await page.goto('/auth/login');
  await page.locator(`[data-user-id="00000000-0000-4000-8000-00000000000${suffix}"]`).click();
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
}

test('admin manages quota and student controls own reminders', async ({ page }, testInfo) => {
  await login(page, '1');
  await page.goto('/verwaltung/email');
  await expect(page.getByRole('heading', { name: 'E-Mail-Verwaltung' })).toBeVisible();
  await expect(page.getByLabel('Tageslimit')).toHaveValue('300');
  await page.getByLabel('Erinnerungen pausieren', { exact: true }).check();
  const save = page.waitForResponse(
    (r) => r.url().endsWith('/admin/email/settings') && r.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Einstellungen speichern' }).click();
  expect((await save).status()).toBe(200);
  await page.reload();
  await expect(page.getByLabel('Erinnerungen pausieren', { exact: true })).toBeChecked();
  await page.getByLabel('Erinnerungen pausieren', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Einstellungen speichern' }).click();
  await page.getByLabel('Alle E-Mails pausieren').check();
  await expect(page.getByRole('alert')).toContainText('stoppt auch Anmelde-E-Mails');
  await page.getByLabel('Alle E-Mails pausieren').uncheck();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('email-admin-phone.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: /Abmelden/ }).click();
  await expect(page.getByRole('link', { name: /^Anmelden$/ })).toBeVisible();
  await login(page, '3');
  expect((await page.request.get('/api/v1/admin/email/status')).status()).toBe(403);
  await page.getByText('E-Mail-Erinnerungen', { exact: true }).click();
  await expect(page.getByText(/Erinnerungen an offene Abgaben:/)).toBeVisible();
  const activate = page.getByRole('button', { name: 'Erinnerungen aktivieren' });
  if (await activate.isVisible()) {
    await activate.click();
    await expect(page.getByRole('button', { name: 'Erinnerungen ausschalten' })).toBeVisible();
  }
  const optout = page.waitForResponse(
    (r) => r.url().endsWith('/me/email-reminders') && r.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Erinnerungen ausschalten' }).click();
  expect((await optout).status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Erinnerungen aktivieren' })).toBeVisible();
  await page.getByRole('button', { name: 'Erinnerungen aktivieren' }).click();
  await expect(page.getByRole('button', { name: 'Erinnerungen ausschalten' })).toBeVisible();
});
