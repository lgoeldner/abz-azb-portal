import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function login(page: Page, slug: string) {
  await page.goto('/');
  await page.getByRole('link', { name: /Mit Schulkonto anmelden/ }).click();
  await page.getByRole('button', { name: new RegExp(`\\b${slug}$`) }).click();
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
}

async function api(page: Page, path: string, method = 'GET', body?: unknown) {
  const me = await (await page.request.get('/api/v1/me')).json();
  return page.request.fetch(`/api/v1${path}`, {
    method,
    headers: { 'X-CSRF-Token': me.csrf_token },
    ...(body === undefined ? {} : { data: body }),
  });
}

test('word portrait chips, private cloud, reversible moderation and CSV at desktop and phone widths', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, 'alex_admin');
  await page.getByRole('button', { name: 'Redaktion', exact: true }).click();
  await page.goto('/sammlungen?neu');
  await page.getByLabel('Name', { exact: true }).fill(`Abi in Worten ${Date.now()}`);
  await page.getByRole('combobox', { name: 'Klasse', exact: true }).selectOption('words');
  await expect(page.getByLabel('Maximale Zahl der Wörter pro Person')).toHaveValue('3');
  await page.getByLabel('Maximale Zahl der Wörter pro Person').fill('2');
  const created = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/categories') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sammlung speichern', exact: true }).click();
  const poll = await (await created).json();
  expect(poll.max_choices).toBe(2);
  expect(poll.options).toEqual([]);
  const path = `/categories/${poll.id}`;
  expect((await api(page, `${path}/status`, 'POST', { version: poll.version, status: 'open' })).status()).toBe(200);

  const studentContext = await browser.newContext();
  const student = await studentContext.newPage();
  await login(student, 'mia_weber');
  await student.goto(`/sammlungen/${poll.id}`);
  for (const word of ['CHAOTISCH', 'Chaos']) {
    await student.getByRole('textbox', { name: /Wörter eingeben/ }).fill(word);
    await student.getByRole('button', { name: 'Wort hinzufügen', exact: true }).click();
  }
  await expect(student.getByRole('list', { name: 'Ausgewählte Wörter' })).toContainText('chaotisch');
  await expect(student.getByRole('textbox', { name: /Wörter eingeben/ })).toBeDisabled();
  const saved = student.waitForResponse(
    (response) => response.url().endsWith(`/api/v1${path}/ballot`) && response.request().method() === 'PUT',
  );
  await student.getByRole('button', { name: 'Stimme speichern', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await student.reload();
  await expect(student.getByRole('list', { name: 'Ausgewählte Wörter' })).toContainText('chaos');
  await expect(student.getByRole('list', { name: /^Wortwolke mit/ })).toHaveCount(0);
  for (const suffix of ['/words', '/results', '/words/export', '/audit']) {
    expect((await api(student, `${path}${suffix}`)).status()).toBe(403);
  }

  await page.goto(`/sammlungen/${poll.id}`);
  const moderationWrites: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().includes('/words/')) moderationWrites.push(request.url());
  });
  const words = await (await api(page, `${path}/words`)).json();
  const chaotic = words.find((word: { word: string }) => word.word === 'chaotisch');
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: 'Aktionen für Begriff chaotisch', exact: true }) });
  const chip = row.getByRole('button', { name: 'Aktionen für Begriff chaotisch', exact: true });
  await expect(row.getByLabel('Bezeichnung bearbeiten', { exact: true })).toHaveCount(0);
  await chip.click();
  await expect(row.getByRole('dialog', { name: 'Begriff chaotisch bearbeiten' })).toBeVisible();
  expect(moderationWrites).toEqual([]);
  await row.getByLabel('Bezeichnung bearbeiten', { exact: true }).fill('CHAOS');
  await row.getByRole('button', { name: 'Umbenennen', exact: true }).click();
  await expect(page.getByRole('list', { name: /^Wortwolke mit/ }).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('list', { name: /^Wortwolke mit/ }).getByRole('listitem')).toHaveAttribute(
    'aria-label',
    'chaos: 1 Nennung',
  );
  const moderationChip = page.getByRole('button', { name: 'Aktionen für Begriff chaotisch', exact: true });
  await moderationChip.click();
  await page.getByRole('button', { name: 'Ausschließen', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Begriff chaotisch bearbeiten' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Aktionen für Begriff chaotisch', exact: true }).click();
  await page.getByRole('button', { name: 'Wiederherstellen', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Begriff chaotisch bearbeiten' })).toHaveCount(0);
  await moderationChip.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Begriff chaotisch bearbeiten' })).toHaveCount(0);
  await expect(moderationChip).toBeFocused();
  await moderationChip.click();
  await page.mouse.click(5, 5);
  await expect(page.getByRole('dialog', { name: 'Begriff chaotisch bearbeiten' })).toHaveCount(0);
  const exported = await api(page, `${path}/words/export`);
  expect(exported.status()).toBe(200);
  expect(await exported.text()).toBe('word,count\nchaos,1\n');
  await expect(page.getByRole('link', { name: /als CSV herunterladen/ })).toHaveAttribute(
    'href',
    `/api/v1${path}/words/export`,
  );

  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('list', { name: /^Wortwolke mit/ })).toBeVisible();
    await moderationChip.click();
    await expect(page.getByRole('dialog', { name: 'Begriff chaotisch bearbeiten' })).toBeVisible();
    await expect(page.getByLabel('Bezeichnung bearbeiten', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/abi-words-${width}.png`, fullPage: true });
    await page.keyboard.press('Escape');
  }

  const managerContext = await browser.newContext();
  const manager = await managerContext.newPage();
  await login(manager, 'sam_redaktion');
  await manager.getByRole('button', { name: 'Redaktion', exact: true }).click();
  await manager.goto(`/sammlungen/${poll.id}`);
  await expect(manager.getByRole('list', { name: /^Wortwolke mit/ })).toBeVisible();
  await expect(manager.getByRole('button', { name: /Aktionen für Begriff/ })).toHaveCount(0);
  expect((await api(manager, `${path}/words/export`)).status()).toBe(200);
  expect(
    (
      await api(manager, `${path}/words/${chaotic.option_id}`, 'PATCH', {
        version: 1,
        label: 'anders',
        excluded: false,
      })
    ).status(),
  ).toBe(403);

  await managerContext.close();
  await studentContext.close();
  await context.close();
});
