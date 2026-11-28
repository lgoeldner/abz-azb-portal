import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Development identities use the same permanent UUIDs as the application roster.
async function signInAs(page: Page, role: 'Jahrgang' | 'Redaktion' | 'Administration') {
  await page.goto('/');
  await page.getByRole('link', { name: /^Anmelden$/ }).click();
  const id =
    role === 'Jahrgang'
      ? '00000000-0000-4000-8000-000000000003'
      : role === 'Redaktion'
        ? '00000000-0000-4000-8000-000000000002'
        : '00000000-0000-4000-8000-000000000001';
  const access = page.locator(`[data-user-id="${id}"]`);
  await expect(access, `Development login for ${role} is available (start a seeded development server)`).toBeVisible();
  await access.click();
  // Editors land on the Redaktion on a fresh visit: /redaktion redirects to the board or the contributions.
  await page.waitForURL((url) => ['/', '/tickets', '/redaktion/beitraege'].includes(url.pathname));
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
}

async function openMenu(page: Page) {
  // Not the close button, which is also named "Redaktionsmenü …".
  await page.getByRole('button', { name: /^Redaktionsmenü(?!\s*schließen)/ }).click();
  return page.getByRole('navigation', { name: 'Redaktionsmenü' });
}

test('student signs in, submits a contribution, and returns to the open ballots', async ({ page }) => {
  await signInAs(page, 'Jahrgang');
  await page.getByRole('region', { name: 'Wiederholbar' }).getByRole('link', { name: /Ideen/ }).click();
  await page.getByRole('link', { name: /Beitrag einreichen/ }).click();
  await page.getByPlaceholder('Gib deinem Beitrag einen Namen').fill(`E2E Erinnerung ${Date.now()}`);
  await page.getByRole('textbox', { name: 'Dein Beitrag', exact: true }).fill('Eine Geschichte aus dem Testlauf.');
  await page.getByRole('button', { name: /Beitrag einreichen/ }).click();
  await expect(page.getByRole('heading', { name: /E2E Erinnerung/ })).toBeVisible();
  await expect(page.getByText('Eingereicht').first()).toBeVisible();
  await page.getByRole('link', { name: '← Meine Beiträge' }).click();
  await expect(page.getByRole('link', { name: /E2E Erinnerung/ }).first()).toBeVisible();
  await page.getByRole('link', { name: 'AbiZeitBetrug Startseite' }).click();
  await expect(page.getByRole('region', { name: 'Jetzt dran' })).toBeVisible();
});

test('back navigation restores the Schüler or Redaktion view of each page', async ({ page }) => {
  await signInAs(page, 'Redaktion');
  await expect(page).toHaveURL(/\/tickets$/);
  const root = page.locator('[data-workspace]:has(#inhalt)');
  await (await openMenu(page)).locator('a[href="/sammlungen"]').first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Abstimmungen' })).toBeVisible();
  await (await openMenu(page)).getByRole('link', { name: 'Zur Schüleransicht' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1, name: /^Hey / })).toBeVisible();
  // /sammlungen redirects the Schüler view home, so this only holds if back restores the Redaktion view.
  await page.goBack();
  await expect(page).toHaveURL(/\/sammlungen$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Abstimmungen' })).toBeVisible();
  await expect(root).toHaveAttribute('data-workspace', 'redaktion');
  await page.goBack();
  await expect(page).toHaveURL(/\/tickets$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/sammlungen$/);
  await page.goForward();
  await expect(page.getByRole('heading', { level: 1, name: /^Hey / })).toBeVisible();
  await expect(root).toHaveAttribute('data-workspace', 'schueler');
});

test('student casts a ballot in the seeded open poll', async ({ page }) => {
  await signInAs(page, 'Jahrgang');
  await page.goto('/sammlungen/30000000-0000-4000-8000-000000000001'); // seeded open proposal Abstimmung
  const option = page
    .getByRole('main')
    .locator('ul')
    .filter({ has: page.locator('button[aria-pressed]') })
    .locator('button[aria-pressed="false"]:not(:disabled)')
    .first();
  await expect(option, 'the seeded Abstimmung has an eligible option').toBeVisible();
  await option.click();
  await page.getByRole('button', { name: /Stimme speichern|Stimme ändern/ }).click();
  await expect(page.getByText('Deine Stimme wurde gespeichert.')).toBeVisible();
});

test('editor reads and annotates an original, exports without approval, and sees ballot results', async ({ page }) => {
  await signInAs(page, 'Jahrgang');
  const title = `E2E Redaktion ${Date.now()}`;
  await page.getByRole('region', { name: 'Wiederholbar' }).getByRole('link', { name: /Ideen/ }).click();
  await page.getByRole('link', { name: /Beitrag einreichen/ }).click();
  await page.getByPlaceholder('Gib deinem Beitrag einen Namen').fill(title);
  await page
    .getByRole('textbox', { name: 'Dein Beitrag', exact: true })
    .fill('Ein Original für die spätere Moderation.');
  await page.getByRole('button', { name: /Beitrag einreichen/ }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  await page.context().clearCookies();
  await signInAs(page, 'Redaktion');
  await (await openMenu(page)).getByRole('link', { name: /Alle Beiträge/ }).click();
  await expect(page).toHaveURL(/\/redaktion\/beitraege$/);
  await page.getByPlaceholder('Titel, Text, Name …').fill(title);
  const review = page.getByRole('link', { name: new RegExp(title) });
  await expect(review, 'the submitted contribution is visible to the editor').toBeVisible();
  await review.click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page).toHaveURL(/\/redaktion\/beitraege\/[^/]+$/);
  await expect(page.getByText('Eingereicht').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Bearbeiten/ })).toHaveCount(0);
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /annehmen|Ablehnen|Prüfung öffnen/ })).toHaveCount(0);
  await page.getByLabel('Anmerkung').fill('Nach der Abstimmung im Team besprechen.');
  await page.getByRole('button', { name: 'Anmerkung speichern' }).click();
  await expect(page.getByText('Nach der Abstimmung im Team besprechen.')).toBeVisible();
  await page.goBack();
  await page.getByRole('combobox', { name: 'Abstimmung' }).last().selectOption('10000000-0000-4000-8000-000000000001'); // export picker, seeded "Ideen"
  await expect(page.getByRole('link', { name: /ZIP herunterladen/ })).toHaveAttribute('href', /status=all/);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: /ZIP herunterladen/ }).click();
  await expect(downloadPromise).resolves.toBeTruthy();

  await page.getByRole('link', { name: 'AbiZeitBetrug Startseite' }).click();
  await expect(page).toHaveURL(/\/tickets$/);
  await (await openMenu(page)).locator('a[href="/sammlungen"]').first().click();
  await page
    .getByRole('main')
    .getByRole('link', { name: /Unser Abimotto(?!:)/ })
    .click();
  await expect(page.getByRole('heading', { name: /Unser Abimotto/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Gesamtergebnisse' })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByText(/Nur für die Redaktion\W+\d+ abgegebene Stimme/)).toBeVisible();
});
