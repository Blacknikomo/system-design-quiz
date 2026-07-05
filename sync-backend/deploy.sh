#!/usr/bin/env bash
# One-shot deploy of the quiz progress sync backend (DynamoDB + Lambda + Function URL).
# Requirements: aws cli v2 configured (aws configure), zip, openssl.
# Safe to re-run: creates on first run, updates code/config after.
#
#   ./deploy.sh                # deploys to eu-central-1 with generated secret
#   REGION=eu-west-1 ./deploy.sh
#   SECRET=my-long-secret ./deploy.sh   # keep the same secret across re-deploys
set -euo pipefail
cd "$(dirname "$0")"

REGION="${REGION:-eu-central-1}"
TABLE="${TABLE:-sdq-progress}"
FN="${FN:-sdq-progress-api}"
ROLE="${ROLE:-sdq-progress-lambda-role}"
SECRET="${SECRET:-$(openssl rand -hex 24)}"
export AWS_PAGER=""

echo "== region=$REGION table=$TABLE fn=$FN"

# ---------- 1. DynamoDB table (on-demand) ----------
if aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" >/dev/null 2>&1; then
  echo "table exists"
else
  aws dynamodb create-table --region "$REGION" --table-name "$TABLE" \
    --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
    --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST >/dev/null
  aws dynamodb wait table-exists --table-name "$TABLE" --region "$REGION"
  echo "table created"
fi
TABLE_ARN=$(aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" --query Table.TableArn --output text)

# ---------- 2. IAM role (least privilege) ----------
if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  echo "role exists"
else
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name "$ROLE" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo "role created"
fi
aws iam put-role-policy --role-name "$ROLE" --policy-name ddb-least-priv --policy-document '{
  "Version":"2012-10-17",
  "Statement":[{"Effect":"Allow",
    "Action":["dynamodb:Query","dynamodb:UpdateItem","dynamodb:PutItem","dynamodb:BatchWriteItem"],
    "Resource":"'"$TABLE_ARN"'"}]}'
ROLE_ARN=$(aws iam get-role --role-name "$ROLE" --query Role.Arn --output text)

# ---------- 3. Lambda ----------
rm -f /tmp/sdq-fn.zip && zip -jq /tmp/sdq-fn.zip index.mjs
if aws lambda get-function --function-name "$FN" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FN" --region "$REGION" \
    --zip-file fileb:///tmp/sdq-fn.zip >/dev/null
  aws lambda wait function-updated --function-name "$FN" --region "$REGION"
  aws lambda update-function-configuration --function-name "$FN" --region "$REGION" \
    --environment "Variables={TABLE=$TABLE,SDQ_SECRET=$SECRET}" >/dev/null
  echo "lambda updated"
else
  echo "waiting 10s for IAM role propagation…"; sleep 10
  aws lambda create-function --function-name "$FN" --region "$REGION" \
    --runtime nodejs20.x --handler index.handler --role "$ROLE_ARN" \
    --zip-file fileb:///tmp/sdq-fn.zip --timeout 20 --memory-size 256 \
    --environment "Variables={TABLE=$TABLE,SDQ_SECRET=$SECRET}" >/dev/null
  echo "lambda created"
fi
aws lambda wait function-active --function-name "$FN" --region "$REGION"

# ---------- 4. Function URL (public, CORS for file:// and any origin) ----------
CORS='{"AllowOrigins":["*"],"AllowMethods":["*"],"AllowHeaders":["content-type","x-sdq-key"],"MaxAge":86400}'
if aws lambda get-function-url-config --function-name "$FN" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-url-config --function-name "$FN" --region "$REGION" \
    --auth-type NONE --cors "$CORS" >/dev/null
else
  aws lambda create-function-url-config --function-name "$FN" --region "$REGION" \
    --auth-type NONE --cors "$CORS" >/dev/null
fi
aws lambda add-permission --function-name "$FN" --region "$REGION" \
  --statement-id public-url --action lambda:InvokeFunctionUrl \
  --principal "*" --function-url-auth-type NONE >/dev/null 2>&1 || true

URL=$(aws lambda get-function-url-config --function-name "$FN" --region "$REGION" --query FunctionUrl --output text)

echo
echo "================================================================"
echo "  Endpoint : $URL"
echo "  Secret   : $SECRET"
echo "================================================================"
echo "Paste both into the ☁ Sync settings on each device."
echo "Keep the secret out of the git repo. Re-deploys: SECRET=$SECRET ./deploy.sh"

# ---------- 5. smoke test ----------
echo
echo "smoke test:"
curl -s -H "x-sdq-key: $SECRET" "${URL}state?store=sd" | head -c 300; echo
