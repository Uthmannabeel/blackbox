# Pre-flight cluster snapshot via the ccloud CLI (CockroachDB Cloud control plane).
# Reuses the service-account API key from .env (CRDB_MCP_API_KEY) for
# non-interactive auth. Run from the repo root or this directory.
#
#   .\infra\ccloud\cluster-info.ps1 [-Cluster blackbox]

param([string]$Cluster = "blackbox")

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$ccloud = Join-Path $PSScriptRoot "bin\ccloud.exe"

if (-not (Test-Path $ccloud)) {
    Write-Error "ccloud.exe not found at $ccloud — see infra/ccloud/README.md for install."
}

# Pull the service-account API key from .env unless already set.
if (-not $env:CCLOUD_API_KEY) {
    $envFile = Join-Path $root ".env"
    if (Test-Path $envFile) {
        $line = Select-String -Path $envFile -Pattern '^CRDB_MCP_API_KEY=' | Select-Object -First 1
        if ($line) { $env:CCLOUD_API_KEY = ($line.Line -split "=", 2)[1].Trim() }
    }
}
if (-not $env:CCLOUD_API_KEY) {
    Write-Warning "No CCLOUD_API_KEY / CRDB_MCP_API_KEY found — falling back to interactive auth state."
}

Write-Host "== ccloud cluster info: $Cluster ==" -ForegroundColor Cyan
& $ccloud cluster info $Cluster
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "If auth failed: run '$ccloud auth login' once (browser), or set CCLOUD_API_KEY." -ForegroundColor Yellow
    exit $LASTEXITCODE
}
