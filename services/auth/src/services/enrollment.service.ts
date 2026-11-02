import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma, type Prisma } from '@a-health/database';
import { enrollmentHash, findEnrollment } from '@a-health/database/enrollment';
import { AppError, forbidden, unauthenticated, conflict } from '../utils/errors.js';
import { env } from '../config/env.js';
import { issueSession, type RequestMeta } from './auth.service.js';
import { appendAudit } from './audit.service.js';
import { recordChange } from './changelog.service.js';
import { phoneNumber } from '../types/auth.types.js';

export const REGISTRATION_FEE = 4000;
export const REGISTRATION_CONSENT = 'patient-registration-2026-10-v1';
const dummyPasswordHash = bcrypt.hash(randomBytes(32).toString('hex'),12);
export const registrationProfileSchema = z.object({
  full_name: z.string().trim().min(3).max(150),
  date_of_birth: z.iso.date().refine(value => {
    const date = new Date(value); const now = new Date();
    return date <= now && date >= new Date(now.getUTCFullYear() - 120, now.getUTCMonth(), now.getUTCDate());
  }, 'Enter a valid date of birth within the last 120 years.'),
  sex: z.enum(['female', 'male', 'other']),
  residence: z.string().trim().min(3).max(250),
  next_of_kin_name: z.string().trim().min(3).max(150),
  next_of_kin_phone: phoneNumber,
  consent_version: z.literal(REGISTRATION_CONSENT),
}).strict();

export async function startEnrollment(tx: Prisma.TransactionClient, userId: string) {
  const token = `enr_${randomBytes(32).toString('base64url')}`;
  await tx.patientEnrollment.upsert({where:{userId},
    create:{userId,tokenHash:enrollmentHash(token),expiresAt:new Date(Date.now()+86400_000)},
    update:{tokenHash:enrollmentHash(token),expiresAt:new Date(Date.now()+86400_000)}});
  const saved=await tx.patientEnrollment.findUniqueOrThrow({where:{userId}});
  if(saved.billId) await tx.careBill.updateMany({where:{id:saved.billId,status:'due',expiresAt:{lte:new Date()}},data:{expiresAt:new Date(Date.now()+30*86400_000)}});
  return {registration_required:true as const,registration_token:token,registration:await registrationStatus(token,tx)};
}

export async function requireEnrollment(token: string, tx: Prisma.TransactionClient = prisma) {
  const record = await findEnrollment(token,tx);
  if (!record) throw unauthenticated('REGISTRATION_SESSION_EXPIRED','Registration session expired. Verify your phone again to continue; confirmed payments are kept.');
  return record;
}

export async function registrationStatus(token: string, tx: Prisma.TransactionClient = prisma) {
  const r = await requireEnrollment(token,tx);
  const p = r.user.patientProfile;
  const intent = r.billId ? await tx.paymentIntent.findFirst({where:{billId:r.billId},orderBy:{createdAt:'desc'}}) : null;
  return {step:!r.profileCompletedAt?'profile':r.bill?.status==='paid'?'security':'payment',
    phone_number:r.user.phoneNumber,fee:{amount:REGISTRATION_FEE,currency:'TZS',one_time:true},
    consent_version:REGISTRATION_CONSENT,expires_at:r.expiresAt.toISOString(),
    profile:r.profileCompletedAt && p ? {full_name:p.fullName,date_of_birth:p.dateOfBirth?.toISOString().slice(0,10),sex:p.sex,residence:p.residence,next_of_kin_name:p.nextOfKinName,next_of_kin_phone:p.nextOfKinPhone}:null,
    bill:r.bill?{id:r.bill.id,reference:r.bill.reference,status:r.bill.status,amount:Number(r.bill.amount),currency:r.bill.currency,paid_at:r.bill.paidAt?.toISOString()??null}:null,
    payment:intent?{id:intent.id,status:intent.status,environment:intent.environment,client_action:intent.clientAction}:null};
}

export async function saveRegistrationProfile(token: string, raw: unknown) {
  const input = registrationProfileSchema.parse(raw);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT user_id FROM patient_enrollments WHERE token_hash=${enrollmentHash(token)} FOR UPDATE`;
    const r = await requireEnrollment(token,tx);
    if (input.next_of_kin_phone === r.user.phoneNumber) throw new AppError('VALIDATION_FAILED',422,'Use a different phone number for your next of kin.');
    if (r.bill && r.bill.status !== 'due' && r.bill.status !== 'paid') throw conflict('STATE_TRANSITION_INVALID','Contact support about this registration bill.');
    const profile = await tx.patientProfile.update({where:{userId:r.userId},data:{
      fullName:input.full_name,dateOfBirth:new Date(input.date_of_birth),sex:input.sex,residence:input.residence,
      nextOfKinName:input.next_of_kin_name,nextOfKinPhone:input.next_of_kin_phone,emergencyContact:input.next_of_kin_phone,version:{increment:1}}});
    await tx.user.update({where:{id:r.userId},data:{fullName:input.full_name,version:{increment:1}}});
    let billId = r.billId;
    if (!billId) {
      const bill=await tx.careBill.create({data:{reference:`REG-${randomUUID().replace(/-/g,'').slice(0,24).toUpperCase()}`,
        payerUserId:r.userId,issuedById:r.userId,patientProfileId:profile.id,title:'Ada ya usajili wa A-Health',
        amount:REGISTRATION_FEE,currency:'TZS',purpose:'registration_fee',expiresAt:new Date(Date.now()+30*86400_000)}});
      billId=bill.id;
      await appendAudit({actorUserId:r.userId,action:'registration.bill_issued',entityType:'care_bills',entityId:bill.id,metadata:{issuer:'system',amount:REGISTRATION_FEE,currency:'TZS'}},tx);
    }
    await tx.patientEnrollment.update({where:{userId:r.userId},data:{billId,profileCompletedAt:new Date(),consentVersion:REGISTRATION_CONSENT}});
    await recordChange(tx,{entity:'patient_profiles',entityId:profile.id,op:'update',version:profile.version,patientProfileId:profile.id});
    return registrationStatus(token,tx);
  });
}

export async function completeRegistration(token: string, password: string, deviceId: string | undefined, meta: RequestMeta) {
  if (password.length < env.PASSWORD_MIN_LENGTH || Buffer.byteLength(password,'utf8') > 72)
    throw new AppError('PASSWORD_TOO_WEAK',422,`Use at least ${env.PASSWORD_MIN_LENGTH} characters and at most 72 UTF-8 bytes.`);
  const hash = await bcrypt.hash(password,12);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT user_id FROM patient_enrollments WHERE token_hash=${enrollmentHash(token)} FOR UPDATE`;
    const r = await requireEnrollment(token,tx);
    if (password.includes(r.user.phoneNumber.slice(-6))) throw new AppError('PASSWORD_TOO_WEAK',422,'Do not include your phone number in the password.');
    const payment = r.billId ? await tx.payment.findFirst({where:{payerUserId:r.userId,purpose:'registration_fee',status:'succeeded',refundedAmount:0,
      amount:REGISTRATION_FEE,currency:'TZS',paymentIntentId:{in:(await tx.paymentIntent.findMany({where:{billId:r.billId,status:'succeeded'},select:{id:true}})).map(i=>i.id)},
      ...(env.NODE_ENV==='production'?{environment:'live',processor:'flutterwave'}:{})}}) : null;
    if (!r.profileCompletedAt || r.consentVersion!==REGISTRATION_CONSENT || r.bill?.status!=='paid' || !payment)
      throw forbidden('REGISTRATION_INCOMPLETE','Complete your profile and wait for verified registration payment before setting a password.');
    const user=await tx.user.update({where:{id:r.userId},data:{passwordHash:hash,status:'active',onboardingRequired:false,failedLoginCount:0,lockedUntil:null,version:{increment:1}},include:{patientProfile:true}});
    await tx.patientEnrollment.update({where:{userId:r.userId},data:{completedAt:new Date()}});
    await tx.refreshToken.updateMany({where:{userId:r.userId,revokedAt:null},data:{revokedAt:new Date()}});
    await appendAudit({actorUserId:r.userId,action:'patient.registration_completed',entityType:'users',entityId:r.userId,ipAddress:meta.ip,requestId:meta.requestId,metadata:{billId:r.billId,consentVersion:REGISTRATION_CONSENT}},tx);
    return {...await issueSession(user,deviceId,undefined,'password',tx),user:{id:user.id,full_name:user.fullName,phone_number:user.phoneNumber,role:user.role,status:user.status,patient_profile:{id:user.patientProfile!.id,full_name:user.fullName}}};
  },{timeout:15_000});
}

export async function patientPasswordLogin(phone: string, password: string, deviceId: string | undefined, meta: RequestMeta) {
  const result=await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM users WHERE phone_number=${phone} FOR UPDATE`;
    const user=await tx.user.findUnique({where:{phoneNumber:phone},include:{patientProfile:true}});
    const invalid=()=>unauthenticated('UNAUTHENTICATED','Phone number or password is incorrect.');
    if(!user||user.role!=='patient'||!user.passwordHash) {
      await bcrypt.compare(password,await dummyPasswordHash);
      return {error:invalid()};
    }
    if(user.lockedUntil&&user.lockedUntil>new Date()) return {error:new AppError('ACCOUNT_LOCKED',423,'Too many attempts. Try again later or use OTP.')};
    if(!await bcrypt.compare(password,user.passwordHash)) {
      const exhausted=user.failedLoginCount+1>=env.LOGIN_MAX_ATTEMPTS;
      await tx.user.update({where:{id:user.id},data:{failedLoginCount:exhausted?0:{increment:1},...(exhausted?{lockedUntil:new Date(Date.now()+env.LOGIN_LOCKOUT_MINUTES*60000)}:{})}});
      return {error:invalid()};
    }
    if(user.status!=='active'||user.onboardingRequired) return {error:forbidden('REGISTRATION_REQUIRED','Complete registration or contact support.')};
    await tx.user.update({where:{id:user.id},data:{failedLoginCount:0,lockedUntil:null}});
    await appendAudit({actorUserId:user.id,action:'auth.patient_password_login',entityType:'users',entityId:user.id,ipAddress:meta.ip,requestId:meta.requestId},tx);
    return {session:{...await issueSession(user,deviceId,undefined,'password',tx),user:{id:user.id,full_name:user.fullName,phone_number:user.phoneNumber,role:user.role,status:user.status,patient_profile:{id:user.patientProfile?.id,full_name:user.fullName}}}};
  },{timeout:15_000});
  if(result.error)throw result.error;
  return result.session!;
}
