import { expect, test, type Page } from '@playwright/test';

const doctorA = {
  email: process.env.E2E_CLINICIAN_EMAIL,
  password: process.env.E2E_CLINICIAN_PASSWORD,
};
const doctorB = {
  email: process.env.E2E_CLINICIAN_B_EMAIL,
  password: process.env.E2E_CLINICIAN_B_PASSWORD,
};
const admin = {
  email: process.env.E2E_ADMIN_EMAIL,
  password: process.env.E2E_ADMIN_PASSWORD,
};
const acceptId = process.env.E2E_MARKETPLACE_ACCEPT_CONSULTATION_ID;
const declineId = process.env.E2E_MARKETPLACE_DECLINE_CONSULTATION_ID;
const completedId = process.env.E2E_MARKETPLACE_COMPLETED_CONSULTATION_ID;

async function login(page: Page, account: { email?: string; password?: string }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email!);
  await page.getByLabel('Password').fill(account.password!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/doctor\/queue$/);
}

async function getBff<T>(page: Page, path: string): Promise<{ status: number; body: T }> {
  return page.evaluate(async (url) => {
    const response = await fetch(url, { cache: 'no-store' });
    return { status: response.status, body: await response.json() as T };
  }, path);
}

test('provider profile, availability, offers, work history and clinician isolation', async ({ page, browser }) => {
  let database: URL;
  try { database = new URL(process.env.DATABASE_URL ?? ''); } catch { throw new Error('Firefox marketplace acceptance requires a local ahealth_test database.'); }
  const databaseName = decodeURIComponent(database.pathname.replace(/^\//, ''));
  expect(databaseName).toBe('ahealth_test');
  expect(['localhost', '127.0.0.1', '::1']).toContain(database.hostname);
  expect(database.port || '5432').not.toBe('5432');

  test.skip(
    !doctorA.email || !doctorA.password || !doctorB.email || !doctorB.password || !admin.email || !admin.password || !acceptId || !declineId || !completedId,
    'Requires real clinician A/B and Admin logins with synthetic ahealth_test marketplace consultation fixtures.',
  );

  await login(page, doctorA);
  await page.goto('/doctor/profile');
  await expect(page.getByRole('heading', { name: 'Provider profile' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Clinician status' })).toBeVisible();

  const ownProfile = await getBff<{ id: string; verification_status: string; facility_id: string | null }>(page, '/bff/clinicians/me');
  expect(ownProfile.status).toBe(200);
  expect(ownProfile.body.id).toBeTruthy();
  expect(ownProfile.body.verification_status).toBe('verified');
  expect(ownProfile.body.facility_id).toBeTruthy();
  await expect(page.getByText('Specialty', { exact: true })).toBeVisible();
  await expect(page.getByText('Facility', { exact: true })).toBeVisible();
  await expect(page.getByText('Verification', { exact: true })).toBeVisible();

  const availability = page.getByRole('button', { name: /Accepting cases|Not accepting cases/ });
  await expect(availability).toBeEnabled();
  const originalAvailability = (await availability.getAttribute('aria-pressed')) === 'true';
  await availability.click();
  await expect(page.getByRole('status').getByText('Availability saved')).toBeVisible();
  await page.reload();
  const persistedAvailability = page.getByRole('button', { name: /Accepting cases|Not accepting cases/ });
  await expect(persistedAvailability).toHaveAttribute('aria-pressed', String(!originalAvailability));
  await persistedAvailability.click();
  await expect(page.getByRole('status').getByText('Availability saved')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /Accepting cases|Not accepting cases/ }))
    .toHaveAttribute('aria-pressed', String(originalAvailability));

  const selfVerifyPost = await page.evaluate(async (url) => {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    return response.status;
  }, `/bff/clinicians/${ownProfile.body.id}/verification`);
  expect(selfVerifyPost).toBe(403);

  const doctorBPage = await browser.newPage();
  await login(doctorBPage, doctorB);
  const privateProfile = await getBff(doctorBPage, `/bff/clinicians/${ownProfile.body.id}`);
  expect(privateProfile.status).toBe(403);
  const otherOfferAccept = await doctorBPage.evaluate(async (url) => {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: '{}',
    });
    return response.status;
  }, `/bff/consultations/${acceptId}/accept`);
  expect([403, 409]).toContain(otherOfferAccept);
  await doctorBPage.getByRole('button', { name: 'Sign out' }).click();

  await page.goto('/doctor/queue');
  const acceptedCard = page.locator('ul li article').filter({ hasText: 'Synthetic marketplace replay request for acceptance workflow coverage.' });
  await expect(acceptedCard).toContainText('Offer expires');
  await expect(acceptedCard.getByRole('button', { name: 'Accept', exact: true })).toBeVisible();
  await acceptedCard.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/doctor/case/${acceptId}$`));
  const accepted = await getBff<{ status: string; assigned_clinician_id: string | null }>(page, `/bff/consultations/${acceptId}`);
  expect(accepted.status).toBe(200);
  expect(['matched', 'in_progress']).toContain(accepted.body.status);
  expect(accepted.body.assigned_clinician_id).toBe(ownProfile.body.id);

  await page.goto('/doctor/queue');
  const declinedCard = page.locator('ul li article').filter({ hasText: 'Synthetic marketplace replay request for decline and fallback routing coverage.' });
  await expect(declinedCard).toContainText('Offer expires');
  await declinedCard.getByRole('button', { name: 'Decline', exact: true }).click();
  await declinedCard.getByRole('button', { name: 'Other reason' }).click();
  await expect(declinedCard).toHaveCount(0);

  await login(doctorBPage, doctorB);
  await doctorBPage.goto('/doctor/queue');
  await expect(doctorBPage.locator('ul li article').filter({ hasText: 'Synthetic marketplace replay request for decline and fallback routing coverage.' }))
    .toContainText('Offer expires');
  await doctorBPage.goto('/doctor/work-history');
  await expect(doctorBPage.getByText(completedId!.slice(0, 8), { exact: false })).toHaveCount(0);
  await doctorBPage.close();

  const adminPage = await browser.newPage();
  await adminPage.goto('/login');
  await adminPage.getByLabel('Email').fill(admin.email!);
  await adminPage.getByLabel('Password').fill(admin.password!);
  await adminPage.getByRole('button', { name: 'Sign in' }).click();
  await expect(adminPage).toHaveURL(/\/admin\/dashboard$/);
  const pending = await getBff<{ data: Array<{ id: string; full_name: string | null; license_number?: string }> }>(
    adminPage,
    '/bff/clinicians?verification_status=pending&limit=100',
  );
  expect(pending.status).toBe(200);
  const pendingDoctor = pending.body.data.find((entry) => entry.full_name === 'AHP Marketplace Pending Doctor B');
  expect(pendingDoctor?.license_number).toBe('AHP-MKT-TEST-PENDING-B');
  await adminPage.goto('/admin/verification');
  const pendingCard = adminPage.locator('article').filter({ hasText: 'AHP Marketplace Pending Doctor B' });
  await expect(pendingCard).toBeVisible();
  await expect(pendingCard).toContainText('AHP-MKT-TEST-PENDING-B');
  await pendingCard.getByRole('button', { name: 'Idhinisha' }).click();
  await expect(pendingCard).toHaveCount(0);
  const verifiedPending = await getBff<{ verification_status: string; account_status: string }>(
    adminPage,
    `/bff/clinicians/${pendingDoctor!.id}`,
  );
  expect(verifiedPending.status).toBe(200);
  expect(verifiedPending.body.verification_status).toBe('verified');
  expect(verifiedPending.body.account_status).toBe('active');
  await adminPage.close();

  await page.goto('/doctor/work-history');
  await expect(page.getByRole('heading', { name: 'Active consultations' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Completed consultations' })).toBeVisible();
  const completedSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Completed consultations' }) });
  await expect(completedSection.getByText(completedId!.slice(0, 8), { exact: true })).toBeVisible();
});
