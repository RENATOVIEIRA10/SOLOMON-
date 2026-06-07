#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATASET="$APP_DIR/eval/fine_tuning/solomon-sft-bedrock-train.jsonl"
MANIFEST="$APP_DIR/eval/fine_tuning/bedrock-sft-job.json"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
BASE_MODEL="amazon.nova-micro-v1:0:128k"
ROLE_NAME="SolomonBedrockCustomizationRole"

if [[ ! -f "$DATASET" ]]; then
  echo "Missing dataset: $DATASET" >&2
  exit 1
fi

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="${SOLOMON_SFT_BUCKET:-solomon-sft-${ACCOUNT_ID}-${REGION}}"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
PREFIX="solomon-sft-v1"
TRAINING_URI="s3://${BUCKET}/${PREFIX}/training.jsonl"
OUTPUT_URI="s3://${BUCKET}/${PREFIX}/output"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
JOB_NAME="solomon-sft-v1-${STAMP}"
MODEL_NAME="solomon-sft-v1-${STAMP}"
TRUST_POLICY="$(mktemp)"
ACCESS_POLICY="$(mktemp)"
trap 'rm -f "$TRUST_POLICY" "$ACCESS_POLICY"' EXIT

if ! aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  if [[ "$REGION" == "us-east-1" ]]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null
  else
    aws s3api create-bucket \
      --bucket "$BUCKET" \
      --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
  fi
fi

jq -n --arg account "$ACCOUNT_ID" '{
  Version: "2012-10-17",
  Statement: [{
    Effect: "Allow",
    Principal: {Service: "bedrock.amazonaws.com"},
    Action: "sts:AssumeRole",
    Condition: {StringEquals: {"aws:SourceAccount": $account}}
  }]
}' > "$TRUST_POLICY"

if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws iam update-assume-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-document "file://$TRUST_POLICY"
else
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "file://$TRUST_POLICY" >/dev/null
fi

jq -n --arg bucket "$BUCKET" '{
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Action: ["s3:GetObject", "s3:PutObject"],
      Resource: [("arn:aws:s3:::" + $bucket + "/*")]
    },
    {
      Effect: "Allow",
      Action: ["s3:ListBucket"],
      Resource: [("arn:aws:s3:::" + $bucket)]
    }
  ]
}' > "$ACCESS_POLICY"

aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name SolomonBedrockCustomizationS3 \
  --policy-document "file://$ACCESS_POLICY"
aws s3 cp "$DATASET" "$TRAINING_URI" --region "$REGION" >/dev/null

# New IAM roles can take a few seconds to propagate to Bedrock.
sleep 12
aws bedrock create-model-customization-job \
  --region "$REGION" \
  --job-name "$JOB_NAME" \
  --custom-model-name "$MODEL_NAME" \
  --role-arn "$ROLE_ARN" \
  --base-model-identifier "$BASE_MODEL" \
  --customization-type FINE_TUNING \
  --training-data-config "s3Uri=$TRAINING_URI" \
  --output-data-config "s3Uri=$OUTPUT_URI" \
  --hyper-parameters epochCount=2 >/dev/null

jq -n \
  --arg created_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg job_name "$JOB_NAME" \
  --arg custom_model_name "$MODEL_NAME" \
  --arg base_model "$BASE_MODEL" \
  --arg region "$REGION" \
  '{
    created_at: $created_at,
    provider: "aws-bedrock",
    job_name: $job_name,
    custom_model_name: $custom_model_name,
    base_model: $base_model,
    region: $region,
    status: "Submitted"
  }' > "$MANIFEST"

cat "$MANIFEST"
