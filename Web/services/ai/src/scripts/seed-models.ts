import { prisma } from '@a-health/database';
import { seedModelRegistry } from '../services/registry.js';

const result = await seedModelRegistry();
console.log(JSON.stringify(result));
await prisma.$disconnect();
