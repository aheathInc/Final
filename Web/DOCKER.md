# Docker deployment

This repository has a development backend stack and a frontend deployment layer. Docker Compose runs PostgreSQL, the backend services, and all three Next.js applications without changing the application stack.

## Prerequisites

- Docker Engine with Compose v2
- At least 4 GB of available memory

## Start the full stack

From the repository root:

```bash
docker compose -f docker-compose.dev.yml build --parallel
docker compose -f docker-compose.dev.yml -f docker-compose.frontend.dev.yml build --parallel
docker compose -f docker-compose.dev.yml -f docker-compose.frontend.dev.yml up -d --no-build
```

The first build installs the workspace dependencies and creates production Next.js images. The Dockerfiles use a persistent BuildKit pnpm cache, so interrupted or later builds do not need to download the entire workspace again. Backend services stay private inside the Compose network, while the frontend containers reach them through Docker service names.

Build in two stages so one failed frontend download does not cancel the entire backend build:

```bash
docker compose -f docker-compose.dev.yml build --parallel
docker compose -f docker-compose.dev.yml -f docker-compose.frontend.dev.yml build --parallel
```

Then start the already-built images:

```bash
docker compose -f docker-compose.dev.yml -f docker-compose.frontend.dev.yml up -d --no-build
```

Apply database migrations before using the application:

```bash
docker compose -f docker-compose.dev.yml -f docker-compose.frontend.dev.yml run --rm \
  auth sh -lc 'cd /repo && pnpm --filter @a-health/database exec prisma migrate deploy'
```

The migration command runs inside the backend image and uses the Compose database hostname `postgres`.

The frontend overlay publishes PostgreSQL on host port `15432` so it can coexist with a system PostgreSQL service. Backend containers still use the internal `postgres:5432` address.

The database image is PostgreSQL 16, matching the existing development volume format and the project documentation. Do not remove the `ahealth_pg_data` volume unless you intentionally want to erase the development database.

Open the applications:

- Clinician dashboard: http://localhost:3100
- Operations console: http://localhost:3200
- Analytics portal: http://localhost:3300

For the patient mobile app, use the LAN API base URL `http://10.111.165.88:8080/api/v1`. The API edge routes authenticated requests to the private backend services; do not configure the phone to call ports `4001`–`4025` directly.

For a phone on the same Wi-Fi, open `http://10.111.165.88:3100`, `http://10.111.165.88:3200`, or `http://10.111.165.88:3300`. The three frontend ports are bound to all host interfaces, and backend ports remain private inside Docker. This is LAN access, not internet exposure; do not forward these ports through your router. If the computer receives a different LAN IP, export `DOCTOR_NEXTAUTH_URL`, `ADMIN_NEXTAUTH_URL`, and `ANALYTICS_NEXTAUTH_URL` with the new address before recreating the frontend containers.

Check status and logs:

```bash
docker compose -f docker-compose.dev.yml -f docker-compose.frontend.dev.yml ps
docker compose -f docker-compose.dev.yml -f docker-compose.frontend.dev.yml logs -f doctor-admin
```

Stop the stack:

```bash
docker compose -f docker-compose.dev.yml -f docker-compose.frontend.dev.yml down
```

This is a development deployment. Replace the default database password, JWT secret, and NextAuth secret before exposing it beyond the local machine.
