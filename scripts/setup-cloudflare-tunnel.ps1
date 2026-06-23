param(
  [string]$TunnelName = "lab-manager",
  [string]$Subdomain = "lab-manager",
  [string]$Domain = "yourdomain.com",  # Change this after you buy a domain
  [string]$RootDir = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════╗"
Write-Host "║   Lab Manager — Cloudflare Tunnel Setup        ║"
Write-Host "╚══════════════════════════════════════════════════╝"
Write-Host ""

# ── Step 1: Check prerequisites ──
Write-Host "Step 1: Checking prerequisites..." -ForegroundColor Cyan

$hasCloudflared = $null
try { $hasCloudflared = Get-Command cloudflared -ErrorAction Stop } catch {}

if (-not $hasCloudflared) {
  Write-Host "  → cloudflared not found. Installing via winget..." -ForegroundColor Yellow
  try {
    winget install Cloudflare.cloudflared
    Write-Host "  ✓ Installed. Restart your terminal if needed." -ForegroundColor Green
  } catch {
    Write-Host "  ✗ winget install failed. Download manually from:" -ForegroundColor Red
    Write-Host "    https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    exit 1
  }
} else {
  Write-Host "  ✓ cloudflared found" -ForegroundColor Green
}

# ── Step 2: Login to Cloudflare ──
Write-Host ""
Write-Host "Step 2: Login to Cloudflare" -ForegroundColor Cyan
Write-Host "  → A browser will open. Log in to your Cloudflare account."
Write-Host "  → If you don't have one, create one at https://dash.cloudflare.com/sign-up"
Write-Host "  → You DO NOT need a domain yet to complete this step."
Write-Host ""

$choice = Read-Host "Continue with login? (Y/n)"
if ($choice -ne "n" -and $choice -ne "N") {
  & cloudflared tunnel login
} else {
  Write-Host "  Skipped. Run 'cloudflared tunnel login' manually later." -ForegroundColor Yellow
}

# ── Step 3: Create the tunnel ──
Write-Host ""
Write-Host "Step 3: Creating tunnel '$TunnelName'..." -ForegroundColor Cyan

$existing = & cloudflared tunnel list 2>$null | Select-String $TunnelName
if ($existing) {
  Write-Host "  → Tunnel '$TunnelName' already exists" -ForegroundColor Yellow
  $recreate = Read-Host "  Recreate it? (y/N)"
  if ($recreate -eq "y" -or $recreate -eq "Y") {
    & cloudflared tunnel delete $TunnelName
    & cloudflared tunnel create $TunnelName
  }
} else {
  & cloudflared tunnel create $TunnelName
}

# Find the credentials file
$credFile = Get-ChildItem "$env:USERPROFILE\.cloudflared\*.json" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $credFile) {
  Write-Host "  ✗ Could not find tunnel credentials file" -ForegroundColor Red
  exit 1
}
$tunnelId = $credFile.BaseName
Write-Host "  ✓ Tunnel ID: $tunnelId" -ForegroundColor Green

# ── Step 4: Create config file ──
Write-Host ""
Write-Host "Step 4: Creating config file..." -ForegroundColor Cyan

$configDir = "$env:USERPROFILE\.cloudflared"
$configPath = "$configDir\config.yml"

$configYaml = @"
tunnel: $TunnelName
credentials-file: $configDir\$tunnelId.json

ingress:
  - hostname: $Subdomain.$Domain
    service: http://localhost:3000
  - service: http_status:404
"@

# Check if config already exists and back it up
if (Test-Path $configPath) {
  $backup = "$configPath.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  Copy-Item $configPath $backup
  Write-Host "  → Backed up existing config to $backup" -ForegroundColor Yellow
}

Set-Content -Path $configPath -Value $configYaml
Write-Host "  ✓ Config written to $configPath" -ForegroundColor Green

# ── Step 5: Domain instructions ──
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗"
Write-Host "║  NEXT STEPS — Manual Domain Setup                          ║"
Write-Host "╚══════════════════════════════════════════════════════════════╝"
Write-Host ""
Write-Host "1. Go to https://dash.cloudflare.com and BUY a domain:" -ForegroundColor Cyan
Write-Host "   → Left menu → 'Domain Registration' → 'Register Domains'"
Write-Host "   → Cheapest options are usually .xyz, .click, .link (~$1-3/year)"
Write-Host "   → Or use a free Freenom domain (.tk, .ml) if available"
Write-Host ""
Write-Host "2. Once you own a domain, add it to Cloudflare:" -ForegroundColor Cyan
Write-Host "   → Left menu → 'Add a Site' → enter your domain"
Write-Host "   → Use the free plan"
Write-Host "   → Update your domain's nameservers to Cloudflare's (they'll show you)"
Write-Host ""
Write-Host "3. Create the DNS record for your tunnel:" -ForegroundColor Cyan
Write-Host "   Run this command (replace with YOUR domain):"
Write-Host ""
Write-Host "   cloudflared tunnel route dns $TunnelName $Subdomain.YOUR-DOMAIN.com"
Write-Host ""
Write-Host "   OR do it manually in Cloudflare Dashboard:"
Write-Host "   → DNS → Records → Add Record"
Write-Host "   → Type: CNAME, Name: $Subdomain, Target: $tunnelId.cfargotunnel.com"
Write-Host "   → Proxy: Proxied (orange cloud)"
Write-Host ""

# ── Step 6: Install as Windows service (optional) ──
Write-Host ""
$installService = Read-Host "Step 5: Install tunnel as Windows service? (Y/n)"
if ($installService -ne "n" -and $installService -ne "N") {
  Write-Host "  Installing cloudflared as Windows service..." -ForegroundColor Cyan
  & cloudflared service install
  if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ Service installed. Starting now..." -ForegroundColor Green
    Start-Service cloudflared -ErrorAction SilentlyContinue
  } else {
    Write-Host "  ✗ Service install failed. Run manually:" -ForegroundColor Yellow
    Write-Host "    cloudflared service install"
  }
}

# ── Summary ──
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════╗"
Write-Host "║  DONE                                           ║"
Write-Host "╚══════════════════════════════════════════════════╝"
Write-Host ""
Write-Host "Your tunnel '$TunnelName' is configured." -ForegroundColor Green
Write-Host ""

if ($installService -ne "n" -and $installService -ne "N") {
  Write-Host "The tunnel service will auto-start on boot." -ForegroundColor Green
} else {
  Write-Host "To run the tunnel manually:" -ForegroundColor Yellow
  Write-Host "  cloudflared tunnel run $TunnelName"
  Write-Host ""
}

Write-Host "After you buy a domain and add the DNS record," -ForegroundColor White
Write-Host "your dashboard will be live at:" -ForegroundColor White
Write-Host "  https://$Subdomain.$Domain" -ForegroundColor Cyan
Write-Host ""
