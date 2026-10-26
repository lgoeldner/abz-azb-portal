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
    if (path === '/me') data = { user, csrf_token: 'local-fixture-token' };
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

test('overview, contribution detail and Sammlung layouts stay within every viewport', async ({ page }) => {
  await useFixtures(page, 'student');
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    for (const [path, heading] of [
      ['/', /^Hey Mia\./],
      ['/beitraege/long-story', submission.title],
      ['/sammlungen/long-poll', poll.name],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      if (path === '/')
        await expect
          .poll(() =>
            page.getByRole('heading', { level: 1 }).evaluate((element) => element.scrollWidth <= element.clientWidth),
          )
          .toBe(true);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBe(true);
    }
    await page.goto('/beitraege/long-story');
    await page.getByRole('button', { name: /Bearbeiten/ }).click();
    await expect(page.locator('textarea').first()).toBeVisible();
    await page.locator('input[type=file]').setInputFiles({
      name: 'Foto '.concat('N'.repeat(100), '.jpg'),
      mimeType: 'image/jpeg',
      buffer: Buffer.from('fixture'),
    });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '32px';
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <= window.innerWidth &&
          document.querySelector('h1')!.scrollWidth <= document.querySelector('h1')!.clientWidth,
      ),
    )
    .toBe(true);
});

test('editor can open the Sammlung form without horizontal page overflow', async ({ page }) => {
  await useFixtures(page, 'manager');
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/sammlungen');
    await page.getByRole('button', { name: /Neue Sammlung/ }).click();
    await expect(page.getByRole('heading', { name: 'Neue Sammlung' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

for (const role of ['manager', 'admin'] as const) {
  test(`${role} Sammlung results fit every viewport`, async ({ page }) => {
    await useFixtures(page, role);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/sammlungen/long-poll');
      await expect(page.getByText('Zweite Option').first()).toBeVisible();
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
      expect(
        layout.document,
        `document overflow at ${width}px: ${JSON.stringify(layout.offenders)}`,
      ).toBeLessThanOrEqual(width);
    }
  });
}

test('pending and request error states remain readable on mobile', async ({ page }) => {
  await useFixtures(page, 'student');
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/submissions', async (route) => {
    await waiting;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([submission]) });
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/beitraege');
  await expect(page.getByRole('main').getByRole('status')).toContainText('Einen Moment …');
  release();
  await expect(page.getByRole('heading', { name: 'Meine Beiträge' })).toBeVisible();
  await page.unroute('**/api/v1/submissions');
  await page.route('**/api/v1/submissions', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: '{"error":{"code":"unavailable","message":"Beiträge gerade nicht verfügbar."}}',
    }),
  );
  await page.goto('/beitraege');
  await expect(page.getByRole('alert')).toContainText('Beiträge gerade nicht verfügbar.');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const role of ['student', 'manager', 'admin'] as const) {
  test(`${role} pages fit the supported viewport widths and navigation remains usable`, async ({ page }) => {
    await useFixtures(page, role);
    const path = role === 'student' ? '/beitraege' : role === 'manager' ? '/redaktion' : '/verwaltung/personen';

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
      if (width <= 650) {
        await page.getByRole('button', { name: 'Menü öffnen' }).click();
        await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Verwaltung' })).toHaveCount(role === 'admin' ? 1 : 0);
      }
    }

    await page.setViewportSize({ width: 640, height: 360 });
    await page.goto(path);
    await page.getByRole('button', { name: 'Menü öffnen' }).click();
    const aside = page.getByRole('complementary', { name: 'Seitenleiste' });
    await expect(aside.getByRole('link', { name: 'Überblick' })).toBeVisible();
    await aside.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(aside.getByRole('button', { name: /Abmelden/ })).toBeInViewport();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('login error state stays readable on a narrow screen', async ({ page }) => {
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: '{"error":{"code":"unauthorized","message":"Bitte anmelden."}}',
    }),
  );
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Schön, dass du da bist.' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('poll chips, switches and count controls fit narrow and wide screens', async ({ page }) => {
  await useFixtures(page, 'admin');
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/sammlungen?neu');
    await page.getByRole('combobox', { name: 'Klasse', exact: true }).selectOption('proposal');
    const optionInput = page.getByRole('textbox', { name: 'Antwortoption hinzufügen' });
    const longOption = 'Abimotto ' + 'X'.repeat(180);
    await optionInput.fill(longOption);
    await optionInput.press('Enter');
    await expect(page.getByRole('button', { name: longOption + ' entfernen', exact: true })).toBeVisible();
    await optionInput.fill('Gemeinsam zum Abi');
    await page.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
    await expect(optionInput).toHaveValue('');
    const selfVote = page.getByRole('switch', { name: 'Stimme für die eigene Person erlauben' });
    await selfVote.locator('..').click();
    await expect(selfVote).toBeChecked();
    const count = page.getByRole('spinbutton', { name: 'Maximale Zahl der Stimmen pro Person' });
    const more = page.getByRole('button', { name: 'Mehr Optionen' });
    const less = page.getByRole('button', { name: 'Weniger Optionen' });
    await expect(count).toHaveValue('1');
    await expect(less).toBeDisabled();
    await expect(count).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(count).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
    for (const button of [more, less]) {
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(48);
      expect(box!.width).toEqual(box!.height);
      const radius = await button.evaluate((el) => Number.parseFloat(getComputedStyle(el).borderTopLeftRadius));
      expect(radius).toBeGreaterThanOrEqual(box!.width / 2);
    }
    await more.click();
    await expect(count).toHaveValue('2');
    await count.click();
    await expect(count).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await count.fill('500');
    await expect(more).toBeDisabled();
    await less.click();
    await expect(count).toHaveValue('499');
    await expect(count).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
