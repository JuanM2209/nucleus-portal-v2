#!/bin/bash
# Build Nucleus Agent V26 Docker image (ARM cross-compile + chisel client)
# Then export as .tar.gz and create GitHub release
set -e

VERSION="vr26"
SEMVER="2.6.0"
IMAGE_NAME="nucleus-agent:${VERSION}"
TAR_FILE="nucleus-agent-${VERSION}.tar.gz"
RELEASE_REPO="JuanM2209/nucleus-agent-releases"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "╔═══════════════════════════════════════════════╗"
echo "║   Nucleus Agent V26 — Build Pipeline          ║"
echo "║   (ARP Discovery + Vendor ID + Deep Scan)    ║"
echo "╚═══════════════════════════════════════════════╝"
echo ""

cd "$PROJECT_ROOT"

# ── Step 1: Build ARM image ──
echo "[1/3] Building ARM image via Docker buildx..."
echo "       (includes chisel ARM binary + pnet ARP scanner)"

# Ensure buildx builder exists
docker buildx inspect armbuilder >/dev/null 2>&1 || \
  docker buildx create --name armbuilder --use

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
  --title "Nucleus Agent V26 (ARP Discovery + Vendor ID)" \
  --notes "Agent V26 (v${SEMVER})
- **ARP Discovery**: Phase 1 uses ARP sweep to find ALL devices on subnet (unfirewallable)
- **MAC + Vendor ID**: Reports MAC address and vendor (Siemens, Emerson, Moxa, Hikvision, etc.)
- **Two-phase scan**: ARP sweep first, then TCP port scan only on discovered hosts
- **Hosts with no open ports**: ARP-discovered devices shown even without open TCP ports
- **Deep port scan**: 44 ports including industrial (S7comm, DNP3, MQTT, OPC UA, BACnet)
- **Chisel re-expose**: Backend resends port_expose on agent reconnect (no manual re-export)
- Localhost dedup: single localhost entry per device
- Chisel TCP transport (SSH, Modbus, HTTP — direct TCP)
- All existing features preserved (heartbeat, mbusd, comms)" \
  "${TAR_FILE}"

# Cleanup tar
rm -f "${TAR_FILE}"

echo ""
echo "╔═══════════════════════════════════════════════╗"
echo "║   Agent V26 published!                        ║"
echo "╚═══════════════════════════════════════════════╝"
echo ""
echo "Install on device:"
echo "  curl -fsSL https://raw.githubusercontent.com/JuanM2209/nucleus-deploy/main/install.sh | bash"
echo ""
echo "Or manual:"
echo "  AGENT_TOKEN=<uuid> curl -fsSL ... | bash"
