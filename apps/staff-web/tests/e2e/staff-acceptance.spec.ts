import { expect, test, type Page } from '@playwright/test';

const clinician = {
  email: process.env.E2E_CLINICIAN_EMAIL,
  password: process.env.E2E_CLINICIAN_PASSWORD,
};
const admin = {
  email: process.env.E2E_ADMIN_EMAIL,
  password: process.env.E2E_ADMIN_PASSWORD,
};
const facilityAdmin = {
  email: process.env.E2E_FACILITY_ADMIN_EMAIL,
  password: process.env.E2E_FACILITY_ADMIN_PASSWORD,
};
const pharmacist = {
  email: process.env.E2E_PHARMACIST_EMAIL,
  password: process.env.E2E_PHARMACIST_PASSWORD,
};
const screenshotDir = 'test-results/screenshots';
const observedBff: Array<{ path: string; status: number }> = [];

test.beforeAll(() => {
  for (const [name, value] of Object.entries({ ...clinician, ...admin, ...facilityAdmin, ...pharmacist })) {
    expect(value, `${name} must be set in ignored apps/staff-web/.env.local`).toBeTruthy();
  }
});

function trackBff(page: Page) {
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/bff/')) {
      observedBff.push({ path: url.pathname, status: response.status() });
    }
  });
}

async function login(page: Page, account: { email?: string; password?: string }, target: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email!);
  await page.getByLabel('Password').fill(account.password!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`${target.replaceAll('/', '\\/')}$`), { timeout: 20_000 });
}

async function expectProtectedPage(page: Page, path: string, heading: string) {
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}$`));
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
}

async function expectQueueContent(page: Page) {
  const offeredCase = page.getByRole('button', { name: 'Accept', exact: true }).first();
  const emptyQueue = page.getByText('No offered cases are waiting right now.', { exact: true });
  await expect(offeredCase.or(emptyQueue).first()).toBeVisible();
}

async function expectBff(page: Page, path: string) {
  const response = await page.evaluate(async (endpoint) => {
    const res = await fetch(endpoint, { cache: 'no-store' });
    return { status: res.status, body: await res.text() };
  }, path);
  expect(response.status, `${path} should reach its service through the BFF`).toBeGreaterThanOrEqual(200);
  expect(response.status, `${path} should not return a proxy/auth/server error`).toBeLessThan(400);
}

test('clinician login, workspace, RBAC, mobile layout and logout', async ({ page, browser }) => {
  trackBff(page);
  const cssResponses: Array<{ status: number; contentType: string }> = [];
  page.on('response', (response) => {
    if (response.request().resourceType() === 'stylesheet') {
      cssResponses.push({ status: response.status(), contentType: response.headers()['content-type'] ?? '' });
    }
  });

  await page.goto('/login');
  const loginStyles = await page.evaluate(() => ({
    font: getComputedStyle(document.body).fontFamily,
    shell: getComputedStyle(document.querySelector('.ahp-login')!).backgroundColor,
    form: getComputedStyle(document.querySelector('form')!).backgroundColor,
    button: getComputedStyle(document.querySelector('button[type="submit"]')!).backgroundColor,
  }));
  await expect(page.getByRole('heading', { name: 'Care, clearly connected.' })).toBeVisible();
  await page.screenshot({ path: `${screenshotDir}/login.png`, fullPage: true });
  expect(loginStyles.font.toLowerCase()).toContain('ui-sans-serif');
  expect(loginStyles.shell).not.toBe('rgba(0, 0, 0, 0)');
  expect(loginStyles.form).not.toBe('rgba(0, 0, 0, 0)');
  expect(await page.locator('button[type="submit"]').evaluate(el=>getComputedStyle(el).backgroundImage)).toContain('linear-gradient');
  await login(page, clinician, '/doctor/queue');
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Consultation queue', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Dr\.|Your clinical workspace/ })).toBeVisible();
  await expectQueueContent(page);
  await page.screenshot({ path: `${screenshotDir}/doctor-workspace.png`, fullPage: true });

  const cssState = await page.evaluate(() => {
    const main = document.querySelector('main')!;
    const shell = document.querySelector('aside')!;
    const selected = document.querySelector('[aria-current="page"]')!;
    const card = document.querySelector('.ahp-card')!;
    const table = document.createElement('table');
    const row = table.insertRow();
    row.insertCell().textContent = 'probe';
    main.append(table);
    const tableStyle = getComputedStyle(table);
    return {
      main: getComputedStyle(document.querySelector('.ahp-hero')!).backgroundImage,
      shell: getComputedStyle(shell).backgroundImage,
      selectedBg: getComputedStyle(selected).backgroundImage,
      cardBorder: getComputedStyle(card).borderTopWidth,
      tableWidth: tableStyle.width,
      tableCollapse: tableStyle.borderCollapse,
      tableCellBorder: getComputedStyle(row.cells[0]).paddingLeft,
      font: getComputedStyle(document.body).fontFamily,
    };
  });
  expect(cssResponses.some((r) => r.status === 200 && r.contentType.includes('text/css'))).toBeTruthy();
  expect(cssState.font.toLowerCase()).toContain('ui-sans-serif');
  expect(cssState.shell).toContain('linear-gradient');
  expect(cssState.main).not.toBe('none');
  expect(cssState.selectedBg).toContain('linear-gradient');
  expect(cssState.cardBorder).not.toBe('0px');
  expect(loginStyles.button).not.toBe('rgba(0, 0, 0, 0)');
  expect(Number.parseFloat(cssState.tableWidth)).toBeGreaterThan(0);
  expect(cssState.tableCollapse).toBe('collapse');
  expect(Number.parseFloat(cssState.tableCellBorder)).toBeGreaterThan(0.9);

  for (const [path, heading] of [
    ['/doctor/appointments', 'Appointments'],
    ['/doctor/diagnostics', 'Lab orders & results'],
    ['/doctor/follow-up', 'Patient follow-up'],
    ['/doctor/pharmacy', 'Pharmacy availability'],
  ]) await expectProtectedPage(page, path, heading);

  for (const path of [
    '/bff/queue?scope=offered&limit=50',
    '/bff/appointments?limit=50',
    '/bff/investigation-orders?limit=50',
    '/bff/adherence-logs?limit=50',
    '/bff/pharmacies/medication-search?medication_name=paracetamol&lat=-6.8&lng=39.28&radius_km=20',
  ]) await expectBff(page, path);

  await page.reload();
  await expect(page).toHaveURL(/\/doctor\/pharmacy$/);
  await expect(page.getByRole('heading', { name: 'Pharmacy availability' })).toBeVisible();
  await page.goto('/doctor/queue');
  await page.goto('/admin/dashboard');
  await expect(page).toHaveURL(/\/doctor\/queue$/);
  await page.goto('/admin/audit-ledger');
  await expect(page).toHaveURL(/\/doctor\/queue$/);
  await page.goto('/analytics/dashboard');
  await expect(page).toHaveURL(/\/doctor\/queue$/);

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  trackBff(mobile);
  await login(mobile, clinician, '/doctor/queue');
  await expectQueueContent(mobile);
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBeFalsy();
  await mobile.screenshot({ path: `${screenshotDir}/mobile-doctor.png`, fullPage: true });
  await mobile.getByRole('button', { name: 'Open navigation', exact: true }).click();
  const mobileLogout = mobile.waitForResponse((response) => response.url().endsWith('/api/logout'));
  await mobile.getByRole('button', { name: 'Sign out' }).click();
  const mobileLogoutResponse = await mobileLogout;
  expect(mobileLogoutResponse.status(), 'UI logout API response').toBe(204);
  await expect(mobile).toHaveURL(/\/login$/);
  await mobile.goto('/doctor/queue');
  await expect(mobile).toHaveURL(/\/login$/);
  await mobile.close();

  const clinicianLogout = page.waitForResponse((response) => response.url().endsWith('/api/logout'));
  await page.getByRole('button', { name: 'Sign out' }).click();
  expect((await clinicianLogout).status(), 'UI logout API response').toBe(204);
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/doctor/queue');
  await expect(page).toHaveURL(/\/login$/);
  expect(observedBff.length).toBeGreaterThan(0);
});

test('platform admin operations, analytics, RBAC and logout', async ({ page }) => {
  trackBff(page);
  await login(page, admin, '/admin/dashboard');
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Overview', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Service overview' })).toBeVisible();
  await page.screenshot({ path: `${screenshotDir}/admin-dashboard.png`, fullPage: true });

  for (const [path, heading] of [
    ['/admin/emergency', 'Emergency operations'],
    ['/admin/verification', 'Clinician verification'],
    ['/admin/facilities', 'Facilities'],
    ['/admin/audit-ledger', 'Identity and consent audit ledger'],
    ['/analytics/dashboard', 'Service insights'],
    ['/analytics/surveillance', 'Disease surveillance'],
    ['/analytics/research', 'Research'],
  ]) await expectProtectedPage(page, path, heading);
  await expectProtectedPage(page, '/admin/audit-ledger', 'Identity and consent audit ledger');
  const ledgerVerification = page.waitForResponse((response) =>
    response.url().includes('/bff/audit/verify') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Verify full ledger' }).click();
  const ledgerResponse = await ledgerVerification;
  expect(ledgerResponse.status(), 'ledger verification BFF response').toBe(200);
  await expect(page.getByRole('status')).toContainText('VALID');
  await page.locator('.ahp-sidebar').getByText('Insights', { exact: true }).click();
  await page.locator('.ahp-sidebar').getByRole('link', { name: 'Service overview', exact: true }).click();
  await expect(page).toHaveURL(/\/analytics\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Service insights' })).toBeVisible();
  await page.screenshot({ path: `${screenshotDir}/analytics-dashboard.png`, fullPage: true });

  for (const path of [
    '/bff/emergency-requests?limit=100',
    '/bff/clinicians?verification_status=pending&limit=50',
    '/bff/facilities?limit=100',
    '/bff/surveillance/conditions?level=national',
    '/bff/research/datasets',
  ]) await expectBff(page, path);

  await page.reload();
  await expect(page).toHaveURL(/\/analytics\/dashboard$/);
  await page.goto('/doctor/queue');
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/admin/dashboard');
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/admin/audit-ledger');
  await expect(page).toHaveURL(/\/login$/);
});

test('facility admin landing page and role isolation', async ({ page }) => {
  await login(page, facilityAdmin, '/admin/facilities');
  await expect(page.getByRole('heading', { name: 'Facilities', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Facilities' })).toBeVisible();

  await page.goto('/admin/dashboard');
  await expect(page).toHaveURL(/\/admin\/facilities$/);
  await page.goto('/analytics/dashboard');
  await expect(page).toHaveURL(/\/admin\/facilities$/);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('pharmacist pharmacy workspace, membership and role isolation', async ({ page }) => {
  await login(page, pharmacist, '/pharmacy');
  await expect(page.getByRole('heading', { name: 'Prescription handoff', exact: true })).toBeVisible();
  await expect(page.getByText('Authorized pharmacy: AHP Local Test: Demonstration Pharmacy', { exact: true })).toBeVisible();
  await expect(page.getByText(/no verified active pharmacy membership/i)).toHaveCount(0);

  await page.goto('/doctor/queue');
  await expect(page).toHaveURL(/\/pharmacy$/);
  await expect(page.getByRole('heading', { name: 'Prescription handoff', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
