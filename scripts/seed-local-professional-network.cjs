// Create a usable local group catalogue without enrolling users or posting messages.
const path = require('node:path');
const { createRequire } = require('node:module');
const url = new URL(process.env.DATABASE_URL);
if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/ahealth_dev' ||
    (url.searchParams.get('schema') && url.searchParams.get('schema') !== 'public')) {
  throw new Error('This seed is restricted to the local AHP development database.');
}
const { PrismaClient } = createRequire(path.resolve(__dirname, '../packages/database/package.json'))('@prisma/client');
const db = new PrismaClient();
(async () => {
  if (await db.community.count({ where: { isActive: true } })) {
    console.log('Active professional groups already exist; catalogue unchanged.');
    return;
  }
  const name = 'AHP Clinical Forum';
  const existing = await db.community.findUnique({ where: { name } });
  if (existing) throw new Error('The starter group was deactivated; review its status before creating another.');
  await db.community.upsert({ where: { name }, update: {}, create: {
    name, specialty: 'general_practice',
    description: 'Clinical questions and professional discussion across specialties. Keep patient identifiers out of this group.',
  }});
  console.log('Created AHP Clinical Forum. Verified clinicians may join voluntarily.');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
