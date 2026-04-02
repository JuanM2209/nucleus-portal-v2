#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────
# Nucleus Portal - Start dev infrastructure
# ──────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[dev]${NC} $*"; }
warn()  { echo -e "${YELLOW}[dev]${NC} $*"; }
error() { echo -e "${RED}[dev]${NC} $*"; }
step()  { echo -e "${CYAN}[dev]${NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/infra/docker-compose.yml"

# ── 1. Check Docker is running ───────────────
step "Checking Docker..."
if ! docker info &>/dev/null; then
  error "Docker daemon is not running. Start Docker Desktop and retry."
  exit 1
fi
info "Docker is running."

# ── 2. Start infrastructure ─────────────────
step "Starting PostgreSQL, PgBouncer, Redis..."
docker compose -f "$COMPOSE_FILE" up -d

# ── 3. Wait for Postgres to be healthy ──────
step "Waiting for PostgreSQL..."
retries=30
until docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U nucleus -d nucleus &>/dev/null; do
  retries=$((retries - 1))
  if [ "$retries" -le 0 ]; then
    error "PostgreSQL did not become healthy in time."
    docker compose -f "$COMPOSE_FILE" logs postgres --tail=20
    exit 1
  fi
  sleep 1
done
info "PostgreSQL is healthy."

# ── 4. Wait for Redis to be healthy ─────────
step "Waiting for Redis..."
retries=15
until docker compose -f "$COMPOSE_FILE" exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; do
  retries=$((retries - 1))
  if [ "$retries" -le 0 ]; then
    error "Redis did not become healthy in time."
    docker compose -f "$COMPOSE_FILE" logs redis --tail=20
    exit 1
  fi
  sleep 1
done
info "Redis is healthy."

# ── 5. Wait for PgBouncer ───────────────────
step "Waiting for PgBouncer..."
retries=15
until docker compose -f "$COMPOSE_FILE" exec -T pgbouncer pg_isready -h 127.0.0.1 -p 6432 -U nucleus &>/dev/null; do
  retries=$((retries - 1))
  if [ "$retries" -le 0 ]; then
    warn "PgBouncer health check timed out (non-fatal)."
    break
  fi
  sleep 1
done
info "PgBouncer is ready."

# ── 6. Summary ──────────────────────────────
echo ""
info "========================================"
info "  Infrastructure ready!"
info "========================================"
echo ""
info "  PostgreSQL : localhost:5432"
info "  PgBouncer  : localhost:6432"
info "  Redis      : localhost:6379"
echo ""
info "Run '${CYAN}pnpm dev${NC}' to start frontend and backend"
echo ""
