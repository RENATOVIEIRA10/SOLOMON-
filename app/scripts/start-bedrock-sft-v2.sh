#!/usr/bin/env bash
# SFT v2 — treino do Nova 2 Lite sobre o dataset RAG-grounded (Phase 6).
# Deriva de start-bedrock-sft.sh (v1); mudancas: base model Nova 2 Lite 256k,
# dataset solomon-sft-v2-train.jsonl, prefixos/manifest v2.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATASET="$APP_DIR/eval/fine_tuning/solomon-sft-v2-train.jsonl"
MANIFEST="$APP_DIR/eval/fine_tuning/bedrock-sft-v2-job.json"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
BASE_MODEL="amazon.nova-2-lite-v1:0:256k"
ROLE_NAME="SolomonBedrockCustomizationRole"

if [[ ! -f "$DATASET" ]]; then
  echo "Missing dataset: $DATASET" >&2
  exit 1
fi

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="${SOLOMON_SFT_BUCKET:-solomon-sft-${ACCOUNT_ID}-${REGION}}"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
PREFIX="solomon-sft-v2"
TRAINING_URI="s3://${BUCKET}/${PREFIX}/training.jsonl"
OUTPUT_URI="s3://${BUCKET}/${PREFIX}/output"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
JOB_NAME="solomon-sft-v2-${STAMP}"
MODEL_NAME="solomon-sft-v2-${STAMP}"

# Role/bucket ja existem do v1 — apenas garante e reutiliza.
if ! aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  echo "Bucket $BUCKET nao existe — rode o start-bedrock-sft.sh v1 primeiro (cria role+bucket)." >&2
  exit 1
fi
if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "Role $ROLE_NAME nao existe — rode o start-bedrock-sft.sh v1 primeiro." >&2
  exit 1
fi

aws s3 cp "$DATASET" "$TRAINING_URI" --region "$REGION" >/dev/null
echo "dataset enviado: $TRAINING_URI"

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
  --arg dataset "solomon-sft-v2-train.jsonl (100 exemplos RAG-grounded, F>=0.8)" \
  '{
    created_at: $created_at,
    provider: "aws-bedrock",
    job_name: $job_name,
    custom_model_name: $custom_model_name,
    base_model: $base_model,
    region: $region,
    dataset: $dataset,
    status: "Submitted"
  }' > "$MANIFEST"

cat "$MANIFEST"
