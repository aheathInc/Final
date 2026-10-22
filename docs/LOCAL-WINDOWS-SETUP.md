# Local Windows setup

This checkout is configured for development against the isolated PostgreSQL 17 instance at `127.0.0.1:55432`, database `ahealth_dev`, user `ahealth`. The local environment file is ignored by Git. These routines do not connect to PostgreSQL 5432, reset a database, or stop unrelated processes.

## Prerequisites

- Node.js 22 and pnpm 10
- PostgreSQL 17 client tools in `C:\Program Files\PostgreSQL\17\bin`
- The isolated AHP database initialized under `%LOCALAPPDATA%\AHP\postgres17-data` with database `ahealth_dev`
- Flutter SDK 3.24+ and Android SDK only for Patient Mobile

Install the locked JavaScript dependencies:

```powershell
pnpm install --frozen-lockfile
```

## Configure local credentials

Start the isolated database on loopback port 55432, then run:

```powershell
.\scripts\configure-local.ps1
```

The script securely prompts for the existing local database password and JWT secret. Keep the existing JWT secret when recovering an established database. The script writes a root `.env` only when none exists, generates separate development-only credentials, and never displays secret values. It refuses to overwrite a partial or complete existing `.env`.

The local provider settings are explicit simulations: OTP is returned through the local development response, SMS uses the console adapter, mobile-money uses local callback/signature handling, and AI/transcription use stubs. These settings are not suitable for production.

Create the marked synthetic role accounts:

```powershell
pnpm seed:local
```

Six accounts are provisioned: `platform_admin`, `facility_admin`, `clinician`, `lab_technician`, `pharmacist`, and `patient`. The shared generated password is held only in the ignored `.env`. Patient access uses OTP. The schema does not define a nurse role; `facility_admin` is the supported hospital/facility administrator role.

## Start and inspect the platform

```powershell
pnpm dev:local
pnpm dev:local:status
pnpm dev:local:stop
```

The launcher starts PostgreSQL only if it finds the configured isolated cluster stopped, verifies the database identity, deploys migrations, and starts all 25 backend APIs and four web applications. It checks every `/health` endpoint and each `/login` route. Stop targets only the recorded launcher process tree and stops PostgreSQL only if that launcher started it. The database and its contents are preserved.

| Application | URL |
|---|---|
| Staff Web | <http://localhost:3000/login> |
| Doctor Admin | <http://localhost:3100/login> |
| Operations Admin | <http://localhost:3200/login> |
| Analytics | <http://localhost:3300/login> |

The 25 backend services occupy ports 4001–4025; the complete port and readiness matrix is in [local-dev-readiness.md](local-dev-readiness.md).

## Patient Mobile

Use a physical Android phone over Wi-Fi; an emulator is not required. Enable Developer options > Wireless debugging. Pair this computer once using the temporary pairing address/code shown on the phone, then connect using the phone's separate wireless-debugging connection address:

```powershell
adb pair <PHONE_IP>:<PAIRING_PORT>
adb connect <PHONE_IP>:<CONNECT_PORT>
flutter devices
cd apps/patient-mobile
flutter run -d <PHONE_IP>:<CONNECT_PORT> --dart-define=API_HOST=<PC_LAN_IPV4>
```

Use the PC's current Wi-Fi IPv4 address from `ipconfig` for `API_HOST` and the phone's current wireless-debugging address for `CONNECT_PORT`; both can change between networks. The phone and PC must be on a network that permits device-to-device traffic. The dev API processes bind to interfaces reachable on the LAN. Keep PostgreSQL bound to loopback; the phone connects only to the API ports. Never use a production endpoint for this local debug build.

## Checks

```powershell
pnpm test:local
pnpm run build
cd apps/patient-mobile
flutter analyze
flutter test
flutter test integration_test/patient_ai_navigation_live_test.dart -d <PHONE_IP>:<CONNECT_PORT> --dart-define=API_HOST=<PC_LAN_IPV4>
```

`pnpm test:local` creates fresh uniquely named, owned schemas inside `ahealth_dev`, applies migrations, then runs the monorepo backend suites. The schemas are retained for inspection; there is no reset or cleanup step. The runner refuses nonlocal databases and port 5432.

## Logs and recovery

The launcher writes stdout/stderr under the ignored `.local\logs` directory and stores its process identity under `.local\dev-run.json`. If a recorded process is stale, inspect its log and use `pnpm dev:local:stop` only after confirming the recorded PID still belongs to this launcher. Never remove or reinitialize the PostgreSQL data directory as a troubleshooting step.
