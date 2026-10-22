# Compatibility entry point for the former multi-file bootstrap workflow.
# Keep one local environment source of truth and its masked credential prompts.
$ErrorActionPreference = 'Stop'
$replacement = Join-Path (Split-Path -Parent $PSScriptRoot) 'configure-local.ps1'
if (-not (Test-Path -LiteralPath $replacement)) {
  throw 'The current local setup script is missing: scripts/configure-local.ps1.'
}
& $replacement
exit $LASTEXITCODE
