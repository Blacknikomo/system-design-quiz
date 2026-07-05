# Quiz progress sync — Lambda + DynamoDB backend

Cross-device persistence for the two quiz stores (`sdq_history_v1` → `store#sd`,
`bq_history_v1` → `store#behavioral`). Single user, effectively $0/month
(Lambda free tier + DynamoDB on-demand pennies).

## Architecture (event deltas, not state blobs)

```
quiz page ──(answer/session EVENTS, batched)──▶ Lambda Function URL ──▶ DynamoDB
   ▲                                                (x-sdq-key check)     single table
   └────────────(GET /state on page load)◀──────────────────────────── atomic ADDs
```

The client never uploads its aggregate state (except one-time bootstrap).
Every answer is a delta event; the Lambda applies it with DynamoDB `ADD`
(atomic, commutative). Result: a device with a stale tab **cannot overwrite**
progress made on another device — the classic multi-device LWW-blob bug is
impossible by construction. Idempotency, single-table design, atomic counters —
the study-material patterns, used for real.

## Table layout (`sdq-progress`, PAY_PER_REQUEST)

| PK | SK | payload |
|---|---|---|
| `store#sd` \| `store#behavioral` | `agg#topic#<topic>` | `{correct, total}` — ADD |
| | `agg#level#<level>` | `{correct, total}` — ADD |
| | `missed#<qid>` | `{qid, topic, level, question, misses, lastMissed, recoveredAt?}` |
| | `session#<ts13>` | `{date, correct, total, topics[]}` |
| | `meta#bootstrap` | one-time-upload guard (conditional put) |

## API

All requests need header `x-sdq-key: <secret>`.

- `GET /state?store=sd` → the store in the exact `localStorage` shape
  (`{topics, sessions(≤50, newest first), levels, missed, _meta}`)
- `POST /events` — `{store, events:[{type:"answer",qid,topic,level,question,correct,ts} | {type:"session",date,correct,total,topics}]}`, max 200/batch
- `POST /bootstrap` — `{store, data:<local store>}`; first caller wins (conditional put on `meta#bootstrap`), others get `{bootstrapped:false}`

## Deploy (once)

```bash
cd sync-backend
aws configure            # if not done yet
./deploy.sh              # REGION=eu-central-1 by default
```

Prints the **Endpoint URL** and **Secret**. Re-run safely to update code
(pass `SECRET=<same>` to keep the secret stable).

## Per-device setup

Open a quiz page → click the **☁** badge (top-right) → paste Endpoint + Secret
→ *Save & test*. Do this **first on the device with the fullest history** — it
will offer to upload local history as the baseline (one-time bootstrap).
Other devices then simply adopt the server state.

## Known trade-offs (fine for one user)

- **Retry double-count:** if a response is lost after the Lambda applied a
  batch, the client retries and an answer may count twice. Full fix = per-event
  idempotency key + conditional write; not worth it here.
- **"Reset history" stays local:** the stats-page reset clears this device
  only; the next pull restores server state. Wipe the server by deleting the
  table (below) or its `store#…` items.
- **Two tabs on one device** share the queue and may double-flush in a rare
  race. Don't quiz in two tabs at once.
- **Sessions accumulate server-side** beyond the 50 the UI shows (bytes,
  irrelevant at this scale).

## Teardown

```bash
aws lambda delete-function --function-name sdq-progress-api --region eu-central-1
aws dynamodb delete-table --table-name sdq-progress --region eu-central-1
aws iam delete-role-policy --role-name sdq-progress-lambda-role --policy-name ddb-least-priv
aws iam detach-role-policy --role-name sdq-progress-lambda-role --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam delete-role --role-name sdq-progress-lambda-role
```
