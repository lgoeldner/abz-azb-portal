import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Identities are picked by display_slug, which (unlike display names) is stable.
async function signInAs(page: Page, role: 'Jahrgang' | 'Redaktion' | 'Administration') {
  await page.goto('/');
  await page.getByRole('link', { name: /Mit Schulkonto anmelden/ }).click();
  const slug = role === 'Jahrgang' ? 'mia_weber' : role === 'Redaktion' ? 'sam_redaktion' : 'alex_admin';
  const access = page.getByRole('button', { name: new RegExp(`\\b${slug}$`) });
  await expect(access, `Development login for ${role} is available (start a seeded development server)`).toBeVisible();
  await access.click();
  // The sidebar brand link is hidden on mobile, so wait for the page heading instead.
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
}

// Students reach single-answer Sammlungen from the sidebar: open ones under "Offen", answered or finished ones under "Erledigt".
async function openFirstPoll(page: Page) {
  const aside = page.getByRole('complementary', { name: 'Seitenleiste' });
  const open = aside.getByRole('list', { name: 'Offen' }).getByRole('link');
  if (await open.count()) await open.first().click();
  else {
    await aside.getByText(/^Erledigt/).click();
    await aside
      .getByRole('link', { name: /abgestimmt|beendet/ })
      .first()
      .click();
  }
}

test('student signs in, submits a contribution, and can reach a ballot', async ({ page }) => {
  await signInAs(page, 'Jahrgang');
  await page
    .getByRole('complementary', { name: 'Seitenleiste' })
    .getByRole('link', { name: /^Ideen/ })
    .click();
  await page.getByRole('link', { name: /Beitrag einreichen/ }).click();
  await page.getByPlaceholder('Gib deiner Erinnerung einen Namen').fill(`E2E Erinnerung ${Date.now()}`);
  await page
    .getByPlaceholder('Was ist passiert? Welcher Spruch darf nicht fehlen?')
    .fill('Eine Geschichte aus dem Testlauf.');
  await page.getByRole('button', { name: /Beitrag einreichen/ }).click();
  await expect(page.getByRole('heading', { name: /E2E Erinnerung/ })).toBeVisible();
  await expect(page.getByText('Eingereicht').first()).toBeVisible();
  await page.getByRole('complementary', { name: 'Seitenleiste' }).getByRole('link', { name: 'Meine Beiträge' }).click();
  await expect(page.getByRole('link', { name: /E2E Erinnerung/ }).first()).toBeVisible();
  await openFirstPoll(page);
  await expect(page).toHaveURL(/\/sammlungen\/[^/]+$/);
});

test('student casts a ballot in the seeded open poll', async ({ page }) => {
  await signInAs(page, 'Jahrgang');
  await page.goto('/sammlungen/30000000-0000-4000-8000-000000000001'); // seeded open proposal Sammlung
  const option = page
    .getByRole('list', { name: /Optionen auswählen.*Suchergebnisse/ })
    .getByRole('button')
    .first();
  await expect(option, 'the seeded Sammlung has an eligible option').toBeVisible();
  await option.click();
  await page.getByRole('button', { name: /Stimme speichern|Stimme ändern/ }).click();
  await expect(page.getByText('Deine Stimme wurde gespeichert.')).toBeVisible();
});

test('editor reads and annotates an original, exports without approval, and sees ballot results', async ({ page }) => {
  await signInAs(page, 'Jahrgang');
  const title = `E2E Redaktion ${Date.now()}`;
  await page
    .getByRole('complementary', { name: 'Seitenleiste' })
    .getByRole('link', { name: /^Ideen/ })
    .click();
  await page.getByRole('link', { name: /Beitrag einreichen/ }).click();
  await page.getByPlaceholder('Gib deiner Erinnerung einen Namen').fill(title);
  await page
    .getByPlaceholder('Was ist passiert? Welcher Spruch darf nicht fehlen?')
    .fill('Ein Original für die spätere Moderation.');
  await page.getByRole('button', { name: /Beitrag einreichen/ }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  await page.context().clearCookies();
  await signInAs(page, 'Redaktion');
  await page.getByRole('complementary', { name: 'Seitenleiste' }).getByRole('link', { name: 'Alle Beiträge' }).click();
  await expect(page).toHaveURL(/\/redaktion$/);
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
  await page.getByLabel('Anmerkung').fill('Nach der Sammlung im Team besprechen.');
  await page.getByRole('button', { name: 'Anmerkung speichern' }).click();
  await expect(page.getByText('Nach der Sammlung im Team besprechen.')).toBeVisible();
  await page.getByRole('complementary', { name: 'Seitenleiste' }).getByRole('link', { name: 'Alle Beiträge' }).click();
  await page.getByRole('combobox', { name: 'Sammlung' }).last().selectOption('10000000-0000-4000-8000-000000000001'); // export picker, seeded "Ideen"
  await expect(page.getByRole('link', { name: /ZIP herunterladen/ })).toHaveAttribute('href', /status=all/);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: /ZIP herunterladen/ }).click();
  await expect(downloadPromise).resolves.toBeTruthy();

  await page
    .getByRole('complementary', { name: 'Seitenleiste' })
    .getByRole('link', { name: /Unser Abimotto/ })
    .click();
  await expect(page.getByRole('heading', { name: /Unser Abimotto/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Gesamtergebnisse' })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByText(/Nur für die Redaktion\W+\d+ abgegebene Stimme/)).toBeVisible();
});

test('admin opens access management and activity log on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs(page, 'Administration');
  await page.getByRole('button', { name: 'Menü öffnen' }).click();
  const aside = page.getByRole('complementary', { name: 'Seitenleiste' });
  await expect(aside.getByRole('button', { name: 'Verwaltung' })).toHaveAttribute('aria-expanded', 'true');
  await aside.getByRole('link', { name: 'Personen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Personen' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Unser Jahrgang & Team' })).toBeVisible();
  await page.getByRole('button', { name: 'Menü öffnen' }).click();
  await aside.getByRole('link', { name: 'Aktivitätsprotokoll' }).click();
  await expect(page.getByRole('heading', { name: 'Letzte Aktivitäten' })).toBeVisible();
});

test('old bookmarks under /abstimmungen land on the Sammlungen pages', async ({ page }) => {
  await signInAs(page, 'Jahrgang');
  await page.goto('/abstimmungen/30000000-0000-4000-8000-000000000001');
  await expect(page).toHaveURL(/\/sammlungen\/30000000-0000-4000-8000-000000000001$/);
  await page.goto('/abstimmungen');
  await expect(page).toHaveURL(/\/sammlungen$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sammlungen' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Wiederholbar' })).toBeVisible();
});

test('admin dashboard shows one widget per class and links to the filtered list', async ({ page }) => {
  await signInAs(page, 'Administration');
  const widgets = page.getByRole('region', { name: 'Sammlungen', exact: true });
  await expect(widgets.getByRole('listitem')).toHaveCount(6);
  for (const label of ['Ideen', 'Zitate', 'Erinnerungen', 'Fotos', 'Personenwahl', 'Vorschlagswahl'])
    await expect(widgets.getByRole('link', { name: new RegExp(`^${label}`) })).toBeVisible();
  await widgets.getByRole('link', { name: /^Vorschlagswahl/ }).click();
  await expect(page).toHaveURL(/\/sammlungen\?klasse=proposal$/);
  await expect(page.getByRole('link', { name: 'Vorschlagswahl', exact: true })).toHaveAttribute('aria-current', 'true');
});
