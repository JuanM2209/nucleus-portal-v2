#!/bin/bash
# Patch mbusd into running nucleus-agent container
# Run from device terminal (N-1065 Cockpit)
#
# Usage: curl -fsSL <URL>/patch-mbusd.sh | bash
# Or:    bash patch-mbusd.sh /path/to/mbusd
set -e

CONTAINER="remote-s"
MBUSD_URL="https://github.com/JuanM2209/nucleus-agent-releases/releases/download/v0.24.0/mbusd"

echo "=== Patching mbusd into ${CONTAINER} ==="

# Download or use local mbusd binary
if [ -n "$1" ] && [ -f "$1" ]; then
  MBUSD_BIN="$1"
  echo "Using local binary: $MBUSD_BIN"
else
  echo "Downloading mbusd binary..."
  curl -fsSL "$MBUSD_URL" -o /tmp/mbusd || {
    echo "Download failed. Provide path: bash patch-mbusd.sh /path/to/mbusd"
    exit 1
  }
  MBUSD_BIN="/tmp/mbusd"
fi

chmod +x "$MBUSD_BIN"

echo "Copying to container..."
docker cp "$MBUSD_BIN" "${CONTAINER}:/usr/local/bin/mbusd"
docker exec "${CONTAINER}" chmod +x /usr/local/bin/mbusd

echo "Verifying..."
docker exec "${CONTAINER}" ls -la /usr/local/bin/mbusd

echo ""
echo "=== Done! mbusd patched into ${CONTAINER} ==="
echo "Test: Start Bridge from the Nucleus Portal"
