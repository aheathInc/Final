import { Router, type Request, type Response, type NextFunction } from 'express';
import { createAuthGuards, createTokenService } from '@a-health/http';
import { env } from '../config/env.js';
import { ResearchPortal } from './service.js';
import { portalConfig } from './config.js';
import { researchStore } from './prisma-store.js';
import { scanEvidence } from './scanner.js';
import { object, PortalError, check } from './policy.js';
import { warehouseConfig } from '../warehouse/config.js';
import { PostgresWarehouse } from '../warehouse/postgres.js';

export const warehouseSettings=warehouseConfig();
export const warehouse=warehouseSettings.enabled?new PostgresWarehouse(warehouseSettings):undefined;
export const portal = new ResearchPortal(researchStore,portalConfig(),scanEvidence,()=>new Date(),warehouse);
export const researchPortalRouter=Router();
const {requireAuth}=createAuthGuards(createTokenService({secret:env.JWT_SECRET,issuer:env.JWT_ISSUER,audience:env.JWT_AUDIENCE,ttlSeconds:env.ACCESS_TOKEN_TTL_SECONDS}));
researchPortalRouter.use('/research/portal',requireAuth,(_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
function error(err:unknown,res:Response,next:NextFunction){if(err instanceof PortalError){res.status(err.status).json({error:{code:err.code,message:err.message}});}else next(err);}
function action(name:string,includeId=false){return (req:Request,res:Response,next:NextFunction)=>{
  void(async()=>{
    const input=req.method==='GET'?{}:object(req.body??{});
    if(includeId){check(!Object.hasOwn(input,'id'),422,'INVALID_INPUT','Resource id belongs in the URL.');input.id=req.params.id;}
    const result=await portal.run({sub:req.auth!.sub,role:req.auth!.role},name,input);
    res.json({data:result});
  })().catch(e=>error(e,res,next));
};}
const r=researchPortalRouter,base='/research/portal';
r.get(base+'/bootstrap',action('bootstrap'));
r.get(base+'/extended',action('extended.bootstrap'));
r.post(base+'/warehouse/batches',action('warehouse.ingest'));
r.post(base+'/warehouse/batches/:id/revoke',action('warehouse.batch.revoke',true));
r.post(base+'/warehouse/builds',action('warehouse.build'));
r.get(base+'/warehouse/builds/:id/inspect',action('warehouse.inspect',true));
r.post(base+'/warehouse/builds/:id/review',action('warehouse.review',true));
r.post(base+'/responses/register',action('ecrf.responses'));
r.post(base+'/responses/:id/withdraw',action('ecrf.withdraw',true));
r.post(base+'/response-snapshots',action('ecrf.prepare'));
r.get(base+'/response-snapshots/:id/inspect',action('ecrf.inspect',true));
r.post(base+'/response-snapshots/:id/review',action('ecrf.review',true));
r.get(base+'/response-snapshots/:id/analytics',action('ecrf.analytics',true));
r.post(base+'/outputs',action('output.request'));
r.get(base+'/outputs/:id/inspect',action('output.inspect',true));
r.post(base+'/outputs/:id/review',action('output.review',true));
r.get(base+'/outputs/:id/download',action('output.download',true));
r.put(base+'/profile',action('profile.submit'));
r.post(base+'/profiles/:id/review',action('profile.review',true));
r.post(base+'/evidence',action('evidence.upload'));
r.get(base+'/evidence/:id/download',action('evidence.download',true));
r.post(base+'/studies',action('study.create'));
r.post(base+'/studies/:id/submit',action('study.submit',true));
r.post(base+'/studies/:id/review',action('study.review',true));
r.post(base+'/collections',action('collection.create'));
r.post(base+'/collections/:id/suspend',action('collection.suspend',true));
r.post(base+'/sources',action('source.create'));
r.post(base+'/sources/:id/review',action('source.review',true));
r.post(base+'/mappings',action('mapping.create'));
r.post(base+'/ingest',action('ingest'));
r.post(base+'/releases',action('release.prepare'));
r.get(base+'/releases/:id/inspect',action('release.inspect',true));
r.post(base+'/releases/:id/review',action('release.review',true));
r.post(base+'/query',action('query'));
r.post(base+'/exports',action('export.request'));
r.get(base+'/exports/:id/inspect',action('export.inspect',true));
r.post(base+'/exports/:id/review',action('export.review',true));
r.get(base+'/exports/:id/download',action('export.download',true));
r.post(base+'/forms',action('form.create'));
r.post(base+'/forms/:id/review',action('form.review',true));
r.post(base+'/responses',action('form.respond'));
r.post(base+'/keys',action('key.create'));r.get(base+'/keys',action('key.list'));
r.post(base+'/keys/:id/revoke',action('key.revoke',true));
// Project-scoped key API is separate from normal session/JWT endpoints.
r.get('/research/projects/:id/aggregates',(req,res,next)=>{
  void(async()=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const token=req.header('Authorization')?.match(/^ResearchKey (ahr_[a-f0-9]{64})$/)?.[1]??'';
    const format=req.query.format??'json';check(format==='json'||format==='xml',422,'INVALID_FORMAT','Use json or xml.');
    check(Object.keys(req.query).every(k=>k==='format'),422,'INVALID_QUERY','Arbitrary query parameters are not supported.');
    const result=await portal.api(token,String(req.params.id),format);
    res.type(result.content_type).send(Buffer.from(result.content_base64,'base64'));
  })().catch(e=>error(e,res,next));
});
