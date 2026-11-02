import { prisma, type Prisma } from '@a-health/database';
import { appendAudit, forbidden, notFound } from '@a-health/http';
import type { Caller, Meta } from './investigation.service.js';

export const laboratoryTypes = ['laboratory', 'pathology', 'point_of_care'] as const;
export function laboratoryScope(userId: string): Prisma.InvestigationOrderWhereInput {
  return {
    investigationType: { in: [...laboratoryTypes] },
    facility: { isActive: true, laboratoryMemberships: { some: {
      userId, isActive: true, user: { role: 'lab_technician', status: 'active' },
    } } },
  };
}

export async function laboratoryFacilities(caller: Caller) {
  if (!['clinician', 'platform_admin', 'lab_technician'].includes(caller.role)) {
    throw forbidden('ROLE_NOT_PERMITTED', 'Laboratory staff or clinician access required');
  }
  return { data: await prisma.facility.findMany({
    where: { isActive: true, laboratoryMemberships: { some: {
      ...(caller.role === 'lab_technician' ? { userId: caller.sub } : {}),
      isActive: true, user: { role: 'lab_technician', status: 'active' },
    } } },
    select: { id: true, name: true }, orderBy: { name: 'asc' },
  }) };
}

export async function memberships(caller: Caller, facilityId: string) {
  if (caller.role !== 'platform_admin') throw forbidden('ROLE_NOT_PERMITTED', 'Platform administrator required');
  return { data: await prisma.laboratoryMembership.findMany({
    where: { facilityId }, orderBy: { createdAt: 'asc' },
    select: { id: true, isActive: true, user: { select: { email: true, fullName: true } } },
  }) };
}

export async function assignMembership(caller: Caller, input: { facility_id: string; email: string; is_active: boolean }, meta: Meta) {
  if (caller.role !== 'platform_admin') throw forbidden('ROLE_NOT_PERMITTED', 'Platform administrator required');
  return prisma.$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { email: input.email } });
    if (!user || user.role !== 'lab_technician' || (input.is_active && user.status !== 'active')) {
      throw notFound('An eligible lab technician account was not found');
    }
    const facility = await tx.facility.findUnique({ where: { id: input.facility_id } });
    if (!facility || (input.is_active && (!facility.isActive || !['hospital', 'clinic', 'laboratory'].includes(facility.type)))) {
      throw notFound('An active laboratory, hospital or clinic was not found');
    }
    const membership = await tx.laboratoryMembership.upsert({
      where: { userId_facilityId: { userId: user.id, facilityId: facility.id } },
      create: { userId: user.id, facilityId: facility.id, assignedByUserId: caller.sub, isActive: input.is_active },
      update: { isActive: input.is_active, assignedByUserId: caller.sub },
      select: { id: true, isActive: true },
    });
    await appendAudit({ actorUserId: caller.sub, action: input.is_active ? 'laboratory.access_granted' : 'laboratory.access_revoked',
      entityType: 'laboratory_memberships', entityId: membership.id,
      metadata: { userId: user.id, facilityId: facility.id }, ipAddress: meta.ip, requestId: meta.requestId }, tx);
    return membership;
  });
}
