# AHP Staff UI Demo Milestone

> **Final recovery status (2026-09-29):** This is historical AHP demo documentation. Its browser/test evidence and listed database backup describe the old AHP environment, not this Final worktree. The seed source is recovered at `Web/scripts/seed-staff-demo.ts`, adapted to Final’s `Web/` workspace, and has not been run.

Feature branch: `feat/ahp-staff-ui-demo-20260913`

Protected checkpoint:

- Branch: `checkpoint/ahp-unified-staff-20260913`
- Commit: `3c5a1f5499b12cf70e99be274bfcb9f037c423b1`

Main app URL: `http://localhost:3000`

Normal local start command:

```bash
bash dev-web.sh web
```

## Demo Data

Namespace: `AHP_STAFF_DEMO_V1`

Pre-seed private database backup:

`/home/kali/ahp-local-backups/ahp-staff-ui-demo-preseed-20260913-150843/`

Commands below run from `Web/`. The seed script type-checks without database access; actual seeding has not been run during recovery and requires configured backend service `.env` files, app `.env.local`, and a verified local database target.

Seed command:

```bash
pnpm type-check:staff-demo
AHP_STAFF_DEMO_CONFIRM=write-local-ahealth_dev pnpm seed:staff-demo
```

The seed refuses production, non-`ahealth_dev`, non-local database targets, non-console SMS, and non-console mobile-money configuration. It writes deterministic records and leaves existing accounts, passwords, cases and assignments unchanged.

Manifest:

`test-results/ahp-staff-demo/manifest.json`

Demo login notes:

Set `AHP_STAFF_DEMO_PASSWORD` in the gitignored `Web/.env` before running the seed. The demo specialist reuses the existing local clinician password hash, so supply that account's local password. The seed stops if the variable is missing. Keep its value out of tracked files.

- Main clinician: `daktari@dev.local`
- Platform admin: `msimamizi@dev.local`
- Demo specialist clinician: `ahp.staff.demo.specialist@dev.local`
- Demo unrelated clinician: `ahp.staff.demo.unrelated@dev.local`
- Demo clinician password: supplied through gitignored `Web/.env` as `AHP_STAFF_DEMO_PASSWORD`

## Demo Coverage

The dataset adds fictional local records for:

- Offered and assigned clinician consultations.
- Two-sided care-thread messages.
- Appointment and slot.
- Diagnostic order and result value.
- Prescription-test-template and adherence records.
- Family assignment and professional network records.
- Second-opinion request.
- Facility, device, emergency request, incident, transport unit and local/mock payment.
- Aggregate research dataset/query and surveillance rollups.

## Undo

Do not run this automatically after verification; the browser stack should keep showing the demo records.

Narrow undo command:

```bash
AHP_STAFF_DEMO_CONFIRM=write-local-ahealth_dev pnpm undo:staff-demo
```

The undo deletes only deterministic IDs in namespace `AHP_STAFF_DEMO_V1`. It does not reset databases, truncate tables, delete volumes, or alter legacy apps.

## Current Implementation Notes

- Shared `apps/web` UI primitives now provide wider staff pages, refined cards, badges and a soft A-health product surface.
- Doctor queue has a navy-to-teal clinical header with a restrained line/dot pattern behind header content only.
- Unified links were corrected where old single-app routes missed `/doctor` or `/admin` prefixes.
- Follow-up adherence visibility now includes clinicians attached to the relevant care thread through primary or assigned consultation ownership.

## Verification Evidence

Completed on 2026-09-13 against `http://localhost:3000`.

- `pnpm --filter a-health-web type-check`: passed.
- `pnpm --filter a-health-web build`: passed while Next dev on port 3000 was stopped.
- `set -a; . services/followup/.env; set +a; pnpm --filter @a-health/followup test`: passed outside the sandbox with local Postgres access, 18 tests passed.
- Firefox Playwright after clean dev restart: passed real clinician login, platform admin login, demo specialist login, unrelated clinician authorization denial, Doctor/Admin/Analytics navigation, clinician denial from Admin/Analytics, persisted messaging/read-back/reply, dashboard API count matching, tab switching, direct refresh, logout, CSS response and mobile overflow checks.
- CSS evidence: `/_next/static/css/app/layout.css` returned `200 text/css`; login shell background `rgb(7, 26, 47)`, primary button `rgb(15, 76, 67)`, button padding `10px 20px`, input border `1px solid rgb(210, 217, 209)`, input radius `6px`.
- Dashboard count evidence from authorised API in browser: open emergencies `6`, pending verifications `1`, active devices `2`, open incidents `2`.

Screenshots:

- Before checkpoint reference: `test-results/unified-web-visual/login-desktop.png`
- Before checkpoint reference: `test-results/unified-web-visual/doctor-queue-desktop.png`
- Before checkpoint reference: `test-results/unified-web-visual/admin-dashboard-desktop.png`
- Before checkpoint reference: `test-results/unified-web-visual/analytics-dashboard-desktop.png`
- After: `test-results/ahp-staff-demo/screenshots/after-login-desktop.png`
- After: `test-results/ahp-staff-demo/screenshots/after-doctor-queue-desktop.png`
- After: `test-results/ahp-staff-demo/screenshots/after-admin-dashboard-desktop.png`
- After: `test-results/ahp-staff-demo/screenshots/after-analytics-dashboard-desktop.png`
- After: `test-results/ahp-staff-demo/screenshots/after-admin-dashboard-mobile.png`

## Remaining Gaps

- The normal `bash dev-web.sh web` launcher can refuse to start in this executor when another service process already owns a required port. In that case, preserve the existing services and start only the unified app with `pnpm --filter a-health-web dev`.
- Some secondary pages still carry older explanatory copy and can be polished further, but the verified Doctor queue/case/messaging, Admin dashboard/emergency, and Analytics dashboard screens now render as one A-health staff product.
