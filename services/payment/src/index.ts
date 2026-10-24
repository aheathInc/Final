import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { paymentRouter } from './routes/payment.routes.js';
import { startPaymentReconciliation } from './workers/reconcile.worker.js';
const timer=startPaymentReconciliation();
const service=createService({name:'payment',port:env.PORT,routers:[paymentRouter],development:env.NODE_ENV==='development',
 jsonVerify(req,_res,buf){(req as {rawBody?:Buffer}).rawBody=Buffer.from(buf);},
 async onShutdown(){if(timer)clearInterval(timer);},
});
service.start();
