# Local Windows setup

This checkout uses local-only development credentials and a separate database. Never copy its `.env` files into production. The environment bootstrap refuses to overwrite any existing local `.env` file.

## Prerequisites

- Node.js and pnpm as declared by the workspace.
- Git Bash for `dev-web.sh`.
- PostgreSQL 17 client/server tools at `C:\Program Files\PostgreSQL\17\bin`, or Docker Desktop as an alternative.

The Windows PostgreSQL service on port 5432 is not used. The native local cluster binds only to `127.0.0.1:55432`, with data under the Git-ignored `Web/.local/postgres/data` directory. Docker is optional; if used, its database also binds only to loopback on port 55432 and uses a separately named Compose volume.

## Create local environment files

Run once from PowerShell in `Web/`:

```powershell
.\scripts\local\bootstrap-env.ps1
```

It creates ignored `.env` files for the services used by the unified launcher and `apps/web/.env.local`. It generates local database, shared JWT, gateway and NextAuth secrets. Each generated env file has a sibling `.env.example` with placeholders. Existing local env files are preserved; if only some exist, the script stops for manual review.

Install the locked workspace dependencies:

```powershell
pnpm install --frozen-lockfile
```

## Create the isolated PostgreSQL cluster

Run from `Web/` in PowerShell after env bootstrap. These commands initialize only the ignored worktree-local cluster; they do not connect to or change the Windows PostgreSQL service on port 5432.

```powershell
$line = Get-Content .env | Where-Object { $_ -like 'POSTGRES_PASSWORD=*' } | Select-Object -First 1
$dbPassword = $line.Substring('POSTGRES_PASSWORD='.Length)
New-Item -ItemType Directory -Path .local\postgres -Force | Out-Null
[System.IO.File]::WriteAllText((Join-Path (Get-Location) '.local\postgres\initdb-password.tmp'), $dbPassword)
& 'C:\Program Files\PostgreSQL\17\bin\initdb.exe' -D .local\postgres\data --username=ahealth --pwfile=.local\postgres\initdb-password.tmp --auth-local=trust --auth-host=scram-sha-256 --encoding=UTF8 --no-instructions
Remove-Item .local\postgres\initdb-password.tmp -Force
& 'C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe' -D .local\postgres\data -l .local\postgres\server.log -o '-p 55432 -h 127.0.0.1' -w start
$env:PGPASSWORD = $dbPassword
$psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
& $psql -X -w -h 127.0.0.1 -p 55432 -U ahealth -d postgres -v ON_ERROR_STOP=1 -c 'CREATE DATABASE ahealth_dev'
& $psql -X -w -h 127.0.0.1 -p 55432 -U ahealth -d postgres -v ON_ERROR_STOP=1 -c 'CREATE DATABASE ahealth_test'
Remove-Item Env:\PGPASSWORD
```

For Docker Desktop instead, first stop the native cluster if it is running. The Compose project name isolates its volume from other projects; the mapped database port is `127.0.0.1:55432`:

```powershell
docker compose --project-name ahealth-integration -f docker-compose.dev.yml up -d postgres
```

Stop that database without removing its volume:

```powershell
docker compose --project-name ahealth-integration -f docker-compose.dev.yml stop postgres
```

## Migrate and seed development accounts

The development and test databases start empty. Apply the existing migrations to both; no migration files are created by this setup:

```powershell
$line = Get-Content services\auth\.env | Where-Object { $_ -like 'DATABASE_URL=*' } | Select-Object -First 1
$env:DATABASE_URL = $line.Substring('DATABASE_URL='.Length)
pnpm --filter @a-health/database exec prisma migrate deploy
$env:DATABASE_URL = $env:DATABASE_URL.Replace('/ahealth_dev?', '/ahealth_test?')
pnpm --filter @a-health/database exec prisma migrate deploy
Remove-Item Env:\DATABASE_URL
```

Only after confirming the next commands target `ahealth_dev`, run the two existing auth-service development seeds. They create the clinician/admin accounts and related local queue/admin fixtures. Do not run them against the test database. The `AHP_STAFF_DEMO_V1` seed is separate and is not part of this bootstrap.

```powershell
$line = Get-Content services\auth\.env | Where-Object { $_ -like 'DATABASE_URL=*' } | Select-Object -First 1
$env:DATABASE_URL = $line.Substring('DATABASE_URL='.Length)
pnpm --filter @a-health/auth exec tsx scripts/seed-dev.ts
pnpm --filter @a-health/auth exec tsx scripts/seed-admin.ts
Remove-Item Env:\DATABASE_URL
```

The safe local stubs are explicit in code: AI and transcription use `stub`, mobile money uses `console`, and auth returns development OTPs. No real AI, SMS or payment credentials are needed. External delivery and provider calls are not tested by this setup.

## Start and stop the unified stack

From `Web/` in Git Bash:

```bash
bash dev-web.sh web
```

This starts the unified staff app at <http://localhost:3000> and its 21 required Final services, including patient profile service `4002` and pharmacy `4011`. Press **Ctrl+C** in that terminal to stop the app and services started by the launcher.

To stop only the isolated native database after the app stack is stopped, run from PowerShell in `Web/`:

```powershell
& 'C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe' -D .local\postgres\data -m fast -w stop
```

After code/config changes, run `pnpm --filter a-health-web type-check`. Stop the dev server before `pnpm --filter a-health-web build`; do not build while Next dev is using the same `.next` directory.

For the focused follow-up tests, set `DATABASE_URL` to the test database before running them:

```powershell
$line = Get-Content services\auth\.env | Where-Object { $_ -like 'DATABASE_URL=*' } | Select-Object -First 1
$env:DATABASE_URL = $line.Substring('DATABASE_URL='.Length).Replace('/ahealth_dev?', '/ahealth_test?')
if (([uri]$env:DATABASE_URL).AbsolutePath.Trim('/').Split('?')[0] -ne 'ahealth_test') { throw 'Refusing to run tests outside ahealth_test' }
pnpm --filter @a-health/followup test
Remove-Item Env:\DATABASE_URL
```

## Troubleshooting

- If `55432` is busy, inspect its listener first. Do not stop or reconfigure the Windows PostgreSQL service; choose another loopback port and update the local env files and database launch options together.
- If the local cluster is already initialized, do not rerun `initdb`; start it with the `pg_ctl` command in the stop section, changing `stop` to `start` and omitting `-m fast`.
- If a service fails, inspect its matching `Web/.dev-logs/<service>.log`. The launcher checks required env files and service ports before it starts the app.
- If an env file exists already, the bootstrap script leaves it untouched and stops rather than replacing secrets.
- Prisma migrations must target `ahealth_dev` or `ahealth_test` on port 55432. Never point this workflow at the Windows service on 5432.
