#!/usr/bin/env bash
set -euo pipefail

# postdeploy-update-dns.sh
# After a successful infra deploy this script ensures the stage domain (dev/production)
# Route53 alias points to the CloudFront distribution that serves it.
#
# Usage: postdeploy-update-dns.sh <stage> [region]
#
# Required environment variables:
#   DOMAIN_ROOT — Root domain (e.g., "example.com")
#
# Optional stage overrides:
#   DOMAIN_PRODUCTION, DOMAIN_DEV, DOMAIN_MOBILE, DOMAIN_CUSTOM

STAGE=${1:-dev}
REGION=${2:-us-east-1}

if [ -z "${DOMAIN_ROOT:-}" ]; then
  echo "ERROR: DOMAIN_ROOT environment variable is required (e.g., DOMAIN_ROOT=example.com)"
  exit 1
fi

# Polling configuration (seconds)
POLL_TIMEOUT=${POLL_TIMEOUT:-600}   # total time to wait for distribution (default 10m)
POLL_INTERVAL=${POLL_INTERVAL:-15}  # interval between checks

resolve_stage_domain() {
  case "$STAGE" in
    production) echo "${DOMAIN_PRODUCTION:-${DOMAIN_ROOT}}" ;;
    dev) echo "${DOMAIN_DEV:-dev.${DOMAIN_ROOT}}" ;;
    mobile) echo "${DOMAIN_MOBILE:-mobile.${DOMAIN_ROOT}}" ;;
    *) echo "${DOMAIN_CUSTOM:-${STAGE}.${DOMAIN_ROOT}}" ;;
  esac
}

DOMAIN=$(resolve_stage_domain)

echo "Post-deploy DNS sync: stage=$STAGE domain=$DOMAIN region=$REGION"

# Find and wait for the CloudFront distribution that has this alias
echo "Searching for CloudFront distribution with alias ${DOMAIN} (will wait up to ${POLL_TIMEOUT}s)..."
END=$((SECONDS + POLL_TIMEOUT))
FOUND_DIST_ID=""
FOUND_DIST_STATUS=""
FOUND_DIST_DOMAIN=""
while [ $SECONDS -le $END ]; do
  # Query distributions and look for any that contain the alias
  CF_JSON=$(mktemp)
  aws cloudfront list-distributions --output json > "$CF_JSON" || true

  # Find first distribution that has the alias
  CID=$(jq -r --arg domain "$DOMAIN" '
    (.DistributionList.Items[]? | select(.Aliases.Items? != null and (.Aliases.Items | index($domain) != null)) )
    | .Id' "$CF_JSON" 2>/dev/null | head -n1 || true)

  if [ -n "$CID" ] && [ "$CID" != "null" ]; then
    STATUS=$(aws cloudfront get-distribution --id "$CID" --query 'Distribution.Status' --output text 2>/dev/null || echo "")
    DOMAIN_NAME=$(aws cloudfront get-distribution --id "$CID" --query 'Distribution.DomainName' --output text 2>/dev/null || echo "")
    echo "Found distribution $CID with status='$STATUS' and domain='$DOMAIN_NAME'"
    if [ "$STATUS" = "Deployed" ]; then
      FOUND_DIST_ID="$CID"
      FOUND_DIST_STATUS="$STATUS"
      FOUND_DIST_DOMAIN="$DOMAIN_NAME"
      rm -f "$CF_JSON"
      break
    fi
    # not yet deployed — wait and poll again
    rm -f "$CF_JSON"
  else
    rm -f "$CF_JSON"
    echo "No distribution found yet for ${DOMAIN}; retrying in ${POLL_INTERVAL}s..."
  fi

  sleep ${POLL_INTERVAL}
done

if [ -z "$FOUND_DIST_ID" ]; then
  echo "Timed out waiting for a deployed CloudFront distribution for ${DOMAIN}. Gathering diagnostics..." >&2

  # Print any distributions that reference the alias (even if not Deployed)
  echo "\n-- Distributions mentioning ${DOMAIN} (all statuses) --"
  aws cloudfront list-distributions --query "DistributionList.Items[?Aliases.Items!=null && contains(Aliases.Items, '${DOMAIN}')].[Id,DomainName,Status,Aliases.Items]" --output json || true

  # ACM certificates in us-east-1
  echo "\n-- ACM certificates for ${DOMAIN} (us-east-1) --"
  aws acm list-certificates --region us-east-1 --query "CertificateSummaryList[?DomainName=='${DOMAIN}']" --output json || true

  # Route53 hosted zone and apex records
  echo "\n-- Route53 apex records for ${DOMAIN_ROOT} --"
  HZ=$(aws route53 list-hosted-zones-by-name --dns-name "${DOMAIN_ROOT}" --query 'HostedZones[0].Id' --output text || true)
  if [ -n "$HZ" ] && [ "$HZ" != "None" ]; then
    HZ_ID=${HZ##*/}
    echo "Hosted zone ID: $HZ_ID"
    aws route53 list-resource-record-sets --hosted-zone-id "$HZ_ID" --query "ResourceRecordSets[?Name=='${DOMAIN}.']" --output json || true
  else
    echo "No hosted zone for ${DOMAIN_ROOT} found in this account/region"
  fi

  echo "\nIf SST reported creating a site but no distribution exists, ensure SST had permissions to create CloudFront and ACM resources and that the deploy completed successfully."
  exit 1
fi

echo "Found distribution: $FOUND_DIST_ID"

DIST_ID="$FOUND_DIST_ID"
DIST_DOMAIN="$FOUND_DIST_DOMAIN"

# If we got here but DIST_DOMAIN is empty, attempt fallback: pick any Deployed distribution
if [ -z "$DIST_DOMAIN" ] || [ "$DIST_DOMAIN" = "null" ]; then
  echo "Distribution had no DomainName in lookup; attempting fallback to any Deployed distribution..."
  FALLBACK_ID=$(aws cloudfront list-distributions --query "DistributionList.Items[?Status=='Deployed'].[Id] | [0]" --output text 2>/dev/null || true)
  if [ -n "$FALLBACK_ID" ] && [ "$FALLBACK_ID" != "None" ]; then
    DIST_ID="$FALLBACK_ID"
    DIST_DOMAIN=$(aws cloudfront get-distribution --id "$DIST_ID" --query 'Distribution.DomainName' --output text 2>/dev/null || echo "")
    echo "Falling back to distribution $DIST_ID with domain $DIST_DOMAIN"
  else
    echo "No Deployed CloudFront distribution available to use as fallback. Exiting." >&2
    exit 1
  fi
fi

# Lookup hosted zone id for base domain
HOSTED_ZONE_ID=$(aws route53 list-hosted-zones-by-name --dns-name "${DOMAIN_ROOT}" --query 'HostedZones[0].Id' --output text)
if [ -z "$HOSTED_ZONE_ID" ] || [ "$HOSTED_ZONE_ID" = "None" ]; then
  echo "Hosted zone for ${DOMAIN_ROOT} not found. Exiting." >&2
  exit 1
fi

# Strip /hostedzone/ prefix if present
HOSTED_ZONE_ID=${HOSTED_ZONE_ID#/hostedzone/}

CHANGE_BATCH=$(mktemp)
cat > "$CHANGE_BATCH" <<EOF
{
  "Comment": "UPSERT ${DOMAIN} -> ${DIST_DOMAIN}",
  "Changes": [
    {
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "${DOMAIN}.",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "Z2FDTNDATAQYW2",
          "DNSName": "${DIST_DOMAIN}",
          "EvaluateTargetHealth": false
        }
      }
    }
  ]
}
EOF

echo "Submitting Route53 change to upsert alias for ${DOMAIN} -> ${DIST_DOMAIN}"
CHANGE_RESULT=$(aws route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" --change-batch file://"$CHANGE_BATCH")
echo "$CHANGE_RESULT"

echo "Done. Route53 change submitted."
