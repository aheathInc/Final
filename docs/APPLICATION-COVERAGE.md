# A-health Web Application Coverage

> **Historical evidence only:** This coverage report describes the AHP workspace and its tests from 2026-09-13. Patient-web rows below are not part of the recovered unified staff app; no Patient web module was restored. Final runtime/browser coverage is pending verification.

Last updated: 2026-09-13.

Main local web entry: `http://localhost:3000/login`.
Current start command from `Web/`: `bash dev-web.sh web` (starts the required local services and unified app), or `pnpm --filter a-health-web dev` when services are already running. The historical `scripts/local/start.sh` helper is not present in Final.

Executor note: browser verification used temporary `http://127.0.0.1:3001` inside one foreground shell because this managed executor cannot reliably expose detached tmux/nohup listeners across command namespaces and port 3000 was held by an invisible listener. The app package itself runs on port 3000 by default.

## Connected routes

| Requirement/source | Screen | API/service | Implementation | Test evidence |
| --- | --- | --- | --- | --- |
| SA&D v2 1.2, 2.1 patient web intake | `/patient/consult` | `POST /consultations`, `GET /consultations`, `GET/POST /care-threads/{id}/messages` | Working | Firefox: patient submitted synthetic consultation; clinician accepted same request; persisted messages verified. |
| Blueprint section 6 patient dashboard/record | `/patient/home`, `/patient/records`, `/patient/profile` | `/users/me`, `/care-threads`, `/investigation-orders`, risk/vaccination reads | Working with gaps | Firefox: patient home refresh preserved data. Emergency contacts have no dedicated API. |
| SA&D v2 2.3 follow-up | `/patient/follow-up` | `GET /check-ins`, `POST /check-ins/{id}/respond` | Working where check-ins exist | Firefox: follow-up page loaded after clinician scheduled follow-up. |
| SA&D v2 2.4 medication adherence | `/patient/medications` | `GET /patient-profiles/{id}/prescriptions`, `GET /adherence-logs`, `POST /adherence-logs/{id}/confirm` | Working | Firefox: patient saw Paracetamol prescription created by clinician completion. |
| Blueprint provider/facility discovery | `/patient/appointments` | `/clinicians`, `/facilities`, `/appointments` | Partly working | Read screens connected. Slot booking UI is a remaining gap; API requires real slot id. |
| Blueprint emergency flow | `/patient/emergency` | `/emergency-requests` | Working local simulation | Request can persist locally. Real ambulance/provider dispatch remains MOCKED/local. |
| Blueprint family/one-family-one-doctor | `/patient/family` | `/families/me`, `/users/me/dependents` | Partly working | Dependants can persist. Family subscription/assignment depends on backend data. |
| Blueprint education/prevention/AI | `/patient/learn`, `/doctor/assistant` | `/education/articles`, `/screening-*`, `/ai/*` | Partly working | Education/prevention reads connected. Live AI provider remains MOCKED; no diagnosis/prescribing claim. |
| Insurance/payment/feedback | `/patient/coverage` | `/insurance/*`, `/payments`, `/incident-reports` | Partly working | Reads/actions connected where authorized; external payment providers remain MOCKED/local. |
| Clinician console reuse | `/doctor/*` | Existing clinician BFF/service APIs | Working | Firefox: clinician real login, queue, accept same request, message, complete with prescription/follow-up. |
| Admin/Ops console reuse | `/admin/*` | Existing admin BFF/service APIs | Working | Firefox: platform admin real login and emergency page visible. |
| Analytics/research reuse | `/analytics/*` | `/surveillance/*`, `/research/*` | Working | Firefox: platform admin accessed surveillance data-backed page. |
| Authorization | all protected namespaces | NextAuth JWT + backend RBAC | Working | Firefox: patient rejected from `/admin/emergency`; staff routes use backend BFF token. |

## Remaining gaps

- MISSING: native React Native/Expo mobile app and offline local queue UI.
- MISSING: blockchain identity/credential/escrow/ledger/consent implementation and real on-chain evidence.
- MISSING: patient emergency-contact CRUD API in the current contract.
- MISSING: complete patient slot-picker/appointment booking UI; backend booking by slot id exists.
- MISSING: pharmacy partner dispensing UI; patient can read prescriptions and supported medication/pharmacy endpoints, but pharmacist workflow remains separate/unbuilt.
- MISSING: full patient consent-grant management UI; backend contract currently exposes ownership/RBAC but not a dedicated consent screen in this web app.
- IMPLEMENTED BUT UNVERIFIED: some patient insurance/payment/incident write paths beyond page wiring.
- MOCKED: live AI providers, SMS/USSD aggregators, push/SMS delivery, mobile-money providers, emergency transport integrations.
- BLOCKED IN MANAGED EXECUTOR: persistent detached local servers on port 3000; verified in a foreground shell on port 3001.
