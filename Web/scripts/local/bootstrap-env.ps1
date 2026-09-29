$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$targets = @((Join-Path $root '.env'))
$services = [ordered]@{
  auth=4001; patient=4002; doctor=4003; appointment=4004; consultation=4005
  messaging=4006; followup=4007; ai=4009; emergency=4010; pharmacy=4011
  payment=4012; diagnostics=4013; quality=4014; families=4015; education=4016
  network=4017; research=4019; surveillance=4020; devices=4023; prevention=4024
  facilities=4025
}
foreach ($name in $services.Keys) { $targets += Join-Path $root "services\$name\.env" }
$targets += Join-Path $root 'apps\web\.env.local'
$present = @($targets | Where-Object { Test-Path -LiteralPath $_ })
if ($present.Count -eq $targets.Count) {
  Write-Output 'Local env files already exist; preserving them without changing secrets.'
  exit 0
}
if ($present.Count -gt 0) {
  throw 'Some local env files already exist. Nothing was changed; review them manually before bootstrapping.'
}

function New-HexSecret([int]$byteCount) {
  $bytes = New-Object byte[] $byteCount
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}

$dbPassword = New-HexSecret 32
$jwtSecret = New-HexSecret 48
$nextAuthSecret = New-HexSecret 32
$gatewaySecret = New-HexSecret 32
$utf8 = New-Object System.Text.UTF8Encoding($false)
$localDir = Join-Path $root '.local'
[System.IO.Directory]::CreateDirectory($localDir) | Out-Null
$ignorePath = Join-Path $root '.gitignore'
if (-not (Select-String -Path $ignorePath -Pattern '^\.local/$' -Quiet)) {
  Add-Content -Path $ignorePath -Value '.local/'
}
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $localDir /inheritance:r /grant:r "*$sid`:(OI)(CI)F" | Out-Null
function Write-Lines([string]$path, [string[]]$lines) {
  [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($path)) | Out-Null
  [System.IO.File]::WriteAllText($path, (($lines -join "`n") + "`n"), $utf8)
}

Write-Lines (Join-Path $root '.env') @(
  'POSTGRES_HOST_PORT=55432', "POSTGRES_PASSWORD=$dbPassword", "JWT_SECRET=$jwtSecret",
  "GATEWAY_SHARED_SECRET=$gatewaySecret"
)
Write-Lines (Join-Path $root '.env.example') @(
  'POSTGRES_HOST_PORT=55432', 'POSTGRES_PASSWORD=replace-with-local-random-password',
  'JWT_SECRET=replace-with-at-least-32-random-local-characters',
  'GATEWAY_SHARED_SECRET=replace-with-at-least-16-random-local-characters',
  'AHP_STAFF_DEMO_PASSWORD=<set-local-demo-password>'
)

$dbUrl = "postgresql://ahealth:$dbPassword@localhost:55432/ahealth_dev?schema=public"
$dbExample = 'postgresql://ahealth:replace-with-local-password@localhost:55432/ahealth_dev?schema=public'
foreach ($name in $services.Keys) {
  $port = $services[$name]
  $actual = @('NODE_ENV=development', "PORT=$port", "DATABASE_URL=$dbUrl", "JWT_SECRET=$jwtSecret", 'JWT_ISSUER=a-health', 'JWT_AUDIENCE=a-health-api')
  $example = @('NODE_ENV=development', "PORT=$port", "DATABASE_URL=$dbExample", 'JWT_SECRET=replace-with-at-least-32-random-local-characters', 'JWT_ISSUER=a-health', 'JWT_AUDIENCE=a-health-api')
  if ($name -eq 'auth') { $actual += 'OTP_ECHO_IN_RESPONSE=true'; $example += 'OTP_ECHO_IN_RESPONSE=true' }
  if ($name -eq 'ai') { $actual += @('CHAT_PROVIDER=stub', 'TRANSCRIBE_PROVIDER=stub'); $example += @('CHAT_PROVIDER=stub', 'TRANSCRIBE_PROVIDER=stub') }
  if ($name -eq 'payment') { $actual += 'MOBILE_MONEY_PROVIDER=console'; $example += 'MOBILE_MONEY_PROVIDER=console' }
  $dir = Join-Path $root "services\$name"
  Write-Lines (Join-Path $dir '.env') $actual
  Write-Lines (Join-Path $dir '.env.example') $example
}

$ports = [ordered]@{
  AUTH_SERVICE_URL=4001; PATIENT_SERVICE_URL=4002; DOCTOR_SERVICE_URL=4003
  APPOINTMENT_SERVICE_URL=4004; CONSULTATION_SERVICE_URL=4005; MESSAGING_SERVICE_URL=4006
  FOLLOWUP_SERVICE_URL=4007; AI_SERVICE_URL=4009; EMERGENCY_SERVICE_URL=4010
  PHARMACY_SERVICE_URL=4011; PAYMENT_SERVICE_URL=4012; DIAGNOSTICS_SERVICE_URL=4013
  QUALITY_SERVICE_URL=4014; FAMILIES_SERVICE_URL=4015; EDUCATION_SERVICE_URL=4016
  NETWORK_SERVICE_URL=4017; INSURANCE_SERVICE_URL=4018; RESEARCH_SERVICE_URL=4019
  SURVEILLANCE_SERVICE_URL=4020; SYNC_SERVICE_URL=4022; DEVICES_SERVICE_URL=4023
  PREVENTION_SERVICE_URL=4024; FACILITIES_SERVICE_URL=4025
}
$app = @('NEXTAUTH_URL=http://localhost:3000', "NEXTAUTH_SECRET=$nextAuthSecret")
$appExample = @('NEXTAUTH_URL=http://localhost:3000', 'NEXTAUTH_SECRET=replace-with-32-random-local-bytes')
foreach ($name in $ports.Keys) {
  $url = "http://localhost:$($ports[$name])"
  $app += "$name=$url"
  $appExample += "$name=$url"
}
$webDir = Join-Path $root 'apps\web'
Write-Lines (Join-Path $webDir '.env.local') $app
Write-Lines (Join-Path $webDir '.env.example') $appExample
Write-Lines (Join-Path $webDir '.env.local.example') $appExample

foreach ($target in $targets) {
  & icacls.exe $target /inheritance:r /grant:r "*$sid`:F" | Out-Null
}
Write-Output "Created local-only env files and safe sibling templates for $($services.Count) services, Compose, and apps/web. Secret values were not printed."
