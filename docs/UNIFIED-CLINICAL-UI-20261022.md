# A-Health — Unified Clinical Staff Web UI

Date: 2026-10-22
Status: implemented frontend candidate; browser-rendered component verification completed. Full locked Next.js build and live-stack acceptance remain required.

## Requested visual reference

The owner approved the six-panel A-Health Staff Web board: narrow dark petrol sidebar, mint geometric depth, white glass topbar, clinical image/illustration heroes, elevated white surfaces, soft borders, and compact, clear clinical worklists. Follow-up is the visual anchor.

The implementation follows that composition and surface language. It is not a pixel-identical reproduction of generated sample text: real application fields, actual statuses, existing authorization, and recorded data take precedence. Unsupported search/notification/draft actions and fabricated patient counts from the illustration were not added.

## Baseline and boundaries

Input: `A-Health-Platform-Premium-Patient-UI-20261021.zip`
SHA-256: `446e1e67d8dbb1bf1a2bbda92189bf3b3909ba2701a7d1bbb4d37bda22f7deb3`

That archive retains the owner's activated monorepo and the latest Premium Patient Flutter changes. This delivery changes Staff Web presentation plus UI tests, documentation and integrity metadata only. Backend services, database schema, all 22 migrations, Flutter files, API contracts, authentication implementation, middleware, BFF handlers, and dependency lockfiles are byte-preserved. No database was connected, and no commit, deployment, package upgrade or production action occurred.

The pre-existing handover/candidate reports are historical; they are not evidence of current UI runtime acceptance. The current archive file manifest is `SHA256SUMS.txt`; its old input copy is preserved under `docs/unified-ui/BASELINE-SHA256SUMS.txt`.

## What changed

### Global shell

`components/premium/StaffShell.tsx` provides one visual shell for the existing Staff Web route tree: compact petrol navigation, current role, actual user context, grouped route links, soft-glass topbar, workspace-navigation search, native modal mobile drawer, keyboard Escape/focus handling, and existing logout calls. It never derives privileges from the selected URL.

Navigation search searches permitted workspace labels, not patient records. No fake notification badge is shown. Server route guards remain authoritative and unchanged.

`DisplayPreferences` implements Light, Dark and System themes plus Comfortable/Compact density. Only display preferences are stored in browser local storage. The initial theme script prevents an avoidable theme flash. There is no patient-data cache in these components.

### Source palette

Original palette values are unchanged: ink `#10241F`, paper `#F4F6F2`, petrol `#0F4C43`, amber `#C2700B`, clay `#A63D2F`, with existing teal/blue support colors. Dark theme and mint surface aliases are derived presentation tokens; semantic warning/danger meaning is retained. The original Tailwind configuration is unchanged.

### Medical imagery and motion

Eight local decorative artworks support the shared hero: overview, follow-up, referrals, diagnostics, records, analytics, pharmacy and network. The follow-up visual is a crop of the owner-provided AI-generated board, not a real patient, staff member, medical record or testimonial. Other assets are newly authored SVG illustrations. They do not contact an image service or load remotely.

Static imports let Next.js serve the assets under its existing static-asset path without changing authentication middleware. Hero titles/descriptions reveal gently once; controls have restrained hover/press feedback. Reduced-motion and reduced-transparency fallbacks are present. Clinical tables and forms stay opaque. No autoplay carousel, flashing warning, rotating clinical advice or continuously moving medical information was added.

### Primary compositions

- **Follow-up:** image hero; readable patient worklist; true review state/date; local loaded-patient search; existing selected-patient clinical review, medication timing and planned-contact panels. Review/closure actions are unchanged.
- **Doctor queue:** illustrated welcome, actual returned-record counts and existing offer/active-case controls. No hospital-wide totals or invented trends. Existing offer expiry and accept/decline handlers are unchanged.
- **Digital referrals:** layered-folder hero; case/destination and clinical-context sections; scoped consent guidance; existing inbox/sent items and lifecycle actions. The numbered sections are not new backend workflow steps. No unsupported Save Draft action was added.
- **Diagnostics:** laboratory artwork, filterable loaded orders and readable status table. Reported values are not clinically interpreted by UI code. The `Not resulted` filter is literal, not a new diagnostic status.
- **Patient history:** source-filterable timeline with native/imported labels and expandable provenance; existing risk/vaccination/prescription context and authorized action retained. Unavailable/unauthorized history is not described as an empty medical record.
- **Admin/Analytics:** layered chart artwork, actual service-returned metrics and source-based bar comparisons; missing data is shown as unavailable, not zero. Percentages, historical growth and synthetic operational totals are not inserted into production pages.
- **Pharmacy, collaboration, interoperability, audit and remaining pages:** shared hero/shell/cards/forms/tables applied without changing existing writes, endpoints or authorization.
- **Login:** corresponding branded split layout, restrained illustration, display controls and original credential submission flow.

The shared shell spans all 48 `page.tsx` files in Staff Web (including redirects). Existing shared page-header users receive the new visual system. This does not mean that all 48 routes received an independently exercised live workflow or that the separate legacy applications in `apps/admin`, `apps/analytics`, and `apps/doctor-admin` were redesigned. Flutter remains the existing premium mobile version.

## Executed verification

| Check | Result | Exact scope |
| --- | --- | --- |
| Component browser renders | 48/48 | 12 representative workspaces × desktop Light/Dark, 390px and 768px Light; Chromium, synthetic session/API adapter |
| Browser page errors | 0 | Above preview renders |
| UI interaction checks | 17/17 | Search, clinical tabs, drawer focus/Tab/Escape, inert background, route-close, role-filtered navigation, themes, density, reduced motion, unavailable versus empty states |
| Request-preservation comparison | 20/20 unchanged | Normalized AST of existing referral, pharmacy, follow-up, queue and login request/action handlers |
| Source assertions | 11/11 | Navigation boundaries/routes, local assets, original palette, fallbacks, source/syntax parsing |
| TS/TSX parse | 125 files, 0 syntax errors | Staff Web source and tests using TypeScript 5.8.3; not semantic type-check |
| Source preservation | Verified by hashes | Backend, Flutter, middleware/auth/BFF, database and dependency files |
| Full Next.js type-check / ESLint / production build | NOT RUN | Locked repository dependencies were unavailable here; registry DNS lookup failed |
| Live HTTP/JWT/DB / Firefox E2E | NOT RUN | No live app/backend stack in this execution environment |
| Complete WCAG audit / Lighthouse / device E2E | NOT RUN | Focused interaction checks are not conformance certification |

### Exact browser harness limitations

The downloadable HTML is built from actual modified TSX components, transpiled and run in Chromium. It uses synthetic fixtures with Next routing/auth/API adapters only inside that standalone preview, never in the application source. Simulated writes are not persisted or sent to a real service. The preview labels this visibly.

An installed React 18.2 runtime was used for the offline preview; the real app retains its locked React 18.3.1 dependencies. Tailwind 4 was used to produce equivalent preview utilities, while application source retains its unchanged Tailwind 3 configuration; custom design CSS is source-identical. Consequently screenshots demonstrate visual direction and component behavior, not a locked-toolchain production build.

Browser navigation to file/loopback URLs was blocked by the host browser policy. Tests used Playwright `set_content` with self-contained markup; no browser policy was disabled. Real-origin theme persistence is covered by the new live Playwright test but was not executed here. Theme changes, density changes and system-media response were exercised in the inline harness.

During QA an Escape/search interaction and a Tab boundary that reached browser chrome were found and fixed in the new modal handling. A mobile stylesheet that concealed a review badge was corrected so the clinical status remains visible.

## Verification on the owner's existing isolated stack

Use a separate review checkout. Preserve local environment files without uploading or committing them. Do not apply this archive with Replace All over a working checkout.

At the monorepo root:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm --filter a-health-web type-check
corepack pnpm --filter a-health-web lint
corepack pnpm --filter a-health-web build
```

Do not run a Next production build against the same `.next` directory being used by a dev process. Stop only that review checkout's frontend first, or use a separate checkout. No database reset, migrations or seeds are necessary for this UI update.

For the real UI tests, run the local Staff Web on an unused port, point its existing BFF URLs to the correct owned local services, set `PLAYWRIGHT_BASE_URL`, and use existing synthetic E2E identities in ignored local configuration. Then, from `apps/staff-web`:

```powershell
corepack pnpm exec playwright test tests/e2e/unified-clinical-ui.spec.ts --project=firefox
```

The test uses real login and no injected cookies or mocked BFF data. It skips its authenticated checks if required credentials are absent; skips are not passes. Existing staff/referral acceptance selectors were updated only for the new visible headings and shell. Run those suites and existing clinical workflow tests before merging.

Source-only check after locked dependencies are installed:

```powershell
node verification/unified-clinical-ui/source-check.cjs
```

## Evidence and integration

`docs/unified-ui/evidence/` contains sanitized JSON summaries, not real patient data or authentication material. The separate screenshot package contains only labeled synthetic preview captures. No pending UI/Demo archive was blindly overlaid.

The UI-only distribution includes a file-hash manifest and a Node installer which defaults to a dry run and refuses conflicts. It makes an external backup before writing reviewed source files. Never override its hash mismatch by force: reconcile current local edits first.

The UI is an implemented review candidate. Approval for production or real clinical use still requires the actual locked build, live authentication/clinical regressions, and owner visual review.
