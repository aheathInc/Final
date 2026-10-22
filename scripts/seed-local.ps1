$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $repo '.env'
if (-not (Test-Path $configPath)) { throw 'Local .env is missing. Run scripts/configure-local.ps1 first.' }

foreach ($line in Get-Content $configPath) {
  if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
    $name = $Matches[1]
    $value = $Matches[2]
    if ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) {
      $value = $value.Substring(1, $value.Length - 2).Replace('\"', '"').Replace('\\n', "`n").Replace('\\r', "`r")
    } elseif ($value.Length -ge 2 -and $value.StartsWith("'") -and $value.EndsWith("'")) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}

$databaseUrl = [Uri]::new($env:DATABASE_URL)
$databaseName = [Uri]::UnescapeDataString($databaseUrl.AbsolutePath.TrimStart('/').Split('/')[0])
if ($databaseUrl.Host -ne '127.0.0.1' -or $databaseUrl.Port -ne 55432 -or $databaseName -ne 'ahealth_dev') {
  throw 'Local role seed requires ahealth_dev on 127.0.0.1:55432.'
}
if ($env:NODE_ENV -ne 'development' -or [string]::IsNullOrWhiteSpace($env:AHP_LOCAL_TEST_PASSWORD)) {
  throw 'Development mode and the private local test password are required.'
}

Push-Location $repo
try {
  & pnpm --filter @a-health/auth exec tsx scripts/seed-local-roles.ts
  if ($LASTEXITCODE -ne 0) { throw 'Local role seed failed.' }
} finally { Pop-Location }
