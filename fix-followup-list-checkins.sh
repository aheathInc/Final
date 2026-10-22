#!/usr/bin/env bash
#
# Adds GET /check-ins — the patient's own due check-ins, flat.
#
# The gap: respondToCheckIn exists, and listCheckIns exists nested under a
# cycle, but there is no way to LIST a patient's follow-up cycles at all. So a
# patient could answer a check-in only if something else handed them its id.
# An action with no way to find what to act on is the same gap-class that
# already bit GET /clinicians and GET /investigation-orders/{id}.
#
# Scoped like /adherence-logs, which already works this way: the caller's own
# rows, or a clinician's assigned patients.
#
# Run from the repo root:
#   bash fix-followup-list-checkins.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/followup"
SERVICE="$SVC/src/services/checkin.service.ts"
CONTROLLER="$SVC/src/controllers/followup.controller.ts"
ROUTES="$SVC/src/routes/followup.routes.ts"
CONTRACT="$ROOT/packages/api/openapi/a-health-api-v1.yaml"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
for f in "$SERVICE" "$CONTROLLER" "$ROUTES"; do
  [ -f "$f" ] || { echo "Missing: ${f#$ROOT/}"; exit 1; }
  cp "$f" "$f.bak"
done

# --- 1. service -------------------------------------------------------------
node - "$SERVICE" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

if (s.includes('listMyCheckIns')) { console.log('  service already has listMyCheckIns'); process.exit(0); }

s = s.trimEnd() + '\n\n' + String.raw`
/**
 * The caller's own check-ins across every cycle, newest window first.
 *
 * Scoped the same way /adherence-logs is: a patient (or guardian) sees their
 * own, a clinician sees the cycles they own, an admin sees all. There is no
 * unscoped variant, because "list every check-in on the platform" is not a
 * question anyone using this app needs answered.
 */
export async function listMyCheckIns(
  caller: Caller,
  query: { status?: string; cursor?: string; limit: number },
) {
  const scope =
    caller.role === 'platform_admin'
      ? {}
      : caller.cpid
        ? { followUpCycle: { clinicianId: caller.cpid } }
        : { followUpCycle: { patient: { OR: [{ userId: caller.sub }, { guardianUserId: caller.sub }] } } };

  const rows = await prisma.checkIn.findMany({
    where: { ...scope, ...(query.status ? { status: query.status as never } : {}) },
    orderBy: { scheduledAt: 'asc' },
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialiseCheckIn);
}
`;
fs.writeFileSync(p, s);
if (!fs.readFileSync(p, 'utf8').includes('export async function listMyCheckIns')) {
  console.error('  VERIFY FAILED'); process.exit(1);
}
console.log('  checkin.service.ts: listMyCheckIns added');
NODE

# --- 2. controller ----------------------------------------------------------
node - "$CONTROLLER" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (s.includes('listMyCheckIns')) { console.log('  controller already patched'); process.exit(0); }

s = s.trimEnd() + '\n\n' + String.raw`
export const listMyCheckIns = handle((req) =>
  checkins.listMyCheckIns(caller(req), listCheckInsQuery.parse(req.query)));
` + '\n';
fs.writeFileSync(p, s);
console.log('  followup.controller.ts: listMyCheckIns added');
NODE

# --- 3. route ---------------------------------------------------------------
node - "$ROUTES" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (s.includes("get('/check-ins'")) { console.log('  route already present'); process.exit(0); }

const anchor = "followupRouter.post('/check-ins/:check_in_id/respond'";
if (!s.includes(anchor)) { console.error('  route anchor not found'); process.exit(1); }
s = s.replace(anchor, "followupRouter.get('/check-ins', requireAuth, c.listMyCheckIns);\n" + anchor);
fs.writeFileSync(p, s);
console.log('  followup.routes.ts: GET /check-ins registered');
NODE

# --- 4. contract ------------------------------------------------------------
python3 - "$CONTRACT" << 'PY'
import sys
p = sys.argv[1]
doc = open(p).read()
if 'operationId: listMyCheckIns' in doc:
    print('  contract already has it'); raise SystemExit

anchor = "  /check-ins/{check_in_id}/respond:"
if anchor not in doc:
    print('  contract anchor not found'); raise SystemExit(1)

block = '''  /check-ins:
    get:
      tags: [follow-up]
      summary: List the caller's own check-ins
      description: |
        Answering a check-in was already described, but there was no way to
        find the ones waiting — a patient could only respond if something else
        handed them an id. Scoped like `/adherence-logs`: a patient or guardian
        sees their own, a clinician sees the cycles they own.
      operationId: listMyCheckIns
      parameters:
        - name: status
          in: query
          schema:\n            type: string\n            enum: [scheduled, responded, missed]
        - $ref: '#/components/parameters/Cursor'
        - $ref: '#/components/parameters/Limit'
      responses:
        '200':
          description: Check-ins
          content:
            application/json:
              schema:
                type: object
                required: [data, meta]
                properties:
                  data:
                    type: array
                    items: { $ref: '#/components/schemas/CheckIn' }
                  meta: { $ref: '#/components/schemas/CursorMeta' }
        '401': { $ref: '#/components/responses/Unauthenticated' }

'''
open(p, 'w').write(doc.replace(anchor, block + anchor, 1))
print('  contract: GET /check-ins added')
PY

python3 -c "
import yaml, re, sys
p='$CONTRACT'
d=yaml.safe_load(open(p)); txt=open(p).read()
bad=[]
for r in set(re.findall(r\"\\\$ref: '(#/[^']+)'\", txt)):
    n=d
    for part in r.lstrip('#/').split('/'):
        if isinstance(n,dict) and part in n: n=n[part]
        else: bad.append(r); break
print('  paths:', len(d['paths']), '| broken refs:', bad or 'none')
"

echo
echo "Next:"
echo "  pnpm --filter @a-health/followup exec tsc --noEmit"
echo "  pnpm --filter @a-health/followup test"
