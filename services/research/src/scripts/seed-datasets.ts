import { prisma } from '@a-health/database';
import { seedDatasets } from '../services/seedDatasets.js';

const result = await seedDatasets();
console.log(JSON.stringify(result));
await prisma.$disconnect();
