import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
});

const longName = 'Mia ' + 'N'.repeat(100) + ' Beispiel aus der Q13';
const base = {
  allow_self_vote: false,
  my_option_id: null,
  all_people: false,
  max_choices: 1,
  my_option_ids: [],
  ballot_count: null as number | null,
  created_at: '2026-10-20T12:00:00Z',
  opened_at: null,
  version: 1,
};
const category = {
  ...base,
  id: 'memory',
  name: 'Erinnerungen an die letzte gemeinsame Abifahrt',
  description: 'Eine besonders lange Sammlungsbeschreibung, die auf schmalen Bildschirmen sauber umbrechen muss.',
  kind: 'memory',
  repeatable: true,
  status: 'open',
  options: [],
};
const submission = {
  id: 'long-story',
  category_id: category.id,
  author_id: 'person-1',
  author_name: longName,
  title:
    'Die außergewöhnlich lange Geschichte über den letzten Schultag und unsere gemeinsame Abifahrt ' + 'X'.repeat(100),
  body: 'Ein langer Beitrag. '.repeat(60) + 'Y'.repeat(100),
  context: 'Kontext '.repeat(25),
  status: 'pending',
  version: 1,
  created_at: '2026-10-23T12:00:00Z',
  updated_at: '2026-10-23T12:00:00Z',
  attachments: [],
};
const poll = {
  ...base,
  id: 'long-poll',
  name: 'Wahl ' + 'P'.repeat(100),
  description: 'Beschreibung '.repeat(20),
  kind: 'proposal',
  repeatable: false,
  status: 'open',
  opened_at: '2026-10-21T12:00:00Z',
  options: [
    { id: 'choice-1', label: 'Option ' + 'O'.repeat(100) },
    { id: 'choice-2', label: 'Zweite Option' },
  ],
};
const widths = [320, 390, 640, 650, 651, 768, 850, 851, 1024, 1150, 1151, 1440, 1920];

async function useFixtures(page: Page, role: 'student' | 'manager' | 'admin') {
  const user = {
    id: 'person-1',
    name: longName,
    role,
    admitted: true,
    cohort_member: true,
    category_ids: [category.id],
  };
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    let data: unknown = [];
    if (path === '/me') data = { user, consent_required: false, csrf_token: 'local-fixture-token' };
    else if (path === '/categories') data = [category, role === 'student' ? poll : { ...poll, ballot_count: 3 }];
    else if (path === '/submissions' || path.startsWith('/submissions?')) data = [submission];
    else if (path === '/submissions/long-story') data = submission;
    else if (path === '/submissions/long-story/revisions')
      data = [
        {
          id: 'revision-1',
          version: 1,
          actor_name: longName,
          title: submission.title,
          body: submission.body,
          context: submission.context,
          status: 'pending',
          created_at: submission.updated_at,
        },
      ];
    else if (path === '/submissions/long-story/corrections') data = [];
    else if (path === '/categories/long-poll/results')
      data = [
        { option_id: 'choice-1', label: poll.options[0].label, count: 2 },
        { option_id: 'choice-2', label: 'Zweite Option', count: 1 },
      ];
    else if (path === '/categories/long-poll/audit') data = [];
    else if (path === '/roster') data = [];
    else if (path === '/admin/users') data = [user];
    else if (path === '/admin/status') data = { backup_last_success: null, backup_stale: false, upload_bytes: 0 };
    else if (path === '/admin/audit') data = [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
}

for (const role of ['student', 'manager', 'admin'] as const) {
  test(`${role} pages fit the supported viewport widths and navigation remains usable`, async ({ page }) => {
    await useFixtures(page, role);
    const path =
      role === 'student' ? '/beitraege' : role === 'manager' ? '/redaktion/beitraege' : '/verwaltung/personen';

    for (const width of widths) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(path);
      await expect(page.locator('h1')).toBeVisible();
      if (role === 'admin') await expect(page.locator('main li').first()).toBeVisible();
      else await expect(page.getByRole('link', { name: /Die außergewöhnlich lange Geschichte/ }).first()).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const layout = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        offenders: [...document.querySelectorAll<HTMLElement>('body *')]
          .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
          .slice(0, 5)
          .map((element) => ({
            tag: element.tagName,
            className: element.className,
            text: element.innerText.slice(0, 40),
            right: Math.round(element.getBoundingClientRect().right),
          })),
      }));
      expect(layout.document, `document overflow: ${JSON.stringify(layout.offenders)}`).toBeLessThanOrEqual(width);
      const account = page.getByRole('region', { name: 'Konto' });
      await expect(account.getByRole('button', { name: 'Abmelden' })).toBeInViewport();
      await expect(account.getByRole('link', { name: 'Einstellungen' })).toBeInViewport();
      const menu = page.getByRole('button', { name: /^Redaktionsmenü/ });
      if (role === 'student') await expect(menu).toHaveCount(0);
      else await expect(menu).toBeInViewport();
    }

    await page.setViewportSize({ width: 640, height: 360 });
    await page.goto(path);
    await expect(
      page.getByRole('region', { name: 'Konto' }).getByRole('button', { name: 'Abmelden' }),
    ).toBeInViewport();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
