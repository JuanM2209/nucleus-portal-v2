#!/usr/bin/env bash
set -euo pipefail

echo "Building Nucleus Agent for ARM32v7..."

cd agent

if command -v cross &> /dev/null; then
    cross build --release --target armv7-unknown-linux-musleabihf
else
    echo "cross not found. Install with: cargo install cross"
    echo "Then run this script again."
    exit 1
fi

BINARY="target/armv7-unknown-linux-musleabihf/release/nucleus-agent"
if [ -f "$BINARY" ]; then
    SIZE=$(du -h "$BINARY" | cut -f1)
    echo "Build complete: $BINARY ($SIZE)"
else
    echo "Build failed!"
    exit 1
fi
