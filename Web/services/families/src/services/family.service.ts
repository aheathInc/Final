import { prisma } from '@a-health/database';
import { appendAudit, conflict, forbidden, notFound } from '@a-health/http';

export interface Caller { sub: string; role: string; ppid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function serialiseFamily(f: { id: string; name: string; subscriptionTier: string; version: number; createdAt: Date }) {
  return {
    id: f.id,
    name: f.name,
    subscription_tier: f.subscriptionTier,
    created_at: f.createdAt.toISOString(),
    version: f.version,
  };
}

/** Creates a family. The caller becomes its head — the account that can add members and later hand off assignment to admin. */
export async function createFamily(caller: Caller, input: { name: string; subscription_tier?: string }, meta: Meta) {
  const family = await prisma.family.create({
    data: {
      name: input.name,
      subscriptionTier: (input.subscription_tier ?? 'none') as never,
      headUserId: caller.sub,
    },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'family.created',
    entityType: 'families', entityId: family.id,
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialiseFamily(family);
}

/**
 * The caller's own family: as head, or as a member via any patient profile
 * they own or guard. Returns members and both doctor assignments together —
 * this is the one view a family actually reads day to day.
 */
export async function getMyFamily(caller: Caller) {
  const guardedProfiles = await prisma.patientProfile.findMany({
    where: { OR: [{ userId: caller.sub }, { guardianUserId: caller.sub }] },
    select: { id: true },
  });
  const profileIds = guardedProfiles.map((p) => p.id);

  const family = await prisma.family.findFirst({
    where: {
      OR: [
        { headUserId: caller.sub },
        ...(profileIds.length > 0 ? [{ members: { some: { patientProfileId: { in: profileIds } } } }] : []),
      ],
    },
    include: {
      members: { include: { patient: { select: { fullName: true } } } },
      assignments: {
        include: {
          gp: { include: { user: { select: { fullName: true } } } },
          obgyn: { include: { user: { select: { fullName: true } } } },
        },
      },
    },
  });
  if (!family) throw notFound('You do not belong to a family');

  const assignment = family.assignments[0];

  return {
    ...serialiseFamily(family),
    members: family.members.map((m) => ({
      id: m.id,
      patient_profile_id: m.patientProfileId,
      full_name: m.patient.fullName,
      relationship: m.relationship,
    })),
    gp_clinician: assignment?.gp
      ? { id: assignment.gp.id, full_name: assignment.gp.user.fullName, current_family_load: assignment.gp.familyLoad }
      : null,
    obgyn_clinician: assignment?.obgyn
      ? { id: assignment.obgyn.id, full_name: assignment.obgyn.user.fullName, current_family_load: assignment.obgyn.familyLoad }
      : null,
  };
}

async function assertHead(familyId: string, caller: Caller) {
  const family = await prisma.family.findUnique({ where: { id: familyId } });
  if (!family) throw notFound('Family not found');
  if (family.headUserId !== caller.sub && caller.role !== 'platform_admin') {
    throw forbidden('NOT_RESOURCE_OWNER', 'Only the family head may do this');
  }
  return family;
}

/** Adding a member is a head-of-family action. Uniqueness on (family, patient) is enforced by the schema itself. */
export async function addFamilyMember(
  familyId: string, caller: Caller, input: { patient_profile_id: string; relationship: string }, meta: Meta,
) {
  await assertHead(familyId, caller);

  const patient = await prisma.patientProfile.findUnique({ where: { id: input.patient_profile_id } });
  if (!patient) throw notFound('Patient profile not found');

  const existing = await prisma.familyMember.findFirst({
    where: { familyId, patientProfileId: input.patient_profile_id },
  });
  if (existing) throw conflict('DUPLICATE_RESOURCE', 'This patient is already a member of the family');

  const member = await prisma.familyMember.create({
    data: { familyId, patientProfileId: input.patient_profile_id, relationship: input.relationship as never },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'family.member_added',
    entityType: 'family_members', entityId: member.id,
    metadata: { familyId, patientProfileId: input.patient_profile_id },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return {
    id: member.id,
    family_id: member.familyId,
    patient_profile_id: member.patientProfileId,
    full_name: patient.fullName,
    relationship: member.relationship,
  };
}

/**
 * Assigns the family's GP and/or OB/GYN. Admin-only: matching a family to a
 * clinician's panel is an operational decision, drawing on the
 * employed-clinician roster with a bounded number of families each — not
 * something a family head picks for themselves.
 *
 * Reassigning releases the previous clinician's load before claiming the
 * new one's, so a family moving between doctors never double-counts against
 * either panel.
 */
export async function assignFamilyDoctors(
  familyId: string, caller: Caller,
  input: { gp_clinician_id?: string; obgyn_clinician_id?: string }, meta: Meta,
) {
  if (caller.role !== 'platform_admin') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Only an admin may assign family doctors');
  }

  const family = await prisma.family.findUnique({ where: { id: familyId } });
  if (!family) throw notFound('Family not found');

  const existing = await prisma.familyAssignment.findUnique({ where: { familyId } });

  async function claim(clinicianId: string, specialtyLabel: string) {
    const clinician = await prisma.clinicianProfile.findUnique({ where: { id: clinicianId } });
    if (!clinician) throw notFound(`${specialtyLabel} clinician not found`);
    if (clinician.verificationStatus !== 'verified') {
      throw forbidden('CLINICIAN_NOT_VERIFIED', `${specialtyLabel} clinician is not verified`);
    }
    if (clinician.maxFamilyLoad > 0 && clinician.familyLoad >= clinician.maxFamilyLoad) {
      throw conflict('CLINICIAN_UNAVAILABLE', `${specialtyLabel} clinician has no family capacity remaining`);
    }
  }

  if (input.gp_clinician_id) await claim(input.gp_clinician_id, 'GP');
  if (input.obgyn_clinician_id) await claim(input.obgyn_clinician_id, 'OB/GYN');

  const updated = await prisma.$transaction(async (tx) => {
    if (input.gp_clinician_id) {
      if (existing?.gpClinicianId && existing.gpClinicianId !== input.gp_clinician_id) {
        await tx.clinicianProfile.update({ where: { id: existing.gpClinicianId }, data: { familyLoad: { decrement: 1 } } });
      }
      if (existing?.gpClinicianId !== input.gp_clinician_id) {
        await tx.clinicianProfile.update({ where: { id: input.gp_clinician_id }, data: { familyLoad: { increment: 1 } } });
      }
    }
    if (input.obgyn_clinician_id) {
      if (existing?.obgynClinicianId && existing.obgynClinicianId !== input.obgyn_clinician_id) {
        await tx.clinicianProfile.update({ where: { id: existing.obgynClinicianId }, data: { familyLoad: { decrement: 1 } } });
      }
      if (existing?.obgynClinicianId !== input.obgyn_clinician_id) {
        await tx.clinicianProfile.update({ where: { id: input.obgyn_clinician_id }, data: { familyLoad: { increment: 1 } } });
      }
    }

    return tx.familyAssignment.upsert({
      where: { familyId },
      create: {
        familyId,
        gpClinicianId: input.gp_clinician_id ?? null,
        obgynClinicianId: input.obgyn_clinician_id ?? null,
      },
      update: {
        ...(input.gp_clinician_id ? { gpClinicianId: input.gp_clinician_id } : {}),
        ...(input.obgyn_clinician_id ? { obgynClinicianId: input.obgyn_clinician_id } : {}),
        version: { increment: 1 },
      },
      include: {
        gp: { include: { user: { select: { fullName: true } } } },
        obgyn: { include: { user: { select: { fullName: true } } } },
      },
    });
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'family.doctors_assigned',
    entityType: 'family_assignments', entityId: updated.id,
    metadata: { familyId, gpClinicianId: input.gp_clinician_id ?? null, obgynClinicianId: input.obgyn_clinician_id ?? null },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  const familyRow = await prisma.family.findUniqueOrThrow({
    where: { id: familyId },
    include: { members: { include: { patient: { select: { fullName: true } } } } },
  });

  return {
    ...serialiseFamily(familyRow),
    members: familyRow.members.map((m) => ({
      id: m.id, patient_profile_id: m.patientProfileId, full_name: m.patient.fullName, relationship: m.relationship,
    })),
    gp_clinician: updated.gp
      ? { id: updated.gp.id, full_name: updated.gp.user.fullName, current_family_load: updated.gp.familyLoad }
      : null,
    obgyn_clinician: updated.obgyn
      ? { id: updated.obgyn.id, full_name: updated.obgyn.user.fullName, current_family_load: updated.obgyn.familyLoad }
      : null,
  };
}
