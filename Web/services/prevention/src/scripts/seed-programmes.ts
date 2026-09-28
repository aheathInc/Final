import { prisma } from '@a-health/database';
import { seedProgrammes } from '../services/seedProgrammes.js';

const result = await seedProgrammes();
console.log(JSON.stringify(result));
await prisma.$disconnect();
