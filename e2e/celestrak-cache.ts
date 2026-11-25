/**
 * Serves CelesTrak GP requests from an on-disk cache of real downloads.
 *
 * CelesTrak asks clients not to fetch the same data more than once per two
 * hours and blocks IPs that do. Every Playwright test starts with an empty
 * browser cache, so without this each test would re-download every group.
 * The first request for a URL goes to CelesTrak; the response is stored in
 * e2e/.cache/ and replayed for 12 hours. Data stays real; only the transport
 * is cached.
 */
import type { Page, Route } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CACHE_DIR = join(import.meta.dirname, '.cache');
const MAX_AGE_MS = 12 * 3_600_000;
export const CELESTRAK_PATTERN = /^https:\/\/celestrak\.org\/NORAD\/elements\/gp\.php/;

function cacheFile(url: string): string {
  return join(CACHE_DIR, `${createHash('sha1').update(url).digest('hex').slice(0, 16)}.txt`);
}

function readFresh(file: string): string | null {
  try {
    if (Date.now() - statSync(file).mtimeMs > MAX_AGE_MS) return null;
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

async function handle(route: Route): Promise<void> {
  const url = route.request().url();
  const file = cacheFile(url);
  let body = readFresh(file);
  if (body === null) {
    const response = await route.fetch();
    if (!response.ok()) {
      await route.fulfill({ response });
      return;
    }
    body = await response.text();
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(file, body);
  }
  await route.fulfill({
    status: 200,
    contentType: 'text/plain; charset=utf-8',
    headers: { 'access-control-allow-origin': '*' },
    body,
  });
}

/** Route CelesTrak through the disk cache for this page. */
export async function useCachedCelestrak(page: Page): Promise<void> {
  await page.route(CELESTRAK_PATTERN, handle);
}

/** Make every CelesTrak request fail as if the network were down. */
export async function blockCelestrak(page: Page): Promise<void> {
  await page.unroute(CELESTRAK_PATTERN);
  await page.route(CELESTRAK_PATTERN, (route) => route.abort('internetdisconnected'));
}
