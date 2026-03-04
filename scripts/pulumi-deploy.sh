#!/usr/bin/env bash
set -euo pipefail

# CI-safe Pulumi deploy helper
# - runs `pulumi preview` and exits unless `APPROVE=true` is set
# - in CI, wire a manual approval step to set APPROVE=true before allowing `pulumi up`


STACK=${STACK:-production}

# Run from the infra package root so Pulumi (if used) finds Pulumi program files
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
INFRA_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
cd "$INFRA_DIR"

echo "Selecting Pulumi stack: ${STACK} (cwd: $PWD)"
pulumi stack select "${STACK}"

echo "Running pulumi preview (non-interactive)"
pulumi preview --non-interactive

if [ "${APPROVE:-}" != "true" ]; then
  echo "Pulumi preview completed. To apply changes set APPROVE=true and re-run this script."
  echo "CI suggestion: add a manual approval action that sets APPROVE=true before invoking this script for production runs."
  exit 0
fi

echo "APPROVE=true detected — running pulumi up"
pulumi up --yes
