/**
 * Smoke check of the production build in a real browser with real CelesTrak
 * data: every dashboard panel renders, the selected-object numbers are
 * physically plausible, settings and location survive a reload, and the
 * offline paths show the right messages.
 */
import { expect, test } from '@playwright/test';
import { blockCelestrak, useCachedCelestrak } from './celestrak-cache';
import { collectErrors, panel, selectIss } from './helpers';

test('loads real orbital data and renders every panel', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await useCachedCelestrak(page);
  await page.goto('/');

  const status = page.getByTestId('catalog-status');
  await expect(status).toContainText(/[1-9][\d,]* objects/);
  const objects = Number((await status.innerText()).match(/([\d,]+) objects/)![1]!.replace(/,/g, ''));
  expect(objects).toBeGreaterThan(100);

  // Primary globe: a canvas and no WebGL / error fallback.
  const globe = panel(page, 'Orbital view');
  await expect(globe.locator('canvas')).toBeVisible();
  await expect(globe.getByRole('alert')).toHaveCount(0);
  await expect(globe).toContainText(/[\d,]+ objects · SGP4/);

  await selectIss(page);
  const info = page.getByTestId('selected-object');
  // Physically plausible ISS state from SGP4 on the downloaded elements.
  const text = await info.innerText();
  const altitude = Number(text.match(/Altitude\s+([\d.,]+) km/i)![1]!.replace(/,/g, ''));
  const speed = Number(text.match(/Speed \(inertial\)\s+([\d.]+) km\/s/i)![1]);
  const inclination = Number(text.match(/Inclination\s+([\d.]+)°/i)![1]);
  expect(altitude).toBeGreaterThan(330);
  expect(altitude).toBeLessThan(460);
  expect(speed).toBeGreaterThan(7.5);
  expect(speed).toBeLessThan(7.8);
  expect(inclination).toBeCloseTo(51.6, 0);

  // Ground track globe, sky plot and pass table, all driven by the selection.
  const groundTrack = panel(page, 'Ground track & footprint');
  await expect(groundTrack.locator('canvas')).toBeVisible();
  await expect(groundTrack).toContainText('SSP');
  await expect(page.getByRole('img', { name: /Sky plot of ISS/ })).toBeVisible();
  const passes = panel(page, 'Upcoming passes');
  await expect(passes.locator('tbody tr').first()).toBeVisible();
  expect(await passes.locator('tbody tr').count()).toBeGreaterThanOrEqual(5);

  // The 3D views actually drew something (a blank canvas compresses to a tiny PNG).
  const globeShot = await globe.locator('canvas').screenshot();
  expect(globeShot.byteLength).toBeGreaterThan(30_000);

  await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('settings, location and selection persist across a reload', async ({ page }) => {
  const errors = collectErrors(page);
  await useCachedCelestrak(page);
  await page.goto('/');
  await expect(page.getByTestId('catalog-status')).toContainText(/[1-9][\d,]* objects/);
  await selectIss(page);

  // Settings panel: change a pass setting, a globe toggle and the footprint mask.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByTestId('settings-panel');
  await settings.getByLabel('Elevation mask').fill('17');
  await settings.getByLabel('Elevation mask').press('Enter');
  await settings.getByLabel('Day/night terminator').uncheck();
  await settings.getByLabel('Predicted track').selectOption('3');
  await settings.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.getByLabel('Elevation mask in degrees')).toHaveValue('17');

  // Location: manual entry.
  await page.getByTitle('Observer location').click();
  await page.getByLabel('Latitude', { exact: true }).fill('-33.8688');
  await page.getByLabel('Longitude', { exact: true }).fill('151.2093');
  await page.getByLabel('Altitude', { exact: true }).fill('58');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByTitle('Observer location')).toContainText('33.87° S');

  await page.reload();
  await expect(page.getByTestId('catalog-status')).toContainText(/[1-9][\d,]* objects/);
  await expect(page.getByTitle('Observer location')).toContainText('33.87° S 151.21° E');
  await expect(page.getByTestId('selected-object')).toContainText('25544');
  await expect(page.getByLabel('Elevation mask in degrees')).toHaveValue('17');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(settings.getByLabel('Day/night terminator')).not.toBeChecked();
  await expect(settings.getByLabel('Predicted track')).toHaveValue('3');

  // Reset to defaults (two-step confirm) restores the defaults and persists.
  await settings.getByRole('button', { name: 'Reset to defaults' }).click();
  await settings.getByRole('button', { name: 'Confirm reset' }).click();
  await expect(settings.getByLabel('Elevation mask')).toHaveValue('10');
  await page.reload();
  await expect(page.getByLabel('Elevation mask in degrees')).toHaveValue('10');
  expect(errors).toEqual([]);
});

test('offline with no cached data explains the problem and offers a retry', async ({ page }) => {
  await blockCelestrak(page);
  await page.goto('/');
  const notice = page.getByTestId('notice').first();
  await expect(notice).toContainText(/No orbital data loaded: CelesTrak unreachable.*Nothing is cached yet/);
  await expect(notice.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByTestId('catalog-status')).toContainText('no data');

  // Network comes back: Retry loads real data and the notice goes away.
  await useCachedCelestrak(page);
  await notice.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('catalog-status')).toContainText(/[1-9][\d,]* objects/);
  await expect(page.getByTestId('notice')).toHaveCount(0);
});

test('offline with an expired cache falls back to cached elements and says so', async ({ page }) => {
  await useCachedCelestrak(page);
  await page.goto('/');
  await expect(page.getByTestId('catalog-status')).toContainText(/[1-9][\d,]* objects/);

  // Age the IndexedDB cache past the refresh interval, then lose the network.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('sattrack', 1);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const store = db.transaction('kv', 'readwrite').objectStore('kv');
    const keys = await new Promise<IDBValidKey[]>((res) => {
      const r = store.getAllKeys();
      r.onsuccess = () => res(r.result);
    });
    for (const key of keys) {
      const entry = await new Promise<{ text: string; fetchedAtMs: number }>((res) => {
        const r = store.get(key);
        r.onsuccess = () => res(r.result);
      });
      store.put({ ...entry, fetchedAtMs: Date.now() - 3 * 86_400_000 }, key);
    }
    await new Promise((res) => (store.transaction.oncomplete = res));
  });
  await blockCelestrak(page);
  await page.reload();

  await expect(page.getByTestId('catalog-status')).toContainText('offline · cached');
  await expect(page.getByTestId('notice').first()).toContainText(/CelesTrak could not be reached.*cached element sets downloaded 3\.0 d ago/);
  // Everything still works from the cached elements.
  await selectIss(page);
  await expect(panel(page, 'Upcoming passes').locator('tbody tr').first()).toBeVisible();
});
