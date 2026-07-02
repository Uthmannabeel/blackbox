# One-command chaos-rig bring-up for demos/recording.
#   powershell -ExecutionPolicy Bypass -File infra\chaos\rig-up.ps1 [-SeedCount 10000]
# Starts the 9-node 3-region cluster, applies schema, seeds memory, and starts
# the web app on http://localhost:3000 with real in-app chaos enabled.
param(
  [int]$SeedCount = 10000,
  [string]$CockroachExe = "$PSScriptRoot\bin\cockroach-v25.4.0.windows-6.2-amd64\cockroach.exe"
)

$ErrorActionPreference = "Stop"
$repo = Resolve-Path "$PSScriptRoot\..\.."
Set-Location $repo

if (-not (Test-Path $CockroachExe)) {
  Write-Error "cockroach.exe not found at $CockroachExe — see infra\chaos\README.md step 1."
}

# Clean slate: the rig is disposable, and a fresh cluster avoids wedged ranges.
Get-Process cockroach -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 2

Write-Host "[rig] starting 9-node, 3-region cluster (driver on control port 7777)..."
$driver = Start-Process node -PassThru -WindowStyle Minimized -ArgumentList @(
  "infra\chaos\driver.mjs", $CockroachExe,
  "demo", "--insecure", "--nodes", "9",
  "--demo-locality=region=us-east1,az=b:region=us-east1,az=c:region=us-east1,az=d:region=us-west1,az=a:region=us-west1,az=b:region=us-west1,az=c:region=europe-west1,az=b:region=europe-west1,az=c:region=europe-west1,az=d",
  "--no-example-database", "--sql-port", "26257", "--http-port", "8080", "--set", "errexit=false"
)

$up = $false
foreach ($i in 1..30) {
  Start-Sleep 3
  if (Test-NetConnection 127.0.0.1 -Port 26257 -InformationLevel Quiet -WarningAction SilentlyContinue) { $up = $true; break }
}
if (-not $up) { Write-Error "[rig] SQL port never came up (driver pid $($driver.Id))" }

Write-Host "[rig] configuring multi-region database + schema..."
npm run build | Out-Null
node packages\memory\dist\scripts\chaosSetup.js "postgresql://root@127.0.0.1:26257/defaultdb?sslmode=disable"

$env:DATABASE_URL = "postgresql://root@127.0.0.1:26257/blackbox?sslmode=disable"
$env:BLACKBOX_MOCK_EMBEDDINGS = "1"

Write-Host "[rig] seeding curated incidents + $SeedCount scale corpus (this is the slow part)..."
node packages\memory\dist\scripts\seed.js
node packages\memory\dist\scripts\seedScale.js $SeedCount

Write-Host "[rig] validating (distribution / plan / recall)..."
node infra\chaos\validate.mjs

Write-Host "[rig] starting web app on http://localhost:3000 ..."
$env:BLACKBOX_MOCK_AGENT = "1"    # remove when Bedrock creds are in .env
$env:CHAOS_CONTROL_PORT = "7777"  # enables the REAL chaos button
npm run web:build
Set-Location "$repo\web"
npx next start -p 3000
