param(
  [string]$ProjectDir = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Continue"
$logDir = Join-Path $ProjectDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log {
  param([string]$Message)
  $time = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  "$time $Message" | Out-File (Join-Path $logDir "startup.log") -Append
}

# Resolve node/npm paths even if they are not on the system PATH
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
$npmPath = (Get-Command npm -ErrorAction SilentlyContinue).Source
$defaultNodeDir = "C:\Program Files\nodejs"
if (-not $nodePath -and (Test-Path (Join-Path $defaultNodeDir "node.exe"))) {
  $nodePath = Join-Path $defaultNodeDir "node.exe"
}
if (-not $npmPath -and (Test-Path (Join-Path $defaultNodeDir "npm.cmd"))) {
  $npmPath = Join-Path $defaultNodeDir "npm.cmd"
}
if (-not $nodePath) { $nodePath = "node" }
if (-not $npmPath) { $npmPath = "npm" }

Write-Log "Starting Lab Manager..."
Write-Log "Project dir: $ProjectDir"
Write-Log "node path: $nodePath"
Write-Log "npm path: $npmPath"

# 1. Start Next.js server
$webOutLog = Join-Path $logDir "web.log"
$webErrLog = Join-Path $logDir "web-error.log"
$standalonePath = Join-Path $ProjectDir ".next\standalone\server.js"
if (Test-Path $standalonePath) {
  $webProcess = Start-Process -FilePath $nodePath -ArgumentList "`"$standalonePath`"" -WorkingDirectory $ProjectDir -WindowStyle Hidden -PassThru -RedirectStandardOutput $webOutLog -RedirectStandardError $webErrLog
  Write-Log "Next.js standalone server started (PID: $($webProcess.Id))"
} else {
  $webProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$npmPath`" run start" -WorkingDirectory $ProjectDir -WindowStyle Hidden -PassThru -RedirectStandardOutput $webOutLog -RedirectStandardError $webErrLog
  Write-Log "Next.js server started (PID: $($webProcess.Id))"
}

# 2. Start worker
$workerOutLog = Join-Path $logDir "worker.log"
$workerErrLog = Join-Path $logDir "worker-error.log"
$workerProcess = Start-Process -FilePath $nodePath -ArgumentList "dist-worker/src/worker/index.js" -WorkingDirectory $ProjectDir -WindowStyle Hidden -PassThru -RedirectStandardOutput $workerOutLog -RedirectStandardError $workerErrLog
Write-Log "Worker started (PID: $($workerProcess.Id))"

# Wait for web server to be ready
Start-Sleep -Seconds 5
Write-Log "Waiting for web server on port 3000..."
for ($i = 0; $i -lt 30; $i++) {
  try {
    $req = [System.Net.WebRequest]::Create("http://localhost:3000")
    $req.Timeout = 2000
    $req.GetResponse().Close()
    Write-Log "Web server is ready"
    break
  } catch {
    Start-Sleep -Seconds 2
  }
}

# 3. Start Cloudflare tunnel (quick tunnel)
$tunnelOutLog = Join-Path $logDir "tunnel.log"
$tunnelErrLog = Join-Path $logDir "tunnel-error.log"
$cloudflaredPath = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflaredPath) { $cloudflaredPath = "C:\Program Files\cloudflared\cloudflared.exe" }
if (-not (Test-Path $cloudflaredPath)) { $cloudflaredPath = "$env:ProgramFiles(x86)\cloudflared\cloudflared.exe" }
if (-not (Test-Path $cloudflaredPath)) { $cloudflaredPath = "$env:LOCALAPPDATA\cloudflared\cloudflared.exe" }
if (Test-Path $cloudflaredPath) {
  $tunnelProcess = Start-Process -FilePath $cloudflaredPath -ArgumentList "tunnel --url http://localhost:3000 --protocol http2" -WorkingDirectory $ProjectDir -WindowStyle Hidden -PassThru -RedirectStandardOutput $tunnelOutLog -RedirectStandardError $tunnelErrLog
  Write-Log "Cloudflare tunnel started (PID: $($tunnelProcess.Id))"
} else {
  Write-Log "cloudflared not found — skipping tunnel"
}

# 4. Extract the URL and save it
Start-Sleep -Seconds 10
$url = ""
if (Test-Path $tunnelOutLog) {
  $content = Get-Content $tunnelOutLog -Raw
  if ($content -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
    $url = $matches[0]
  }
}
if ($url) {
  $url | Out-File (Join-Path $ProjectDir "tunnel-url.txt")
  Write-Log "Tunnel URL: $url"
} else {
  Write-Log "Tunnel URL not yet available — check logs/tunnel.log after startup"
}

Write-Log "Startup complete"
