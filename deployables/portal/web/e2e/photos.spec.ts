import { expect, test } from './fixtures';
import type { Attachment, Category, Me, Submission } from '../src/api';

// Synthetic browser-only fixtures keep layout/upload checks independent of private contributions.
test('photo batches share one collection grid and new uploads return to it', async ({ page }, testInfo) => {
  const user: Me['user'] = {
    id: 'photo-student',
    name: 'Mia Foto',
    role: 'student',
    admitted: true,
    cohort_member: true,
    category_ids: [],
    created_at: '2026-10-01T00:00:00Z',
  };
  const category: Category = {
    id: 'photo-collection',
    name: 'Jahrgangsmomente',
    description: 'Unser Abschlussjahr in Bildern',
    kind: 'photo',
    status: 'open',
    repeatable: true,
    ongoing: true,
    closes_at: null,
    allow_self_vote: false,
    options: [],
    my_option_id: null,
    my_option_ids: [],
    all_people: false,
    max_choices: 1,
    version: 1,
    created_at: user.created_at,
    opened_at: user.created_at,
    ballot_count: null,
    participation: null,
  };
  const attachment = (id: string): Attachment => ({
    id,
    filename: `${id}.png`,
    caption: `Jahrgangsmoment ${id}`,
    mime_type: 'image/png',
    size_bytes: 1024,
    url: `/api/v1/attachments/${id}`,
    preview_url: `/api/v1/attachments/${id}/preview`,
  });
  const submission = (id: string, attachments: Attachment[]): Submission => ({
    id,
    category_id: category.id,
    author_id: user.id,
    author_name: user.name,
    title: `Upload ${id}`,
    body: '',
    context: '',
    status: 'pending',
    version: 1,
    attachments,
    created_at: user.created_at,
    updated_at: user.created_at,
  });
  const entries = [
    submission('first', [attachment('1'), attachment('2')]),
    submission('second', [attachment('3'), attachment('4')]),
  ];
  let creates = 0;
  let appends = 0;
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path.startsWith('/attachments/')) {
      const id = Number(path.split('/')[2]) || 5;
      await route.fulfill({
        contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="450"><rect width="600" height="450" fill="${['#b6b5a0', '#d2a389', '#a6b7a4', '#b4a0a8', '#c1b392'][id % 5]}"/><circle cx="300" cy="220" r="110" fill="#f4eee1"/><path d="M0 450 170 270 330 450 480 300 600 450" fill="#58625b"/></svg>`,
      });
      return;
    }
    if (path === '/me') return route.fulfill({ json: { user, csrf_token: 'browser-fixture' } });
    if (path === '/categories') return route.fulfill({ json: [category] });
    if (path === '/submissions' && route.request().method() === 'POST') {
      creates++;
      const entry = submission('new', [attachment('5')]);
      entries.push(entry);
      return route.fulfill({ status: 201, json: entry });
    }
    if (path === '/submissions/new/attachments' && route.request().method() === 'POST') {
      appends++;
      const entry = entries.at(-1)!;
      entry.attachments.push(attachment('6'));
      entry.version++;
      return route.fulfill({ json: entry });
    }
    if (path === '/submissions') return route.fulfill({ json: entries });
    return route.fulfill({ json: [] });
  });

  await page.goto(`/sammlungen/${category.id}`);
  const gallery = page.getByRole('region', { name: 'Fotogalerie' });
  await expect(gallery.getByRole('img')).toHaveCount(4);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(gallery).toBeVisible();
    const layout = await gallery.evaluate((element) => ({
      columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    }));
    expect(layout.columns).toBe(width < 640 ? 2 : 3);
    expect(layout.overflow).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`photos-${width}.png`), fullPage: true });
  }

  await page.getByRole('link', { name: 'Fotos hochladen' }).click();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1kAAAAASUVORK5CYII=',
    'base64',
  );
  await page.locator('input[type=file]').setInputFiles([
    { name: 'later-one.png', mimeType: 'image/png', buffer: png },
    { name: 'later-two.png', mimeType: 'image/png', buffer: png },
  ]);
  await page.getByRole('button', { name: 'Fotos einreichen' }).click();
  await expect(page).toHaveURL(`/sammlungen/${category.id}`);
  await expect(gallery.getByRole('img')).toHaveCount(6);
  expect(creates).toBe(1);
  expect(appends).toBe(1);
  await page.goto('/beitraege');
  const collections = page.getByRole('main').getByRole('link', { name: 'Jahrgangsmomente 6 Fotos' });
  await expect(collections).toHaveCount(1);
  await collections.click();
  await expect(gallery.getByRole('img')).toHaveCount(6);
});
