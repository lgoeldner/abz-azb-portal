import { expect, test } from '@playwright/test';

const admin = {
  id: 'admin-1',
  name: 'Test Admin',
  role: 'admin',
  admitted: true,
  cohort_member: true,
  category_ids: [],
};
const guest = {
  id: 'guest-1',
  name: 'Gast Gerda',
  role: 'student',
  admitted: true,
  cohort_member: false,
  category_ids: [],
};

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const data = path === '/me' ? { user: admin, csrf_token: 'csrf' } : path === '/admin/users' ? [admin, guest] : [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
});

test('row menu and confirm dialog keep keyboard focus in place', async ({ page }) => {
  await page.goto('/verwaltung/personen');
  const trigger = page.getByRole('button', { name: 'Aktionen für Gast Gerda' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: /Rolle ändern/ })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('menuitem', { name: 'Löschen' })).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Gast Gerda löschen?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Abbrechen' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('collection administration redirects to the shared workspace and adds admin options', async ({ page }) => {
  await page.goto('/verwaltung/sammlungen');
  await expect(page).toHaveURL(/\/sammlungen$/);
  const aside = page.getByRole('complementary');
  await expect(aside.locator('a[href="/verwaltung/sammlungen"]')).toHaveCount(0);
  await expect(aside.getByRole('link', { name: 'Alle Sammlungen' })).toBeVisible();
  await page.getByRole('button', { name: 'Neue Sammlung' }).click();
  await expect(page.getByRole('group', { name: 'Wer darf bearbeiten' })).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`shared-collection-admin-${width}.png`) });
  }
});

test('Redaktion creates every collection kind in the shared form without admin requests', async ({ page }) => {
  const manager = { ...admin, id: 'manager-1', role: 'manager' };
  const writes: Record<string, unknown>[] = [];
  const adminRequests: string[] = [];
  await page.route('**/api/v1/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (path.startsWith('/admin/')) adminRequests.push(path);
    let data: unknown = [];
    let status = 200;
    if (path === '/me') data = { user: manager, csrf_token: 'csrf' };
    if (path === '/categories' && request.method() === 'POST') {
      const body = request.postDataJSON();
      writes.push(body);
      data = { ...body, id: 'created', version: 1 };
      status = 201;
    }
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto('/sammlungen?neu');
  await expect(page.getByLabel('Klasse').locator('option')).toHaveText([
    'Ideen',
    'Zitate',
    'Erinnerungen',
    'Fotos',
    'Personenwahl',
    'Vorschlagswahl',
    'Wortwolke',
  ]);
  const repeatable = page.getByRole('switch', { name: 'Wiederholbar', exact: true });
  await repeatable.locator('..').click();
  await expect(repeatable).not.toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Klasse', exact: true })).toHaveValue('memory');
  await page.getByRole('combobox', { name: 'Klasse', exact: true }).selectOption('photo');
  await expect(repeatable).not.toBeChecked();
  await page.getByRole('switch', { name: 'Fortlaufend', exact: true }).locator('..').click();
  await page.getByLabel('Enddatum', { exact: true }).fill('2099-06-01T12:00');
  await expect(page.getByRole('group', { name: 'Wer darf bearbeiten' })).toHaveCount(0);
  await page.getByLabel('Name', { exact: true }).fill('Ein Foto pro Person');
  await page.getByRole('button', { name: 'Sammlung speichern' }).click();
  await expect(page.getByText('Sammlung gespeichert.')).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ kind: 'photo', repeatable: false, ongoing: false, options: [] });
  expect(new Date(String(writes[0].closes_at)).getUTCFullYear()).toBe(2099);
  expect(adminRequests).toEqual([]);
});

test('Verwaltung follows the selected workspace and keeps its editorial accent on direct visits', async ({ page }) => {
  await page.goto('/verwaltung/personen');
  const aside = page.getByRole('complementary');
  await expect(aside.getByRole('button', { name: 'Redaktion' })).toHaveAttribute('aria-pressed', 'true');
  await expect(aside.getByRole('link', { name: 'Personen' })).toBeVisible();

  await aside.getByRole('button', { name: 'Schüler' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(aside.getByRole('button', { name: 'Schüler' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('view'))).toBe('schueler');
  await expect(aside.getByRole('link', { name: 'Personen' })).toHaveCount(0);
  await expect(aside.getByRole('button', { name: 'Verwaltung' })).toHaveCount(0);

  for (const [path, heading] of [
    ['/verwaltung/personen', 'Personen'],
    ['/verwaltung/sammlungen', 'Sammlungen'],
    ['/verwaltung/protokoll', 'Aktivitätsprotokoll'],
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    const workspace = page.locator('[data-workspace="redaktion"]');
    await expect(workspace).toBeVisible();
    await expect(page.getByRole('complementary').getByRole('button', { name: 'Redaktion' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect
      .poll(() => workspace.evaluate((element) => getComputedStyle(element).getPropertyValue('--color-accent').trim()))
      .toBe('#1d5fbf');
    const selected = page.locator('aside a[aria-current="page"]');
    await selected.hover();
    const contrast = await selected.evaluate((element) => {
      const style = getComputedStyle(element);
      const luminance = (rgb: string) => {
        const [r, g, b] = rgb
          .match(/\d+/g)!
          .slice(0, 3)
          .map(Number)
          .map((channel) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ink = luminance(style.color),
        ground = luminance(style.backgroundColor);
      return (Math.max(ink, ground) + 0.05) / (Math.min(ink, ground) + 0.05);
    });
    expect(contrast, 'selected Verwaltung link stays readable on hover').toBeGreaterThanOrEqual(4.5);
  }
});
