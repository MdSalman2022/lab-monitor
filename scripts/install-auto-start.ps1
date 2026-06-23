param(
  [string]$ProjectDir = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path,
  [string]$ShortcutName = "LabManager"
)

$ErrorActionPreference = "Stop"
$scriptPath = Join-Path $PSScriptRoot "start-all.ps1"
$logDir = Join-Path $ProjectDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$startupDir = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "$ShortcutName.lnk"
$powershellPath = (Get-Command powershell).Source
$arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scriptPath + '"'

$wshShell = New-Object -ComObject WScript.Shell
$shortcut = $wshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershellPath
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = $ProjectDir
$shortcut.IconLocation = "powershell.exe,0"
$shortcut.Save()

Write-Host "Startup shortcut installed" -ForegroundColor Green
Write-Host "Shortcut: $shortcutPath"
Write-Host "Runs when the current user logs in."
Write-Host ""
Write-Host "Logs: $logDir\startup.log"
Write-Host "Tunnel URL: $ProjectDir\tunnel-url.txt"
Write-Host ""
Write-Host "Manual commands:" -ForegroundColor Yellow
Write-Host "  Start now:  powershell -ExecutionPolicy Bypass -File $scriptPath"
Write-Host "  Remove:     Remove-Item -LiteralPath $shortcutPath"
Write-Host ""
