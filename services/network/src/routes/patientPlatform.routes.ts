import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { createAuthGuards, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import { platformAction } from '../services/patientPlatform.service.js';
const {requireAuth}=createAuthGuards(createTokenService({secret:env.JWT_SECRET,issuer:env.JWT_ISSUER,audience:env.JWT_AUDIENCE,ttlSeconds:env.ACCESS_TOKEN_TTL_SECONDS}));
export const patientPlatformRouter=Router();
const id=z.string().uuid();
const body=z.string().trim().min(1).max(4000);
const page=z.object({cursor:id.optional()});
const route=(method:'get'|'post',path:string,op:string,schema=z.object({}) as z.ZodType)=> {
  patientPlatformRouter[method](`/patient-platform${path}`,requireAuth,async(req:Request,res:Response,next:NextFunction)=>{
    try {
      const params=req.params.id?{id:id.parse(req.params.id)}:{};
      res.json(await platformAction({sub:req.auth!.sub,role:req.auth!.role},op,{...schema.parse(method==='get'?req.query:req.body) as object,...params}));
    } catch(e){next(e);}
  });
};
route('get','/profile','profile');
route('get','/notifications','notifications');
route('get','/reports','reports');
route('post','/consent','consent',z.object({alias:z.string().trim().min(2).max(60),consent:z.boolean(),consent_version:z.string().optional(),peer_enabled:z.boolean().default(false)}));
route('get','/spaces','spaces');
route('post','/spaces/:id/membership','membership',z.object({join:z.boolean()}));
route('get','/spaces/:id/posts','posts',page);
route('post','/spaces/:id/posts','post',z.object({body,parent_id:id.optional()}));
route('get','/peers','peers');
route('post','/posts/:id/invite','invite');
route('post','/peers/:id/decision','peerDecision',z.object({accept:z.boolean()}));
route('get','/peers/:id/messages','messages',page);
route('post','/peers/:id/messages','message',z.object({body,request_key:id}));
route('post','/peers/:id/block','block');
route('post','/reports/:id','report',z.object({kind:z.enum(['post','message']),reason:body,urgent:z.boolean().default(false),share_with_moderators:z.literal(true)}));
route('get','/feedback','feedback');
route('post','/feedback','feedbackCreate',z.object({kind:z.enum(['complaint','suggestion']),subject:z.string().trim().min(3).max(150),body,urgent:z.boolean().default(false)}));
route('post','/feedback/:id/escalate','feedbackEscalate');
route('get','/admin/queue','admin.queue');
route('post','/admin/spaces','admin.space',z.object({name:z.string().trim().min(3).max(120),description:body}));
route('post','/admin/posts/:id','admin.moderate',z.object({status:z.enum(['approved','rejected','hidden']),reason:z.string().trim().min(3).max(1000)}));
route('post','/admin/reports/:id','admin.resolveReport',z.object({resolution:z.string().trim().min(3).max(1000),hide:z.boolean().default(false),suspend:z.boolean().default(false)}));
route('post','/admin/feedback/:id','admin.feedbackUpdate',z.object({status:z.enum(['in_review','escalated','resolved']),note:z.string().trim().min(3).max(1000)}));
