# Manual deploy — command by command (eu-west-1)

Same result as `deploy.sh`, but each command entered by hand. Run everything
from the `sync-backend/` directory. Only two things to substitute:

- `<ACCOUNT_ID>` — shown by step 0
- `<SECRET>` — generated in step 4

The IAM JSON documents are already in this folder (`iam-trust.json`,
`iam-policy.json`) — nothing to hand-edit in them.

---

**0. Sanity check + account id** (also confirms `aws configure` is done)

```bash
aws sts get-caller-identity
```

Copy `Account` from the output — that's `<ACCOUNT_ID>`.

**1. DynamoDB table** (on-demand, PK+SK)

```bash
aws dynamodb create-table --region eu-west-1 --table-name sdq-progress \
  --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
  --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST
```

```bash
aws dynamodb wait table-exists --region eu-west-1 --table-name sdq-progress
```

**2. IAM role for the Lambda**

```bash
aws iam create-role --role-name sdq-progress-lambda-role \
  --assume-role-policy-document file://iam-trust.json
```

```bash
aws iam attach-role-policy --role-name sdq-progress-lambda-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
```

```bash
aws iam put-role-policy --role-name sdq-progress-lambda-role \
  --policy-name ddb-least-priv --policy-document file://iam-policy.json
```

**3. Package the function**

```bash
zip -j fn.zip index.mjs
```

**4. Generate the secret** (copy the output — it's `<SECRET>`, you'll also paste it into the ☁ badge)

```bash
openssl rand -hex 24
```

**5. Create the Lambda**

```bash
aws lambda create-function --region eu-west-1 --function-name sdq-progress-api \
  --runtime nodejs20.x --handler index.handler \
  --role arn:aws:iam::<ACCOUNT_ID>:role/sdq-progress-lambda-role \
  --zip-file fileb://fn.zip --timeout 20 --memory-size 256 \
  --environment "Variables={TABLE=sdq-progress,SDQ_SECRET=<SECRET>}"
```

If it fails with *"The role defined for the function cannot be assumed"* —
IAM hasn't propagated yet; wait ~10 seconds and run the same command again.

**6. Public Function URL with CORS** (the `file://` pages send Origin `null`, hence `*`)

```bash
aws lambda create-function-url-config --region eu-west-1 --function-name sdq-progress-api \
  --auth-type NONE \
  --cors '{"AllowOrigins":["*"],"AllowMethods":["*"],"AllowHeaders":["content-type","x-sdq-key"],"MaxAge":86400}'
```

Copy `FunctionUrl` from the output — that's the **Endpoint** for the ☁ badge.

```bash
aws lambda add-permission --region eu-west-1 --function-name sdq-progress-api \
  --statement-id public-url --action lambda:InvokeFunctionUrl \
  --principal "*" --function-url-auth-type NONE
```

**7. Smoke test** (substitute both; note: no slash between the URL and `state`
if the URL already ends with `/`)

```bash
curl -H "x-sdq-key: <SECRET>" "<FUNCTION_URL>state?store=sd"
```

Expected: `{"topics":{},"sessions":[],"levels":{},"missed":{},"_meta":{"bootstrapped":false,"items":0}}`
Wrong/missing secret → `{"error":"bad or missing x-sdq-key"}` (401) — that's the auth working.

**Done.** Open a quiz page on the device with the fullest history → ☁ badge →
paste Endpoint + Secret → *Save & test* → agree to the bootstrap upload.
Other devices: same paste, no bootstrap.

---

**Updating the Lambda code later** (after editing index.mjs):

```bash
zip -j fn.zip index.mjs
aws lambda update-function-code --region eu-west-1 \
  --function-name sdq-progress-api --zip-file fileb://fn.zip
```

**Teardown:** see README.md (delete function, table, role policy, role).
