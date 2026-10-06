# AHP Production Release Runbook

This runbook describes a controlled release for the repository baseline `4a25d94a2075659986784e5fa3cca5106e30504e`. It is an operational procedure, not evidence that AHP has been deployed. The production database and production provider accounts were not accessed during acceptance.

## Release prerequisites

- A named release owner, a maintenance window, an approved hosting/network design, TLS certificates, and an incident contact.
- A managed PostgreSQL instance and a secret manager. Never copy local `.env`, `.env.local`, `.local`, or acceptance files to production.
- Set `NODE_ENV=production` explicitly for every backend process. Several local schemas default to development mode when it is omitted.
- Set a high-entropy `JWT_SECRET` of at least 32 characters, and explicitly set the same `JWT_ISSUER` and `JWT_AUDIENCE` on every token issuer/verifier.
- Set `NEXTAUTH_SECRET` and an HTTPS `NEXTAUTH_URL` for Staff Web. HTTPS makes its session cookies `Secure`, `HttpOnly`, and `SameSite=Lax`.
- Set `DATABASE_URL`, all enabled service URLs, and `GATEWAY_SHARED_SECRET` (minimum 16 characters) through the secret manager. Do not use local defaults or values from examples.
- Choose external providers deliberately. Production rejects the AI chat stub, SMS console provider, and payment console provider. A real provider URL/key must be supplied before enabling that integration.
- Build the patient app with the deployed HTTPS gateway URL. The release build rejects local, insecure, blank, and nonstandard API URLs.

Safe variable names and placeholders are in the tracked `.env.example` files. The seed-only `AHP_SEED_ADMIN_PASSWORD` and `AHP_SEED_CLINICIAN_PASSWORD` variables are for local development; development seed scripts refuse `NODE_ENV=production`. Do not seed synthetic users in production.

## Locked dependency and build checks

From `Web/`:

```powershell
pnpm install --frozen-lockfile
pnpm exec prisma validate
pnpm exec prisma generate
pnpm exec turbo run build --concurrency=2
```

For the Staff Web app:

```powershell
Set-Location apps/web
pnpm run type-check
pnpm run build
pnpm start
```

Run Firefox acceptance against the production server with release credentials held in the ignored `apps/web/.env.local` only in a local test environment:

```powershell
pnpm exec playwright test tests/e2e/staff-acceptance.spec.ts --project=firefox
```

For the patient app, from `Mobile app/patient_app/`:

```powershell
flutter pub get --enforce-lockfile
flutter test --no-pub
flutter analyze --no-pub
flutter build apk --release --dart-define=API_GATEWAY_URL=https://<deployed-gateway>
```

Use a release signing key only in the approved signing pipeline. The acceptance APK was unsigned/test packaging, not a store-ready signed artifact.

## Database backup and ledger pre-check

1. Freeze writes or use the database provider's consistent online-backup procedure. Confirm the target database and schema before running commands.
2. Through the authenticated Platform Admin ledger page, run **Verify full ledger**. Proceed only when the status is `VALID`. Stop if the ledger is invalid or unavailable.
3. Create and retain a custom-format backup outside the repository and outside the database host's ephemeral storage:

   ```powershell
   pg_dump --format=custom --no-owner --no-privileges --file <protected-backup-file> $env:DATABASE_URL
   ```

4. Restore that backup to an isolated database and verify the application can read it before the production window. Record backup identifier, time, database version, and restore result in the release record; never put the backup in Git.
5. Do not begin if the backup is missing, unreadable, or has not been restored successfully.

## Migration procedure

1. Confirm the exact application release and migration set. Confirm the deployed app version is compatible with the new schema.
2. Re-run `prisma validate`, `prisma migrate status`, and a schema-drift check against an isolated production-like database first.
3. Apply migrations from `Web/packages/database/` using the production `DATABASE_URL` supplied only in the process environment/secret manager:

   ```powershell
   pnpm exec prisma migrate deploy
   pnpm exec prisma migrate status
   ```

   Never use `prisma migrate dev`, `db push`, test scripts, or seed scripts against production.
4. Stop and retain the pre-migration backup if deployment reports a failed migration, unexpected pending migration, data loss, schema drift, application startup failure, or a ledger verification other than `VALID`.
5. Confirm the audit chain is still `VALID` in the Admin ledger page, confirm the signed-in app can read the required tables, and confirm ledger immutability triggers remain enabled before reopening writes.

The acceptance migration rehearsal covered an empty database, a pre-ledger database with synthetic v1 audit rows, and a backup/restore copy. It did not migrate a production database.

## Deployment order and smoke checks

1. Apply the reviewed database migration after backup and pre-check.
2. Deploy authentication and backend services with consistent JWT secret, issuer, audience, and database configuration.
3. Deploy the gateway and any explicitly enabled provider adapters. Keep optional local/stub services disabled in production.
4. Deploy Staff Web with HTTPS `NEXTAUTH_URL` and service URLs. Start the built app with the production server command; do not use `next dev`.
5. Build and distribute the patient app only after the deployed HTTPS API gateway is reachable and configured in the build.
6. Check `/health` for each deployed service, then `/login`, clinician Doctor workspace, Platform Admin dashboard, Analytics pages, the Admin audit ledger, and representative authenticated BFF routes.
7. Verify clinician/Admin route separation, logout, audit status `VALID`, patient ownership boundaries, and safe provider failure behavior before reopening general access.
8. Observe startup and dependency logs for errors. Logs should contain request IDs and minimum operational metadata, not request bodies, credentials, OTPs, or clinical notes.

## Stop, rollback, and restore

- Stop before reopening traffic if a migration fails, the ledger is not `VALID`, a health check is degraded, an authorization regression appears, or a required provider is silently in console/stub mode.
- Prefer application rollback only when the previous app version is documented as compatible with the migrated schema. Do not blindly run a down migration or delete ledger rows.
- If the schema is incompatible or integrity is uncertain, stop writes and restore the verified pre-migration backup to a **new** database. Validate the restored ledger before pointing the previous application at it. Preserve the failed database read-only for diagnosis.
- Re-run ledger verification after restore and before resuming writes. Record the restore point and application/database versions.
- Rotate any secret suspected of disclosure through the secret manager. Do not place the replacement secret in source, logs, or this runbook.

## External integration boundary

The current code provides an OpenAI-compatible AI adapter and a generic HTTP SMS gateway adapter, but no production provider was configured or exercised. Payment uses a local console adapter; there is no verified mobile-money transfer adapter. Insurance claims are internal/local, emergency dispatch has no external carrier, USSD is a local session engine, and no production email, object storage, or telemetry provider is configured. Treat these as unavailable until separately configured and accepted; do not describe local stubs as live integrations.

There is no production Compose stack in the repository. The available Compose files are development-only and expose legacy split frontends; the unified Staff Web can be built with the generic frontend Dockerfile but has no production service definition here. Use the approved hosting model and validate its own deployment manifests before release.
