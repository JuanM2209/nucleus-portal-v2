@echo off
:: Nucleus Portal Auto-Start Script
:: Starts Docker + PM2 + verifies Cloudflare Tunnel after system boot

echo [%date% %time%] Starting Nucleus Portal services... >> "%USERPROFILE%\nucleus-startup.log"

:: 1. Start Docker containers (Postgres, PgBouncer, Redis)
cd /d Z:\nucleus-portal
docker compose -f infra/docker-compose.yml up -d >> "%USERPROFILE%\nucleus-startup.log" 2>&1

:: 2. Wait for Docker services to be ready
timeout /t 15 /nobreak > nul

:: 3. Resurrect PM2 processes (backend + frontend)
call npx pm2 resurrect >> "%USERPROFILE%\nucleus-startup.log" 2>&1

:: 4. Cloudflare tunnel runs as Windows service (cloudflared service install)
:: Verify it's running, restart if needed
sc query cloudflared | find "RUNNING" > nul 2>&1
if errorlevel 1 (
    echo [%date% %time%] Cloudflared not running, starting... >> "%USERPROFILE%\nucleus-startup.log"
    net start cloudflared >> "%USERPROFILE%\nucleus-startup.log" 2>&1
)

echo [%date% %time%] Nucleus Portal services started. >> "%USERPROFILE%\nucleus-startup.log"
