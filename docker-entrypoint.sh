#!/bin/sh
set -eu

DATA_DIR="${OAUTH_STORE_DIR:-/data}"
mkdir -p "$DATA_DIR"
# Volume is often root-owned on first mount; app runs as mcp.
if [ "$(id -u)" -eq 0 ]; then
  chown -R mcp:mcp "$DATA_DIR" 2>/dev/null || true
  exec su-exec mcp node dist/index.js
fi

exec node dist/index.js
