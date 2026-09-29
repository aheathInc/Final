# A-health Unified Web App

> **Final recovery status (2026-09-29):** The source was recovered from AHP commit `1a9caf7` into `Web/apps/web`. Historical browser/test evidence below refers to the original AHP workspace and has not been repeated against Final. Current static verification is recorded in the integration handoff; runtime verification remains pending.

Run commands from `Web/`. Current unified launcher: `bash dev-web.sh web`.

Main local URL: `http://localhost:3000`

Normal local start command:

```bash
bash dev-web.sh web
```

The `web` mode launches the unified staff app on port 3000 and its required services. `doctor`, `admin`, `analytics`, and `all` remain available for the retained standalone apps.

## Staff Areas

The unified app exposes only the existing working staff areas:

- Doctor / Clinician
- Admin / Operations
- Analytics / Research

Patient web, pharmacy portal, laboratory portal, blockchain UI, USSD/SMS and other product surfaces are not part of `Web/apps/web`. The retained patient mobile app lives at `Mobile app/patient_app`.

## Roles And Access

- `clinician` signs in through `/login` and lands on `/doctor/queue`.
- `clinician` can access `/doctor/*`.
- `clinician` is redirected back to `/doctor/queue` when trying `/admin/*` or `/analytics/*`.
- `platform_admin` signs in through `/login` and lands on `/admin/dashboard`.
- `platform_admin` can access `/admin/*` and `/analytics/*`.
- `platform_admin` is redirected back to `/admin/dashboard` when trying `/doctor/*`.
- Session cookies use the unified `a-health-web.*` cookie names. Access tokens stay server-side in the NextAuth JWT and are attached only by the BFF.
- Refresh is handled by NextAuth JWT refresh and by server-side BFF/server component token renewal.
- Logout uses NextAuth signout and then navigates to `/login`.

## Route Map

Doctor:

- `/doctor` -> `/doctor/queue`
- `/doctor/queue`
- `/doctor/case/[consultation_id]`
- `/doctor/case/[consultation_id]/close`
- `/doctor/patients/[patient_profile_id]`
- `/doctor/appointments`
- `/doctor/slots`
- `/doctor/diagnostics`
- `/doctor/diagnostics/[order_id]`
- `/doctor/follow-up`
- `/doctor/pharmacy`
- `/doctor/families`
- `/doctor/network`
- `/doctor/network/[discussion_id]`
- `/doctor/second-opinions`
- `/doctor/education`
- `/doctor/settings`
- `/doctor/assistant`

Admin:

- `/admin` -> `/admin/dashboard`
- `/admin/dashboard`
- `/admin/emergency`
- `/admin/emergency/[emergency_id]`
- `/admin/devices`
- `/admin/verification`
- `/admin/facilities`
- `/admin/facilities/[facility_id]`
- `/admin/incidents`
- `/admin/payments`
- `/admin/triage`
- `/admin/settings`

Analytics:

- `/analytics` -> `/analytics/dashboard`
- `/analytics/dashboard`
- `/analytics/surveillance`
- `/analytics/research`
- `/analytics/research/[query_id]`

Shared:

- `/login`
- `/api/auth/[...nextauth]`
- `/bff/[...path]`

## Historical AHP Build And Test Evidence

Verified on 2026-09-13 against `http://localhost:3000`.

- `pnpm --filter a-health-web type-check`: passed.
- `pnpm --filter a-health-web build`: passed while `next dev` was stopped.
- Production build route output showed Doctor, Admin, Analytics, auth and BFF routes only; no `/patient/*` or `/patient-auth/*` routes.
- Styling root cause found and verified: `next build` had been run while `next dev` was still serving the same `apps/web/.next` directory. Firefox requested `/_next/static/css/app/layout.css`, but the running dev server returned `404` with `text/html`; computed styles were browser defaults (`body` serif, default button/input styles). Stopping dev, running the build alone, then restarting dev restored the generated CSS route.
- Post-restart Firefox CSS checks passed: generated CSS returned `200 text/css`; login `body` used system sans, login shell background was `rgb(7, 26, 47)`, primary button was `rgb(15, 76, 67)`, inputs had `1px` line border, `12px` horizontal padding and `6px` radius.
- Post-restart authenticated CSS checks passed: app sidebar background was `rgb(7, 26, 47)`, selected nav background was `rgb(32, 184, 159)`, and dashboard cards rendered with white background, line border, padding and `8px` radius.
- Firefox screenshots saved under `test-results/unified-web-visual/`: `login-desktop.png`, `doctor-queue-desktop.png`, `admin-dashboard-desktop.png`, `analytics-dashboard-desktop.png`, `admin-dashboard-mobile.png`.
- Real Firefox clinician login: `daktari@dev.local` landed on `/doctor/queue`.
- Real Firefox platform admin login: `msimamizi@dev.local` landed on `/admin/dashboard`.
- Doctor route navigation verified visible content for queue, appointments, slots, diagnostics, follow-up, pharmacy, families, network, second opinions, education and settings.
- Doctor active case verified with existing consultation `6a15695c-7887-44f5-87af-6957b3c74984`.
- Doctor patient record access verified with existing patient profile `c3f3fcf9-f070-41f6-a899-7db12c454e6c`.
- Admin route navigation verified visible content for dashboard, emergency, devices, verification, facilities, incidents, payments, triage and settings.
- Analytics route navigation verified visible content for dashboard, surveillance and research.
- Clinician forbidden checks passed for `/admin/dashboard` and `/analytics/dashboard`; both redirected to `/doctor/queue`.
- Platform admin forbidden check passed for `/doctor/queue`; it redirected to `/admin/dashboard`.
- Direct refresh passed for clinician `/doctor/queue` and admin `/analytics/research`.
- Logout passed for clinician and platform admin, returning to `/login`.
- Desktop check used 1366 x 900 Firefox viewport.
- Mobile-width check used 390 x 844 Firefox viewport on `/admin/dashboard`.

Additional staff UI/demo milestone evidence on 2026-09-13:

- Demo namespace: `AHP_STAFF_DEMO_V1`.
- Seed command: `AHP_STAFF_DEMO_CONFIRM=write-local-ahealth_dev pnpm seed:staff-demo`.
- Undo command: `AHP_STAFF_DEMO_CONFIRM=write-local-ahealth_dev pnpm undo:staff-demo`.
- Demo manifest: `test-results/ahp-staff-demo/manifest.json`.
- Pre-seed private database backup: `/home/kali/ahp-local-backups/ahp-staff-ui-demo-preseed-20260913-150843/`.
- Post-build Firefox verification screenshots: `test-results/ahp-staff-demo/screenshots/`.
- `pnpm --filter a-health-web type-check`: passed.
- `pnpm --filter a-health-web build`: passed while `next dev` on port 3000 was stopped.
- `set -a; . services/followup/.env; set +a; pnpm --filter @a-health/followup test`: passed outside the sandbox with local Postgres access, 18 tests passed.
- Firefox verified real clinician, demo specialist clinician, demo unrelated clinician and platform admin sessions, Doctor/Admin/Analytics navigation, clinician denial from Admin/Analytics, unrelated clinician denial from the demo care thread, persisted messaging/read-back/reply, direct refresh, logout, mobile width and generated CSS response.
- Final post-build CSS evidence after a clean dev restart: `/_next/static/css/app/layout.css` returned `200 text/css`; login shell background was `rgb(7, 26, 47)` and the primary sign-in button was `rgb(15, 76, 67)`.

## Remaining Migration Gaps

- The unified app reuses the existing service-backed screens. Some pages can show empty states when local seed data has no current records, for example offered clinician queue items.
- The old fallback apps still exist and are intentionally preserved.
- The BFF service routing table remains a local gateway stand-in until the real API gateway is introduced.
