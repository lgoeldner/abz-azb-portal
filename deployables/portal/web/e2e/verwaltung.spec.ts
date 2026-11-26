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
    const data =
      path === '/me'
        ? { user: admin, consent_required: false, csrf_token: 'csrf' }
        : path === '/admin/users'
          ? [admin, guest]
          : [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
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
    if (path === '/me') data = { user: manager, consent_required: false, csrf_token: 'csrf' };
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
