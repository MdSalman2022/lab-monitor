param(
  [string]$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path,
  [string]$NssmPath = "nssm.exe",
  [string]$Port = "3000"
)

$ErrorActionPreference = "Stop"

$node = (Get-Command node).Source
$webScript = Join-Path $ProjectRoot ".next\standalone\server.js"
$workerScript = Join-Path $ProjectRoot "dist-worker\src\worker\index.js"
$logsDir = Join-Path $ProjectRoot "logs"

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

if (-not (Test-Path -LiteralPath $webScript)) {
  throw "Missing $webScript. Run npm run build first."
}

if (-not (Test-Path -LiteralPath $workerScript)) {
  throw "Missing $workerScript. Run npm run build:worker first."
}

& $NssmPath install LabBeaconWeb $node $webScript
& $NssmPath set LabBeaconWeb AppDirectory $ProjectRoot
& $NssmPath set LabBeaconWeb AppEnvironmentExtra "PORT=$Port"
& $NssmPath set LabBeaconWeb AppStdout (Join-Path $logsDir "web.log")
& $NssmPath set LabBeaconWeb AppStderr (Join-Path $logsDir "web-error.log")
& $NssmPath set LabBeaconWeb Start SERVICE_AUTO_START

& $NssmPath install LabBeaconWorker $node $workerScript
& $NssmPath set LabBeaconWorker AppDirectory $ProjectRoot
& $NssmPath set LabBeaconWorker AppStdout (Join-Path $logsDir "worker.log")
& $NssmPath set LabBeaconWorker AppStderr (Join-Path $logsDir "worker-error.log")
& $NssmPath set LabBeaconWorker Start SERVICE_AUTO_START

Write-Host "Installed LabBeaconWeb and LabBeaconWorker."
Write-Host "Start them with:"
Write-Host "  nssm start LabBeaconWeb"
Write-Host "  nssm start LabBeaconWorker"
