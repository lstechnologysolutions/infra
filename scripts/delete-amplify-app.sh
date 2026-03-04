#!/usr/bin/env bash
set -euo pipefail

# delete-amplify-app.sh
# Delete an AWS Amplify app by app id or by matching a domain/branch.
# Usage:
#   ./delete-amplify-app.sh --app-id <appId>
#   ./delete-amplify-app.sh --domain example.com
# This is non-reversible; ensure you have backups before running.

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI required"
  exit 1
fi

APP_ID=""
DOMAIN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-id) APP_ID="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    -h|--help) echo "Usage: $0 [--app-id <appId>] [--domain <domain>]"; exit 0 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$APP_ID" && -z "$DOMAIN" ]]; then
  echo "Either --app-id or --domain is required"
  exit 1
fi

if [[ -n "$DOMAIN" ]]; then
  echo "Searching Amplify apps for domain: $DOMAIN"
  # List apps and find ones with domain associations
  apps=$(aws amplify list-apps --query "apps[].{id:appId,name:name,domain:defaultDomain}" --output json)
  # Try to find app that matches domain or defaultDomain contains the domain
  APP_ID=$(echo "$apps" | node -e "const r=require('fs').readFileSync(0,'utf8'); const a=JSON.parse(r)||[]; for(const it of a){ if((it.domain||'').includes(process.argv[1])|| (it.name||'').includes(process.argv[1])){ console.log(it.id||it.appId||it.appId||it.appId); process.exit(0);} }" "$DOMAIN" || true)
fi

if [[ -z "$APP_ID" ]]; then
  echo "Amplify app not found for domain; please specify --app-id"
  exit 1
fi

echo "Deleting Amplify app: $APP_ID"
aws amplify delete-app --app-id "$APP_ID"

echo "Deleted Amplify app $APP_ID (request submitted)."
echo "Note: You may want to remove associated DNS records and artifacts if needed."
