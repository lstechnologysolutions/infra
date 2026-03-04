#!/usr/bin/env bash
set -euo pipefail

# ensure-pipelines.sh
#
# AWS-only helper (v1.0.0) to ensure configured CodePipelines exist.
# Missing pipelines are created by triggering an SST deploy for their mapped stage.
#
# Usage:
#   APPROVE=true bash scripts/ensure-pipelines.sh

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
INFRA_DIR=$(cd "$SCRIPT_DIR/.." && pwd)

if [ -f "$INFRA_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$INFRA_DIR/.env"
  set +a
fi

DOMAIN_ROOT=${DOMAIN_ROOT:-${INFRA_ROOT_DOMAIN:-}}
if [ -z "$DOMAIN_ROOT" ]; then
  echo "ERROR: Set DOMAIN_ROOT or INFRA_ROOT_DOMAIN (e.g., example.com)" >&2
  exit 1
fi

REGION=${AWS_REGION:-us-east-1}
PIPELINE_PREFIX=${INFRA_PIPELINE_PREFIX:-myapp}
PIPELINES_CSV=${INFRA_PIPELINES:-production,dev,mobile}
REPO_DEFAULT=${INFRA_PIPELINE_REPO:-myorg/myrepo}
BRANCH_PROD=${INFRA_PIPELINE_BRANCH_PROD:-main}
BRANCH_DEV=${INFRA_PIPELINE_BRANCH_DEV:-develop}
BRANCH_MOBILE=${INFRA_PIPELINE_BRANCH_MOBILE:-mobile}

declare -A PIPELINE_STAGE=()
declare -A PIPELINE_REPO=()
declare -A PIPELINE_BRANCH=()

add_pipeline() {
  local stage=$1
  local name="${PIPELINE_PREFIX}-${stage}"
  local branch=${2:-main}

  if [ "$stage" = "production" ]; then
    name="${PIPELINE_PREFIX}-prod"
  fi

  PIPELINE_STAGE["$name"]="$stage"
  PIPELINE_REPO["$name"]="$REPO_DEFAULT"
  PIPELINE_BRANCH["$name"]="$branch"
}

IFS=',' read -r -a STAGE_LIST <<< "$PIPELINES_CSV"
for raw in "${STAGE_LIST[@]}"; do
  stage=$(echo "$raw" | xargs)
  case "$stage" in
    production) add_pipeline "production" "$BRANCH_PROD" ;;
    dev) add_pipeline "dev" "$BRANCH_DEV" ;;
    mobile) add_pipeline "mobile" "$BRANCH_MOBILE" ;;
    ""|none) ;;
    *)
      # Allow custom stage names while defaulting to main branch.
      add_pipeline "$stage" "main"
      ;;
  esac
done

resolve_sst_deploy_script() {
  local candidates=(
    "$SCRIPT_DIR/sst-deploy.sh"
    "$INFRA_DIR/node_modules/@lsts_tech/infra/scripts/sst-deploy.sh"
    "$INFRA_DIR/../node_modules/@lsts_tech/infra/scripts/sst-deploy.sh"
  )

  for candidate in "${candidates[@]}"; do
    if [ -f "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI not found in PATH" >&2
  exit 1
fi

if [ ${#PIPELINE_STAGE[@]} -eq 0 ]; then
  echo "No pipelines configured in scripts/ensure-pipelines.sh. Nothing to do."
  exit 0
fi

SST_DEPLOY_SCRIPT=${SST_DEPLOY_SCRIPT:-}
if [ -z "$SST_DEPLOY_SCRIPT" ]; then
  SST_DEPLOY_SCRIPT=$(resolve_sst_deploy_script || true)
fi

if [ -z "$SST_DEPLOY_SCRIPT" ]; then
  echo "Could not locate sst-deploy.sh. Set SST_DEPLOY_SCRIPT explicitly." >&2
  exit 1
fi

cd "$INFRA_DIR"

MISSING=()
for NAME in "${!PIPELINE_STAGE[@]}"; do
  PIPELINE_NAME="${NAME}-pipeline"
  echo "Checking for pipeline names: $NAME or $PIPELINE_NAME (region: $REGION)"

  if aws codepipeline get-pipeline --name "$NAME" --region "$REGION" >/dev/null 2>&1 || \
     aws codepipeline get-pipeline --name "$PIPELINE_NAME" --region "$REGION" >/dev/null 2>&1; then
    echo "Pipeline exists: $PIPELINE_NAME"
  else
    echo "Pipeline missing: $PIPELINE_NAME"
    MISSING+=("$NAME")
  fi
done

if [ ${#MISSING[@]} -eq 0 ]; then
  echo "All pipelines present; nothing to do."
  exit 0
fi

echo "Missing pipelines: ${MISSING[*]}"

if [ "${APPROVE:-}" != "true" ]; then
  echo "To create missing pipelines, re-run with APPROVE=true."
  exit 1
fi

for NAME in "${MISSING[@]}"; do
  STAGE=${PIPELINE_STAGE[$NAME]:-production}
  REPO=${PIPELINE_REPO[$NAME]:-$REPO_DEFAULT}
  BRANCH=${PIPELINE_BRANCH[$NAME]:-main}

  echo "Creating pipeline '$NAME' via SST deploy (stage: $STAGE, repo: $REPO, branch: $BRANCH)"
  APPROVE=true STACK="$STAGE" bash "$SST_DEPLOY_SCRIPT"
done

echo "Done. Current pipelines:"
aws codepipeline list-pipelines --region "$REGION" --query "pipelines[].name" --output table || true
