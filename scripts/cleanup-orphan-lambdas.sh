#!/usr/bin/env bash
set -euo pipefail

# cleanup-orphan-lambdas.sh
# Finds Lambda functions that match a given prefix but are not owned by any
# CloudFormation stack (orphans). Checks recent usage and optionally deletes
# them when invoked with --delete.
#
# Required environment variables:
#   PREFIX — Lambda function name prefix to search for (e.g., "myapp")

AWS_REGION=${AWS_REGION:-us-east-1}
THRESHOLD_DAYS=${THRESHOLD_DAYS:-30}

if [ -z "${PREFIX:-}" ]; then
  echo "ERROR: PREFIX environment variable is required (e.g., PREFIX=myapp)"
  echo "This is the Lambda function name prefix to search for orphans."
  exit 1
fi

usage() {
  echo "Usage: PREFIX=myapp $0 [--delete] [--region REGION]"
  echo "  --delete    Actually delete identified orphan functions"
  exit 1
}

DO_DELETE=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --delete) DO_DELETE=1; shift ;;
    --region) AWS_REGION="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown arg: $1"; usage ;;
  esac
done

echo "Region: $AWS_REGION  Prefix: $PREFIX  Threshold: $THRESHOLD_DAYS days"

echo "Listing CloudFormation stacks for project..."
stacks=$(aws cloudformation list-stacks --region "$AWS_REGION" \
  --query "StackSummaries[?contains(StackName,'$PREFIX') && StackStatus!='DELETE_COMPLETE'].StackName" --output text)

echo "Found stacks: $stacks"

owned_arns_file=$(mktemp)
trap 'rm -f "$owned_arns_file"' EXIT

if [ -n "$stacks" ]; then
  for s in $stacks; do
    echo "Collecting functions from stack: $s"
    aws cloudformation list-stack-resources --stack-name "$s" --region "$AWS_REGION" \
      --query "StackResourceSummaries[?ResourceType=='AWS::Lambda::Function'].PhysicalResourceId" --output text >> "$owned_arns_file" || true
  done
fi

echo "Listing all Lambda functions with prefix '$PREFIX'..."
all_funcs_json=$(aws lambda list-functions --region "$AWS_REGION" --query "Functions[?starts_with(FunctionName, '$PREFIX')].[FunctionName,FunctionArn,LastModified]" --output json)

ORPHAN_FILE="/tmp/${PREFIX}-orphan-lambdas.txt"

echo "$all_funcs_json" | jq -r '.[] | @base64' | while read -r item; do
  _jq() { echo "$item" | base64 --decode | jq -r "$1"; }
  name=$(_jq '.[0]')
  arn=$(_jq '.[1]')
  last_modified=$(_jq '.[2]')

  # check ownership
  if grep -qF "$arn" "$owned_arns_file"; then
    echo "SKIP (owned) $name"
    continue
  fi

  # check last invocation metric over threshold window
  end_time=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  start_time=$(date -u -d "$THRESHOLD_DAYS days ago" +%Y-%m-%dT%H:%M:%SZ)

  invocations=$(aws cloudwatch get-metric-statistics --region "$AWS_REGION" \
    --namespace AWS/Lambda --metric-name Invocations --statistics Sum \
    --dimensions Name=FunctionName,Value="$name" --start-time "$start_time" --end-time "$end_time" --period 86400 \
    --query "Datapoints[].Sum" --output text || echo "")

  if [ -z "$invocations" ] || [ "$invocations" = "None" ] || [ "$invocations" = "" ]; then
    inv_sum=0
  else
    inv_sum=$(echo "$invocations" | awk '{sum += $1} END {print sum+0}')
  fi

  if [ "$inv_sum" -eq 0 ]; then
    echo "ORPHAN CANDIDATE: $name (lastModified: $last_modified) — no invocations in last $THRESHOLD_DAYS days"
    if [ "$DO_DELETE" -eq 1 ]; then
      echo "Deleting $name..."
      aws lambda delete-function --function-name "$name" --region "$AWS_REGION"
      echo "Deleted $name"
    else
      echo "$name" >> "$ORPHAN_FILE"
    fi
  else
    echo "IN USE: $name (invocations last $THRESHOLD_DAYS days: $inv_sum)"
  fi
done

echo "Completed. Dry-run list at $ORPHAN_FILE (if any). Rerun with --delete to remove." 
