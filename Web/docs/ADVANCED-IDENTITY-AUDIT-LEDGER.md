# Advanced identity and audit ledger

## Architecture decision

**INTERNAL TAMPER-EVIDENT LEDGER.** A-health extends the existing PostgreSQL
`audit_logs` hash chain. It does not add a blockchain adapter, token economics,
wallets, or public network dependencies. **NO PHI ON PUBLIC BLOCKCHAIN.** External
anchoring is future work and is not exercised by this milestone.

## Scope and data minimisation

The ledger records accountability events supported by existing workflows:

- `consent.granted` and `consent.revoked`;
- `clinician.verified` and `clinician.rejected`;
- `emergency.context_break_glass_access` when the existing emergency workflow
  supplies patient context without active emergency-responder consent.

No ordinary UI clicks, passwords, OTPs, access or refresh tokens, clinical
notes, prescriptions, diagnostic values, or raw request bodies are written by
these integrations. Consent and verification events store only event scope,
grantee category or verification status. A break-glass event stores the patient
profile reference, actor reference, emergency request reference, generic access
reason and timestamp.

## Integrity and canonicalisation

The hash algorithm is SHA-256. Canonical JSON recursively sorts object keys,
preserves array order, emits explicit `null`, and uses JSON string/number
encoding. Event timestamps are ISO 8601 UTC strings. Metadata is first
normalised to the JSON value stored in PostgreSQL JSONB, so unsupported values
fail before insertion and equivalent object key order hashes identically.

Hash version 1 preserves the original deployed payload format so existing rows
remain verifiable without inventing or rewriting events. It covers the previous
hash, actor, action, resource type and reference, reason, metadata, and timestamp.
The original format did not cover `ip_address` or `request_id`; this historical
limitation is retained and is not represented as stronger coverage.
Earlier clinician-verification code also wrote license number, specialty, and
free-text rejection reason into some version 1 rows. This milestone stops those
fields in new verification events and suppresses their legacy metadata/reasons
from the Admin list. Historical rows are preserved rather than rewritten; a
deployment owner should review their access and retention policy before
production use.

New writes use hash version 2. Its canonical payload also covers `hash_version`,
`ip_address`, and `request_id`, with nulls explicit. Verification replays the
complete ledger in ascending sequence order from one repeatable-read snapshot,
checks each stored `prev_hash`, and recomputes every supported hash version. It
reports only `VALID`/`INVALID`, number checked and, on failure, the broken
sequence. PostgreSQL sequence gaps can occur after rolled-back transactions,
so gaps alone are not corruption; the linked hash chain detects a missing
interior row.

The PostgreSQL transaction-scoped advisory lock serialises appenders across
processes. Consent mutations and clinician verification transitions pass their
existing Prisma transaction to the append operation, so a failed ledger write
rolls back the corresponding business change. Standalone audit writes retain
their own transaction and lock.

## Authorised views

- `GET /patient-profiles/{patient_profile_id}/audit-history` is patient-role
  only and checks profile ownership or guardian ownership. It returns only the
  caller's consent grant/revoke and break-glass event category, time, and
  supported consent scope/grantee category. It omits actor IDs, hashes, IP,
  request IDs, reasons, and arbitrary metadata.
- `GET /audit/ledger` and `POST /audit/verify` require `platform_admin` in the
  auth service. The list accepts the `consent`, `verification`, and `break_glass`
  category filters and returns only allowlisted event references/details. It
  never returns hashes, IP addresses, request IDs, arbitrary metadata, or
  reasons. The Admin Staff Web view links to the list and runs verification.
- No Patient, Doctor, or Admin HTTP endpoint updates or deletes ledger rows.

The database trigger rejects `UPDATE`, `DELETE`, and `TRUNCATE` against
`audit_logs`. The migration also removes the old actor foreign key's `SET NULL`
behavior so deleting a user cannot rewrite the actor reference in historical
events. A database owner or superuser can disable triggers; this internal chain
is tamper-evident, not proof against a privileged database administrator.

## Coverage boundary

**LEDGER COVERAGE STARTS FROM migration `20260812114735_init` deployed with the
audit log table.** Earlier activity is not represented as audited. Existing
rows stay version 1 and retain their recorded data and original hashes; no
historical consent or verification events are fabricated. The follow-on
`20261006120000_harden_audit_ledger` migration adds hash versioning and database
immutability without rewriting historical event content.

## Production readiness — not verified

**PRODUCTION MIGRATION NOT YET VERIFIED.** The migration has only been applied
to the isolated local `ahealth_test` database. Production rollout is deferred
to the Production Readiness phase. Before rollout, that phase must define and
review:

- a production-compatible backup and restore plan;
- a migration dry-run against a production-like copy;
- full ledger verification before migration;
- the controlled migration execution plan;
- full ledger and immutability verification after migration; and
- rollback and incident procedures.

No production database was accessed for this milestone.

## Test and acceptance evidence

The focused backend suite checks canonical equivalence, parallel appends,
previous-hash linkage, consent transactionality and history ownership, clinician
verification events, emergency break-glass events, database mutation
rejection, and tamper detection using only the isolated local `ahealth_test`
database on a non-5432 port. OpenAPI source and generated TypeScript types are
kept in sync. Firefox acceptance uses synthetic accounts and verifies the
platform-admin list/VALID result, patient-owned projection, Patient A/B
isolation, and Doctor denial.

## Limitations

Hash version 1 does not cover the historical IP/request ID fields, as described
above. The Admin list is an allowlisted operational view rather than a general
forensic export. Patient history returns the latest 100 matching events. No
external anchor, blockchain, public-chain data, or PHI publication is part of
this milestone.
