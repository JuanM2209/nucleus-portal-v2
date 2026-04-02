#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────
# Nucleus Portal - First-time dev setup
# ──────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[setup]${NC} $*"; }
warn()  { echo -e "${YELLOW}[setup]${NC} $*"; }
error() { echo -e "${RED}[setup]${NC} $*"; }

# ── 1. Check required tools ──────────────────
info "Checking required tools..."

missing=0
for cmd in node pnpm docker; do
  if ! command -v "$cmd" &>/dev/null; then
    error "  $cmd is not installed"
    missing=1
  else
    info "  $cmd: $(command -v "$cmd")"
  fi
done

if [ "$missing" -eq 1 ]; then
  error "Install missing tools and re-run this script."
  exit 1
fi

# ── 2. Ensure Docker daemon is running ───────
if ! docker info &>/dev/null; then
  error "Docker daemon is not running. Start Docker Desktop and retry."
  exit 1
fi
info "Docker daemon is running."

# ── 3. Copy .env.example -> .env if needed ───
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ ! -f "$PROJECT_ROOT/.env" ]; then
  cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
  info "Created .env from .env.example"
else
  warn ".env already exists, skipping copy."
fi

# ── 4. Install dependencies ─────────────────
info "Installing pnpm dependencies..."
cd "$PROJECT_ROOT"
pnpm install

# ── 5. Start Docker infrastructure ──────────
info "Starting PostgreSQL, PgBouncer, Redis via Docker Compose..."
docker compose -f "$PROJECT_ROOT/infra/docker-compose.yml" up -d

# ── 6. Wait for Postgres to be healthy ──────
info "Waiting for PostgreSQL to be healthy..."
retries=30
until docker compose -f "$PROJECT_ROOT/infra/docker-compose.yml" exec -T postgres pg_isready -U nucleus -d nucleus &>/dev/null; do
  retries=$((retries - 1))
  if [ "$retries" -le 0 ]; then
    error "PostgreSQL did not become healthy in time."
    exit 1
  fi
  sleep 1
done
info "PostgreSQL is healthy."

# ── 7. Wait for PgBouncer ───────────────────
info "Waiting for PgBouncer to be ready..."
retries=15
until docker compose -f "$PROJECT_ROOT/infra/docker-compose.yml" exec -T pgbouncer pg_isready -h 127.0.0.1 -p 6432 -U nucleus &>/dev/null; do
  retries=$((retries - 1))
  if [ "$retries" -le 0 ]; then
    warn "PgBouncer health check timed out (non-fatal, may still work)."
    break
  fi
  sleep 1
done

# ── 8. Run database seed ────────────────────
info "Seeding database (sets admin password)..."
pnpm run db:seed || warn "db:seed failed. Run it manually once the DB is ready."

# ── 9. Done ─────────────────────────────────
echo ""
info "========================================"
info "  Nucleus Portal setup complete!"
info "========================================"
echo ""
info "Services:"
info "  PostgreSQL : localhost:5432"
info "  PgBouncer  : localhost:6432"
info "  Redis      : localhost:6379"
echo ""
info "Credentials:"
info "  Email    : admin@nucleus.local"
info "  Password : Admin123!"
echo ""
info "Next steps:"
info "  pnpm dev   - start frontend (port 3000) + backend (port 3001)"
echo ""
