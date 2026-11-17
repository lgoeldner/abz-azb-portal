import { expect, test } from './fixtures';

test('student adds a passkey, signs in with it and removes it', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'The virtual authenticator needs the Chromium DevTools protocol');
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.goto('/auth/login');
  await page.locator('[data-user-id="00000000-0000-4000-8000-000000000003"]').click();
  await page.waitForURL((url) => url.pathname === '/');
  const me = () => page.evaluate(async () => (await (await fetch('/api/v1/me')).json()).user.id as string);
  const userId = await me();

  await page.getByRole('link', { name: 'Einstellungen' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Passkeys' })).toBeVisible();
  await page.getByRole('button', { name: 'Passkey hinzufügen' }).click();
  await expect(page.getByText('Passkey hinzugefügt.')).toBeVisible();
  await expect(page.getByText(/^Passkey vom \d{2}\.\d{2}\.\d{4}$/)).toHaveCount(1);

  await page.getByRole('button', { name: /Abmelden/ }).click();
  await expect(page.getByRole('link', { name: /^Anmelden$/ })).toBeVisible();
  await page.goto('/auth/login'); // this browser has used a passkey: the login page asks for it by itself
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
  expect(await me()).toBe(userId);

  await page.goto('/einstellungen');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /Entfernen/ }).click();
  await expect(page.getByText('Du hast noch keinen Passkey.')).toBeVisible();
});
