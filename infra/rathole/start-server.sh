#!/usr/bin/env bash
# Start Rathole server for Nucleus Portal V2
# Usage: bash infra/rathole/start-server.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RATHOLE_EXE="$SCRIPT_DIR/rathole.exe"
CONFIG="$SCRIPT_DIR/server.toml"

if [ ! -f "$RATHOLE_EXE" ]; then
  echo "ERROR: rathole.exe not found at $RATHOLE_EXE"
  exit 1
fi

if [ ! -f "$CONFIG" ]; then
  echo "ERROR: server.toml not found at $CONFIG"
  exit 1
fi

echo "Starting Rathole server..."
echo "  Binary:  $RATHOLE_EXE"
echo "  Config:  $CONFIG"
echo "  Control: 0.0.0.0:2333"
echo "  Hot-reload: enabled (file watch on config changes)"
echo ""

exec "$RATHOLE_EXE" --server "$CONFIG"
