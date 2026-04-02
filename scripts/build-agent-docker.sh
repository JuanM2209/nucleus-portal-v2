#!/bin/bash
# Build Nucleus Agent vr24 Docker image (ARM cross-compile)
# Then export as .tar.gz and create GitHub release
set -e

VERSION="vr24"
SEMVER="0.24.0"
IMAGE_NAME="nucleus-agent:${VERSION}"
TAR_FILE="nucleus-agent-${VERSION}.tar.gz"
RELEASE_REPO="JuanM2209/nucleus-agent-releases"
DEPLOY_REPO="JuanM2209/nucleus-deploy"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "╔═══════════════════════════════════════╗"
echo "║   Nucleus Agent ${VERSION} — Build Pipeline  ║"
echo "╚═══════════════════════════════════════╝"
echo ""

cd "$PROJECT_ROOT"

# ── Step 1: Build ARM image ──
echo "[1/4] Building ARM image via Docker buildx..."
docker buildx build \
  --builder armbuilder \
  --platform linux/arm/v7 \
  -f infra/docker/Dockerfile.agent \
  -t "${IMAGE_NAME}" \
  --load \
  .

# ── Step 2: Export to .tar.gz ──
echo "[2/4] Exporting image to ${TAR_FILE}..."
docker save "${IMAGE_NAME}" | gzip > "${TAR_FILE}"
SIZE=$(du -h "${TAR_FILE}" | cut -f1)
echo "       Size: ${SIZE}"

# ── Step 3: Create GitHub release ──
echo "[3/4] Creating GitHub release v${SEMVER} in ${RELEASE_REPO}..."
# Delete existing release if present
gh release delete "v${SEMVER}" --repo "${RELEASE_REPO}" --yes 2>/dev/null || true
# Create new release with the tar.gz
gh release create "v${SEMVER}" \
  --repo "${RELEASE_REPO}" \
  --title "Nucleus Agent ${VERSION}" \
  --notes "Agent ${VERSION} (v${SEMVER})
- mbusd crash diagnostics: captures stderr, verifies process survives startup
- endpoint health check improvements
- carrier detection for adapter link state" \
  "${TAR_FILE}"

# ── Step 4: Update deploy repo install.sh ──
echo "[4/4] Updating install.sh in ${DEPLOY_REPO}..."
# Clone, update, push
TMPDIR=$(mktemp -d)
gh repo clone "${DEPLOY_REPO}" "${TMPDIR}/deploy" -- --depth 1 2>/dev/null
cp scripts/install-agent-${VERSION}.sh "${TMPDIR}/deploy/install.sh"
cd "${TMPDIR}/deploy"
git add install.sh
git commit -m "Update to agent ${VERSION}" 2>/dev/null || echo "No changes to commit"
git push 2>/dev/null || echo "Push failed — update manually"
cd "$PROJECT_ROOT"
rm -rf "${TMPDIR}"

# Cleanup tar
rm -f "${TAR_FILE}"

echo ""
echo "╔═══════════════════════════════════════╗"
echo "║   Agent ${VERSION} published!               ║"
echo "╚═══════════════════════════════════════╝"
echo ""
echo "Install on device:"
echo "  curl -fsSL https://raw.githubusercontent.com/${DEPLOY_REPO}/main/install.sh | bash"
echo ""
echo "Or with explicit token:"
echo "  AGENT_TOKEN=<uuid> curl -fsSL https://raw.githubusercontent.com/${DEPLOY_REPO}/main/install.sh | bash"
