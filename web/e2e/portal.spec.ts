import { expect, test, type Page } from '@playwright/test';

async function signInAs(page: Page, role: 'Jahrgang' | 'Redaktion' | 'Administration', name?: string) {
  await page.goto('/');
  await page.getByRole('link', { name: /Mit Schulkonto anmelden/ }).click();
  const identity = name ?? (role === 'Jahrgang' ? 'Mia Weber' : role === 'Redaktion' ? 'Sam · Redaktion' : 'Alex · Administration');
  const access = page.getByRole('button', { name: identity, exact: true });
  await expect(access, `Development login for ${role} is available (start a seeded development server)`).toBeVisible();
  await access.click();
  await expect(page.getByRole('link', { name: 'AbiZeitBetrug Startseite' })).toBeVisible();
}

test('student signs in, submits a contribution, and can access polls', async ({ page }) => {
  await signInAs(page, 'Jahrgang', 'Mia Weber');
  await page.getByRole('link', { name: 'Meine Beiträge' }).click();
  await page.getByRole('link', { name: /Neuer Beitrag/ }).click();
  await page.getByPlaceholder('Gib deiner Erinnerung einen Namen').fill(`E2E Erinnerung ${Date.now()}`);
  await page.getByPlaceholder('Was ist passiert? Welcher Spruch darf nicht fehlen?').fill('Eine Geschichte aus dem Testlauf.');
  await page.getByRole('button', { name: /Beitrag einreichen/ }).click();
  await expect(page.getByRole('heading', { name: /E2E Erinnerung/ })).toBeVisible();
  await expect(page.locator('.page-head .badge').filter({ hasText: 'In Prüfung' })).toBeVisible();
  await page.getByRole('link', { name: 'Abstimmungen' }).click();
  await expect(page.getByRole('heading', { name: 'Der Jahrgang entscheidet.' })).toBeVisible();
});

test('student casts a ballot in the seeded open poll', async ({ page }) => {
  await signInAs(page, 'Jahrgang', 'Mia Weber');
  await page.getByRole('link', { name: 'Abstimmungen' }).click();
  const openPoll = page.locator('.poll-card').filter({ hasText: 'Offen' }).first();
  await expect(openPoll, 'the seeded development data includes an open poll').toBeVisible();
  await openPoll.click();
  const option = page.locator('input[name="ballot"]:enabled').first();
  await expect(option, 'the seeded poll has an eligible option').toBeVisible();
  await option.check();
  await page.getByRole('button', { name: /Stimme speichern|Stimme ändern/ }).click();
  await expect(page.getByRole('status')).toContainText('Deine Stimme wurde gespeichert.');
});

test('editor reviews and accepts an assigned contribution, exports it, and sees poll results', async ({ page }) => {
  await signInAs(page, 'Jahrgang', 'Mia Weber');
  const title = `E2E Redaktion ${Date.now()}`;
  await page.getByRole('link', { name: /Deinen Beitrag einreichen/ }).click();
  await page.getByLabel('Rubrik').selectOption({ label: 'Ideen' });
  await page.getByPlaceholder('Gib deiner Erinnerung einen Namen').fill(title);
  await page.getByPlaceholder('Was ist passiert? Welcher Spruch darf nicht fehlen?').fill('Ein Beitrag für den Prüfablauf.');
  await page.getByRole('button', { name: /Beitrag einreichen/ }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  await page.context().clearCookies();
  await signInAs(page, 'Redaktion');
  await page.getByRole('link', { name: 'Redaktion', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Aus Geschichten wird Zeitung.' })).toBeVisible();
  await page.getByPlaceholder('Titel, Text, Name …').fill(title);
  const review = page.locator('.submission-row').filter({ hasText: title });
  await expect(review, 'the submitted contribution is visible to the editor').toBeVisible();
  await review.click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.getByRole('button', { name: /Für die Zeitung annehmen/ }).click();
  await expect(page.locator('.page-head .badge').filter({ hasText: 'Angenommen' })).toBeVisible();
  await page.getByRole('link', { name: 'Redaktion', exact: true }).click();
  await page.getByLabel('Rubrik').last().selectOption({ label: 'Ideen' });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: /ZIP herunterladen/ }).click();
  await expect(downloadPromise).resolves.toBeTruthy();

  await page.getByRole('link', { name: 'Abstimmungen' }).click();
  await page.getByRole('link', { name: /Unser Abimotto/ }).click();
  await expect(page.getByText('NUR FÜR DIE REDAKTION')).toBeVisible();
});

test('admin opens access management and activity log on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs(page, 'Administration');
  await page.getByRole('button', { name: 'Menü öffnen' }).click();
  await page.getByRole('link', { name: 'Verwaltung' }).click();
  await expect(page.getByRole('heading', { name: 'Verwaltung' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Unser Jahrgang & Team' })).toBeVisible();
  await page.getByRole('tab', { name: 'Aktivitätsprotokoll' }).click();
  await expect(page.getByRole('heading', { name: 'Letzte Aktivitäten' })).toBeVisible();
});
