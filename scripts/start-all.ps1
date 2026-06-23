param(
  [string]$ProjectDir = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
)

$ErrorActionPreference = "Continue"
$logDir = Join-Path $ProjectDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log {
  param([string]$Message)
  $time = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  "$time $Message" | Out-File (Join-Path $logDir "startup.log") -Append
}

# Resolve npm path
$npmPath = (Get-Command npm -ErrorAction SilentlyContinue).Source
if (-not $npmPath) { $npmPath = "npm" }

Write-Log "Starting Lab Manager..."
Write-Log "Project dir: $ProjectDir"
Write-Log "npm path: $npmPath"

# 1. Start Next.js server
$webLog = Join-Path $logDir "web.log"
$standalonePath = Join-Path $ProjectDir ".next\standalone\server.js"
if (Test-Path $standalonePath) {
  $webProcess = Start-Process -FilePath "node" -ArgumentList "`"$standalonePath`"" -WorkingDirectory $ProjectDir -WindowStyle Hidden -PassThru -RedirectStandardOutput $webLog -RedirectStandardError $webLog
  Write-Log "Next.js standalone server started (PID: $($webProcess.Id))"
} else {
  $webProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/c $npmPath run start" -WorkingDirectory $ProjectDir -WindowStyle Hidden -PassThru -RedirectStandardOutput $webLog -RedirectStandardError $webLog
  Write-Log "Next.js server started (PID: $($webProcess.Id))"
}

# 2. Start worker
$workerLog = Join-Path $logDir "worker.log"
$workerProcess = Start-Process -FilePath "node" -ArgumentList "dist-worker/src/worker/index.js" -WorkingDirectory $ProjectDir -WindowStyle Hidden -PassThru -RedirectStandardOutput $workerLog -RedirectStandardError $workerLog
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
$tunnelLog = Join-Path $logDir "tunnel.log"
$cloudflaredPath = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflaredPath) {
  $cloudflaredPath = "C:\Program Files\cloudflared\cloudflared.exe"
}
if (Test-Path $cloudflaredPath) {
  $tunnelProcess = Start-Process -FilePath $cloudflaredPath -ArgumentList "tunnel --url http://localhost:3000 --protocol http2" -WorkingDirectory $ProjectDir -WindowStyle Hidden -PassThru -RedirectStandardOutput $tunnelLog -RedirectStandardError $tunnelLog
  Write-Log "Cloudflare tunnel started (PID: $($tunnelProcess.Id))"
} else {
  Write-Log "cloudflared not found — skipping tunnel"
}

# 4. Extract the URL and save it
Start-Sleep -Seconds 10
$url = ""
if (Test-Path $tunnelLog) {
  $content = Get-Content $tunnelLog -Raw
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
