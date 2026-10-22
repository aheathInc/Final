param(
  [switch] $Status,
  [switch] $Stop,
  [switch] $Child,
  [string] $RunId
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $repo '.env'
$statePath = Join-Path $repo '.local\dev-run.json'
$logDir = Join-Path $repo '.local\logs'
$pgData = 'C:\Users\User\AppData\Local\AHP\postgres17-data'
$pgBin = 'C:\Program Files\PostgreSQL\17\bin'
$pgCtl = Join-Path $pgBin 'pg_ctl.exe'
$pgIsReady = Join-Path $pgBin 'pg_isready.exe'
$psql = Join-Path $pgBin 'psql.exe'
$servicePorts = [ordered]@{
  auth=4001; patient=4002; doctor=4003; appointment=4004; consultation=4005
  messaging=4006; followup=4007; notification=4008; ai=4009; emergency=4010
  pharmacy=4011; payment=4012; diagnostics=4013; quality=4014; families=4015
  education=4016; network=4017; insurance=4018; research=4019; surveillance=4020
  gateway=4021; sync=4022; devices=4023; prevention=4024; facilities=4025
}
$appPorts = [ordered]@{ 'Staff Web'=3000; 'Doctor Admin'=3100; 'Operations Admin'=3200; Analytics=3300 }
$ownedPorts = @($servicePorts.Values) + @($appPorts.Values)

if (-not ('AHealthProcessNative' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AHealthProcessNative {
  [StructLayout(LayoutKind.Sequential)] public struct FILETIME { public int Low; public int High; }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int processId);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process, out FILETIME creation, out FILETIME exit, out FILETIME kernel, out FILETIME user);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

  public static int TerminateIfStartTimeMatches(int processId, long expectedFileTime, int toleranceMilliseconds) {
    const uint PROCESS_TERMINATE = 0x0001;
    const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    const uint SYNCHRONIZE = 0x00100000;
    const uint WAIT_OBJECT_0 = 0;
    const uint WAIT_TIMEOUT = 258;
    IntPtr process = OpenProcess(PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, false, processId);
    if (process == IntPtr.Zero) return Marshal.GetLastWin32Error();
    try {
      FILETIME creation, exit, kernel, user;
      if (!GetProcessTimes(process, out creation, out exit, out kernel, out user)) return Marshal.GetLastWin32Error();
      long actualFileTime = ((long)creation.High << 32) | (uint)creation.Low;
      long difference = Math.Abs(actualFileTime - expectedFileTime);
      if (difference > (long)toleranceMilliseconds * 10000L) return -1;
      uint current = WaitForSingleObject(process, 0);
      if (current == WAIT_OBJECT_0) return 0;
      if (current != WAIT_TIMEOUT) return Marshal.GetLastWin32Error();
      if (!TerminateProcess(process, 1)) {
        uint afterFailure = WaitForSingleObject(process, 0);
        return afterFailure == WAIT_OBJECT_0 ? 0 : Marshal.GetLastWin32Error();
      }
      uint result = WaitForSingleObject(process, 5000);
      return result == WAIT_OBJECT_0 ? 0 : (result == WAIT_TIMEOUT ? 1460 : Marshal.GetLastWin32Error());
    } finally { CloseHandle(process); }
  }
}
'@
}

function Import-LocalEnvironment {
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
}

function Assert-LocalDatabaseUrl {
  if ([string]::IsNullOrWhiteSpace($env:DATABASE_URL)) { throw 'DATABASE_URL is required.' }
  try { $script:databaseUri = [Uri]::new($env:DATABASE_URL) } catch { throw 'DATABASE_URL is invalid.' }
  $databaseName = [Uri]::UnescapeDataString($databaseUri.AbsolutePath.TrimStart('/').Split('/')[0])
  if ($databaseUri.Host -notin @('127.0.0.1', 'localhost') -or $databaseUri.Port -ne 55432 -or $databaseName -ne 'ahealth_dev') {
    throw 'The local launcher requires ahealth_dev on 127.0.0.1:55432. No other PostgreSQL endpoint will be used.'
  }
  if ([string]::IsNullOrWhiteSpace($env:JWT_SECRET) -or $env:JWT_SECRET.Length -lt 32) { throw 'JWT_SECRET must be at least 32 characters.' }
}

function Test-DatabaseIdentity {
  $userInfo = [Uri]::UnescapeDataString($databaseUri.UserInfo)
  $separator = $userInfo.IndexOf(':')
  if ($separator -lt 1) { throw 'DATABASE_URL must include the local ahealth database credentials.' }
  $dbUser = $userInfo.Substring(0, $separator)
  if ($dbUser -ne 'ahealth') { throw 'DATABASE_URL must use the local ahealth database user.' }
  $env:PGPASSWORD = $userInfo.Substring($separator + 1)
  try {
    $identity = & $psql -X -q -A -t -h 127.0.0.1 -p 55432 -U ahealth -d ahealth_dev -c "SELECT current_database() || '|' || current_user || '|' || inet_server_port();" 2>$null
    if ($LASTEXITCODE -ne 0 -or ($identity | Out-String).Trim() -ne 'ahealth_dev|ahealth|55432') {
      throw 'Database identity or authentication check failed on 127.0.0.1:55432.'
    }
  } finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
}

function Get-ServiceHealth {
  $ready = [System.Collections.Generic.List[string]]::new()
  $listening = @()
  try { $listening = @(Get-NetTCPConnection -State Listen -LocalPort $ownedPorts -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort -Unique) } catch { }
  foreach ($entry in $servicePorts.GetEnumerator()) {
    if ($listening -notcontains [int]$entry.Value) { continue }
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$($entry.Value)/health" -TimeoutSec 2
      if ($health.status -eq 'ok') { $ready.Add($entry.Key) }
    } catch { }
  }
  return $ready
}

function Get-WebReadiness {
  $ready = [System.Collections.Generic.List[string]]::new()
  foreach ($entry in $appPorts.GetEnumerator()) {
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$($entry.Value)/login" -TimeoutSec 2 -UseBasicParsing
      if ($response.StatusCode -eq 200) { $ready.Add($entry.Key) }
    } catch { }
  }
  return $ready
}

function Get-RunState {
  if (-not (Test-Path $statePath)) { return $null }
  try { return Get-Content $statePath -Raw | ConvertFrom-Json } catch { return $null }
}

function Save-RunState($state) {
  $temporaryPath = "$statePath.$PID.tmp"
  [IO.File]::WriteAllText($temporaryPath, ($state | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporaryPath -Destination $statePath -Force
}

function Get-ProcessStartUtc([int] $processId) {
  try {
    $process = Get-Process -Id $processId -ErrorAction Stop
    return $process.StartTime.ToUniversalTime()
  } catch { return $null }
}

function Test-RecordedLauncher($state) {
  if (-not $state -or -not $state.processId -or -not $state.startedAt -or -not $state.scriptPath) { return $false }
  $expectedScript = [IO.Path]::GetFullPath($PSCommandPath)
  if ([IO.Path]::GetFullPath([string]$state.scriptPath) -ine $expectedScript) { return $false }

  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($state.processId)" -ErrorAction SilentlyContinue
  if (-not $process -or $process.Name -notmatch '^(powershell|pwsh)\.exe$') { return $false }

  $actualStart = Get-ProcessStartUtc ([int]$state.processId)
  if (-not $actualStart) { return $false }
  try { $expectedStart = [DateTime]::Parse([string]$state.startedAt).ToUniversalTime() } catch { return $false }
  if ([Math]::Abs(($actualStart - $expectedStart).TotalMilliseconds) -gt 1000) { return $false }

  # Some Windows process providers omit CommandLine. When it is present, require
  # the exact script and worker switch; the recorded start time remains the PID
  # reuse guard in either case.
  if (-not [string]::IsNullOrWhiteSpace([string]$process.CommandLine)) {
    if (-not $process.CommandLine.Contains($expectedScript) -or -not $process.CommandLine.Contains('-Child')) { return $false }
    if ($state.runId -and -not $process.CommandLine.Contains([string]$state.runId)) { return $false }
  }
  return $true
}

function Get-RunProcessTree($state) {
  $rootId = [int]$state.processId
  $rootStart = [DateTime]::Parse([string]$state.startedAt).ToUniversalTime()
  $allProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $childrenByParent = @{}
  foreach ($process in $allProcesses) {
    $key = [string]$process.ParentProcessId
    if (-not $childrenByParent.ContainsKey($key)) { $childrenByParent[$key] = [System.Collections.Generic.List[object]]::new() }
    $childrenByParent[$key].Add($process)
  }

  $found = [System.Collections.Generic.List[object]]::new()
  $queue = [System.Collections.Generic.Queue[object]]::new()
  $queue.Enqueue([PSCustomObject]@{ processId = $rootId; depth = 0 })
  $seen = [System.Collections.Generic.HashSet[int]]::new()
  $null = $seen.Add($rootId)
  while ($queue.Count -gt 0) {
    $item = $queue.Dequeue()
    $parentKey = [string]$item.processId
    if (-not $childrenByParent.ContainsKey($parentKey)) { continue }
    foreach ($child in $childrenByParent[$parentKey]) {
      $childId = [int]$child.ProcessId
      if (-not $seen.Add($childId)) { continue }
      $childStart = Get-ProcessStartUtc $childId
      if (-not $childStart -or $childStart -lt $rootStart.AddSeconds(-1)) { continue }
      $record = [PSCustomObject]@{
        processId = $childId
        parentProcessId = [int]$child.ParentProcessId
        processName = [string]$child.Name
        startedAt = $childStart.ToString('o')
        depth = [int]$item.depth + 1
      }
      $found.Add($record)
      $queue.Enqueue([PSCustomObject]@{ processId = $childId; depth = $record.depth })
    }
  }
  return @($found | Sort-Object depth -Descending)
}

function Update-RunOwnership($state) {
  $records = @{}
  $previous = @()
  if ($state.PSObject.Properties['ownedProcesses']) { $previous = @($state.ownedProcesses) }
  foreach ($record in $previous) {
    if ($record.processId -and $record.startedAt) { $records["$($record.processId)|$($record.startedAt)"] = $record }
  }
  foreach ($record in (Get-RunProcessTree $state)) {
    $records["$($record.processId)|$($record.startedAt)"] = $record
  }
  $owned = @($records.Values | Sort-Object depth -Descending)
  if ($state.PSObject.Properties['ownedProcesses']) { $state.ownedProcesses = $owned }
  else { $state | Add-Member -MemberType NoteProperty -Name ownedProcesses -Value $owned }
  Save-RunState $state
  return $state
}

function Stop-OwnedProcessTree($state) {
  $rootId = [int]$state.processId
  $rootStart = [DateTime]::Parse([string]$state.startedAt).ToUniversalTime()
  $currentTree = @(Get-RunProcessTree $state)
  $known = @{}
  foreach ($record in @($state.ownedProcesses) + $currentTree) {
    if ($record.processId -and $record.startedAt) { $known["$($record.processId)|$($record.startedAt)"] = $record }
  }

  # Give applications with a window a chance to close cleanly. Node services
  # generally have no main window, so they are stopped by their verified PID.
  foreach ($record in @($known.Values)) {
    if ([string]$record.processName -ieq 'conhost.exe') { continue }
    $start = Get-ProcessStartUtc ([int]$record.processId)
    if (-not $start) { continue }
    try {
      $expected = [DateTime]::Parse([string]$record.startedAt).ToUniversalTime()
      if ([Math]::Abs(($start - $expected).TotalMilliseconds) -gt 1000) { continue }
      $process = Get-Process -Id ([int]$record.processId) -ErrorAction Stop
      if ($process.MainWindowHandle -ne [IntPtr]::Zero) { $null = $process.CloseMainWindow() }
    } catch { }
  }
  Start-Sleep -Milliseconds 750

  # Descendants are stopped deepest-first, then the verified launcher. This
  # avoids taskkill's tree-wide errors and never targets unrelated node.exe.
  $ordered = @($known.Values | Where-Object { [string]$_.processName -ine 'conhost.exe' } | Sort-Object depth -Descending)
  $ordered += [PSCustomObject]@{ processId = $rootId; startedAt = $rootStart.ToString('o'); depth = -1 }
  $terminationFailures = @{}
  foreach ($record in $ordered) {
    $processId = [int]$record.processId
    try { $expected = [DateTime]::Parse([string]$record.startedAt).ToUniversalTime() } catch { continue }
    $nativeResult = [AHealthProcessNative]::TerminateIfStartTimeMatches($processId, $expected.ToFileTimeUtc(), 1000)
    if ($nativeResult -notin @(0, 87, 1168)) {
      $remainingStart = Get-ProcessStartUtc $processId
      if ($remainingStart) { $terminationFailures[[string]$processId] = $nativeResult }
    }
  }

  $deadline = (Get-Date).AddSeconds(8)
  $remaining = @()
  do {
    $remaining = @($ordered | Where-Object {
      $start = Get-ProcessStartUtc ([int]$_.processId)
      if (-not $start) { return $false }
      try { $expected = [DateTime]::Parse([string]$_.startedAt).ToUniversalTime() } catch { return $false }
      [Math]::Abs(($start - $expected).TotalMilliseconds) -le 1000
    })
    if ($remaining.Count -gt 0) { Start-Sleep -Milliseconds 200 }
  } while ($remaining.Count -gt 0 -and (Get-Date) -lt $deadline)
  if ($remaining.Count -gt 0) {
    $details = @($remaining | ForEach-Object {
      $processId = [string]$_.processId
      if ($terminationFailures.ContainsKey($processId)) { "$processId (Win32 error $($terminationFailures[$processId]))" } else { $processId }
    }) -join ', '
    throw "Could not stop the verified AHP process tree. Still running PIDs: $details."
  }
}

function Get-PostgresReady {
  & $pgIsReady -h 127.0.0.1 -p 55432 -t 2 | Out-Null
  return ($LASTEXITCODE -eq 0)
}

function Assert-PinnedPnpm {
  $manifest = Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json
  if ([string]$manifest.packageManager -notmatch '^pnpm@(.+)$') { throw 'Root package.json must pin pnpm with a packageManager field.' }
  $requiredVersion = $Matches[1]
  $actualVersion = (& pnpm --version 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $actualVersion -ne $requiredVersion) {
    throw "Pinned pnpm $requiredVersion is required; this shell resolves pnpm $actualVersion. Activate the pinned version before starting AHP."
  }
}

function Test-PrismaClient {
  Push-Location (Join-Path $repo 'packages\database')
  try {
    & node --input-type=module -e "import { PrismaClient } from '@prisma/client'; if (typeof PrismaClient !== 'function') process.exit(1); console.log('Prisma Client OK')" 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
  } finally { Pop-Location }
}

if ($Child) {
  Import-LocalEnvironment
  Assert-LocalDatabaseUrl
  Assert-PinnedPnpm
  Push-Location $repo
  try { & pnpm exec turbo run dev --concurrency=32; exit $LASTEXITCODE }
  finally { Pop-Location }
}

if ($Status) {
  $state = Get-RunState
  if (-not $state) { Write-Host 'No AHP local launcher process is recorded.'; exit 0 }
  if (-not (Test-RecordedLauncher $state)) {
    Write-Host 'The recorded launcher is not the same live process (stale state or PID reuse). No process was touched; use -Stop to clear the stale state.'
    exit 1
  }
  $state = Update-RunOwnership $state
  $readyServices = Get-ServiceHealth
  $readyApps = Get-WebReadiness
  $postgresReady = Get-PostgresReady
  $prismaClientReady = Test-PrismaClient
  Write-Host "PostgreSQL 55432: $(if ($postgresReady) { 'ready' } else { 'not ready' })"
  Write-Host "Prisma Client: $(if ($prismaClientReady) { 'generated and importable' } else { 'not importable' })"
  Write-Host "Backend health: $($readyServices.Count)/$($servicePorts.Count)"
  Write-Host "Web login routes: $($readyApps.Count)/$($appPorts.Count)"
  Write-Host "Tracked process tree: $(@($state.ownedProcesses).Count) child process(es)"
  Write-Host "Logs: $($state.stdoutLog)"
  if (-not $postgresReady -or -not $prismaClientReady -or $readyServices.Count -ne $servicePorts.Count -or $readyApps.Count -ne $appPorts.Count) { exit 1 }
  exit 0
}

if ($Stop) {
  $state = Get-RunState
  if (-not $state) { Write-Host 'No AHP local launcher is recorded; no process was stopped.'; exit 0 }
  if (-not (Test-RecordedLauncher $state)) {
    $recorded = Get-ProcessStartUtc ([int]$state.processId)
    Remove-Item $statePath -Force -ErrorAction SilentlyContinue
    if ($recorded) {
      Write-Host 'The saved PID was reused or belongs to another process. The stale state was cleared; that process was left untouched.'
    } else {
      Write-Host 'The recorded launcher has already exited. Stale state was cleared; no process needed stopping.'
    }
    exit 0
  }

  $state = Update-RunOwnership $state
  Stop-OwnedProcessTree $state
  if ($state.startedPostgres -eq $true -and (Get-PostgresReady)) {
    & $pgCtl -D $pgData stop -m fast -w | Out-Null
    if ($LASTEXITCODE -ne 0 -and (Get-PostgresReady)) { throw 'The AHP PostgreSQL cluster did not stop cleanly.' }
  }
  Remove-Item $statePath -Force
  $remainingPorts = @(Get-NetTCPConnection -State Listen -LocalPort $ownedPorts -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort -Unique)
  Write-Host 'Stopped the recorded AHP launcher and its verified process tree.'
  if ($remainingPorts.Count -eq 0) {
    Write-Host 'All configured application ports are free.'
  } else {
    Write-Host "These configured ports remain occupied and were left untouched: $($remainingPorts -join ', ')."
  }
  if ($state.startedPostgres -eq $true) { Write-Host 'Stopped the isolated AHP PostgreSQL cluster started by this run.' }
  exit 0
}

Import-LocalEnvironment
Assert-LocalDatabaseUrl
Assert-PinnedPnpm
if (-not (Test-Path $pgCtl) -or -not (Test-Path $pgIsReady) -or -not (Test-Path $psql)) { throw 'PostgreSQL 17 command-line tools are unavailable.' }
$null = New-Item -ItemType Directory -Force -Path $logDir

$startedPostgres = $false
& $pgIsReady -h 127.0.0.1 -p 55432 -t 2 | Out-Null
if ($LASTEXITCODE -ne 0) {
  $occupied = @(Get-NetTCPConnection -State Listen -LocalPort 55432 -ErrorAction SilentlyContinue)
  if ($occupied.Count -gt 0) { throw 'Port 55432 is occupied but is not the AHP PostgreSQL cluster. No process was stopped.' }
  if (-not (Test-Path (Join-Path $pgData 'PG_VERSION'))) { throw 'The isolated AHP PostgreSQL 17 data directory is missing.' }
  & $pgCtl -D $pgData -l (Join-Path $logDir 'postgres17.log') -o '-h 127.0.0.1 -p 55432' start
  if ($LASTEXITCODE -ne 0) { throw 'Could not start the isolated AHP PostgreSQL cluster.' }
  $startedPostgres = $true
  $deadline = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 500
    & $pgIsReady -h 127.0.0.1 -p 55432 -t 2 | Out-Null
    if ($LASTEXITCODE -eq 0) { break }
  } while ((Get-Date) -lt $deadline)
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL did not become ready on 127.0.0.1:55432.' }
}
Test-DatabaseIdentity

Push-Location $repo
try {
  & pnpm --filter @a-health/database run generate
  if ($LASTEXITCODE -ne 0) { throw 'Prisma Client generation failed.' }
  & pnpm --filter @a-health/database exec prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { throw 'Prisma migration deployment failed.' }
  & pnpm --filter @a-health/database exec prisma migrate status
  if ($LASTEXITCODE -ne 0) { throw 'Prisma migration status failed after deployment.' }
} finally { Pop-Location }

$existingState = Get-RunState
if ($existingState) {
  if (Test-RecordedLauncher $existingState) { throw 'An AHP launcher is already recorded. Run scripts/dev-local.ps1 -Status or -Stop first.' }
  $existingProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($existingState.processId)" -ErrorAction SilentlyContinue
  if ($existingProcess) { throw 'The recorded PID is now a different process. Stale launcher state was retained; no process was stopped.' }
  Remove-Item $statePath -Force -ErrorAction SilentlyContinue
}
$portConflicts = @(Get-NetTCPConnection -State Listen -LocalPort $ownedPorts -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort -Unique)
if ($portConflicts.Count -gt 0) {
  throw "One or more AHP service/web ports are occupied ($($portConflicts -join ', ')). No process was stopped."
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdoutLog = Join-Path $logDir "dev-$stamp.stdout.log"
$stderrLog = Join-Path $logDir "dev-$stamp.stderr.log"
$runId = [Guid]::NewGuid().ToString('N')
$childArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Child', '-RunId', $runId)
$launcher = Start-Process -FilePath 'powershell.exe' -ArgumentList $childArgs -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
$state = [PSCustomObject]@{
  processId = $launcher.Id
  startedAt = $launcher.StartTime.ToUniversalTime().ToString('o')
  scriptPath = [IO.Path]::GetFullPath($PSCommandPath)
  stdoutLog = $stdoutLog
  stderrLog = $stderrLog
  startedPostgres = $startedPostgres
  runId = $runId
  ownedProcesses = @()
}
$null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $statePath)
Save-RunState $state

Write-Host 'Starting all 25 backend services and all four web apps...'
$deadline = (Get-Date).AddSeconds(300)
$readyServices = @()
$readyApps = @()
do {
  Start-Sleep -Seconds 2
  if (Test-RecordedLauncher $state) { $state = Update-RunOwnership $state }
  $readyServices = Get-ServiceHealth
  $readyApps = Get-WebReadiness
  if ($readyServices.Count -eq $servicePorts.Count -and $readyApps.Count -eq $appPorts.Count) { break }
  $running = Get-Process -Id $launcher.Id -ErrorAction SilentlyContinue
  if (-not $running) { break }
} while ((Get-Date) -lt $deadline)

Write-Host "Backend health: $($readyServices.Count)/$($servicePorts.Count)"
Write-Host "Web login routes: $($readyApps.Count)/$($appPorts.Count)"
Write-Host 'Staff Web: http://localhost:3000/login'
Write-Host 'Doctor Admin: http://localhost:3100/login'
Write-Host 'Operations Admin: http://localhost:3200/login'
Write-Host 'Analytics: http://localhost:3300/login'
Write-Host "Logs: $stdoutLog"
Write-Host 'Use scripts/dev-local.ps1 -Status to inspect readiness and -Stop to stop only this launcher tree.'
if ($readyServices.Count -ne $servicePorts.Count -or $readyApps.Count -ne $appPorts.Count) {
  Write-Host 'Some services or apps are not ready yet; inspect the recorded logs. The processes remain available for diagnosis.'
  exit 1
}
