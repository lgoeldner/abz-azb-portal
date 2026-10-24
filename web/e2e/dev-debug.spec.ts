import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const production = process.env.DEBUG_EXPECT_PRODUCTION === '1';
test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
});
const category = { id: 'debug-category', name: 'Erinnerungen', description: '', kind: 'memory' };
const user = { id: 'fixture-user', name: 'PRIVATE_NAME_SENTINEL', role: 'student', admitted: true, cohort_member: true, category_ids: [] };
const submission = {
  id: 'debug-submission', category_id: category.id, author_id: user.id, author_name: user.name,
  title: 'Meine Testgeschichte', body: 'PRIVATE_BODY_SENTINEL', context: 'PRIVATE_CONTEXT_SENTINEL',
  status: 'pending', version: 7, attachments: [], created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-21T12:00:00Z',
};
const poll = {
  id: 'debug-poll', category_id: category.id, title: 'Unser Testmotto', description: '', kind: 'proposal',
  format: 'single_choice', status: 'open', version: 3, allow_self_vote: false,
  options: [{ id: 'PRIVATE_OPTION_SENTINEL', label: 'PRIVATE_LABEL_SENTINEL' }],
  my_option_id: 'PRIVATE_OPTION_SENTINEL', created_at: '2026-10-20T12:00:00Z', opened_at: '2026-10-21T12:00:00Z', ballot_count: null,
};

async function fixtures(page: Page, role = 'student') {
  const requests: string[] = [];
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    requests.push(`${route.request().method()} ${path}`);
    const data = path === '/me' ? { user: { ...user, role }, csrf_token: 'PRIVATE_CSRF_SENTINEL' }
      : path === '/categories' ? [category]
      : path === '/submissions' ? [submission]
      : path === '/submissions/debug-submission' ? submission
      : path === '/polls' ? [poll]
      : path === '/admin/users' ? [{ ...user, role }]
      : path === '/admin/status' ? { backup_last_success: null, backup_stale: true, upload_bytes: 0 }
      : [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  return requests;
}

function debugMenus(page: Page) { return page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Debug' }) }); }

test('dev debug disclosures preserve navigation, privacy and read permissions', async ({ page }) => {
  test.skip(production, 'Checks development controls.');
  const requests = await fixtures(page);
  for (const [path, id] of [['/', category.id], ['/beitraege', submission.id], ['/beitraege/debug-submission', submission.id], ['/abstimmungen', poll.id], ['/abstimmungen/debug-poll', poll.id]]) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1')).toBeVisible();
    await expect(debugMenus(page).filter({ hasText: id }).first()).toHaveCount(1);
    await page.waitForLoadState('networkidle');
    const menus = debugMenus(page).filter({ visible: true });
    await expect(menus.first()).toBeVisible();
    const before = requests.length;
    for (const menu of await menus.all()) {
      await expect(menu).not.toHaveAttribute('open', '');
      const summary = menu.locator('summary');
      await summary.focus();
      await page.keyboard.press('Enter');
      await expect(menu).toHaveAttribute('open', '');
      await expect(menu).not.toContainText(/PRIVATE_(NAME|BODY|CONTEXT|OPTION|LABEL|CSRF)_SENTINEL/);
      await expect(menu.locator('a, input, form')).toHaveCount(0);
      await expect(summary.locator('xpath=ancestor::a')).toHaveCount(0);
      await page.keyboard.press('Space');
      await expect(menu).not.toHaveAttribute('open', '');
    }
    expect(requests.length).toBe(before);
    expect(requests.every(request => request.startsWith('GET '))).toBe(true);
    expect(requests.some(request => /\/(results|audit)$/.test(request))).toBe(false);
    await expect(page).toHaveURL(new RegExp(`${path === '/' ? '/$' : path + '$'}`));
  }
  await page.goto('/beitraege', { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: /Meine Testgeschichte/ }).click();
  await expect(page).toHaveURL(/\/beitraege\/debug-submission$/);
});

test('expanded dev metadata fits narrow cards', async ({ page }) => {
  test.skip(production, 'Checks development controls.');
  await fixtures(page);
  await page.setViewportSize({ width: 320, height: 800 });
  for (const path of ['/', '/beitraege', '/abstimmungen/debug-poll']) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1')).toBeVisible();
    await expect(debugMenus(page).filter({ hasText: path === '/' ? category.id : path === '/beitraege' ? submission.id : poll.id }).first()).toHaveCount(1);
    for (const menu of await debugMenus(page).filter({ visible: true }).all()) await menu.locator('summary').click();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: test.info().outputPath('expanded-debug.png'), fullPage: true });
});

test('editor and admin diagnostics preserve short-screen navigation', async ({ page }) => {
  test.skip(production, 'Checks development controls.');
  await page.setViewportSize({ width: 640, height: 360 });
  for (const role of ['manager', 'admin']) {
    await page.unrouteAll();
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await fixtures(page, role);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(debugMenus(page).filter({ hasText: poll.id })).toHaveCount(1);
    // The admin home is a dashboard without category cards; admin category diagnostics are checked under /admin below.
    if (role === 'manager') await expect(debugMenus(page).filter({ has: page.getByText('Debug: Rubrik', { exact: true }) }).filter({ hasText: category.id })).toHaveCount(1);
    await page.locator('summary').filter({ hasText: 'Debug: Sitzung' }).click();
    await page.getByRole('button', { name: 'Menü öffnen' }).click();
    const aside = page.getByRole('complementary', { name: 'Seitenleiste' });
    await expect(aside.getByRole('link', { name: 'Überblick', exact: true })).toBeVisible();
    await aside.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(aside.getByRole('button', { name: /Abmelden/ })).toBeInViewport();
    if (role === 'admin') {
      await page.goto('/verwaltung/rubriken', { waitUntil: 'domcontentloaded' });
      const menu = debugMenus(page).filter({ hasText: category.id });
      await expect(menu).toHaveCount(1);
      await menu.locator('summary').click();
      await expect(menu).not.toContainText(/PRIVATE_/);
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('production builds omit debug controls for every role and view', async ({ page }) => {
  test.skip(!production, 'Run against vite preview with DEBUG_EXPECT_PRODUCTION=1.');
  for (const role of ['student', 'manager', 'admin']) {
    await page.unrouteAll();
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await fixtures(page, role);
    const paths = ['/', '/beitraege', '/beitraege/debug-submission', '/abstimmungen', '/abstimmungen/debug-poll', ...(role === 'admin' ? ['/verwaltung/rubriken'] : [])];
    for (const path of paths) {
      await page.goto(`${path}?debug=true`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('h1')).toBeVisible();
      await expect(debugMenus(page)).toHaveCount(0);
      await expect(page.getByText('Debug', { exact: true })).toHaveCount(0);
      await expect(page.locator('[data-dev-debug]')).toHaveCount(0);
      if (path === '/verwaltung/rubriken') {
        await expect(page.getByRole('button', { name: 'Rubrik bearbeiten' })).toBeVisible();
        await expect(debugMenus(page)).toHaveCount(0);
      }
    }
  }
});
