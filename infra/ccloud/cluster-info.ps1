# Pre-flight cluster snapshot via the ccloud CLI (CockroachDB Cloud control plane).
# Requires a one-time interactive `ccloud auth login` (browser OAuth) — the CLI
# does not accept service-account API keys (those are for the Cloud API / MCP,
# not ccloud). Run from the repo root or this directory.
#
#   .\infra\ccloud\cluster-info.ps1 [-Cluster blackbox]

param([string]$Cluster = "blackbox")

$ErrorActionPreference = "Stop"
$ccloud = Join-Path $PSScriptRoot "bin\ccloud.exe"

if (-not (Test-Path $ccloud)) {
    Write-Error "ccloud.exe not found at $ccloud — see infra/ccloud/README.md for install."
}

& $ccloud auth whoami *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Not logged in. Run this once in a real terminal (needs a keypress + browser):" -ForegroundColor Yellow
    Write-Host "  $ccloud auth login" -ForegroundColor Yellow
    exit 1
}

Write-Host "== ccloud auth ==" -ForegroundColor Cyan
& $ccloud auth whoami

Write-Host "== ccloud cluster info: $Cluster ==" -ForegroundColor Cyan
& $ccloud cluster info $Cluster
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
