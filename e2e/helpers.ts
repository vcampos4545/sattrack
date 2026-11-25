import { expect, type Page } from '@playwright/test';

/** A dashboard panel by its title. */
export const panel = (page: Page, title: string) => page.locator('section', { has: page.locator('h2', { hasText: title }) });

/** Uncaught page errors, for asserting a clean run. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Select the ISS through the header search. */
export async function selectIss(page: Page) {
  await page.getByLabel('Search satellites').fill('25544');
  await page.getByRole('option', { name: /ISS \(ZARYA\)/ }).click();
  await expect(page.getByTestId('selected-object')).toContainText('25544');
}
