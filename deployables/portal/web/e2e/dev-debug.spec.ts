import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const production = process.env.DEBUG_EXPECT_PRODUCTION === '1';
test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
});
const base = {
  description: '',
  allow_self_vote: false,
  my_option_id: null,
  all_people: false,
  max_choices: 1,
  my_option_ids: [],
  ballot_count: null,
  created_at: '2026-10-20T12:00:00Z',
  opened_at: null,
};
const category = {
  ...base,
  id: 'debug-category',
  name: 'Erinnerungen',
  kind: 'memory',
  repeatable: true,
  status: 'open',
  version: 1,
  options: [],
};
const user = {
  id: 'fixture-user',
  name: 'PRIVATE_NAME_SENTINEL',
  role: 'student',
  admitted: true,
  cohort_member: true,
  category_ids: [],
};
const submission = {
  id: 'debug-submission',
  category_id: category.id,
  author_id: user.id,
  author_name: user.name,
  title: 'Meine Testgeschichte',
  body: 'PRIVATE_BODY_SENTINEL',
  context: 'PRIVATE_CONTEXT_SENTINEL',
  status: 'pending',
  version: 7,
  attachments: [],
  created_at: '2026-10-20T12:00:00Z',
  updated_at: '2026-10-21T12:00:00Z',
};
const poll = {
  ...base,
  id: 'debug-poll',
  name: 'Unser Testmotto',
  kind: 'proposal',
  repeatable: false,
  status: 'open',
  version: 3,
  options: [{ id: 'PRIVATE_OPTION_SENTINEL', label: 'PRIVATE_LABEL_SENTINEL' }],
  my_option_id: 'PRIVATE_OPTION_SENTINEL',
  opened_at: '2026-10-21T12:00:00Z',
};

async function fixtures(page: Page, role = 'student') {
  const requests: string[] = [];
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    requests.push(`${route.request().method()} ${path}`);
    const data =
      path === '/me'
        ? { user: { ...user, role }, consent_required: false, csrf_token: 'PRIVATE_CSRF_SENTINEL' }
        : path === '/categories'
          ? [category, poll]
          : path === '/submissions'
            ? [submission]
            : path === '/submissions/debug-submission'
              ? submission
              : path === '/admin/users'
                ? [{ ...user, role }]
                : path === '/admin/status'
                  ? { backup_last_success: null, backup_stale: true, upload_bytes: 0 }
                  : [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  return requests;
}

function debugMenus(page: Page) {
  return page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Debug' }) });
}

test('production builds omit debug controls for every role and view', async ({ page }) => {
  test.skip(!production, 'Run against vite preview with DEBUG_EXPECT_PRODUCTION=1.');
  for (const role of ['student', 'manager', 'admin']) {
    await page.unrouteAll();
    await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
    await fixtures(page, role);
    const paths = [
      '/',
      '/beitraege',
      '/beitraege/debug-submission',
      '/sammlungen',
      '/sammlungen/debug-poll',
      ...(role === 'admin' ? [`/sammlungen/${category.id}`] : []),
    ];
    for (const path of paths) {
      await page.goto(`${path}?debug=true`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('h1')).toBeVisible();
      await expect(debugMenus(page)).toHaveCount(0);
      await expect(page.getByText('Debug', { exact: true })).toHaveCount(0);
      await expect(page.locator('[data-dev-debug]')).toHaveCount(0);
      if (path === `/sammlungen/${category.id}`) {
        await expect(page.getByRole('button', { name: 'Sammlung bearbeiten' })).toBeVisible();
        await expect(debugMenus(page)).toHaveCount(0);
      }
    }
  }
});
