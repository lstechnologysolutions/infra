#!/usr/bin/env bash
set -euo pipefail

# CI-safe SST deploy helper
# - runs `npx sst diff` for a readable preview
# - exits unless `APPROVE=true` is set (to gate destructive changes)


STACK=${STACK:-production}

# Run from the infra package root so SST finds sst.config.ts
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
INFRA_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
cd "$INFRA_DIR"

echo "Using SST stack/stage: ${STACK} (cwd: $PWD)"

echo "Running SST diff (preview of infra changes)"
# Use npx so script works without a global sst install
npx sst diff --stage "${STACK}" || true

if [ "${APPROVE:-}" != "true" ]; then
  echo "SST diff completed. To apply changes set APPROVE=true and re-run this script."
  echo "CI suggestion: add a manual approval action that sets APPROVE=true before invoking this script for production runs."
  exit 0
fi

echo "APPROVE=true detected — running sst deploy"
echo "Attempting to clear any stale SST lock for stage ${STACK} (no-op if none)"
# If a previous run left a lock, unlock it non-interactively. This is safe when you
# have confirmed no concurrent deploy is running. In CI, ensure this only runs
# after human approval.
npx sst unlock --stage "${STACK}" || true

# If DOMAIN is provided, check CloudFront distributions for that alias and remove it
# so SST/Pulumi can create a distribution using the domain. CloudFront is global
# (us-east-1) so we query there. This step is performed only when APPROVE=true.
if [ -n "${DOMAIN:-}" ]; then
  echo "Checking CloudFront distributions for alias: ${DOMAIN}"
  # find distribution IDs that include the DOMAIN in their Aliases.Items
  DIST_IDS=$(aws cloudfront list-distributions --query "DistributionList.Items[?contains(Aliases.Items, '${DOMAIN}')].Id" --output text 2>/dev/null || true)
  if [ -n "$DIST_IDS" ]; then
    for DIST_ID in $DIST_IDS; do
      echo "Found CloudFront distribution $DIST_ID that contains alias ${DOMAIN}; removing alias to allow new distribution creation"
      TMP_CFG="/tmp/cf-config-${DIST_ID}.json"
      TMP_CFG_MOD="/tmp/cf-config-${DIST_ID}-mod.json"
      ETAG=$(aws cloudfront get-distribution-config --id "$DIST_ID" --query 'ETag' --output text)
      aws cloudfront get-distribution-config --id "$DIST_ID" --output json > "$TMP_CFG"
      # Use python to safely remove the alias from the DistributionConfig and update Quantity
      python3 - <<PY
import json
with open('$TMP_CFG', 'r') as f:
    obj = json.load(f)
cfg = obj.get('DistributionConfig', {})
aliases = cfg.get('Aliases', {})
items = aliases.get('Items', [])
new_items = [i for i in items if i != '$DOMAIN']
cfg['Aliases'] = {'Quantity': len(new_items), 'Items': new_items}

# If no aliases remain, we must reset the ViewerCertificate to default
if len(new_items) == 0:
    viewer_cert = cfg.get('ViewerCertificate', {})
    if 'ACMCertificateArn' in viewer_cert:
        del viewer_cert['ACMCertificateArn']
    if 'IAMCertificateId' in viewer_cert:
        del viewer_cert['IAMCertificateId']
    if 'MinimumProtocolVersion' in viewer_cert:
        del viewer_cert['MinimumProtocolVersion']
    if 'SSLSupportMethod' in viewer_cert:
        del viewer_cert['SSLSupportMethod']
    viewer_cert['CloudFrontDefaultCertificate'] = True
    cfg['ViewerCertificate'] = viewer_cert

with open('$TMP_CFG_MOD', 'w') as f:
    json.dump(obj, f)
PY
      # update the distribution with the modified config
      if aws cloudfront update-distribution --id "$DIST_ID" --if-match "$ETAG" --distribution-config file://"$TMP_CFG_MOD" >/dev/null 2>&1; then
        echo "Removed alias ${DOMAIN} from distribution $DIST_ID"
      else
        echo "Failed to remove alias ${DOMAIN} from distribution $DIST_ID; continue and attempt deploy (check permissions)" >&2
      fi
      rm -f "$TMP_CFG" "$TMP_CFG_MOD"
    done
  else
    echo "No existing CloudFront distributions found with alias ${DOMAIN}"
  fi
fi

echo "Running sst deploy"
npx sst deploy --stage "${STACK}" --yes
