import { prisma } from '@a-health/database';
import { appendAudit, cursorArgs, forbidden, toCursorPage } from '@a-health/http';

export interface Caller { sub: string; role: string }
export interface Meta { ip?: string | null; requestId?: string | null }

const ESCALATING_SEVERITIES = new Set(['serious', 'catastrophic']);

function serialise(r: {
  id: string; category: string; severity: string; status: string; description: string;
  consultationId: string | null; clinicianId: string | null; facilityId: string | null;
  anonymous: boolean; escalatedToGovernance: boolean; reportedAt: Date; closedAt: Date | null;
}) {
  return {
    id: r.id,
    category: r.category,
    severity: r.severity,
    status: r.status,
    description: r.description,
    consultation_id: r.consultationId,
    clinician_id: r.clinicianId,
    facility_id: r.facilityId,
    anonymous: r.anonymous,
    escalated_to_governance: r.escalatedToGovernance,
    reported_at: r.reportedAt.toISOString(),
    closed_at: r.closedAt?.toISOString() ?? null,
  };
}

/**
 * Open to patients and staff alike. Serious and catastrophic reports escalate
 * directly to clinical and governance leadership rather than entering a
 * customer-service queue — the point is improvement, not punishment, but
 * that only works if the report actually reaches someone who can act on it.
 *
 * A reporter who fears identification does not report. When `anonymous` is
 * set, the reporter's id is never written to the row at all — not stored and
 * later hidden, genuinely absent.
 */
export async function createIncidentReport(
  caller: Caller,
  input: {
    category: string; severity?: string; description: string;
    consultation_id?: string; clinician_id?: string; facility_id?: string; anonymous?: boolean;
  },
  meta: Meta,
) {
  const severity = input.severity ?? 'moderate';
  const escalate = ESCALATING_SEVERITIES.has(severity);

  const report = await prisma.incidentReport.create({
    data: {
      category: input.category as never,
      severity: severity as never,
      description: input.description,
      reportedByUserId: input.anonymous ? null : caller.sub,
      anonymous: Boolean(input.anonymous),
      consultationId: input.consultation_id ?? null,
      clinicianId: input.clinician_id ?? null,
      facilityId: input.facility_id ?? null,
      escalatedToGovernance: escalate,
    },
  });

  await appendAudit({
    // Never attributed to the reporter when anonymous — even in the audit
    // trail, which exists to record actions, not to unmask a report the
    // reporter deliberately chose not to sign.
    actorUserId: input.anonymous ? null : caller.sub,
    action: escalate ? 'incident.reported_escalated' : 'incident.reported',
    entityType: 'incident_reports', entityId: report.id,
    metadata: { category: input.category, severity },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialise(report);
}

/** Governance visibility only — this is the leadership-facing queue. */
export async function listIncidentReports(
  caller: Caller,
  query: { status?: string; severity?: string; cursor?: string; limit: number },
) {
  if (caller.role !== 'platform_admin') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Only governance may list incident reports');
  }
  const rows = await prisma.incidentReport.findMany({
    where: {
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.severity ? { severity: query.severity as never } : {}),
    },
    orderBy: [{ escalatedToGovernance: 'desc' }, { reportedAt: 'desc' }],
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialise);
}
