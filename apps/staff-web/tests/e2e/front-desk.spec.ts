/** Candidate 005: authored real-login smoke tests. NOT RUN in build environment.
 * Does not provision users, seed, inject cookies or mark financial/clinical clearance.
 * Set AHP_FRONT_DESK_E2E=1 with real isolated synthetic account credentials.
 */
import { expect, test } from '@playwright/test';
const enabled = process.env.AHP_FRONT_DESK_E2E === '1';
test.describe('Digital front desk — authenticated shell and BFF smoke', () => {
  test.skip(!enabled, 'Requires an explicitly selected isolated front-desk runtime.');
  for (const role of ['CLINICIAN', 'ADMIN'] as const) {
    test(`${role} opens authorized front desk with real login`, async ({ page }) => {
      const email = process.env[`E2E_${role}_EMAIL`]; const password = process.env[`E2E_${role}_PASSWORD`];
      expect(Boolean(email && password), 'Set synthetic credentials in ignored environment config; values are not printed.').toBe(true);
      await page.goto('/login');
      await page.getByLabel('Email', { exact: true }).fill(email!);
      await page.getByLabel('Password', { exact: true }).fill(password!);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
      const data = page.waitForResponse((r) => new URL(r.url()).pathname === '/bff/front-desk/facilities');
      await page.goto(role === 'ADMIN' ? '/admin/front-desk' : '/doctor/front-desk');
      expect((await data).status()).toBe(200);
      await expect(page.getByRole('heading', { name: role === 'ADMIN' ? 'Digital front desk' : 'Hospital intake queue', exact: true })).toBeVisible();
      await expect(page.getByLabel('Facility', { exact: true })).toBeVisible();
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
      }
      // Clinical writes are covered by explicit operator acceptance, not screenshot generation.
      const foreignRolePath = role === 'CLINICIAN' ? '/admin/front-desk' : '/doctor/front-desk';
      await page.goto(foreignRolePath);
      await expect(page).not.toHaveURL(new RegExp(`${foreignRolePath}$`));
    });
  }
});
