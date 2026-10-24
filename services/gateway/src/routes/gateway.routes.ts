import { Router,type Request,type Response,type NextFunction } from 'express';
import { unauthenticated,AppError } from '@a-health/http';
import { env } from '../config/env.js';
import { bridgeSignatureValid } from '../services/ussd-security.js';
import * as c from '../controllers/gateway.controller.js';
const guard=(req:Request,_res:Response,next:NextFunction)=>{
 const raw=(req as Request&{rawBody?:Buffer}).rawBody;
 if(!raw||!bridgeSignatureValid(raw,req.header('X-Gateway-Timestamp'),req.header('X-Gateway-Signature'),env.GATEWAY_SHARED_SECRET))return next(unauthenticated('UNAUTHENTICATED','Gateway signature or timestamp is invalid.'));
 next();
};
export const gatewayRouter=Router();
gatewayRouter.post('/gateway/ussd/session',guard,c.ussdSession);
gatewayRouter.post('/gateway/sms/inbound',guard,(req,res,next)=>{
 if(env.GATEWAY_INBOUND_SMS_ENABLED!=='true')return next(new AppError('SERVICE_UNAVAILABLE',503,'Inbound SMS clinical replies are not enabled.'));
 return c.smsInbound(req,res,next);
});
