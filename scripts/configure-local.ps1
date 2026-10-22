$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $repo '.env'
$donePath = Join-Path $repo '.local\configure-local.done'
$pgBin = 'C:\Program Files\PostgreSQL\17\bin'
$psql = Join-Path $pgBin 'psql.exe'
$pgIsReady = Join-Path $pgBin 'pg_isready.exe'

function ConvertTo-PlainText([System.Security.SecureString] $Value) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function New-LocalSecret([int] $Bytes = 48) {
  $buffer = [byte[]]::new($Bytes)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($buffer) } finally { $generator.Dispose() }
  return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

if (Test-Path $configPath) {
  $keys = Get-Content $configPath | ForEach-Object {
    if ($_ -match '^\s*([A-Z][A-Z0-9_]*)=') { $Matches[1] }
  }
  if ($keys -contains 'DATABASE_URL' -and $keys -contains 'JWT_SECRET') {
    Write-Host 'The local .env already contains the required keys. It was left unchanged.'
    exit 0
  }
  throw 'A partial .env already exists. It was left unchanged; complete it manually before continuing.'
}

if (-not (Test-Path $psql) -or -not (Test-Path $pgIsReady)) {
  throw 'PostgreSQL 17 command-line tools were not found in the expected installation directory.'
}
& $pgIsReady -h 127.0.0.1 -p 55432 -t 2 | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'The isolated AHP database is not accepting connections on 127.0.0.1:55432.' }

$identity = ''
$dbPassword = ''
while ($identity -ne 'ahealth_dev|ahealth|55432') {
  $secureDbPassword = Read-Host 'AHP database password for ahealth_dev on 127.0.0.1:55432 (masked)' -AsSecureString
  $dbPassword = ConvertTo-PlainText $secureDbPassword
  if ([string]::IsNullOrEmpty($dbPassword)) { Write-Host 'A database password is required.'; continue }

  $env:PGPASSWORD = $dbPassword
  $result = & $psql -X -q -A -t -h 127.0.0.1 -p 55432 -U ahealth -d ahealth_dev -c "SELECT current_database() || '|' || current_user || '|' || inet_server_port();" 2>&1
  $psqlExitCode = $LASTEXITCODE
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  if ($psqlExitCode -eq 0) { $identity = ($result | Out-String).Trim() }
  if ($identity -ne 'ahealth_dev|ahealth|55432') {
    Write-Host 'Authentication or database identity check failed. The secret was not saved; try again.'
  }
}

$secureJwtSecret = Read-Host 'Existing JWT_SECRET for this local database (masked; press Enter to create a new one)' -AsSecureString
$jwtSecret = ConvertTo-PlainText $secureJwtSecret
if ([string]::IsNullOrEmpty($jwtSecret)) { $jwtSecret = New-LocalSecret }
if ($jwtSecret.Length -lt 32 -or $jwtSecret.Contains("`n") -or $jwtSecret.Contains("`r")) {
  throw 'JWT_SECRET must be at least 32 characters and fit on one line. No configuration was written.'
}

$encodedDbPassword = [Uri]::EscapeDataString($dbPassword)
$databaseUrl = "postgresql://ahealth:$encodedDbPassword@127.0.0.1:55432/ahealth_dev?schema=public"
$testDatabaseUrl = "postgresql://ahealth:$encodedDbPassword@127.0.0.1:55432/ahealth_dev?schema=ahp_test"
$lines = @(
  'NODE_ENV=development'
  'POSTGRES_HOST_PORT=55432'
  "DATABASE_URL=$databaseUrl"
  "TEST_DATABASE_URL=$testDatabaseUrl"
  "JWT_SECRET=$jwtSecret"
  'JWT_ISSUER=a-health'
  'JWT_AUDIENCE=a-health-api'
  "GATEWAY_SHARED_SECRET=$(New-LocalSecret 32)"
  'NEXTAUTH_URL=http://localhost:3000'
  "NEXTAUTH_SECRET=$(New-LocalSecret 48)"
  'CORS_ORIGINS=http://localhost:3000,http://localhost:3100,http://localhost:3200,http://localhost:3300,http://127.0.0.1:3000,http://127.0.0.1:3100,http://127.0.0.1:3200,http://127.0.0.1:3300'
  'AUTH_LOCAL_OTP_MODE=true'
  'OTP_ECHO_IN_RESPONSE=true'
  'OTP_LOG_TO_CONSOLE=false'
  'SMS_PROVIDER=console'
  'MOBILE_MONEY_PROVIDER=console'
  "WEBHOOK_SECRET_MPESA=$(New-LocalSecret 32)"
  "WEBHOOK_SECRET_TIGO_PESA=$(New-LocalSecret 32)"
  "WEBHOOK_SECRET_AIRTEL_MONEY=$(New-LocalSecret 32)"
  'CHAT_PROVIDER=stub'
  'TRANSCRIBE_PROVIDER=stub'
  "AHP_LOCAL_TEST_PASSWORD=$(New-LocalSecret 32)"
  'AUTH_SERVICE_URL=http://127.0.0.1:4001'
  'PATIENT_SERVICE_URL=http://127.0.0.1:4002'
  'DOCTOR_SERVICE_URL=http://127.0.0.1:4003'
  'APPOINTMENT_SERVICE_URL=http://127.0.0.1:4004'
  'CONSULTATION_SERVICE_URL=http://127.0.0.1:4005'
  'MESSAGING_SERVICE_URL=http://127.0.0.1:4006'
  'FOLLOWUP_SERVICE_URL=http://127.0.0.1:4007'
  'AI_SERVICE_URL=http://127.0.0.1:4009'
  'EMERGENCY_SERVICE_URL=http://127.0.0.1:4010'
  'PHARMACY_SERVICE_URL=http://127.0.0.1:4011'
  'PAYMENT_SERVICE_URL=http://127.0.0.1:4012'
  'DIAGNOSTICS_SERVICE_URL=http://127.0.0.1:4013'
  'QUALITY_SERVICE_URL=http://127.0.0.1:4014'
  'FAMILIES_SERVICE_URL=http://127.0.0.1:4015'
  'EDUCATION_SERVICE_URL=http://127.0.0.1:4016'
  'NETWORK_SERVICE_URL=http://127.0.0.1:4017'
  'INSURANCE_SERVICE_URL=http://127.0.0.1:4018'
  'RESEARCH_SERVICE_URL=http://127.0.0.1:4019'
  'SURVEILLANCE_SERVICE_URL=http://127.0.0.1:4020'
  'SYNC_SERVICE_URL=http://127.0.0.1:4022'
  'DEVICES_SERVICE_URL=http://127.0.0.1:4023'
  'PREVENTION_SERVICE_URL=http://127.0.0.1:4024'
  'FACILITIES_SERVICE_URL=http://127.0.0.1:4025'
)

[IO.File]::WriteAllLines($configPath, $lines, [Text.UTF8Encoding]::new($false))
$null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $donePath)
[IO.File]::WriteAllText($donePath, (Get-Date).ToUniversalTime().ToString('o'), [Text.UTF8Encoding]::new($false))
Write-Host 'Local .env saved. The database identity is verified; secrets were not displayed.'
Write-Host 'The configured SMS, mobile-money and AI adapters are local simulations.'
Read-Host 'Press Enter to close this secure setup window' | Out-Null
