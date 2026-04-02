# Run this script as Administrator:
#   Right-click PowerShell → Run as Administrator
#   cd Z:\nucleus-portal-v2\infra\rathole
#   .\setup-firewall.ps1

Write-Host "Creating firewall rules for Rathole..." -ForegroundColor Cyan

# Control channel
New-NetFirewallRule `
  -DisplayName "Rathole Control (TCP 2333)" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 2333 `
  -Action Allow `
  -Profile Any `
  -Description "Rathole server control channel for Nucleus Portal V2"

Write-Host "  [OK] Port 2333 (control channel)" -ForegroundColor Green

# Dynamic port range for device tunnels
New-NetFirewallRule `
  -DisplayName "Rathole Dynamic Ports (TCP 10000-19999)" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort "10000-19999" `
  -Action Allow `
  -Profile Any `
  -Description "Rathole dynamic port range for device tunnels"

Write-Host "  [OK] Ports 10000-19999 (dynamic tunnels)" -ForegroundColor Green
Write-Host ""
Write-Host "Firewall rules created successfully." -ForegroundColor Green
Write-Host "You can verify with: Get-NetFirewallRule -DisplayName 'Rathole*' | Select DisplayName,Enabled" -ForegroundColor Gray
