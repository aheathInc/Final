import { expect, test, type Page } from '@playwright/test';

// Real Next.js/HTTP test: no cookie injection, API interception, or clinical writes.
// Optional authenticated checks require isolated synthetic local E2E credentials.
async function loginClinician(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(process.env.E2E_CLINICIAN_EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(process.env.E2E_CLINICIAN_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/doctor\/queue$/);
}

test('login theme, motion and small-screen layout', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 950 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
  await page.getByLabel('Color theme', { exact: true }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('Color theme', { exact: true }).selectOption('system');
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
});

test('authenticated drawer and navigation search keep keyboard focus', async ({ page }) => {
  test.skip(!process.env.E2E_CLINICIAN_EMAIL || !process.env.E2E_CLINICIAN_PASSWORD,
    'Requires legitimate synthetic clinician credentials in ignored local E2E configuration.');
  await loginClinician(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const trigger = page.getByRole('button', { name: 'Open navigation', exact: true });
  await trigger.click();
  const drawer = page.getByRole('dialog', { name: 'Staff navigation', exact: true });
  await expect(drawer).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toBeFocused();
  for (const key of [...Array<string>(15).fill('Tab'), ...Array<string>(15).fill('Shift+Tab')]) {
    await page.keyboard.press(key);
    expect(await drawer.evaluate(el => el.contains(document.activeElement))).toBeTruthy();
  }
  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await drawer.getByRole('link', { name: 'Follow-up', exact: true }).click();
  await expect(page).toHaveURL(/\/doctor\/follow-up$/);
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Patient follow-up', exact: true })).toBeVisible();
  await page.keyboard.press('Control+k');
  const search = page.getByRole('dialog', { name: 'Find your workspace', exact: true });
  await expect(search).toBeVisible();
  await page.getByLabel('Search available workspaces').fill('referrals');
  await expect(search.getByRole('link', { name: /Digital referrals/ })).toBeVisible();
  await expect(search.getByRole('link', { name: /Audit ledger/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(search).not.toBeVisible();
});

test('live follow-up request and real UI never substitute fixture success', async ({ page }) => {
  test.skip(!process.env.E2E_CLINICIAN_EMAIL || !process.env.E2E_CLINICIAN_PASSWORD,
    'Requires the isolated local backend and legitimate clinician login.');
  await loginClinician(page);
  const response = page.waitForResponse(r => r.url().includes('/bff/care-continuity/worklist') && r.request().method() === 'GET');
  await page.goto('/doctor/follow-up');
  expect((await response).status()).toBe(200);
  await expect(page.getByText('Loading authorized follow-up records…')).toHaveCount(0);
  await expect(page.locator('.care-patient').first().or(page.getByText(/No active cycles\./)).first()).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('.ahp-hero-copy').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await page.getByRole('button', { name: 'Use compact density', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
});
