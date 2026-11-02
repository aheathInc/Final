import { Router, type Request } from 'express';
import { z } from 'zod';
import { phoneNumber } from '../types/auth.types.js';
import * as enrollment from '../services/enrollment.service.js';
import { searchResidence } from '../services/residence-search.service.js';
export const enrollmentRouter=Router();
const token=(req:Request)=>req.header('Authorization')?.replace(/^Bearer /,'')??'';
enrollmentRouter.use('/auth/registration',(_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
enrollmentRouter.get('/auth/registration',async(req,res,next)=>{try{res.json(await enrollment.registrationStatus(token(req)));}catch(e){next(e);}});
enrollmentRouter.post('/auth/registration/locations',async(req,res,next)=>{try{
  const record=await enrollment.requireEnrollment(token(req));
  res.json(await searchResidence(req.body,record.userId));
}catch(e){next(e);}});
enrollmentRouter.put('/auth/registration/profile',async(req,res,next)=>{try{res.json(await enrollment.saveRegistrationProfile(token(req),req.body));}catch(e){next(e);}});
enrollmentRouter.post('/auth/registration/complete',async(req,res,next)=>{try{
  const input=z.object({password:z.string().min(1).max(200),device_id:z.string().max(128).optional()}).strict().parse(req.body);
  res.json(await enrollment.completeRegistration(token(req),input.password,input.device_id,{ip:req.ip,requestId:res.locals.requestId}));
}catch(e){next(e);}});
enrollmentRouter.post('/auth/patient/login',async(req,res,next)=>{try{
  const input=z.object({phone_number:phoneNumber,password:z.string().min(1).max(200),device_id:z.string().max(128).optional()}).parse(req.body);
  res.setHeader('Cache-Control','no-store');
  res.json(await enrollment.patientPasswordLogin(input.phone_number,input.password,input.device_id,{ip:req.ip,requestId:res.locals.requestId}));
}catch(e){next(e);}});
