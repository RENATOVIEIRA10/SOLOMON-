#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$APP_DIR/eval/fine_tuning/bedrock-sft-job.json"

if [[ ! -f "$MANIFEST" ]]; then
  echo "Missing job manifest: $MANIFEST" >&2
  exit 1
fi

JOB_NAME="$(jq -r .job_name "$MANIFEST")"
REGION="$(jq -r .region "$MANIFEST")"
aws bedrock get-model-customization-job \
  --region "$REGION" \
  --job-identifier "$JOB_NAME" \
  --query '{status:status,failureMessage:failureMessage,creationTime:creationTime,lastModifiedTime:lastModifiedTime,endTime:endTime,outputModelArn:outputModelArn}' \
  --output json
