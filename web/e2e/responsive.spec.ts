import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
});

const longName = 'Mia ' + 'N'.repeat(100) + ' Beispiel aus der Q13';
const category = { id: 'memory', name: 'Erinnerungen an die letzte gemeinsame Abifahrt', description: 'Eine besonders lange Rubrikbeschreibung, die auf schmalen Bildschirmen sauber umbrechen muss.', kind: 'memory' };
const submission = {
  id: 'long-story', category_id: category.id, author_id: 'person-1', author_name: longName,
  title: 'Die außergewöhnlich lange Geschichte über den letzten Schultag und unsere gemeinsame Abifahrt ' + 'X'.repeat(100),
  body: 'Ein langer Beitrag. '.repeat(60) + 'Y'.repeat(100), context: 'Kontext '.repeat(25), status: 'pending', version: 1,
  created_at: '2026-10-23T12:00:00Z', updated_at: '2026-10-23T12:00:00Z', attachments: [],
};
const poll = {
  id: 'long-poll', category_id: category.id, title: 'Abstimmung ' + 'P'.repeat(100), description: 'Beschreibung '.repeat(20),
  kind: 'proposal', format: 'single_choice', status: 'open', allow_self_vote: false, my_option_id: null, version: 1,
  created_at: '2026-10-20T12:00:00Z', opened_at: '2026-10-21T12:00:00Z', ballot_count: null as number | null,
  options: [{ id: 'choice-1', label: 'Option ' + 'O'.repeat(100) }, { id: 'choice-2', label: 'Zweite Option' }],
};
const widths = [320, 390, 640, 650, 651, 768, 850, 851, 1024, 1150, 1151, 1440, 1920];

async function useFixtures(page: Page, role: 'student' | 'manager' | 'admin') {
  const user = { id: 'person-1', name: longName, role, admitted: true, cohort_member: true, category_ids: [category.id] };
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    let data: unknown = [];
    if (path === '/me') data = { user, csrf_token: 'local-fixture-token' };
    else if (path === '/categories') data = [category];
    else if (path === '/submissions' || path.startsWith('/submissions?')) data = [submission];
    else if (path === '/submissions/long-story') data = submission;
    else if (path === '/submissions/long-story/revisions') data = [{ id: 'revision-1', version: 1, actor_name: longName, title: submission.title, body: submission.body, context: submission.context, status: 'pending', created_at: submission.updated_at }];
    else if (path === '/submissions/long-story/corrections') data = [];
    else if (path === '/polls') data = [role === 'student' ? poll : { ...poll, ballot_count: 3 }];
    else if (path === '/polls/long-poll/results') data = [{ option_id: 'choice-1', label: poll.options[0].label, count: 2 }, { option_id: 'choice-2', label: 'Zweite Option', count: 1 }];
    else if (path === '/polls/long-poll/audit') data = [];
    else if (path === '/roster') data = [];
    else if (path === '/admin/users') data = [user];
    else if (path === '/admin/status') data = { backup_last_success: null, backup_stale: false, upload_bytes: 0 };
    else if (path === '/admin/audit') data = [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
}

test('overview, contribution detail and poll layouts stay within every viewport', async ({ page }) => {
  await useFixtures(page, 'student');
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    for (const [path, heading] of [['/', /^Hey Mia\./], ['/beitraege/long-story', submission.title], ['/abstimmungen/long-poll', poll.title]] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      if (path === '/') await expect.poll(() => page.getByRole('heading', { level: 1 }).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.goto('/beitraege/long-story');
    await page.getByRole('button', { name: /Bearbeiten/ }).click();
    await expect(page.locator('textarea').first()).toBeVisible();
    await page.locator('input[type=file]').setInputFiles({ name: 'Foto '.concat('N'.repeat(100), '.jpg'), mimeType: 'image/jpeg', buffer: Buffer.from('fixture') });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.querySelector('h1')!.scrollWidth <= document.querySelector('h1')!.clientWidth)).toBe(true);
});

test('editor can open the poll form without horizontal page overflow', async ({ page }) => {
  await useFixtures(page, 'manager');
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/abstimmungen');
    await page.getByRole('button', { name: /Neue Abstimmung/ }).click();
    await expect(page.getByRole('heading', { name: 'Eine neue Abstimmung' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

for (const role of ['manager', 'admin'] as const) {
  test(`${role} poll results fit every viewport`, async ({ page }) => {
    await useFixtures(page, role);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/abstimmungen/long-poll');
      await expect(page.getByText('Zweite Option').first()).toBeVisible();
      const layout = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        offenders: [...document.querySelectorAll<HTMLElement>('body *')]
          .filter(element => element.getBoundingClientRect().right > window.innerWidth + 1)
          .slice(0, 5)
          .map(element => ({ tag: element.tagName, className: element.className, text: element.innerText.slice(0, 40), right: Math.round(element.getBoundingClientRect().right) })),
      }));
      expect(layout.document, `document overflow at ${width}px: ${JSON.stringify(layout.offenders)}`).toBeLessThanOrEqual(width);
    }
  });
}

test('pending and request error states remain readable on mobile', async ({ page }) => {
  await useFixtures(page, 'student');
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/submissions', async route => {
    await waiting;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([submission]) });
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/beitraege');
  await expect(page.getByRole('main').getByRole('status')).toContainText('Einen Moment …');
  release();
  await expect(page.getByRole('heading', { name: 'Meine Beiträge' })).toBeVisible();
  await page.unroute('**/api/v1/submissions');
  await page.route('**/api/v1/submissions', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"unavailable","message":"Beiträge gerade nicht verfügbar."}}' }));
  await page.goto('/beitraege');
  await expect(page.getByRole('alert')).toContainText('Beiträge gerade nicht verfügbar.');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const role of ['student', 'manager', 'admin'] as const) {
  test(`${role} pages fit the supported viewport widths and navigation remains usable`, async ({ page }) => {
    await useFixtures(page, role);
    const path = role === 'student' ? '/beitraege' : role === 'manager' ? '/redaktion' : '/admin';

    for (const width of widths) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(path);
      await expect(page.locator('h1')).toBeVisible();
      if (role === 'admin') await expect(page.getByRole('row').nth(1)).toBeVisible();
      else await expect(page.getByRole('link', { name: /Die außergewöhnlich lange Geschichte/ }).first()).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const layout = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        offenders: [...document.querySelectorAll<HTMLElement>('body *')]
          .filter(element => element.getBoundingClientRect().right > window.innerWidth + 1)
          .slice(0, 5)
          .map(element => ({ tag: element.tagName, className: element.className, text: element.innerText.slice(0, 40), right: Math.round(element.getBoundingClientRect().right) })),
      }));
      expect(layout.document, `document overflow: ${JSON.stringify(layout.offenders)}`).toBeLessThanOrEqual(width);
      if (width <= 650) {
        await page.getByRole('button', { name: 'Menü öffnen' }).click();
        await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Verwaltung' })).toHaveCount(role === 'admin' ? 1 : 0);
      }
    }

    await page.setViewportSize({ width: 640, height: 360 });
    await page.goto(path);
    await page.getByRole('button', { name: 'Menü öffnen' }).click();
    const aside = page.getByRole('complementary', { name: 'Seitenleiste' });
    await expect(aside.getByRole('link', { name: 'Überblick' })).toBeVisible();
    await aside.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(aside.getByRole('button', { name: /Abmelden/ })).toBeInViewport();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('login error state stays readable on a narrow screen', async ({ page }) => {
  await page.route('**/api/v1/me', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":{"code":"unauthorized","message":"Bitte anmelden."}}' }));
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Schön, dass du da bist.' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
