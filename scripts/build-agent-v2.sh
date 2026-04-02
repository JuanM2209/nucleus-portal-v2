#!/bin/bash
# Build Nucleus Agent V2 Docker image (ARM cross-compile + rathole client)
# Then export as .tar.gz and create GitHub release
set -e

VERSION="v2"
SEMVER="2.0.0"
IMAGE_NAME="nucleus-agent:${VERSION}"
TAR_FILE="nucleus-agent-${VERSION}.tar.gz"
RELEASE_REPO="JuanM2209/nucleus-agent-releases"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "╔═══════════════════════════════════════╗"
echo "║   Nucleus Agent V2 — Build Pipeline   ║"
echo "║   (with Rathole transport)            ║"
echo "╚═══════════════════════════════════════╝"
echo ""

cd "$PROJECT_ROOT"

# ── Step 1: Build ARM image ──
echo "[1/3] Building ARM image via Docker buildx..."
echo "       (includes rathole ARM binary download)"
docker buildx build \
  --builder armbuilder \
  --platform linux/arm/v7 \
  -f infra/docker/Dockerfile.agent \
  -t "${IMAGE_NAME}" \
  --load \
  .

# ── Step 2: Export to .tar.gz ──
echo "[2/3] Exporting image to ${TAR_FILE}..."
docker save "${IMAGE_NAME}" | gzip > "${TAR_FILE}"
SIZE=$(du -h "${TAR_FILE}" | cut -f1)
echo "       Size: ${SIZE}"

# ── Step 3: Create GitHub release ──
echo "[3/3] Creating GitHub release v${SEMVER} in ${RELEASE_REPO}..."
# Delete existing release if present
gh release delete "v${SEMVER}" --repo "${RELEASE_REPO}" --yes 2>/dev/null || true
# Create new release with the tar.gz
gh release create "v${SEMVER}" \
  --repo "${RELEASE_REPO}" \
  --title "Nucleus Agent V2 (Rathole Transport)" \
  --notes "Agent V2 (v${SEMVER})
- Rathole TCP transport replaces custom WebSocket tunneling
- Direct TCP port forwarding (SSH, Modbus, HTTP — no CLI needed)
- Dynamic port expose/unexpose via portal commands
- Rathole client managed by agent process
- All existing features preserved (heartbeat, discovery, mbusd, scanner)" \
  "${TAR_FILE}"

# Cleanup tar
rm -f "${TAR_FILE}"

echo ""
echo "╔═══════════════════════════════════════╗"
echo "║   Agent V2 published!                 ║"
echo "╚═══════════════════════════════════════╝"
echo ""
echo "Install on device:"
echo "  curl -fsSL https://raw.githubusercontent.com/JuanM2209/nucleus-portal-v2/master/scripts/install-agent-v2.sh | bash"
echo ""
echo "Or with explicit token:"
echo "  AGENT_TOKEN=<uuid> curl -fsSL ... | bash"
