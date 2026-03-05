#!/usr/bin/env bash
set -euo pipefail

# ensure-pipelines.sh
#
# AWS-only helper (v1.0.0) to ensure configured CodePipelines exist.
# Missing pipelines are created by triggering an explicit production deploy with:
#   INFRA_CREATE_PIPELINES=true
#   INFRA_PIPELINES=<missing-stage>
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

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI not found in PATH" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required for parsing pipeline config" >&2
  exit 1
fi

REGION=${AWS_REGION:-us-east-1}
PIPELINE_PREFIX=${INFRA_PIPELINE_PREFIX:-myapp}
PIPELINES_RAW=${INFRA_PIPELINES:-production,dev}
PIPELINES_CONFIG_PATH=${INFRA_PIPELINES_CONFIG_PATH:-$INFRA_DIR/config/pipelines.json}
REPO_DEFAULT=${INFRA_PIPELINE_REPO:-myorg/myrepo}

BRANCH_PROD_DEFAULT=${INFRA_PIPELINE_BRANCH_PROD:-main}
BRANCH_DEV_DEFAULT=${INFRA_PIPELINE_BRANCH_DEV:-develop}
BRANCH_MOBILE_DEFAULT=${INFRA_PIPELINE_BRANCH_MOBILE:-mobile}

declare -A STAGE_ENABLED=(
  [production]=false
  [dev]=false
  [mobile]=false
)

declare -A STAGE_BRANCH=(
  [production]="$BRANCH_PROD_DEFAULT"
  [dev]="$BRANCH_DEV_DEFAULT"
  [mobile]="$BRANCH_MOBILE_DEFAULT"
)

declare -A STAGE_REPO=(
  [production]="$REPO_DEFAULT"
  [dev]="$REPO_DEFAULT"
  [mobile]="$REPO_DEFAULT"
)

declare -A STAGE_SUFFIX=(
  [production]="prod"
  [dev]="dev"
  [mobile]="mobile"
)

normalize_stage() {
  local input
  input=$(echo "$1" | tr '[:upper:]' '[:lower:]' | xargs)
  case "$input" in
    prod) echo "production" ;;
    production|dev|mobile) echo "$input" ;;
    *) echo "" ;;
  esac
}

for token in $(echo "$PIPELINES_RAW" | tr ',' ' '); do
  stage=$(normalize_stage "$token")
  if [ -n "$stage" ]; then
    STAGE_ENABLED["$stage"]=true
  fi
done

if [ -f "$PIPELINES_CONFIG_PATH" ]; then
  echo "Loading runtime pipeline config from $PIPELINES_CONFIG_PATH"
  while IFS=$'\t' read -r stage enabled branch repo; do
    stage=$(normalize_stage "$stage")
    if [ -z "$stage" ]; then
      continue
    fi

    if [ "$enabled" = "true" ]; then
      STAGE_ENABLED["$stage"]=true
    elif [ "$enabled" = "false" ]; then
      STAGE_ENABLED["$stage"]=false
    fi

    if [ -n "$branch" ]; then
      STAGE_BRANCH["$stage"]="$branch"
    fi

    if [ -n "$repo" ]; then
      STAGE_REPO["$stage"]="$repo"
    fi
  done < <(node -e '
const fs = require("fs");
const path = process.argv[1];
const raw = JSON.parse(fs.readFileSync(path, "utf8"));
const src = raw.pipelines ?? raw;
function toStage(v) {
  const n = String(v || "").trim().toLowerCase();
  if (n === "prod") return "production";
  if (n === "production" || n === "dev" || n === "mobile") return n;
  return "";
}
function emit(stage, cfg) {
  const enabled = cfg && typeof cfg.enabled !== "undefined" ? Boolean(cfg.enabled) : true;
  const branch = cfg && typeof cfg.branch === "string" ? cfg.branch.trim() : "";
  const repo = cfg && typeof cfg.repo === "string" ? cfg.repo.trim() : "";
  process.stdout.write([stage, String(enabled), branch, repo].join("\t") + "\n");
}
if (Array.isArray(src)) {
  for (const item of src) {
    const stage = toStage(item && item.stage);
    if (!stage) continue;
    emit(stage, item || {});
  }
} else if (src && typeof src === "object") {
  for (const [key, value] of Object.entries(src)) {
    const stage = toStage(key);
    if (!stage) continue;
    emit(stage, value || {});
  }
}
' "$PIPELINES_CONFIG_PATH")
else
  echo "Runtime pipeline config not found at $PIPELINES_CONFIG_PATH; using env defaults"
fi

declare -A PIPELINE_STAGE=()
declare -A PIPELINE_REPO=()
declare -A PIPELINE_BRANCH=()

for stage in production dev mobile; do
  if [ "${STAGE_ENABLED[$stage]}" != "true" ]; then
    continue
  fi

  suffix=${STAGE_SUFFIX[$stage]}
  name="${PIPELINE_PREFIX}-${suffix}"

  PIPELINE_STAGE["$name"]="$stage"
  PIPELINE_REPO["$name"]="${STAGE_REPO[$stage]}"
  PIPELINE_BRANCH["$name"]="${STAGE_BRANCH[$stage]}"
done

if [ ${#PIPELINE_STAGE[@]} -eq 0 ]; then
  echo "No pipelines configured. Set INFRA_PIPELINES and/or config/pipelines.json."
  exit 0
fi

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

declare -A PROCESSED_STAGE=()
for NAME in "${MISSING[@]}"; do
  STAGE=${PIPELINE_STAGE[$NAME]}

  if [ "${PROCESSED_STAGE[$STAGE]:-false}" = "true" ]; then
    continue
  fi

  REPO=${PIPELINE_REPO[$NAME]:-$REPO_DEFAULT}

  echo "Creating pipeline for stage '$STAGE' via production deploy"
  echo "  repo   : $REPO"
  echo "  branch : ${PIPELINE_BRANCH[$NAME]}"

  APPROVE=true \
  STACK="production" \
  INFRA_CREATE_PIPELINES=true \
  INFRA_PIPELINES="$STAGE" \
  INFRA_PIPELINE_REPO="$REPO" \
  INFRA_PIPELINE_BRANCH_PROD="${STAGE_BRANCH[production]}" \
  INFRA_PIPELINE_BRANCH_DEV="${STAGE_BRANCH[dev]}" \
  INFRA_PIPELINE_BRANCH_MOBILE="${STAGE_BRANCH[mobile]}" \
  bash "$SST_DEPLOY_SCRIPT"

  PROCESSED_STAGE[$STAGE]=true
done

echo "Done. Current pipelines:"
aws codepipeline list-pipelines --region "$REGION" --query "pipelines[].name" --output table || true
