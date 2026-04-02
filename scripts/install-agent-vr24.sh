#!/bin/bash
# Nucleus Agent vr24 — One-line installer for N-1065
# curl -fsSL https://raw.githubusercontent.com/JuanM2209/nucleus-deploy/main/install.sh | bash
set -e

IMAGE="nucleus-agent:vr24"
TAR_URL="https://github.com/JuanM2209/nucleus-agent-releases/releases/download/v0.24.0/nucleus-agent-vr24.tar.gz"
CONTAINER="remote-s"
SERVER="${AGENT_SERVER_URL:-wss://api.datadesng.com/ws/agent}"
DEVICE="${AGENT_TOKEN:-$(cat /data/nucleus/factory/nucleus_serial_number 2>/dev/null)}"

echo ""
echo "╔═══════════════════════════════════════╗"
echo "║   Nucleus Agent vr24 Installer        ║"
echo "╚═══════════════════════════════════════╝"
echo ""
echo "  Device: ${DEVICE:-UNKNOWN}"
echo "  Server: ${SERVER}"
echo ""

[ -z "$DEVICE" ] && echo "ERROR: No device ID. Set AGENT_TOKEN or check /data/nucleus/factory/nucleus_serial_number" && exit 1

echo "[1/4] Downloading image..."
curl -L -o /tmp/agent.tar.gz "$TAR_URL"
docker load < /tmp/agent.tar.gz
rm -f /tmp/agent.tar.gz

echo "[2/4] Stopping old container..."
docker stop "$CONTAINER" 2>/dev/null || true
docker rm "$CONTAINER" 2>/dev/null || true

echo "[3/4] Starting vr24..."
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
  "$IMAGE"

echo ""
sleep 3
STATUS=$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "error")
echo "[4/4] Status: ${STATUS}"
echo ""
docker logs --tail 5 "$CONTAINER" 2>&1 | sed 's/^/  /'
echo ""
echo "Logs: docker logs -f $CONTAINER"
