import { expect, test, type Page } from '@playwright/test';

const doctorA = {
  email: process.env.E2E_DIGITAL_REFERRAL_DOCTOR_A_EMAIL,
  password: process.env.E2E_DIGITAL_REFERRAL_DOCTOR_A_PASSWORD,
};
const doctorB = {
  email: process.env.E2E_DIGITAL_REFERRAL_DOCTOR_B_EMAIL,
  password: process.env.E2E_DIGITAL_REFERRAL_DOCTOR_B_PASSWORD,
};
const doctorC = {
  email: process.env.E2E_DIGITAL_REFERRAL_DOCTOR_C_EMAIL,
  password: process.env.E2E_DIGITAL_REFERRAL_DOCTOR_C_PASSWORD,
};
const consultationId = process.env.E2E_DIGITAL_REFERRAL_CONSULTATION_ID;

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

test('real Firefox referral submission, receiving workflow, feedback and facility isolation', async ({ page, browser }, testInfo) => {
  let database: URL;
  try { database = new URL(process.env.DATABASE_URL ?? ''); } catch {
    throw new Error('Firefox referral acceptance requires a local ahealth_test database.');
  }
  expect(decodeURIComponent(database.pathname.replace(/^\//, ''))).toBe('ahealth_test');
  expect(['localhost', '127.0.0.1', '::1']).toContain(database.hostname);
  expect(database.port || '5432').not.toBe('5432');

  test.skip(
    !doctorA.email || !doctorA.password || !doctorB.email || !doctorB.password ||
      !doctorC.email || !doctorC.password || !consultationId,
    'Requires the synthetic digital-referral fixture and three real clinician logins.',
  );

  const purpose = `Synthetic referral acceptance ${new Date().toISOString()}`;
  const summary = 'Synthetic minimum necessary referral summary for acceptance only.';
  const followUp = 'Synthetic follow-up recommendation for local testing only.';
  const instructions = 'Synthetic patient instruction for local testing only.';

  await login(page, doctorA);
  await page.goto('/doctor/referrals');
  await expect(page.getByRole('heading', { name: 'Digital referrals' })).toBeVisible();
  await page.getByLabel('Case').selectOption(consultationId!);
  const destination = page.getByLabel('Patient-authorized destination facility');
  await expect(destination.locator('option')).toHaveCount(2);
  await destination.selectOption({ index: 1 });
  const department = page.getByLabel('Destination department (optional)');
  await expect(department).toBeVisible();
  await department.selectOption({ index: 1 });
  await page.getByLabel('Referral purpose').fill(purpose);
  await page.getByLabel(/Minimum necessary summary/).fill(summary);
  await page.getByRole('button', { name: 'Confirm and submit referral' }).click();
  await expect(page.getByRole('status')).toContainText('was submitted');

  const sourceRows = await getBff<{ data: Array<{ id: string; status: string; purpose: string }> }>(page, '/bff/referrals/source');
  expect(sourceRows.status).toBe(200);
  const referral = sourceRows.body.data.find((item) => item.purpose === purpose);
  expect(referral?.status).toBe('submitted');
  await page.screenshot({ path: testInfo.outputPath('digital-referral-source-submitted.png'), fullPage: true });

  const destinationPage = await browser.newPage();
  await login(destinationPage, doctorB);
  await destinationPage.goto('/doctor/referrals');
  const incoming = destinationPage.locator('article').filter({ hasText: purpose }).first();
  await expect(incoming).toBeVisible();
  await expect(incoming).toContainText(summary);
  await incoming.getByRole('button', { name: 'Acknowledge receipt' }).click();
  await expect(destinationPage.locator('article').filter({ hasText: purpose }).first()).toContainText('Received');
  const received = destinationPage.locator('article').filter({ hasText: purpose }).first();
  await received.getByRole('button', { name: 'Accept referral' }).click();
  await expect(destinationPage.locator('article').filter({ hasText: purpose }).first()).toContainText('care has not started');
  const accepted = destinationPage.locator('article').filter({ hasText: purpose }).first();
  await destinationPage.screenshot({ path: testInfo.outputPath('digital-referral-destination-accepted.png'), fullPage: true });
  await accepted.getByRole('button', { name: 'Mark care started' }).click();
  await expect(destinationPage.locator('article').filter({ hasText: purpose }).first()).toContainText('Care started');
  const inCare = destinationPage.locator('article').filter({ hasText: purpose }).first();
  await inCare.getByLabel('Follow-up recommendation (optional)').fill(followUp);
  await inCare.getByLabel('Patient instructions (optional)').fill(instructions);
  await inCare.getByRole('button', { name: 'Complete and send feedback' }).click();
  await expect(destinationPage.getByRole('status')).toContainText('complete recorded');
  const completed = await getBff<{ status: string; outcome: { follow_up_recommendation: string } }>(
    destinationPage, `/bff/referrals/${referral!.id}`,
  );
  expect(completed.status).toBe(200);
  expect(completed.body.status).toBe('completed');
  expect(completed.body.outcome.follow_up_recommendation).toBe(followUp);

  const outsiderPage = await browser.newPage();
  await login(outsiderPage, doctorC);
  const outsiderRead = await getBff(outsiderPage, `/bff/referrals/${referral!.id}`);
  expect(outsiderRead.status).toBe(403);
  await outsiderPage.close();

  await page.reload();
  const sourceCompleted = page.locator('article').filter({ hasText: purpose }).first();
  await expect(sourceCompleted).toContainText('Completed');
  await expect(sourceCompleted).toContainText(followUp);
  await expect(sourceCompleted).toContainText(instructions);
  await page.screenshot({ path: testInfo.outputPath('digital-referral-source-feedback.png'), fullPage: true });
  await destinationPage.close();
});
