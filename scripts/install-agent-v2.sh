#!/bin/bash
# Nucleus Agent V2 — One-line installer for N-1065
# Includes chisel client for direct TCP port forwarding via Cloudflare Tunnel
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/JuanM2209/nucleus-portal-v2/master/scripts/install-agent-v2.sh | bash
set -e

IMAGE="nucleus-agent:vr25"
TAR_URL="https://github.com/JuanM2209/nucleus-agent-releases/releases/download/v2.5.0/nucleus-agent-vr25.tar.gz"
CONTAINER="remote-s"
SERVER="${AGENT_SERVER_URL:-wss://api.datadesng.com/ws/agent}"
DEVICE="${AGENT_TOKEN:-$(cat /data/nucleus/factory/nucleus_serial_number 2>/dev/null)}"
CHISEL_CRED="${CHISEL_AUTH:-nucleus:d0f8884fd9676ea03d9230f36ac48769}"
CHISEL_URL="${CHISEL_SERVER_URL:-https://api.datadesng.com/chisel}"

echo ""
echo "╔═══════════════════════════════════════╗"
echo "║   Nucleus Agent V2 Installer          ║"
echo "║   (with Chisel TCP transport)         ║"
echo "╚═══════════════════════════════════════╝"
echo ""
echo "  Device: ${DEVICE:-UNKNOWN}"
echo "  Server: ${SERVER}"
echo ""

[ -z "$DEVICE" ] && echo "ERROR: No device ID. Set AGENT_TOKEN or check /data/nucleus/factory/nucleus_serial_number" && exit 1

echo "[1/4] Downloading agent image..."
curl -L -o /tmp/agent-v2.tar.gz "$TAR_URL"
docker load < /tmp/agent-v2.tar.gz
rm -f /tmp/agent-v2.tar.gz

echo "[2/4] Stopping old container..."
docker stop "$CONTAINER" 2>/dev/null || true
docker rm "$CONTAINER" 2>/dev/null || true

echo "[3/4] Starting agent V2..."
docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  --network host \
  --privileged \
  --pid=host \
  -v /data/nucleus:/data/nucleus:ro \
  -v /dev:/dev \
  -v /var/run/dbus:/var/run/dbus \
  -v /sys/class/net:/sys/class/net:ro \
  -e AGENT_SERVER_URL="$SERVER" \
  -e AGENT_TOKEN="$DEVICE" \
  -e CHISEL_AUTH="$CHISEL_CRED" \
  -e CHISEL_SERVER_URL="$CHISEL_URL" \
  "$IMAGE"

echo ""
sleep 3
STATUS=$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "error")
echo "[4/4] Status: ${STATUS}"
echo ""
docker logs --tail 5 "$CONTAINER" 2>&1 | sed 's/^/  /'
echo ""
echo "╔═══════════════════════════════════════╗"
echo "║   Agent V2 deployed: ${STATUS}            ║"
echo "╚═══════════════════════════════════════╝"
echo ""
echo "Logs: docker logs -f $CONTAINER"
