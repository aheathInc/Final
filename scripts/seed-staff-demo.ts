import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { prisma } from '../packages/database/src/client.js';

dotenv.config({ path: '.env' });
dotenv.config({ path: 'services/auth/.env', override: false });
dotenv.config({ path: 'services/payment/.env', override: false });
dotenv.config({ path: 'services/notification/.env', override: false });

const NS = 'AHP_STAFF_DEMO_V1';
const CONFIRM = 'write-local-ahealth_dev';
const SPECIALIST_EMAIL = 'ahp.staff.demo.specialist@dev.local';
const UNRELATED_EMAIL = 'ahp.staff.demo.unrelated@dev.local';
const SPECIALIST_PASSWORD = process.env.AHP_STAFF_DEMO_PASSWORD?.trim();

const ids = {
  facility: '11111111-1111-4111-8111-111111111111',
  pharmacy: '11111111-1111-4111-8111-111111111112',
  specialistUser: '11111111-1111-4111-8111-111111111113',
  specialistClinician: '11111111-1111-4111-8111-111111111114',
  unrelatedUser: '11111111-1111-4111-8111-111111111158',
  unrelatedClinician: '11111111-1111-4111-8111-111111111159',
  pendingUser: '11111111-1111-4111-8111-111111111115',
  pendingClinician: '11111111-1111-4111-8111-111111111116',
  patientUserA: '11111111-1111-4111-8111-111111111117',
  patientA: '11111111-1111-4111-8111-111111111118',
  patientUserB: '11111111-1111-4111-8111-111111111119',
  patientB: '11111111-1111-4111-8111-111111111120',
  threadOffered: '11111111-1111-4111-8111-111111111121',
  consultationOffered: '11111111-1111-4111-8111-111111111122',
  offer: '11111111-1111-4111-8111-111111111123',
  threadActive: '11111111-1111-4111-8111-111111111124',
  consultationActive: '11111111-1111-4111-8111-111111111125',
  messagePatient: '11111111-1111-4111-8111-111111111126',
  messageClinician: '11111111-1111-4111-8111-111111111127',
  slot: '11111111-1111-4111-8111-111111111128',
  appointment: '11111111-1111-4111-8111-111111111129',
  order: '11111111-1111-4111-8111-111111111130',
  orderValue: '11111111-1111-4111-8111-111111111131',
  prescription: '11111111-1111-4111-8111-111111111132',
  prescriptionItem: '11111111-1111-4111-8111-111111111133',
  adherenceMissed: '11111111-1111-4111-8111-111111111134',
  adherenceTaken: '11111111-1111-4111-8111-111111111135',
  family: '11111111-1111-4111-8111-111111111136',
  familyMemberA: '11111111-1111-4111-8111-111111111137',
  familyMemberB: '11111111-1111-4111-8111-111111111138',
  familyAssignment: '11111111-1111-4111-8111-111111111139',
  community: '11111111-1111-4111-8111-111111111140',
  membershipMain: '11111111-1111-4111-8111-111111111141',
  membershipSpecialist: '11111111-1111-4111-8111-111111111142',
  discussion: '11111111-1111-4111-8111-111111111143',
  discussionReply: '11111111-1111-4111-8111-111111111144',
  opinion: '11111111-1111-4111-8111-111111111145',
  emergency: '11111111-1111-4111-8111-111111111146',
  emergencyEvent: '11111111-1111-4111-8111-111111111147',
  transport: '11111111-1111-4111-8111-111111111148',
  device: '11111111-1111-4111-8111-111111111149',
  incident: '11111111-1111-4111-8111-111111111150',
  paymentIntent: '11111111-1111-4111-8111-111111111151',
  payment: '11111111-1111-4111-8111-111111111152',
  dataset: '11111111-1111-4111-8111-111111111153',
  researchQuery: '11111111-1111-4111-8111-111111111154',
  rollupA: '11111111-1111-4111-8111-111111111155',
  rollupB: '11111111-1111-4111-8111-111111111156',
  stock: '11111111-1111-4111-8111-111111111157',
};

function assertSafeTarget() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required.');
  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\//, '');
  const host = parsed.hostname;
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed with NODE_ENV=production.');
  if (dbName !== 'ahealth_dev') throw new Error(`Refusing to seed database "${dbName}". Expected ahealth_dev.`);
  if (!['localhost', '127.0.0.1', 'ahealth-pg'].includes(host)) {
    throw new Error(`Refusing non-local database host "${host}".`);
  }
  if (process.env.AHP_STAFF_DEMO_CONFIRM !== CONFIRM) {
    throw new Error(`Set AHP_STAFF_DEMO_CONFIRM=${CONFIRM} to write local demo records.`);
  }
  if ((process.env.MOBILE_MONEY_PROVIDER ?? 'console') !== 'console') {
    throw new Error('Refusing to seed payment demo unless MOBILE_MONEY_PROVIDER=console.');
  }
  if ((process.env.SMS_PROVIDER ?? 'console') !== 'console') {
    throw new Error('Refusing to seed notification demo unless SMS_PROVIDER=console.');
  }
}

async function mainClinician() {
  const clinician = await prisma.clinicianProfile.findFirst({
    where: { user: { email: 'daktari@dev.local' }, verificationStatus: 'verified' },
    include: { user: true },
  });
  if (!clinician) throw new Error('Verified clinician daktari@dev.local is required.');
  return clinician;
}

async function adminUserId() {
  const admin = await prisma.user.findUnique({ where: { email: 'msimamizi@dev.local' } });
  if (!admin || admin.role !== 'platform_admin') throw new Error('Platform admin msimamizi@dev.local is required.');
  return admin.id;
}

async function seed() {
  assertSafeTarget();
  if (!SPECIALIST_PASSWORD) throw new Error('Set AHP_STAFF_DEMO_PASSWORD in Web/.env before seeding.');
  const [clinician, adminId] = await Promise.all([mainClinician(), adminUserId()]);
  if (!clinician.user.passwordHash) throw new Error('The dev clinician must have a password hash.');
  const now = new Date();
  const minutes = (n: number) => new Date(now.getTime() + n * 60_000);
  const days = (n: number) => new Date(now.getTime() + n * 86_400_000);

  await prisma.facility.upsert({
    where: { id: ids.facility },
    update: {},
    create: {
      id: ids.facility,
      name: `${NS} - Kinondoni Staff Demo Clinic`,
      type: 'clinic',
      lat: -6.775,
      lng: 39.24,
      regionCode: 'DAR',
      contactPhone: '+255700000901',
      integrationLevel: 'partial',
    },
  });

  await prisma.user.upsert({
    where: { id: ids.specialistUser },
    update: {},
    create: {
      id: ids.specialistUser,
      phoneNumber: '+255700000902',
      email: SPECIALIST_EMAIL,
      passwordHash: clinician.user.passwordHash,
      role: 'clinician',
      status: 'active',
      fullName: `${NS} Specialist Clinician`,
      preferredLanguage: 'en',
    },
  });
  await prisma.clinicianProfile.upsert({
    where: { id: ids.specialistClinician },
    update: {},
    create: {
      id: ids.specialistClinician,
      userId: ids.specialistUser,
      facilityId: ids.facility,
      licenseNumber: `${NS}-SPEC-001`,
      specialty: 'internal_medicine',
      verificationStatus: 'verified',
      languagesSpoken: ['en', 'sw'],
      isAvailable: true,
      maxFamilyLoad: 25,
    },
  });

  await prisma.user.upsert({
    where: { id: ids.unrelatedUser },
    update: {},
    create: {
      id: ids.unrelatedUser,
      phoneNumber: '+255700099904',
      email: UNRELATED_EMAIL,
      passwordHash: clinician.user.passwordHash,
      role: 'clinician',
      status: 'active',
      fullName: `${NS} Unrelated Clinician`,
      preferredLanguage: 'en',
    },
  });
  await prisma.clinicianProfile.upsert({
    where: { id: ids.unrelatedClinician },
    update: {},
    create: {
      id: ids.unrelatedClinician,
      userId: ids.unrelatedUser,
      facilityId: ids.facility,
      licenseNumber: `${NS}-UNRELATED-001`,
      specialty: 'general_practice',
      verificationStatus: 'verified',
      languagesSpoken: ['en'],
      isAvailable: false,
      maxFamilyLoad: 10,
    },
  });

  await prisma.user.upsert({
    where: { id: ids.pendingUser },
    update: {},
    create: {
      id: ids.pendingUser,
      phoneNumber: '+255700000903',
      email: 'ahp.staff.demo.pending-clinician@dev.local',
      role: 'clinician',
      status: 'pending_verification',
      fullName: `${NS} Pending Clinician`,
      preferredLanguage: 'en',
    },
  });
  await prisma.clinicianProfile.upsert({
    where: { id: ids.pendingClinician },
    update: {},
    create: {
      id: ids.pendingClinician,
      userId: ids.pendingUser,
      facilityId: ids.facility,
      licenseNumber: `${NS}-PEND-001`,
      specialty: 'paediatrics',
      verificationStatus: 'pending',
      languagesSpoken: ['en', 'sw'],
    },
  });

  for (const patient of [
    { userId: ids.patientUserA, profileId: ids.patientA, phone: '+255700000904', name: `${NS} Patient One`, dob: '1984-03-11', sex: 'female' as const },
    { userId: ids.patientUserB, profileId: ids.patientB, phone: '+255700000905', name: `${NS} Patient Two`, dob: '2017-08-21', sex: 'male' as const },
  ]) {
    await prisma.user.upsert({
      where: { id: patient.userId },
      update: {},
      create: { id: patient.userId, phoneNumber: patient.phone, role: 'patient', status: 'active', fullName: patient.name, preferredLanguage: 'en' },
    });
    await prisma.patientProfile.upsert({
      where: { id: patient.profileId },
      update: {},
      create: {
        id: patient.profileId,
        userId: patient.userId,
        fullName: patient.name,
        dateOfBirth: new Date(patient.dob),
        sex: patient.sex,
        chronicConditions: patient.profileId === ids.patientA ? ['AHP_STAFF_DEMO_V1 synthetic chronic-history marker'] : [],
        allergies: [],
        regionCode: 'DAR',
      },
    });
  }

  await prisma.careThread.upsert({
    where: { id: ids.threadOffered },
    update: {},
    create: { id: ids.threadOffered, patientProfileId: ids.patientB, reasonSummary: `${NS}: offered paediatric fever demo` },
  });
  await prisma.consultationRequest.upsert({
    where: { id: ids.consultationOffered },
    update: {
      status: 'offered',
      slaDeadlineAt: minutes(45),
    },
    create: {
      id: ids.consultationOffered,
      careThreadId: ids.threadOffered,
      patientProfileId: ids.patientB,
      channel: 'app',
      modality: 'chat',
      symptomText: `${NS}: parent reports fever and reduced appetite for a fictional child profile.`,
      structuredSymptoms: [{ code: 'fever', severity: 3, duration_hours: 48 }],
      urgencyLevel: 'urgent',
      triageRuleVersion: 'staff-demo',
      status: 'offered',
      slaDeadlineAt: minutes(45),
      clientCreatedAt: minutes(-25),
    },
  });
  await prisma.consultationOffer.upsert({
    where: { consultationId_clinicianId: { consultationId: ids.consultationOffered, clinicianId: clinician.id } },
    update: {
      status: 'offered',
      expiresAt: minutes(45),
    },
    create: {
      id: ids.offer,
      consultationId: ids.consultationOffered,
      clinicianId: clinician.id,
      rankScore: 0.82,
      rankWeights: { namespace: NS, specialty: 0.35, language: 0.25, availability: 0.25, load: 0.15 },
      status: 'offered',
      expiresAt: minutes(45),
    },
  });

  await prisma.careThread.upsert({
    where: { id: ids.threadActive },
    update: {},
    create: {
      id: ids.threadActive,
      patientProfileId: ids.patientA,
      primaryClinicianId: ids.specialistClinician,
      reasonSummary: `${NS}: active clinician messaging demo`,
      latestConsultationId: ids.consultationActive,
      openConsultationCount: 1,
    },
  });
  await prisma.consultationRequest.upsert({
    where: { id: ids.consultationActive },
    update: {},
    create: {
      id: ids.consultationActive,
      careThreadId: ids.threadActive,
      patientProfileId: ids.patientA,
      assignedClinicianId: clinician.id,
      channel: 'web',
      modality: 'chat',
      symptomText: `${NS}: fictional adult follow-up question for staff messaging verification.`,
      structuredSymptoms: [{ code: 'follow_up_question', severity: 1, duration_hours: 6 }],
      urgencyLevel: 'routine',
      triageRuleVersion: 'staff-demo',
      status: 'matched',
      slaDeadlineAt: days(1),
      acceptedAt: minutes(-60),
      clientCreatedAt: minutes(-90),
    },
  });
  await prisma.message.upsert({
    where: { id: ids.messagePatient },
    update: {},
    create: {
      id: ids.messagePatient,
      careThreadId: ids.threadActive,
      consultationId: ids.consultationActive,
      senderUserId: ids.patientUserA,
      body: `${NS}: Fictional patient message visible to assigned staff.`,
      deliveredVia: 'app',
      clientCreatedAt: minutes(-50),
    },
  });
  await prisma.message.upsert({
    where: { id: ids.messageClinician },
    update: {},
    create: {
      id: ids.messageClinician,
      careThreadId: ids.threadActive,
      consultationId: ids.consultationActive,
      senderUserId: clinician.userId,
      body: `${NS}: Existing clinician reply seeded for read-back testing.`,
      deliveredVia: 'app',
      clientCreatedAt: minutes(-45),
    },
  });

  await prisma.slot.upsert({
    where: { id: ids.slot },
    update: {},
    create: { id: ids.slot, clinicianId: clinician.id, startsAt: minutes(20), durationMin: 30, modality: 'chat', isBooked: true },
  });
  await prisma.appointment.upsert({
    where: { id: ids.appointment },
    update: {},
    create: {
      id: ids.appointment,
      slotId: ids.slot,
      careThreadId: ids.threadActive,
      patientProfileId: ids.patientA,
      clinicianId: clinician.id,
      startsAt: minutes(20),
      durationMin: 30,
      modality: 'chat',
      reason: `${NS}: synthetic appointment linked to active case`,
      status: 'booked',
    },
  });

  await prisma.investigationOrder.upsert({
    where: { id: ids.order },
    update: {},
    create: {
      id: ids.order,
      careThreadId: ids.threadActive,
      consultationId: ids.consultationActive,
      patientProfileId: ids.patientA,
      orderedById: clinician.id,
      facilityId: ids.facility,
      investigationCode: `${NS}-CBC`,
      investigationType: 'laboratory',
      urgency: 'urgent',
      status: 'resulted',
      clinicalNotes: `${NS}: fictional investigation order for UI demo`,
      narrative: 'Synthetic lab result for local UI verification only.',
      isCritical: false,
      orderedAt: minutes(-40),
      resultedAt: minutes(-20),
    },
  });
  await prisma.investigationValue.upsert({
    where: { id: ids.orderValue },
    update: {},
    create: { id: ids.orderValue, orderId: ids.order, analyte: 'Demo marker', value: 'within synthetic range', unit: null, flag: 'normal' },
  });

  await prisma.prescription.upsert({
    where: { id: ids.prescription },
    update: {},
    create: {
      id: ids.prescription,
      careThreadId: ids.threadActive,
      consultationId: ids.consultationActive,
      patientProfileId: ids.patientA,
      prescribedById: clinician.id,
      status: 'active',
    },
  });
  await prisma.prescriptionItem.upsert({
    where: { id: ids.prescriptionItem },
    update: {},
    create: {
      id: ids.prescriptionItem,
      prescriptionId: ids.prescription,
      medicationName: `${NS} prescription-test-template`,
      dosage: 'demo only',
      frequencyPerDay: 1,
      durationDays: 2,
      instructions: 'Synthetic template record; not medical treatment.',
    },
  });
  await prisma.adherenceLog.upsert({
    where: { id: ids.adherenceMissed },
    update: {},
    create: {
      id: ids.adherenceMissed,
      prescriptionItemId: ids.prescriptionItem,
      prescriptionId: ids.prescription,
      patientProfileId: ids.patientA,
      medicationName: `${NS} prescription-test-template`,
      dosage: 'demo only',
      scheduledAt: minutes(-120),
      reportedStatus: 'missed',
      reportedAt: minutes(-90),
      note: `${NS}: synthetic missed-dose signal`,
      channel: 'app',
    },
  });
  await prisma.adherenceLog.upsert({
    where: { id: ids.adherenceTaken },
    update: {},
    create: {
      id: ids.adherenceTaken,
      prescriptionItemId: ids.prescriptionItem,
      prescriptionId: ids.prescription,
      patientProfileId: ids.patientA,
      medicationName: `${NS} prescription-test-template`,
      dosage: 'demo only',
      scheduledAt: minutes(-30),
      reportedStatus: 'taken',
      reportedAt: minutes(-25),
      channel: 'app',
    },
  });

  await prisma.family.upsert({
    where: { id: ids.family },
    update: {},
    create: { id: ids.family, name: `${NS} Fictional Family`, subscriptionTier: 'family_plus', headUserId: ids.patientUserA },
  });
  await prisma.familyMember.upsert({
    where: { id: ids.familyMemberA },
    update: {},
    create: { id: ids.familyMemberA, familyId: ids.family, patientProfileId: ids.patientA, relationship: 'head' },
  });
  await prisma.familyMember.upsert({
    where: { id: ids.familyMemberB },
    update: {},
    create: { id: ids.familyMemberB, familyId: ids.family, patientProfileId: ids.patientB, relationship: 'child' },
  });
  await prisma.familyAssignment.upsert({
    where: { id: ids.familyAssignment },
    update: {},
    create: { id: ids.familyAssignment, familyId: ids.family, gpClinicianId: clinician.id, obgynClinicianId: null },
  });

  await prisma.community.upsert({
    where: { id: ids.community },
    update: {},
    create: { id: ids.community, name: `${NS} General Practice Community`, specialty: 'general_practice', description: 'Synthetic staff demo community.' },
  });
  await prisma.communityMembership.upsert({
    where: { id: ids.membershipMain },
    update: {},
    create: { id: ids.membershipMain, communityId: ids.community, clinicianId: clinician.id, role: 'member' },
  });
  await prisma.communityMembership.upsert({
    where: { id: ids.membershipSpecialist },
    update: {},
    create: { id: ids.membershipSpecialist, communityId: ids.community, clinicianId: ids.specialistClinician, role: 'member' },
  });
  await prisma.discussion.upsert({
    where: { id: ids.discussion },
    update: {},
    create: {
      id: ids.discussion,
      communityId: ids.community,
      authorClinicianId: clinician.id,
      title: `${NS}: de-identified routing question`,
      body: 'Synthetic clinical operations discussion. No patient-identifying detail is included.',
      isCaseDiscussion: true,
      careThreadId: ids.threadActive,
      replyCount: 1,
    },
  });
  await prisma.discussionReply.upsert({
    where: { id: ids.discussionReply },
    update: {},
    create: { id: ids.discussionReply, discussionId: ids.discussion, authorClinicianId: ids.specialistClinician, body: `${NS}: specialist reply for existing network flow.` },
  });
  await prisma.secondOpinion.upsert({
    where: { id: ids.opinion },
    update: {},
    create: {
      id: ids.opinion,
      careThreadId: ids.threadActive,
      requestedById: clinician.id,
      specialty: 'internal_medicine',
      question: `${NS}: de-identified second-opinion question for a fictional staff demo case.`,
      status: 'open',
      attachmentKeys: [],
    },
  });

  await prisma.transportUnit.upsert({
    where: { id: ids.transport },
    update: {},
    create: { id: ids.transport, callSign: `${NS}-AMB-01`, facilityId: ids.facility, capability: 'advanced', status: 'available', lat: -6.78, lng: 39.25, locationUpdatedAt: minutes(-5) },
  });
  await prisma.emergencyRequest.upsert({
    where: { id: ids.emergency },
    update: {},
    create: {
      id: ids.emergency,
      scale: 'individual',
      category: 'medical',
      source: 'facility',
      status: 'reported',
      patientProfileId: ids.patientA,
      reportedByUserId: adminId,
      lat: -6.779,
      lng: 39.246,
      estimatedCasualties: 1,
      description: `${NS}: synthetic local emergency request; no real dispatch.`,
      reportedAt: minutes(-18),
    },
  });
  await prisma.emergencyEvent.upsert({
    where: { id: ids.emergencyEvent },
    update: {},
    create: { id: ids.emergencyEvent, emergencyId: ids.emergency, toStatus: 'reported', actorUserId: adminId, notes: `${NS}: seed event`, occurredAt: minutes(-18) },
  });

  await prisma.device.upsert({
    where: { id: ids.device },
    update: {},
    create: {
      id: ids.device,
      deviceType: 'wearable_watch',
      serialNumber: `${NS}-WATCH-001`,
      patientProfileId: ids.patientA,
      label: `${NS} wearable demo`,
      credentialHash: `${NS}-not-a-real-secret`,
      status: 'active',
      lastSeenAt: minutes(-7),
      batteryPercent: 72,
    },
  });
  await prisma.incidentReport.upsert({
    where: { id: ids.incident },
    update: {},
    create: {
      id: ids.incident,
      category: 'data_privacy',
      severity: 'moderate',
      status: 'reported',
      description: `${NS}: synthetic incident for local operations demo.`,
      reportedByUserId: adminId,
      anonymous: false,
      facilityId: ids.facility,
      escalatedToGovernance: false,
      reportedAt: minutes(-55),
    },
  });

  await prisma.paymentIntent.upsert({
    where: { id: ids.paymentIntent },
    update: {},
    create: {
      id: ids.paymentIntent,
      amount: 15000,
      currency: 'TZS',
      method: 'mobile_money',
      provider: 'manual',
      purpose: 'consultation_fee',
      status: 'succeeded',
      consultationId: ids.consultationActive,
      payerUserId: ids.patientUserA,
      payerPhone: '+255700000904',
      providerReference: `${NS}-LOCAL-PAY-001`,
      paymentId: ids.payment,
    },
  });
  await prisma.payment.upsert({
    where: { id: ids.payment },
    update: {},
    create: {
      id: ids.payment,
      paymentIntentId: ids.paymentIntent,
      amount: 15000,
      currency: 'TZS',
      method: 'mobile_money',
      provider: 'manual',
      providerReference: `${NS}-LOCAL-PAY-001`,
      purpose: 'consultation_fee',
      status: 'succeeded',
      consultationId: ids.consultationActive,
      payerUserId: ids.patientUserA,
      refundedAmount: 0,
      settledAt: minutes(-35),
    },
  });

  await prisma.researchDataset.upsert({
    where: { id: ids.dataset },
    update: {},
    create: {
      id: ids.dataset,
      name: `${NS} aggregate consultation demo`,
      description: 'Synthetic aggregate counts for local staff UI verification. No row-level patient export.',
      deidentificationMethod: 'aggregation-only synthetic demo',
      kAnonymity: 5,
      minimumCellSize: 5,
      requiresEthicsApproval: true,
      recordCount: 128,
    },
  });
  await prisma.researchQuery.upsert({
    where: { id: ids.researchQuery },
    update: {},
    create: {
      id: ids.researchQuery,
      datasetId: ids.dataset,
      researcherId: adminId,
      ethicsApprovalRef: `${NS}-ETHICS-LOCAL`,
      spec: { measure: 'consultation_count', group_by: ['urgency_level'] },
      status: 'complete',
      rows: [{ urgency_level: 'urgent', count: 42 }, { urgency_level: 'routine', count: 86 }],
      suppressedCells: 0,
      submittedAt: minutes(-80),
      completedAt: minutes(-79),
    },
  });
  await prisma.surveillanceRollup.upsert({
    where: { id: ids.rollupA },
    update: {},
    create: {
      id: ids.rollupA,
      level: 'region',
      areaCode: 'DAR',
      conditionCode: `${NS}-ARI`,
      conditionName: `${NS} synthetic respiratory signal`,
      periodStart: days(-7),
      periodEnd: now,
      count: 38,
      rankInArea: 1,
      ratePer100k: 12.4,
      expectedLow: 20,
      expectedHigh: 35,
      aboveExpected: true,
      modelVersion: `${NS}-local`,
    },
  });
  await prisma.surveillanceRollup.upsert({
    where: { id: ids.rollupB },
    update: {},
    create: {
      id: ids.rollupB,
      level: 'region',
      areaCode: 'DAR',
      conditionCode: `${NS}-GI`,
      conditionName: `${NS} synthetic gastrointestinal signal`,
      periodStart: days(-7),
      periodEnd: now,
      count: 17,
      rankInArea: 2,
      ratePer100k: 5.1,
      expectedLow: 12,
      expectedHigh: 24,
      aboveExpected: false,
      modelVersion: `${NS}-local`,
    },
  });

  await prisma.pharmacy.upsert({
    where: { id: ids.pharmacy },
    update: {},
    create: { id: ids.pharmacy, name: `${NS} Local Demo Pharmacy`, licenseNumber: `${NS}-PHARM-001`, isVerified: true, lat: -6.77, lng: 39.25, regionCode: 'DAR', openingHours: 'Local demo only', isActive: true },
  });
  await prisma.pharmacyStock.upsert({
    where: { id: ids.stock },
    update: {},
    create: { id: ids.stock, pharmacyId: ids.pharmacy, medicationName: `${NS} prescription-test-template`, stockStatus: 'in_stock', unitPrice: 0, currency: 'TZS', lastReportedAt: minutes(-10) },
  });

  const manifest = {
    namespace: NS,
    createdOrRetainedIds: ids,
    login: {
      clinician: 'daktari@dev.local',
      platformAdmin: 'msimamizi@dev.local',
      demoSpecialist: SPECIALIST_EMAIL,
      demoUnrelatedClinician: UNRELATED_EMAIL,
      demoClinicianPassword: SPECIALIST_PASSWORD,
    },
    seededAt: now.toISOString(),
  };
  const dir = path.join('test-results', 'ahp-staff-demo');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(manifest, null, 2));
}

async function undo() {
  assertSafeTarget();
  await prisma.$transaction(async (tx) => {
    await tx.payment.deleteMany({ where: { id: ids.payment } });
    await tx.paymentIntent.deleteMany({ where: { id: ids.paymentIntent } });
    await tx.surveillanceRollup.deleteMany({ where: { id: { in: [ids.rollupA, ids.rollupB] } } });
    await tx.researchQuery.deleteMany({ where: { id: ids.researchQuery } });
    await tx.researchDataset.deleteMany({ where: { id: ids.dataset } });
    await tx.incidentReport.deleteMany({ where: { id: ids.incident } });
    await tx.emergencyEvent.deleteMany({ where: { id: ids.emergencyEvent } });
    await tx.emergencyRequest.deleteMany({ where: { id: ids.emergency } });
    await tx.device.deleteMany({ where: { id: ids.device } });
    await tx.transportUnit.deleteMany({ where: { id: ids.transport } });
    await tx.secondOpinion.deleteMany({ where: { id: ids.opinion } });
    await tx.discussionReply.deleteMany({ where: { id: ids.discussionReply } });
    await tx.discussion.deleteMany({ where: { id: ids.discussion } });
    await tx.communityMembership.deleteMany({ where: { id: { in: [ids.membershipMain, ids.membershipSpecialist] } } });
    await tx.community.deleteMany({ where: { id: ids.community } });
    await tx.familyAssignment.deleteMany({ where: { id: ids.familyAssignment } });
    await tx.familyMember.deleteMany({ where: { id: { in: [ids.familyMemberA, ids.familyMemberB] } } });
    await tx.family.deleteMany({ where: { id: ids.family } });
    await tx.pharmacyStock.deleteMany({ where: { id: ids.stock } });
    await tx.pharmacy.deleteMany({ where: { id: ids.pharmacy } });
    await tx.adherenceLog.deleteMany({ where: { id: { in: [ids.adherenceMissed, ids.adherenceTaken] } } });
    await tx.prescriptionItem.deleteMany({ where: { id: ids.prescriptionItem } });
    await tx.prescription.deleteMany({ where: { id: ids.prescription } });
    await tx.investigationValue.deleteMany({ where: { id: ids.orderValue } });
    await tx.investigationOrder.deleteMany({ where: { id: ids.order } });
    await tx.appointment.deleteMany({ where: { id: ids.appointment } });
    await tx.slot.deleteMany({ where: { id: ids.slot } });
    await tx.message.deleteMany({ where: { id: { in: [ids.messagePatient, ids.messageClinician] } } });
    await tx.consultationOffer.deleteMany({ where: { id: ids.offer } });
    await tx.consultationRequest.deleteMany({ where: { id: { in: [ids.consultationActive, ids.consultationOffered] } } });
    await tx.careThread.deleteMany({ where: { id: { in: [ids.threadActive, ids.threadOffered] } } });
    await tx.patientProfile.deleteMany({ where: { id: { in: [ids.patientA, ids.patientB] } } });
    await tx.clinicianProfile.deleteMany({ where: { id: { in: [ids.specialistClinician, ids.unrelatedClinician, ids.pendingClinician] } } });
    await tx.user.deleteMany({ where: { id: { in: [ids.patientUserA, ids.patientUserB, ids.specialistUser, ids.unrelatedUser, ids.pendingUser] } } });
    await tx.facility.deleteMany({ where: { id: ids.facility } });
  });
  console.log(`${NS} demo records removed from local ahealth_dev.`);
}

const mode = process.argv.includes('--undo') ? 'undo' : 'seed';
(mode === 'undo' ? undo() : seed())
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
