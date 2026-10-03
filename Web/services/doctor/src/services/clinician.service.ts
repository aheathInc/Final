import { prisma } from '@a-health/database';
import {
  appendAudit,
  conflict,
  cursorArgs,
  encodeCursor,
  forbidden,
  notFound,
} from '@a-health/http';

export interface RequestMeta {
  ip?: string | null;
  requestId?: string | null;
}

function serialise(c: {
  id: string;
  userId: string;
  facilityId: string | null;
  licenseNumber: string;
  specialty: string;
  verificationStatus: string;
  rejectionReason: string | null;
  languagesSpoken: unknown;
  isAvailable: boolean;
  availableUntil: Date | null;
  currentLoad: number;
  ratingAvg: unknown;
  version: number;
  updatedAt: Date;
  user?: { fullName: string | null; email: string | null; status: string } | null;
}) {
  return {
    id: c.id,
    user_id: c.userId,
    facility_id: c.facilityId,
    license_number: c.licenseNumber,
    specialty: c.specialty,
    verification_status: c.verificationStatus,
    rejection_reason: c.rejectionReason,
    languages_spoken: c.languagesSpoken ?? [],
    is_available: c.isAvailable,
    available_until: c.availableUntil?.toISOString() ?? null,
    current_load: c.currentLoad,
    rating_avg: c.ratingAvg === null ? null : Number(c.ratingAvg),
    version: c.version,
    updated_at: c.updatedAt.toISOString(),
    ...(c.user
      ? { full_name: c.user.fullName, email: c.user.email, account_status: c.user.status }
      : {}),
  };
}

/**
 * The queue an administrator actually works from.
 *
 * The contract described how to approve a licence but gave no way to find the
 * ones waiting, which made the approval endpoint unusable in practice.
 */
export async function listClinicians(query: {
  facility_id?: string;
  verification_status?: string;
  specialty?: string;
  is_available?: boolean;
  cursor?: string;
  limit: number;
}, caller: { role: string }) {
  const isAdmin = caller.role === 'platform_admin';
  const rows = await prisma.clinicianProfile.findMany({
    where: {
      ...(!isAdmin ? { verificationStatus: 'verified', user: { status: 'active' } } : {}),
      ...(query.facility_id ? { facilityId: query.facility_id } : {}),
      ...(query.verification_status
        ? { verificationStatus: query.verification_status as never }
        : {}),
      ...(query.specialty ? { specialty: query.specialty as never } : {}),
      ...(query.is_available !== undefined ? { isAvailable: query.is_available } : {}),
    },
    include: { user: { select: { fullName: true, email: true, status: true } } },
    orderBy: { createdAt: 'asc' },
    ...cursorArgs(query.cursor, query.limit),
  });
  const hasMore = rows.length > query.limit;
  const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
  const data = await Promise.all(pageRows.map(async (row) => {
    const [assigned, offered] = await Promise.all([
      prisma.consultationRequest.count({
        where: { assignedClinicianId: row.id, status: { in: ['matched', 'in_progress'] } },
      }),
      prisma.consultationOffer.count({
        where: { clinicianId: row.id, status: 'offered', expiresAt: { gt: new Date() } },
      }),
    ]);
    const status = row.user.status !== 'active' || row.verificationStatus !== 'verified'
      ? 'off_duty'
      : row.isAvailable && row.currentLoad < 5
        ? 'available'
        : 'busy';
    return {
      id: row.id,
      full_name: row.user.fullName,
      specialty: row.specialty,
      status,
      queue_count: assigned + offered,
      ...(isAdmin
        ? {
            license_number: row.licenseNumber,
            verification_status: row.verificationStatus,
            facility_id: row.facilityId,
            is_available: row.isAvailable,
          }
        : {}),
    };
  }));
  const last = pageRows[pageRows.length - 1];
  return {
    data,
    meta: {
      next_cursor: hasMore && last ? encodeCursor(last.id) : null,
      has_more: hasMore,
    },
  };
}

export async function getClinician(clinicianId: string, caller: { sub: string; role: string }) {
  const clinician = await prisma.clinicianProfile.findUnique({
    where: { id: clinicianId },
    include: { user: { select: { fullName: true, email: true, status: true } } },
  });
  if (!clinician) throw notFound('Clinician not found');

  // A clinician may read their own record; anyone else needs an admin role.
  if (caller.role !== 'platform_admin' && clinician.userId !== caller.sub) {
    throw forbidden('NOT_RESOURCE_OWNER', 'You cannot view another clinician’s record');
  }
  return serialise(clinician);
}

/**
 * Approving a licence is what makes a clinician real to the system: it is the
 * moment they become eligible for routing and able to sign a note. It also
 * activates the account — phone verification alone deliberately does not,
 * because possessing a handset is not a right to practise medicine.
 */
export async function decideVerification(
  clinicianId: string,
  adminUserId: string,
  decision: 'approve' | 'reject',
  reason: string | undefined,
  meta: RequestMeta,
) {
  const clinician = await prisma.clinicianProfile.findUnique({
    where: { id: clinicianId },
    include: { user: { select: { id: true, status: true, fullName: true, email: true } } },
  });
  if (!clinician) throw notFound('Clinician not found');

  if (clinician.verificationStatus === 'verified' && decision === 'approve') {
    throw conflict('STATE_TRANSITION_INVALID', 'This clinician is already verified');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const profile = await tx.clinicianProfile.update({
      where: { id: clinicianId },
      data: {
        verificationStatus: decision === 'approve' ? 'verified' : 'rejected',
        rejectionReason: decision === 'reject' ? (reason ?? null) : null,
        // A rejected clinician must not stay on duty against a licence that is
        // no longer accepted.
        ...(decision === 'reject' ? { isAvailable: false } : {}),
        version: { increment: 1 },
      },
      include: { user: { select: { fullName: true, email: true, status: true } } },
    });

    if (decision === 'approve' && clinician.user.status === 'pending_verification') {
      await tx.user.update({
        where: { id: clinician.userId },
        data: { status: 'active', version: { increment: 1 } },
      });
    }

    return profile;
  });

  await appendAudit({
    actorUserId: adminUserId,
    action: decision === 'approve' ? 'clinician.verified' : 'clinician.rejected',
    entityType: 'clinician_profiles',
    entityId: clinicianId,
    reason: reason ?? null,
    metadata: { licenseNumber: clinician.licenseNumber, specialty: clinician.specialty },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });

  return serialise(updated);
}

/**
 * Going off duty removes the clinician from the routing candidate pool. It
 * does not drop consultations already assigned — those must be completed or
 * explicitly reassigned, because a patient mid-conversation is not a queue
 * entry to be discarded.
 */
export async function setAvailability(
  clinicianProfileId: string,
  isAvailable: boolean,
  until: string | undefined,
  meta: RequestMeta,
) {
  const clinician = await prisma.clinicianProfile.findUnique({
    where: { id: clinicianProfileId },
  });
  if (!clinician) throw notFound('Clinician profile not found');
  if (clinician.verificationStatus !== 'verified') {
    throw forbidden('CLINICIAN_NOT_VERIFIED', 'Your licence has not been verified');
  }

  const updated = await prisma.clinicianProfile.update({
    where: { id: clinicianProfileId },
    data: {
      isAvailable,
      availableUntil: until ? new Date(until) : null,
      version: { increment: 1 },
    },
    include: { user: { select: { fullName: true, email: true, status: true } } },
  });

  await appendAudit({
    actorUserId: clinician.userId,
    action: isAvailable ? 'clinician.on_duty' : 'clinician.off_duty',
    entityType: 'clinician_profiles',
    entityId: clinicianProfileId,
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });

  return serialise(updated);
}
