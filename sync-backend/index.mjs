// sdq-progress-api — Lambda behind a Function URL.
// Cross-device sync for the quiz progress stores (system-design + behavioral).
//
// Design: event deltas, not state blobs. The client sends per-answer /
// per-session EVENTS; we apply them with DynamoDB atomic ADDs, so writes are
// commutative — a stale device can never wipe progress made elsewhere.
// (This is the single-table + atomic-counter pattern from the study materials,
// used for real.)
//
// Table (PAY_PER_REQUEST):  PK (S), SK (S)
//   PK = "store#sd" | "store#behavioral"
//   SK = "agg#topic#<topic>"   {correct:N, total:N}          <- atomic ADD
//      | "agg#level#<level>"   {correct:N, total:N}          <- atomic ADD
//      | "missed#<qid>"        {qid,topic,level,question,misses,lastMissed,recoveredAt?}
//      | "session#<ts13>"      {date,correct,total,topics[]} <- immutable Put
//      | "meta#bootstrap"      {at:N}  guard: local history uploaded exactly once
//
// API (all JSON; auth: header `x-sdq-key` must equal env SDQ_SECRET):
//   GET  /state?store=sd            -> store in the exact localStorage shape
//   POST /events    {store, events:[{type:"answer",...}|{type:"session",...}]}
//   POST /bootstrap {store, data:{topics,levels,missed,sessions}}
//
// Known trade-off (single user, acceptable): if a client retries after a
// response was lost mid-flight, an answer event can be applied twice. The full
// fix is an idempotency key per event + conditional write — see README.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, PutCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { createHash, timingSafeEqual } from "node:crypto";

const TABLE  = process.env.TABLE || "sdq-progress";
const SECRET = process.env.SDQ_SECRET || "";
const STORES = new Set(["sd", "behavioral"]);
const MAX_EVENTS = 200;          // per POST /events
const MAX_Q_LEN  = 300;          // truncate question text stored in missed#

// ---------- auth ----------
function authorized(headers){
  const got = (headers?.["x-sdq-key"] ?? "");
  if(!SECRET || !got) return false;
  const a = createHash("sha256").update(String(got)).digest();
  const b = createHash("sha256").update(SECRET).digest();
  return timingSafeEqual(a, b);   // equal-length digests -> constant-time compare
}

// ---------- helpers ----------
const pk = store => `store#${store}`;
const ts13 = n => String(n).padStart(13, "0");
const resp = (code, body) => ({ statusCode: code, headers: {"content-type":"application/json"}, body: JSON.stringify(body) });
const bad  = msg => resp(400, {error: msg});

function parseBody(event){
  try{
    const raw = event.isBase64Encoded ? Buffer.from(event.body||"", "base64").toString("utf8") : (event.body||"");
    return JSON.parse(raw || "{}");
  }catch{ return null; }
}

// ---------- event application (atomic, commutative) ----------
async function applyAnswer(send, store, ev){
  const ok = ev.correct ? 1 : 0;
  const topic = String(ev.topic||"Unknown").slice(0,120);
  const level = String(ev.level||"Unknown").slice(0,40);
  const now = Number(ev.ts) || Date.now();

  // ADD is atomic and order-independent: concurrent/stale devices can't clobber each other
  for(const sk of [`agg#topic#${topic}`, `agg#level#${level}`]){
    await send(new UpdateCommand({
      TableName: TABLE,
      Key: {PK: pk(store), SK: sk},
      UpdateExpression: "ADD #c :ok, #t :one",
      ExpressionAttributeNames: {"#c":"correct", "#t":"total"},
      ExpressionAttributeValues: {":ok": ok, ":one": 1},
    }));
  }

  const qid = String(ev.qid||"").slice(0,40);
  if(!qid) return;
  if(!ev.correct){
    await send(new UpdateCommand({
      TableName: TABLE,
      Key: {PK: pk(store), SK: `missed#${qid}`},
      UpdateExpression: "SET qid=:q, topic=:tp, #lv=:lv, question=:qt, lastMissed=:ts ADD misses :one REMOVE recoveredAt",
      ExpressionAttributeNames: {"#lv":"level"},
      ExpressionAttributeValues: {
        ":q": qid, ":tp": topic, ":lv": level,
        ":qt": String(ev.question||"").slice(0, MAX_Q_LEN),
        ":ts": now, ":one": 1,
      },
    }));
  } else {
    // mark recovered ONLY if this question was missed before (mirror engine logic)
    try{
      await send(new UpdateCommand({
        TableName: TABLE,
        Key: {PK: pk(store), SK: `missed#${qid}`},
        UpdateExpression: "SET recoveredAt=:ts",
        ConditionExpression: "attribute_exists(SK)",
        ExpressionAttributeValues: {":ts": now},
      }));
    }catch(e){
      if(e.name !== "ConditionalCheckFailedException") throw e; // not previously missed -> nothing to do
    }
  }
}

async function applySession(send, store, ev){
  const date = Number(ev.date) || Date.now();
  await send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: pk(store), SK: `session#${ts13(date)}`,
      date, correct: Number(ev.correct)||0, total: Number(ev.total)||0,
      topics: Array.isArray(ev.topics) ? ev.topics.slice(0,120).map(t=>String(t).slice(0,120)) : [],
    },
  }));
}

// ---------- GET /state: assemble the localStorage shape ----------
async function getState(send, store){
  const items = [];
  let ExclusiveStartKey;
  do{
    const page = await send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: {":pk": pk(store)},
      ExclusiveStartKey,
    }));
    items.push(...(page.Items||[]));
    ExclusiveStartKey = page.LastEvaluatedKey;
  }while(ExclusiveStartKey);

  const out = {topics:{}, sessions:[], levels:{}, missed:{}, _meta:{bootstrapped:false, items:items.length}};
  for(const it of items){
    const sk = it.SK || "";
    if(sk.startsWith("agg#topic#"))      out.topics[sk.slice(10)] = {correct: it.correct||0, total: it.total||0};
    else if(sk.startsWith("agg#level#")) out.levels[sk.slice(10)] = {correct: it.correct||0, total: it.total||0};
    else if(sk.startsWith("missed#")){
      const m = {id: it.qid, topic: it.topic, level: it.level, question: it.question,
                 misses: it.misses||0, lastMissed: it.lastMissed||0};
      if(it.recoveredAt) m.recoveredAt = it.recoveredAt;
      out.missed[it.qid] = m;
    }
    else if(sk.startsWith("session#"))   out.sessions.push({date: it.date, correct: it.correct, total: it.total, topics: it.topics||[]});
    else if(sk === "meta#bootstrap")     out._meta.bootstrapped = true;
  }
  out.sessions.sort((a,b)=>b.date-a.date);        // newest first, like the engine
  out.sessions = out.sessions.slice(0,50);         // engine caps at 50
  return out;
}

// ---------- POST /bootstrap: one-time upload of pre-existing local history ----------
async function bootstrap(send, store, data){
  // first-writer-wins guard: exactly ONE device seeds the aggregates,
  // otherwise two bootstraps would double-count history
  try{
    await send(new PutCommand({
      TableName: TABLE,
      Item: {PK: pk(store), SK: "meta#bootstrap", at: Date.now()},
      ConditionExpression: "attribute_not_exists(SK)",
    }));
  }catch(e){
    if(e.name === "ConditionalCheckFailedException") return {bootstrapped:false, reason:"already bootstrapped"};
    throw e;
  }

  const puts = [];
  for(const [t,v] of Object.entries(data?.topics||{}))
    puts.push({PK: pk(store), SK:`agg#topic#${String(t).slice(0,120)}`, correct:Number(v.correct)||0, total:Number(v.total)||0});
  for(const [l,v] of Object.entries(data?.levels||{}))
    puts.push({PK: pk(store), SK:`agg#level#${String(l).slice(0,40)}`, correct:Number(v.correct)||0, total:Number(v.total)||0});
  for(const [qid,m] of Object.entries(data?.missed||{})){
    const item = {PK: pk(store), SK:`missed#${String(qid).slice(0,40)}`, qid:String(qid).slice(0,40),
      topic:String(m.topic||"").slice(0,120), level:String(m.level||"").slice(0,40),
      question:String(m.question||"").slice(0,MAX_Q_LEN), misses:Number(m.misses)||1, lastMissed:Number(m.lastMissed)||0};
    if(m.recoveredAt) item.recoveredAt = Number(m.recoveredAt);
    puts.push(item);
  }
  for(const s of (Array.isArray(data?.sessions)?data.sessions:[]).slice(0,50)){
    const date = Number(s.date)||0;
    if(!date) continue;
    puts.push({PK: pk(store), SK:`session#${ts13(date)}`, date, correct:Number(s.correct)||0,
      total:Number(s.total)||0, topics:Array.isArray(s.topics)?s.topics.slice(0,120):[]});
  }

  for(let i=0; i<puts.length; i+=25){   // BatchWrite limit = 25
    let req = {[TABLE]: puts.slice(i,i+25).map(Item=>({PutRequest:{Item}}))};
    // retry unprocessed items (throttling) a few times
    for(let attempt=0; attempt<5 && Object.keys(req).length; attempt++){
      const r = await send(new BatchWriteCommand({RequestItems: req}));
      req = (r.UnprocessedItems && Object.keys(r.UnprocessedItems).length) ? r.UnprocessedItems : {};
      if(Object.keys(req).length) await new Promise(res=>setTimeout(res, 100*(attempt+1)));
    }
  }
  return {bootstrapped:true, items: puts.length};
}

// ---------- router ----------
// makeHandler(sendFn) enables headless testing with a fake DynamoDB
export function makeHandler(send){
  return async (event) => {
    const method = event.requestContext?.http?.method || "GET";
    const path   = event.rawPath || "/";
    if(method === "OPTIONS") return {statusCode: 204};        // CORS preflight is handled by the Function URL config
    if(!authorized(event.headers)) return resp(401, {error:"bad or missing x-sdq-key"});

    try{
      if(method === "GET" && path === "/state"){
        const store = event.queryStringParameters?.store;
        if(!STORES.has(store)) return bad("store must be one of: " + [...STORES].join(", "));
        return resp(200, await getState(send, store));
      }
      if(method === "POST" && path === "/events"){
        const b = parseBody(event);
        if(!b || !STORES.has(b.store)) return bad("body must be {store, events[]}");
        const events = Array.isArray(b.events) ? b.events : [];
        if(events.length === 0) return resp(200, {applied: 0});
        if(events.length > MAX_EVENTS) return bad(`too many events (max ${MAX_EVENTS})`);
        let applied = 0;
        for(const ev of events){
          if(ev?.type === "answer")       { await applyAnswer(send, b.store, ev); applied++; }
          else if(ev?.type === "session") { await applySession(send, b.store, ev); applied++; }
        }
        return resp(200, {applied});
      }
      if(method === "POST" && path === "/bootstrap"){
        const b = parseBody(event);
        if(!b || !STORES.has(b.store) || typeof b.data !== "object") return bad("body must be {store, data}");
        return resp(200, await bootstrap(send, b.store, b.data));
      }
      return resp(404, {error:"unknown route", routes:["GET /state","POST /events","POST /bootstrap"]});
    }catch(e){
      console.error(e);
      return resp(500, {error: e.name || "InternalError"});
    }
  };
}

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {marshallOptions:{removeUndefinedValues:true}});
export const handler = makeHandler(cmd => doc.send(cmd));
