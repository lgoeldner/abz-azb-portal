import { expect, test as base } from '@playwright/test';

// Any uncaught page exception fails the test: a crashed React tree renders a blank page.
export const test = base.extend<{ pageErrors: void }>({
  pageErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    await use();
    expect(errors, 'uncaught page exceptions').toEqual([]);
  }, { auto: true }],
});
export { expect };
