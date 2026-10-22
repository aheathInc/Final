// Standalone entry point, for running the sweep from cron instead of in-process:
//   0 * * * * cd /srv/a-health && pnpm --filter @a-health/auth exec tsx src/scripts/cleanup.ts
import { prisma } from '@a-health/database';
import { sweepExpired } from '../services/maintenance.service.js';

const result = await sweepExpired();
console.log(JSON.stringify(result));
await prisma.$disconnect();
