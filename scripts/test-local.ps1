$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $repo '.env'
$pgBin = 'C:\Program Files\PostgreSQL\17\bin'
$pgCtl = Join-Path $pgBin 'pg_ctl.exe'
$pgIsReady = Join-Path $pgBin 'pg_isready.exe'
$psql = Join-Path $pgBin 'psql.exe'
$pgData = 'C:\Users\User\AppData\Local\AHP\postgres17-data'
$logDir = Join-Path $repo '.local\logs'

if (-not (Test-Path $configPath)) { throw 'Local .env is missing. Run scripts/configure-local.ps1 first.' }
foreach ($line in Get-Content $configPath) {
  if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
    $name = $Matches[1]
    $value = $Matches[2]
    if ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) {
      $value = $value.Substring(1, $value.Length - 2).Replace('\\"', '"').Replace('\\n', "`n").Replace('\\r', "`r")
    } elseif ($value.Length -ge 2 -and $value.StartsWith("'") -and $value.EndsWith("'")) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}

if (-not (Test-Path $pgIsReady) -or -not (Test-Path $psql)) { throw 'PostgreSQL 17 command-line tools are unavailable.' }
$null = New-Item -ItemType Directory -Force -Path $logDir
$testUrl = [Uri]::new($env:TEST_DATABASE_URL)
$databaseName = [Uri]::UnescapeDataString($testUrl.AbsolutePath.TrimStart('/').Split('/')[0])
$query = $testUrl.Query.TrimStart('?')
if ($testUrl.Host -ne '127.0.0.1' -or $testUrl.Port -ne 55432 -or $databaseName -ne 'ahealth_dev' -or $query -ne 'schema=ahp_test') {
  throw 'TEST_DATABASE_URL must target the isolated ahp_test schema in ahealth_dev on 127.0.0.1:55432.'
}
$userInfo = [Uri]::UnescapeDataString($testUrl.UserInfo)
$separator = $userInfo.IndexOf(':')
if ($separator -lt 1 -or $userInfo.Substring(0, $separator) -ne 'ahealth') { throw 'TEST_DATABASE_URL must use the local ahealth user.' }
$env:PGPASSWORD = $userInfo.Substring($separator + 1)

& $pgIsReady -h 127.0.0.1 -p 55432 -t 2 | Out-Null
if ($LASTEXITCODE -ne 0) {
  $occupied = @(Get-NetTCPConnection -State Listen -LocalPort 55432 -ErrorAction SilentlyContinue)
  if ($occupied.Count -gt 0) { throw 'Port 55432 is occupied but is not the AHP PostgreSQL cluster. No process was stopped.' }
  if (-not (Test-Path (Join-Path $pgData 'PG_VERSION'))) { throw 'The isolated AHP PostgreSQL 17 data directory is missing.' }
  & $pgCtl -D $pgData -l (Join-Path $logDir 'postgres17.log') -o '-h 127.0.0.1 -p 55432' start
  if ($LASTEXITCODE -ne 0) { throw 'Could not start the isolated AHP PostgreSQL cluster.' }
  $deadline = (Get-Date).AddSeconds(30)
  do { Start-Sleep -Milliseconds 500; & $pgIsReady -h 127.0.0.1 -p 55432 -t 2 | Out-Null } while ($LASTEXITCODE -ne 0 -and (Get-Date) -lt $deadline)
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL did not become ready on 127.0.0.1:55432.' }
}

$identity = & $psql -X -q -A -t -h 127.0.0.1 -p 55432 -U ahealth -d ahealth_dev -c "SELECT current_database() || '|' || current_user || '|' || inet_server_port();" 2>$null
if ($LASTEXITCODE -ne 0 -or ($identity | Out-String).Trim() -ne 'ahealth_dev|ahealth|55432') { throw 'Test schema database identity check failed.' }

$runId = [guid]::NewGuid().ToString('N').Substring(0, 8)
$runStamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$baseTestSchema = "ahp_test_${runStamp}_$runId"
$env:AHP_TEST_FRONT_DESK_SCHEMA = "ahp_test_front_desk_${runStamp}_$runId"
$env:AHP_TEST_THREAD_SCHEMA = "ahp_test_thread_integrity_${runStamp}_$runId"
$testUrlWithoutQuery = $env:TEST_DATABASE_URL -replace '\?.*$', ''
$testSchemas = @($baseTestSchema, $env:AHP_TEST_FRONT_DESK_SCHEMA, $env:AHP_TEST_THREAD_SCHEMA)
$env:NODE_ENV = 'test'
$env:AHP_SAFETY_TEST_DB_ACK = 'ISOLATED_DISPOSABLE_AHEALTH_TEST'
Push-Location $repo
try {
  foreach ($schema in $testSchemas) {
    if ($schema -notmatch '^ahp_test(_[a-z0-9_]+)?$') { throw 'Generated test schema name failed validation.' }
    $schemaOwned = & $psql -X -q -A -t -h 127.0.0.1 -p 55432 -U ahealth -d ahealth_dev -c "SELECT nspowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) FROM pg_namespace WHERE nspname = '$schema';" 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect an isolated local test schema.' }
    if (-not [string]::IsNullOrWhiteSpace(($schemaOwned | Out-String).Trim())) { throw 'A generated local test schema already exists; existing schema data was left untouched.' }
    & $psql -X -q -h 127.0.0.1 -p 55432 -U ahealth -d ahealth_dev -c "CREATE SCHEMA `"$schema`" AUTHORIZATION ahealth;" 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Could not create an isolated local test schema.' }
    $env:DATABASE_URL = "$testUrlWithoutQuery`?schema=$schema"
    & pnpm --filter @a-health/database exec prisma migrate deploy
    if ($LASTEXITCODE -ne 0) { throw 'Test schema migration deployment failed.' }
    & pnpm --filter @a-health/database exec prisma migrate status
    if ($LASTEXITCODE -ne 0) { throw 'Test schema migration status failed after deployment.' }
  }
  $env:DATABASE_URL = "$testUrlWithoutQuery`?schema=$baseTestSchema"
  & pnpm exec turbo run test --concurrency=1
  if ($LASTEXITCODE -ne 0) { throw 'One or more monorepo test suites failed.' }
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Pop-Location
}
