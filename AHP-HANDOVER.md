# AHP Secure Source Handover — 2026-10-20

## Verified Git baseline

- Repository: `https://github.com/aheathInc/Final.git`
- Branch: `main`
- Main commit: `901dc9366f2eeb524fb04329eb95e7576e60201b`
- Security fix: `ee3a562cb32aa1f363fe5721fa97980f6362bbd0`
- The local `main` matched `origin/main`; the worktree was clean. The security fix is an ancestor of main.
- The merge added the three reviewed script changes in `dev.sh`, `dev-web.sh`, and `diagnose-401.sh`; no unrelated file changes were part of that merge.

## Credential remediation and remaining risk

The current tracked versions of the three scripts were reviewed. Startup output does not display seed credentials. `diagnose-401.sh` requires `AHP_DIAGNOSE_PASSWORD` and exits safely when it is missing. No Auth runtime behavior changed in the security fix.

The historical seed-password values are absent from the current tracked source scan (975 tracked paths). High-risk pattern scans found no private-key block, AWS key ID, GitHub token, Slack token, JWT-shaped token, or live payment key. No non-local database URL credential was identified. Static local database URL password components were replaced with `LOCAL_DB_PASSWORD_REQUIRED` in this archive copy only: 50 components across 49 files. Runtime-variable URLs remain unchanged. The authoritative repository was not edited.

Historical passwords remain in Git history. The owner reports local/test-only use; that report does not verify shared, staging, or production environments. The historical values must be treated as exposed and never reused. Use outside isolated local/test environments remains unknown and must be checked by the owner. Rotate/revoke any reuse and invalidate affected sessions or tokens. No history rewrite was authorized or performed. The inspected local Auth database was reported not to use those values; no account or session was changed during this handover.

No real patient PHI was identified by the content-indicator review. This is not a legal or semantic PHI certification. Test/demo identity and clinical fixtures are synthetic. External credential reuse and environment rotation remain unverified.

## Main source archive

- Archive: `D:\Projects\AHP-Final-Complete-Source.zip`
- Source commit: `901dc9366f2eeb524fb04329eb95e7576e60201b`
- Contents: 955 approved tracked source files plus this handover, `SOURCE-COMMIT.txt`, and `SHA256SUMS.txt` (958 file entries total).
- Includes the Staff Web workspace, backend services, shared packages, Flutter Patient App, Prisma schema and migrations, OpenAPI, tests, documentation, safe environment examples, and lockfiles.
- Excludes `.git`, private `.env` files, `.local`, database files/dumps, cookies/tokens/auth state, runtime logs, private test screenshots/results, `node_modules`, `.next`, other generated build/cache output, all 19 tracked `.bak*`/`.pre-*` backup files, and `docs/The Boogeyman.md` (22.7 MB, unverified external investigation material).
- Static local database URL password components were normalized in archive copies only. The source ZIP was compared against the clean Git archive at the source commit; the only source-content differences are those documented normalizations.
- `SHA256SUMS.txt` contains SHA-256 for each archive entry other than itself. The ZIP's own SHA-256 is held in the adjacent external `.sha256` sidecar and this external handover copy, avoiding a self-reference.

## Preserved pending work

These archives remain separate from main and are not approved as merged product source:

- Premium UI: `D:\Projects\AHP-recovery-checkpoints\premium-web-ui-pending-20261018\AHP-Premium-Web-UI-pending.zip` — SHA-256 `750826143f060eb8fc29716f6c72db1f7fbc756452b1654d177dc539c915b25b`; branch `feat/premium-web-ui-modernization`, based on `c44bb9aeb11657473ed09a7e8d87c29f7ff1508d`, pending owner visual approval and acceptance. Per-entry hashes: `AHP-Premium-Web-UI-pending.zip.contents.sha256` beside the archive.
- Integrated demo/bootstrap: `D:\Projects\AHP-recovery-checkpoints\integrated-demo-pending-20261018\AHP-integrated-demo-pending.zip` — SHA-256 `7f086083d79191262759b529c9ec8325551a3741601212589fa7262b00cc74f2`; branch `demo/full-integrated-ahp`, based on `c44bb9aeb11657473ed09a7e8d87c29f7ff1508d`, pending manual security and architecture review. Per-entry hashes: `AHP-integrated-demo-pending.zip.contents.sha256` beside the archive.
- The demo ZIP copy redacts one stale deleted development credential in `working-tree.patch`; this sanitization affects only the archive and makes that single deleted patch line require manual reconciliation. The pending worktree was not changed. The demo's database URL is runtime-interpolated local configuration, not a literal credential.

## Safe local setup

Use the checked-in setup guides as the authoritative procedure:

- `docs/LOCAL-WINDOWS-SETUP.md`
- `README.md`
- `DOCKER.md`

The workspace documents Node.js 22 and pnpm 10. From `Web`, install locked dependencies with `pnpm install --frozen-lockfile`. Create private, ignored env files from the safe `.env.example` templates and supply locally generated credentials; never reuse historical values or copy private env files into an archive. Follow the Windows setup guide to select an isolated local database and verify its host and port before migrations or seeds. Its documented migration command is `pnpm --filter @a-health/database exec prisma migrate deploy`. Start the documented unified staff stack with `bash dev-web.sh web` from Git Bash. Development OTP echo is only for an isolated local environment and must not be exposed externally. These commands are handover instructions; they were not run for archive preparation.

## Known limitations

- Historical credentials remain recoverable from Git history and must not be reused. Shared/staging/production use has not been verified.
- The unverified 22.7 MB investigation guide is excluded pending owner review of provenance and contents.
- The Premium UI and integrated demo archives remain pending separate review and are not included in the main source archive.
- One removed demo credential was redacted in the pending demo archive's patch copy; manually reconcile that line before applying the patch.
- PHI review is indicator-based and does not certify legal, regulatory, or semantic absence of PHI.
- No backend behavior, database, Docker service, account, or session was changed for this handover.