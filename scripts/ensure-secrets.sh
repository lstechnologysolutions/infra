#!/usr/bin/env bash
set -euo pipefail

# ensure-secrets.sh
# Idempotently ensure SST secrets for a given stage using the schema.
# Usage: ./ensure-secrets.sh <stage> [--values-file path/to/values.env]

STAGE=${1:-dev}
VALUES_FILE=${2:-}

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
SCHEMA_FILE="$ROOT_DIR/schemas/secrets.schema.json"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to run this script"
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required to run this script"
  exit 1
fi

echo "Using secrets schema: $SCHEMA_FILE"

# Extract keys from schema using node (single-line invocation avoids heredoc issues)
KEYS=$(node -e "const fs=require('fs');const p=process.argv[1];const schema=JSON.parse(fs.readFileSync(p,'utf8'));console.log(Object.keys(schema.properties||{}).join(' '));" "$SCHEMA_FILE")

declare -A VALS

# Load values-file if provided (simple KEY=VALUE lines)
if [[ -n "$VALUES_FILE" && -f "$VALUES_FILE" ]]; then
  echo "Loading values from $VALUES_FILE"
  while IFS='=' read -r k v; do
    k=$(echo "$k" | tr -d ' \t\r\n')
    v=$(echo "$v" | sed -e 's/^\s*//;s/\s*$//')
    if [[ -n "$k" ]]; then
      VALS["$k"]="$v"
    fi
  done < <(grep -E '^[A-Za-z0-9_]+=.*' "$VALUES_FILE" || true)
fi

echo "Ensuring SST secrets for stage: $STAGE"
for key in $KEYS; do
  value="${VALS[$key]:-__MISSING__}"
  if [[ "$value" == "__MISSING__" ]]; then
    # generate a random value for AuthSecret if missing
    if [[ "$key" == "AuthSecret" ]]; then
      value=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    fi
  fi

  echo "Setting secret: $key"
  # Use `sst secret set` which is idempotent for values; it will create/update.
  npx --yes sst secret set "$key" "$value" --stage "$STAGE"
done

echo "All secrets ensured for stage: $STAGE"
