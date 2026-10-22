import { expect, test, type Page } from '@playwright/test';

const doctorA = {
  email: process.env.E2E_PROVIDER_COLLABORATION_DOCTOR_A_EMAIL,
  password: process.env.E2E_PROVIDER_COLLABORATION_DOCTOR_A_PASSWORD,
};
const doctorB = {
  email: process.env.E2E_PROVIDER_COLLABORATION_DOCTOR_B_EMAIL,
  password: process.env.E2E_PROVIDER_COLLABORATION_DOCTOR_B_PASSWORD,
};
const doctorE = {
  email: process.env.E2E_PROVIDER_COLLABORATION_DOCTOR_E_EMAIL,
  password: process.env.E2E_PROVIDER_COLLABORATION_DOCTOR_E_PASSWORD,
};
const consultationId = process.env.E2E_PROVIDER_COLLABORATION_CONSULTATION_ID;
const question = `Synthetic acceptance question: ${new Date().toISOString()}`;

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

test('real Firefox login, consent-gated case share, provider discussion, and revocation', async ({ page, browser }, testInfo) => {
  let database: URL;
  try { database = new URL(process.env.DATABASE_URL ?? ''); } catch {
    throw new Error('Firefox collaboration acceptance requires a local ahealth_test database.');
  }
  const databaseName = decodeURIComponent(database.pathname.replace(/^\//, ''));
  expect(databaseName).toBe('ahealth_test');
  expect(['localhost', '127.0.0.1', '::1']).toContain(database.hostname);
  expect(database.port || '5432').not.toBe('5432');

  test.skip(
    !doctorA.email || !doctorA.password || !doctorB.email || !doctorB.password ||
      !doctorE.email || !doctorE.password || !consultationId,
    'Requires the synthetic provider-collaboration seed, three real clinician logins, and its consultation ID.',
  );

  await login(page, doctorA);
  const requesterProfile = await getBff<{ id: string }> (page, '/bff/clinicians/me');
  expect(requesterProfile.status).toBe(200);
  await page.goto('/doctor/clinical-collaboration');
  await expect(page.getByRole('heading', { name: 'Clinical collaboration' })).toBeVisible();

  const caseCard = page.locator('article').filter({ hasText: consultationId! }).first();
  await expect(caseCard).toBeVisible();
  await caseCard.getByRole('button', { name: 'Request collaboration' }).click();
  const invitees = await getBff<{ data: Array<{ clinician_id: string }> }>(
    page,
    `/bff/network/collaborations/eligible-clinicians?consultation_id=${consultationId}`,
  );
  expect(invitees.status).toBe(200);

  const pageB = await browser.newPage();
  await login(pageB, doctorB);
  const inviteeProfile = await getBff<{ id: string }>(pageB, '/bff/clinicians/me');
  expect(inviteeProfile.status).toBe(200);
  expect(invitees.body.data.some((item) => item.clinician_id === inviteeProfile.body.id)).toBe(true);
  await pageB.close();

  await page.getByLabel('Patient-authorized clinician').selectOption(inviteeProfile.body.id);
  await page.getByLabel('Clinical question').fill(question);
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByRole('status')).toContainText('Request sent');

  const requestsA = await getBff<{ data: Array<{ id: string; status: string; question: string }> }>(page, '/bff/network/collaborations?limit=100');
  const request = requestsA.body.data.find((item) => item.question === question && item.status === 'requested');
  expect(request).toBeTruthy();

  const doctorBPage = await browser.newPage();
  await login(doctorBPage, doctorB);
  await doctorBPage.goto('/doctor/clinical-collaboration');
  const incoming = doctorBPage.locator('article').filter({ hasText: question }).first();
  await expect(incoming.getByRole('button', { name: 'Accept' })).toBeVisible();
  await incoming.getByRole('button', { name: 'Accept' }).click();
  await expect(incoming).toContainText('accepted');
  await doctorBPage.getByRole('link', { name: 'Open case discussion' }).click();
  await expect(doctorBPage.getByRole('heading', { name: 'Shared consultation summary' })).toBeVisible();
  await expect(doctorBPage.getByText('Patient identity, longitudinal records')).toBeVisible();
  await doctorBPage.screenshot({ path: testInfo.outputPath('provider-collaboration-active-case.png'), fullPage: true });

  const clinicianReply = 'Synthetic provider-only response for Firefox acceptance.';
  const replyInput = doctorBPage.getByLabel('Reply to the collaborating clinician');
  await replyInput.fill(clinicianReply);
  await doctorBPage.getByRole('button', { name: 'Send message' }).click();
  await expect(doctorBPage.locator('ol li').getByText(clinicianReply, { exact: true })).toBeVisible();
  await expect(replyInput).toHaveValue('');
  await doctorBPage.reload();
  await expect(doctorBPage.locator('ol li').getByText(clinicianReply, { exact: true })).toBeVisible();

  const doctorEPage = await browser.newPage();
  await login(doctorEPage, doctorE);
  const outsiderCase = await getBff(doctorEPage, `/bff/network/collaborations/${request!.id}/case`);
  const outsiderMessages = await getBff(doctorEPage, `/bff/network/collaborations/${request!.id}/messages?limit=25`);
  expect(outsiderCase.status).toBe(403);
  expect(outsiderMessages.status).toBe(403);
  await doctorEPage.close();

  await page.reload();
  await page.getByRole('link', { name: 'Open case discussion' }).click();
  await expect(page.locator('ol li').getByText(clinicianReply, { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('provider-collaboration-message-readback.png'), fullPage: true });
  await page.getByRole('button', { name: 'Revoke access' }).click();
  await expect(page).toHaveURL(/\/doctor\/clinical-collaboration$/);

  const denied = await getBff(doctorBPage, `/bff/network/collaborations/${request!.id}/case`);
  expect(denied.status).toBe(403);
  await doctorBPage.close();
});
