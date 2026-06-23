param(
  [string]$ProjectDir = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path,
  [string]$TaskName = "LabManager"
)

$ErrorActionPreference = "Stop"
$scriptPath = Join-Path $PSScriptRoot "start-all.ps1"
$logDir = Join-Path $ProjectDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force

Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  Lab Manager — Auto-start installed             ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════╝"
Write-Host ""
Write-Host "Task '$TaskName' registered." -ForegroundColor Green
Write-Host "Auto-starts on boot as SYSTEM (even before login)."
Write-Host ""
Write-Host "Logs: $logDir\startup.log"
Write-Host "Tunnel URL: $ProjectDir\tunnel-url.txt"
Write-Host ""
Write-Host "Manual commands:" -ForegroundColor Yellow
Write-Host "  Start:  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Stop:   Stop-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Status: Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
Write-Host ""
