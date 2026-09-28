#!/usr/bin/env bash
#
# Adds the three consultation READ endpoints. All three are described in the
# contract; none had a route.
#
#   GET /consultations                      list mine
#   GET /consultations/{id}                 one consultation
#   GET /consultations/{id}/note            the signed note
#
# This is blocking, not cosmetic. The clinician's case screen calls the second
# one, so opening an accepted case always showed "not found"; the patient app's
# home screen calls the first, so a patient never saw their own ongoing care.
#
# Same gap-class as GET /clinicians, GET /investigation-orders/{id} and
# GET /check-ins: an action with no way to read back what it acted on. This is
# the fourth and, after a full route-vs-contract sweep, the last.
#
# Run from the repo root:
#   bash fix-consultation-reads.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/consultation"
SERVICE="$SVC/src/services/consultation.service.ts"
CONTROLLER="$SVC/src/controllers/consultation.controller.ts"
ROUTES="$SVC/src/routes/consultation.routes.ts"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
for f in "$SERVICE" "$CONTROLLER" "$ROUTES"; do
  [ -f "$f" ] || { echo "Missing: ${f#$ROOT/}"; exit 1; }
  cp "$f" "$f.bak-reads"
done

node - "$SERVICE" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (s.includes('export async function getConsultation')) {
  console.log('  service already has the reads'); process.exit(0);
}

s = s.trimEnd() + '\n\n' + String.raw`
/**
 * Visibility for a single consultation: the patient it belongs to (or their
 * guardian), the clinician it is assigned to, or an admin.
 *
 * A clinician who was merely OFFERED the case and declined is not included —
 * the offer let them see a summary in order to decide, and declining ends
 * that, rather than leaving them a permanent window into someone's care.
 */
async function assertConsultationVisible(
  c: { patientProfileId: string; assignedClinicianId: string | null },
  caller: Caller,
): Promise<void> {
  if (caller.role === 'platform_admin') return;
  if (caller.cpid && c.assignedClinicianId === caller.cpid) return;

  const patient = await prisma.patientProfile.findUnique({ where: { id: c.patientProfileId } });
  const owns = patient && (patient.userId === caller.sub || patient.guardianUserId === caller.sub);
  if (!owns) throw forbidden('NOT_RESOURCE_OWNER', 'This consultation is not yours');
}

export async function getConsultation(consultationId: string, caller: Caller) {
  const c = await prisma.consultationRequest.findUnique({ where: { id: consultationId } });
  if (!c) throw notFound('Consultation not found');
  await assertConsultationVisible(c, caller);
  return serialiseConsultation(c);
}

export async function listConsultations(
  caller: Caller,
  query: { status?: string; care_thread_id?: string; cursor?: string; limit: number },
) {
  const scope =
    caller.role === 'platform_admin'
      ? {}
      : caller.cpid
        ? { assignedClinicianId: caller.cpid }
        : { patient: { OR: [{ userId: caller.sub }, { guardianUserId: caller.sub }] } };

  const rows = await prisma.consultationRequest.findMany({
    where: {
      ...scope,
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.care_thread_id ? { careThreadId: query.care_thread_id } : {}),
    },
    orderBy: { createdAt: 'desc' },
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialiseConsultation);
}

/**
 * The signed note. Readable only once it exists — an unfinished consultation
 * has no advice to give, and returning an empty shell would read as "the
 * clinician said nothing" rather than "the clinician has not finished".
 */
export async function getConsultationNote(consultationId: string, caller: Caller) {
  const c = await prisma.consultationRequest.findUnique({ where: { id: consultationId } });
  if (!c) throw notFound('Consultation not found');
  await assertConsultationVisible(c, caller);

  const note = await prisma.consultationNote.findUnique({ where: { consultationId } });
  if (!note) throw notFound('This consultation has no note yet');

  return {
    id: note.id,
    consultation_id: note.consultationId,
    care_thread_id: note.careThreadId,
    diagnosis_text: note.diagnosisText,
    diagnosis_codes: note.diagnosisCodes,
    advice_text: note.adviceText,
    red_flags_discussed: note.redFlagsDiscussed,
    referred_specialist_id: note.referredSpecialistId,
    signed_by_clinician_id: note.signedByClinicianId,
    signed_at: note.signedAt.toISOString(),
    version: note.version,
  };
}
`;
fs.writeFileSync(p, s);
if (!fs.readFileSync(p, 'utf8').includes('export async function getConsultationNote')) {
  console.error('  VERIFY FAILED'); process.exit(1);
}
console.log('  consultation.service.ts: getConsultation, listConsultations, getConsultationNote added');
NODE

node - "$CONTROLLER" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (s.includes('export const getConsultation')) {
  console.log('  controller already patched'); process.exit(0);
}
s = s.trimEnd() + '\n\n' + String.raw`
export const getConsultation = handle((req) =>
  consultations.getConsultation(pathParam(req, 'consultation_id'), caller(req)));

export const listConsultations = handle((req) =>
  consultations.listConsultations(caller(req), listQuery.parse(req.query)));

export const getConsultationNote = handle((req) =>
  consultations.getConsultationNote(pathParam(req, 'consultation_id'), caller(req)));
` + '\n';
fs.writeFileSync(p, s);
console.log('  consultation.controller.ts: 3 handlers added');
NODE

node - "$ROUTES" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (s.includes("get('/consultations',")) {
  console.log('  routes already registered'); process.exit(0);
}

const anchor = "consultationRouter.post('/consultations', requireAuth, idempotency, c.createConsultation);";
if (!s.includes(anchor)) { console.error('  route anchor not found'); process.exit(1); }

// The literal /consultations/:id must come AFTER the more specific
// /consultations/:id/queue-status and the action routes, or Express would
// match the parameter first and swallow them.
s = s.replace(anchor, anchor +
  "\nconsultationRouter.get('/consultations', requireAuth, c.listConsultations);");

const lastAction = "consultationRouter.post('/consultations/:consultation_id/refer', requireAuth, requireVerifiedClinician, idempotency, c.referConsultation);";
if (!s.includes(lastAction)) { console.error('  refer route anchor not found'); process.exit(1); }
s = s.replace(lastAction, lastAction +
  "\nconsultationRouter.get('/consultations/:consultation_id/note', requireAuth, c.getConsultationNote);" +
  "\nconsultationRouter.get('/consultations/:consultation_id', requireAuth, c.getConsultation);");

fs.writeFileSync(p, s);
console.log('  consultation.routes.ts: 3 routes registered, parameterised route placed last');
NODE

echo
echo "  route order check:"
grep -n "consultationRouter.get('/consultations" "$ROUTES" | sed 's/^/    /'

echo
echo "Next:"
echo "  pnpm --filter @a-health/consultation exec tsc --noEmit"
echo "  pnpm --filter @a-health/consultation test"
