# A-Health Unified Clinical UI — start here

This full project is based on the latest Premium Patient UI archive supplied in this conversation. It adds the owner-approved unified clinical visual direction to **Staff Web**, without changing backend, database, Auth/BFF/middleware or Flutter source.

## Open the product

- Main app: `apps/staff-web`.
- Follow-up: `/doctor/follow-up`.
- Doctor: `/doctor/queue`; referrals: `/doctor/referrals`; diagnostics: `/doctor/diagnostics`.
- Pharmacy: `/pharmacy`; administration: `/admin/dashboard`; analytics: `/analytics/dashboard`.
- Other existing routes keep their functionality and share the updated shell and visual components.

Extract into a NEW directory; do not overwrite a running checkout. Your existing `.env.local` and database passwords are intentionally not in this ZIP. Reuse them privately only after confirming the correct isolated service URLs. No migrations or seeds are needed for this frontend-only change. Do not touch PostgreSQL 5432.

Run the locked dependencies, type-check, lint and build as described in `docs/UNIFIED-CLINICAL-UI-20261022.md`. At the time this UI-only archive was prepared, the full Next build had not run. In the later consolidated workspace, `pnpm --filter a-health-web run build` passed and generated all 42 pages.

## What you can trust from this delivery

- Actual frontend source edits, not an image-only mockup.
- 48 scoped browser render checks and 17 interaction checks passed with synthetic adapters.
- Backend/Flutter/API/auth-related files and dependency versions remain unchanged.
- Clinical action handlers were compared to baseline; the selected 20 handlers are unchanged.
- Original source and earlier ZIPs were not modified.

The accompanying offline HTML is a preview of the actual TSX components with synthetic data, **not a live hospital system or a substitute for backend verification**. Labels and status values in the real app come from the current services.

Current integrity manifest: `SHA256SUMS.txt` (every file except itself). The baseline checksum list and old candidate reports are preserved for historical reference only. No Git commit/push/deployment has been performed.
