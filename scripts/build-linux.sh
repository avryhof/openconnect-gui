#!/usr/bin/env bash
# Build the Linux packages (.deb and .AppImage).
#
# Usage:
#   ./scripts/build-linux.sh
#
# Output (in dist/):
#   openconnect-gui_<version>_amd64.deb
#   OpenConnect VPN-<version>.AppImage

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  echo "==> Installing dependencies"
  npm install
fi

echo "==> Building Linux packages"
npm run dist:linux

VERSION=$(node -p "require('./package.json').version")
echo
echo "==> Done (version ${VERSION})"
ls -la dist/*.deb dist/*.AppImage 2>/dev/null || true
