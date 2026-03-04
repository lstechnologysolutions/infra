#!/usr/bin/env bash
set -euo pipefail

# predeploy-checks.sh
# Non-destructive pre-deploy checks that detect common DNS/CloudFront/ACM
# conflicts which would cause `sst deploy` to fail. Exits non-zero with a
# helpful diagnostic if a blocking issue is found.
#
# Required environment variables:
#   DOMAIN_ROOT       — Root domain (e.g., "example.com")
#
# Optional environment variables:
#   AWS_REGION        — AWS region (default: us-east-1)
#   SST_STAGE         — SST stage name (default: production)
#   INFRA_PATH        — Path to infra package (default: packages/infra)
#   DOMAIN_PRODUCTION — Override domain for production stage
#   DOMAIN_DEV        — Override domain for dev stage
#   DOMAIN_MOBILE     — Override domain for mobile stage
#   DOMAIN_CUSTOM     — Override domain for custom stages
#   PROJECT_PREFIX    — Project prefix for pipeline names (e.g., "myapp")
#   SKIP_PREDEPLOY_CHECKS — Set to "true" to skip all checks
#   SKIP_DNS_CHECK    — Set to "true" to skip DNS conflict check
#   AUTO_REMOVE_CONFLICTING_DNS — Set to "true" to auto-remove conflicting DNS records
#   ALLOW_PIPELINE_DESTRUCTIVE — Set to "true" to allow pipeline deletion

AWS_REGION=${AWS_REGION:-us-east-1}
STAGE=${SST_STAGE:-${1:-production}}
INFRA_PATH=${INFRA_PATH:-packages/infra}

if [ -z "${DOMAIN_ROOT:-}" ]; then
  echo "ERROR: DOMAIN_ROOT environment variable is required (e.g., DOMAIN_ROOT=example.com)"
  echo "Set this in your project's environment or buildspec."
  exit 1
fi

# Optional overrides for CI
SKIP_PREDEPLOY_CHECKS=${SKIP_PREDEPLOY_CHECKS:-false}
SKIP_DNS_CHECK=${SKIP_DNS_CHECK:-false}
AUTO_REMOVE_CONFLICTING_DNS=${AUTO_REMOVE_CONFLICTING_DNS:-false}

echo "Pre-deploy checks: region=$AWS_REGION stage=$STAGE domain=$DOMAIN_ROOT"

check_route53_conflict() {
  local name=$1
  hz=$(aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN_ROOT" --query 'HostedZones[0].Id' --output text 2>/dev/null || true)
  if [ -z "$hz" ]; then
    echo "WARN: Hosted zone for $DOMAIN_ROOT not found in $AWS_REGION"
    return 0
  fi
  hz=${hz##*/}
  hz=${hz##*/}
  # Only treat A/AAAA/CNAME or alias records as blocking records for web deploys.
  # Keep MX/TXT/NS/SOA since they are often required for email/zone setup and
  # should not block CloudFront/website deploys.
  rr=$(aws route53 list-resource-record-sets --hosted-zone-id "$hz" --query "ResourceRecordSets[?Name=='${name}.' && (Type=='A' || Type=='AAAA' || Type=='CNAME' || AliasTarget!=null)]" --output json || echo "[]")
  if [ "$rr" != "[]" ]; then
    echo "FAIL: Route53 A/AAAA/CNAME/ALIAS record exists for ${name} that may block deploy:"
    echo "$rr"
    if [ "${AUTO_REMOVE_CONFLICTING_DNS}" = "true" ]; then
      echo "AUTO_REMOVE_CONFLICTING_DNS=true — attempting to delete conflicting records for ${name}"
      # Delete each matching record set
      echo "$rr" | jq -c '.[]' | while read -r rec; do
        tmp=$(mktemp)
        cat > "$tmp" <<EOF
{
  "Comment": "DELETE conflicting record for ${name}",
  "Changes": [
    {
      "Action": "DELETE",
      "ResourceRecordSet": $rec
    }
  ]
}
EOF
        if aws route53 change-resource-record-sets --hosted-zone-id "$hz" --change-batch file://"$tmp" >/dev/null 2>&1; then
          echo "Deleted conflicting record: $rec"
        else
          echo "Failed to delete conflicting record: $rec" >&2
        fi
        rm -f "$tmp"
      done
      # Give DNS a moment to settle (don't block long)
      sleep 2
      return 0
    fi
    return 2
  fi
  return 0
}

check_cloudfront_alias() {
  local sub=$1
  out=$(aws cloudfront list-distributions --query "DistributionList.Items[?Aliases.Items!=null && contains(Aliases.Items,'${sub}')].[Id,DomainName,Status,Aliases.Items]" --output json || echo "[]")
  if [ "$out" != "[]" ]; then
    echo "WARN: CloudFront distribution already has alias ${sub}:"
    echo "$out"
    echo "This is expected if the site is already deployed by this same SST project."
    return 0
  fi
  return 0
}

check_acm_certificate() {
  local sub=$1
  certs=$(aws acm list-certificates --region "$AWS_REGION" --query "CertificateSummaryList[?DomainName=='${sub}']" --output json || echo "[]")
  if [ "$certs" != "[]" ]; then
    echo "NOTE: ACM certificate(s) exist for ${sub}:"
    echo "$certs"
  fi
}

resolve_stage_domain() {
  case "$STAGE" in
    production) echo "${DOMAIN_PRODUCTION:-${DOMAIN_ROOT}}" ;;
    dev) echo "${DOMAIN_DEV:-dev.${DOMAIN_ROOT}}" ;;
    mobile) echo "${DOMAIN_MOBILE:-mobile.${DOMAIN_ROOT}}" ;;
    *) echo "${DOMAIN_CUSTOM:-${STAGE}.${DOMAIN_ROOT}}" ;;
  esac
}

TARGET_DOMAIN=$(resolve_stage_domain)

echo "Checking DNS records and CloudFront aliases..."

if [ "${SKIP_PREDEPLOY_CHECKS}" = "true" ]; then
  echo "SKIP_PREDEPLOY_CHECKS=true — skipping DNS/CloudFront/ACM predeploy checks."
else
  if [ "${SKIP_DNS_CHECK}" != "true" ]; then
    check_route53_conflict "$TARGET_DOMAIN" || exit 2
  elif [ "$STAGE" = "dev" ]; then
    echo "SKIP_DNS_CHECK=true — skipping Route53 conflict check for $TARGET_DOMAIN"
  else
    echo "SKIP_DNS_CHECK=true — skipping Route53 conflict check for $TARGET_DOMAIN"
  fi

  check_cloudfront_alias "$TARGET_DOMAIN" || exit 2
  check_acm_certificate "$TARGET_DOMAIN"
fi

echo "Pre-deploy checks passed."

# ----- Destructive change detection (pipeline protection) -----
echo "Running infra diff to detect potentially destructive changes..."
DIFF_OUT=""
if [ -d "$INFRA_PATH" ]; then
  pushd "$INFRA_PATH" >/dev/null || true
  if command -v npx >/dev/null 2>&1; then
    DIFF_OUT=$(npx sst diff --stage "$STAGE" --no-color 2>&1 || true)
  elif command -v sst >/dev/null 2>&1; then
    DIFF_OUT=$(sst diff --stage "$STAGE" --no-color 2>&1 || true)
  else
    DIFF_OUT=""
  fi
  popd >/dev/null || true
fi

if [ -n "$DIFF_OUT" ]; then
  echo "$DIFF_OUT" | sed -n '1,200p'
  # detect pipeline deletion entries in the diff output
  if echo "$DIFF_OUT" | grep -Ei 'DELETE.*(CodePipeline|AWS::CodePipeline::Pipeline|pipeline)' >/dev/null 2>&1; then
    # compute expected pipeline name for this stage
    PROJECT_PREFIX=${PROJECT_PREFIX:-app}
    if [ "$STAGE" = "production" ]; then
      PIPELINE_NAME="${PROJECT_PREFIX}-prod-pipeline"
    elif [ "$STAGE" = "dev" ]; then
      PIPELINE_NAME="${PROJECT_PREFIX}-dev-pipeline"
    else
      PIPELINE_NAME="${PROJECT_PREFIX}-${STAGE}-pipeline"
    fi

    ARN=$(aws codepipeline list-pipelines --region "$AWS_REGION" --query "pipelines[?name=='${PIPELINE_NAME}'].pipelineArn" --output text || true)
    PROTECTED_TAG=""
    if [ -n "$ARN" ] && [ "$ARN" != "None" ]; then
      tags_json=$(aws codepipeline list-tags-for-resource --resource-arn "$ARN" --region "$AWS_REGION" --output json 2>/dev/null || echo "[]")
      PROTECTED_TAG=$(echo "$tags_json" | jq -r '.tags[]? | select(.key=="Protected") | .value' 2>/dev/null || echo "")
    fi

    if [ "$PROTECTED_TAG" = "true" ]; then
      echo "ERROR: planned changes include deletion of protected pipeline '$PIPELINE_NAME'. Aborting." >&2
      exit 4
    else
      if [ "${ALLOW_PIPELINE_DESTRUCTIVE:-false}" != "true" ]; then
        echo "FAIL: planned changes include deletion of pipeline '$PIPELINE_NAME'. To allow this set ALLOW_PIPELINE_DESTRUCTIVE=true and re-run." >&2
        exit 4
      else
        echo "Warning: pipeline deletion detected but ALLOW_PIPELINE_DESTRUCTIVE=true is set — proceeding with caution."
      fi
    fi
  fi
fi

exit 0
