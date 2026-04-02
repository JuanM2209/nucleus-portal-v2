#!/bin/bash
# =============================================================================
# Obsidian Auto-Sync for Nucleus Portal
#
# PostToolUse hook: after Write/Edit, logs changes and updates relevant notes.
# Called by Claude Code with tool info on stdin (JSON).
# =============================================================================

VAULT_URL="https://127.0.0.1:27124"
API_KEY="f9014cd3546d1609cde5f6bdad40c0ce441f0026b465d6d2cfb95296dc445694"
VAULT_DIR="Z:/NucleusVault"
PROJECT_DIR="Z:/nucleus-portal"
CHANGES_NOTE="Nucleus/Changelog/Recent-Changes.md"

# Read hook input from stdin
INPUT=$(cat)

# Extract tool name and file path from hook JSON
TOOL_NAME=$(echo "$INPUT" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
FILE_PATH=$(echo "$INPUT" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

# Only process Write/Edit on project files
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# Skip if file is in NucleusVault (avoid infinite loop)
if echo "$FILE_PATH" | grep -qi "NucleusVault"; then
  exit 0
fi

# Skip node_modules, .next, dist, target
if echo "$FILE_PATH" | grep -qiE "(node_modules|\.next|dist/|target/|\.turbo)"; then
  exit 0
fi

# Get relative path from project root
REL_PATH=$(echo "$FILE_PATH" | sed "s|.*nucleus-portal[/\\\\]||i" | sed 's|\\|/|g')

# Determine category based on file path
CATEGORY=""
OBSIDIAN_NOTE=""
if echo "$REL_PATH" | grep -qi "packages/backend/src/auth"; then
  CATEGORY="Auth" ; OBSIDIAN_NOTE="07-Security"
elif echo "$REL_PATH" | grep -qi "packages/backend/src/tunnel"; then
  CATEGORY="Tunnels" ; OBSIDIAN_NOTE="03-Tunnel-System"
elif echo "$REL_PATH" | grep -qi "packages/backend/src/device"; then
  CATEGORY="Devices" ; OBSIDIAN_NOTE="01-API-Endpoints"
elif echo "$REL_PATH" | grep -qi "packages/backend/src/scanner"; then
  CATEGORY="Scanner" ; OBSIDIAN_NOTE="01-API-Endpoints"
elif echo "$REL_PATH" | grep -qi "packages/backend/src/discovery"; then
  CATEGORY="Discovery" ; OBSIDIAN_NOTE="01-API-Endpoints"
elif echo "$REL_PATH" | grep -qi "packages/backend/src/agent-gateway"; then
  CATEGORY="Agent Gateway" ; OBSIDIAN_NOTE="04-Agent-Protocol"
elif echo "$REL_PATH" | grep -qi "packages/backend/src/database"; then
  CATEGORY="Database" ; OBSIDIAN_NOTE="02-Database-Schema"
elif echo "$REL_PATH" | grep -qi "packages/backend/src/orgs"; then
  CATEGORY="Organizations" ; OBSIDIAN_NOTE="01-API-Endpoints"
elif echo "$REL_PATH" | grep -qi "packages/backend/src/audit"; then
  CATEGORY="Audit" ; OBSIDIAN_NOTE="01-API-Endpoints"
elif echo "$REL_PATH" | grep -qi "packages/backend/src/logs"; then
  CATEGORY="Logs" ; OBSIDIAN_NOTE="01-API-Endpoints"
elif echo "$REL_PATH" | grep -qi "packages/backend/src/settings"; then
  CATEGORY="Settings" ; OBSIDIAN_NOTE="01-API-Endpoints"
elif echo "$REL_PATH" | grep -qi "packages/backend/src/health"; then
  CATEGORY="Health" ; OBSIDIAN_NOTE="01-API-Endpoints"
elif echo "$REL_PATH" | grep -qi "packages/backend"; then
  CATEGORY="Backend" ; OBSIDIAN_NOTE="01-API-Endpoints"
elif echo "$REL_PATH" | grep -qi "packages/frontend/src/app"; then
  CATEGORY="Frontend Routes" ; OBSIDIAN_NOTE="05-Frontend-Routes"
elif echo "$REL_PATH" | grep -qi "packages/frontend/src/components"; then
  CATEGORY="Frontend Components" ; OBSIDIAN_NOTE="05-Frontend-Routes"
elif echo "$REL_PATH" | grep -qi "packages/frontend/src/hooks"; then
  CATEGORY="Frontend Hooks" ; OBSIDIAN_NOTE="05-Frontend-Routes"
elif echo "$REL_PATH" | grep -qi "packages/frontend/src/stores"; then
  CATEGORY="Frontend Stores" ; OBSIDIAN_NOTE="05-Frontend-Routes"
elif echo "$REL_PATH" | grep -qi "packages/frontend"; then
  CATEGORY="Frontend" ; OBSIDIAN_NOTE="05-Frontend-Routes"
elif echo "$REL_PATH" | grep -qi "packages/shared"; then
  CATEGORY="Shared Types" ; OBSIDIAN_NOTE="00-Overview"
elif echo "$REL_PATH" | grep -qi "agent/"; then
  CATEGORY="Rust Agent" ; OBSIDIAN_NOTE="04-Agent-Protocol"
elif echo "$REL_PATH" | grep -qi "helper/"; then
  CATEGORY="Rust Helper" ; OBSIDIAN_NOTE="04-Agent-Protocol"
elif echo "$REL_PATH" | grep -qi "infra/"; then
  CATEGORY="Infrastructure" ; OBSIDIAN_NOTE="06-Infrastructure"
elif echo "$REL_PATH" | grep -qi "scripts/"; then
  CATEGORY="Scripts" ; OBSIDIAN_NOTE="06-Infrastructure"
else
  CATEGORY="Other" ; OBSIDIAN_NOTE="00-Overview"
fi

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
ACTION="edited"
if [[ "$TOOL_NAME" == "Write" ]]; then
  ACTION="created/rewritten"
fi

# Build the change entry
ENTRY="- \`$TIMESTAMP\` | **$ACTION** | \`$REL_PATH\` | $CATEGORY → [[Nucleus/$OBSIDIAN_NOTE]]"

# Append to Recent-Changes note via Obsidian API
CHANGES_FILE="$VAULT_DIR/$CHANGES_NOTE"

# Create the file if it doesn't exist
if [[ ! -f "$CHANGES_FILE" ]]; then
  cat > "$CHANGES_FILE" << 'HEADER'
---
tags: [nucleus, changelog, auto-sync]
created: 2026-03-26
---

# Recent Changes (Auto-Sync)

> This note is automatically updated by Claude Code via PostToolUse hook.
> Every file edit/write in `Z:\nucleus-portal` is logged here.

HEADER
fi

# Append the entry
echo "$ENTRY" >> "$CHANGES_FILE"

# Update the Obsidian note via API to trigger hot reload
curl -s -k -X PUT \
  "$VAULT_URL/vault/$CHANGES_NOTE" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: text/markdown" \
  --data-binary "@$CHANGES_FILE" \
  > /dev/null 2>&1

exit 0
