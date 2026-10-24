import { expect, test } from '@playwright/test';

const admin = { id: 'admin-1', name: 'Test Admin', role: 'admin', admitted: true, cohort_member: true, category_ids: [] };
const guest = { id: 'guest-1', name: 'Gast Gerda', role: 'student', admitted: true, cohort_member: false, category_ids: [] };

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('**/api/v1/**', route => {
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
