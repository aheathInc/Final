import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { researchRouter } from './routes/research.routes.js';
import { researchPortalRouter, portal, warehouse, warehouseSettings } from './portal/routes.js';
import { seedDatasets } from './services/seedDatasets.js';

let warehouseRunning:Promise<unknown>|null=null;
const warehouseTimer=warehouseSettings.workerEnabled?setInterval(()=>{
  if(warehouseRunning)return;
  warehouseRunning=portal.processWarehouseJob().catch(()=>{console.error('[research] OMOP worker failed; inspect protected job metadata.');}).finally(()=>{warehouseRunning=null;});
},5000):undefined;
warehouseTimer?.unref();
const service = createService({
  name: 'research',
  port: env.PORT,
  routers: [researchPortalRouter, researchRouter],
  development: env.NODE_ENV === 'development',
  ...(warehouse?{healthChecks:{warehouse:async()=> (await warehouse!.status()).ready}}:{}),
  onShutdown:async()=>{if(warehouseTimer)clearInterval(warehouseTimer);await warehouseRunning;await warehouse?.close();},
});

await seedDatasets();
service.start();
