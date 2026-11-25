/**
 * Without WebGL the two 3D views show an explanation instead of crashing, and
 * every panel that does not need WebGL keeps working.
 */
import { expect, test } from '@playwright/test';
import { useCachedCelestrak } from './celestrak-cache';
import { collectErrors, panel, selectIss } from './helpers';

test.use({ launchOptions: { args: ['--disable-webgl', '--disable-3d-apis'] } });

test('3D views explain the problem and the data panels keep working', async ({ page }) => {
  const errors = collectErrors(page);
  await useCachedCelestrak(page);
  await page.goto('/');
  await expect(page.getByTestId('catalog-status')).toContainText(/[1-9][\d,]* objects/);
  await expect(panel(page, 'Orbital view').getByRole('alert')).toContainText('3D globe needs WebGL');
  await selectIss(page);
  await expect(panel(page, 'Ground track & footprint').getByRole('alert')).toContainText('Ground track globe needs WebGL');
  await expect(page.getByRole('img', { name: /Sky plot of ISS/ })).toBeVisible();
  await expect(panel(page, 'Upcoming passes').locator('tbody tr').first()).toBeVisible();
  expect(errors).toEqual([]);
});
