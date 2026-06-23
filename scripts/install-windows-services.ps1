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

& $NssmPath install LabScheduleManagerWeb $node $webScript
& $NssmPath set LabScheduleManagerWeb AppDirectory $ProjectRoot
& $NssmPath set LabScheduleManagerWeb AppEnvironmentExtra "PORT=$Port`r`nTZ=Asia/Dhaka"
& $NssmPath set LabScheduleManagerWeb AppStdout (Join-Path $logsDir "web.log")
& $NssmPath set LabScheduleManagerWeb AppStderr (Join-Path $logsDir "web-error.log")
& $NssmPath set LabScheduleManagerWeb Start SERVICE_AUTO_START

& $NssmPath install LabScheduleManagerWorker $node $workerScript
& $NssmPath set LabScheduleManagerWorker AppDirectory $ProjectRoot
& $NssmPath set LabScheduleManagerWorker AppEnvironmentExtra "TZ=Asia/Dhaka"
& $NssmPath set LabScheduleManagerWorker AppStdout (Join-Path $logsDir "worker.log")
& $NssmPath set LabScheduleManagerWorker AppStderr (Join-Path $logsDir "worker-error.log")
& $NssmPath set LabScheduleManagerWorker Start SERVICE_AUTO_START

Write-Host "Installed LabScheduleManagerWeb and LabScheduleManagerWorker."
Write-Host "Start them with:"
Write-Host "  nssm start LabScheduleManagerWeb"
Write-Host "  nssm start LabScheduleManagerWorker"
