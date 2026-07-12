/* SDQSync — cross-device progress sync for the quiz pages.
   Backend: sync-backend/ (Lambda Function URL + DynamoDB, event-delta design).

   Contract with a quiz engine (see system-design-quiz.html bottom):
     SDQSync.init({ store,            // "sd" | "behavioral" | "walkthroughs"
                    getStore,         // () => STORE
                    setStore,         // s  => { STORE = s; saveStore(STORE); }
                    clearStore,       // () => { STORE = defaultStore(); saveStore(STORE); }  (hard reset)
                    onRemoteUpdate }) // () => re-render after adopting remote state
     SDQSync.pushAnswer(q, correct)   // call right after recordAnswer+saveStore
     SDQSync.pushSession(sess)        // call right after the session summary is saved
     SDQSync.resetEverywhere()        // wipe progress on ALL devices (cloud reset epoch)
     SDQSync.isConfigured()           // is sync set up on this device?

   Behavior:
   - Endpoint URL + secret are entered ONCE per device (☁ badge, top-right) and
     live only in localStorage — never in the (public) repo.
   - Every answer becomes a delta event, queued in localStorage and POSTed in
     batches; the backend applies them with atomic ADDs, so a stale device can
     never wipe progress made elsewhere. Offline answers flush on next open.
   - On load: pull remote state; if the remote is empty and this device has
     history, offer a one-time bootstrap upload.
   - All failures are non-fatal: the quiz works exactly as before, the badge
     just shows the sync state. */

window.SDQSync = (function(){
  const CFG_KEY = "sdq_sync_cfg_v1";
  const FLUSH_DEBOUNCE_MS = 400, FETCH_TIMEOUT_MS = 8000, MAX_BATCH = 200;

  let ctx = null;          // {store, getStore, setStore, onRemoteUpdate}
  let flushTimer = null, flushing = false;
  let badge, panel;

  // ---------- config & queue (localStorage; every access guarded like the engines do) ----------
  const lsGet = k => { try{ return localStorage.getItem(k); }catch(e){ return null; } };
  const lsSet = (k,v) => { try{ localStorage.setItem(k, v); }catch(e){} };
  const lsDel = k => { try{ localStorage.removeItem(k); }catch(e){} };
  const loadCfg = () => { try{ return JSON.parse(lsGet(CFG_KEY)) || null; }catch(e){ return null; } };
  const saveCfg = c => lsSet(CFG_KEY, JSON.stringify(c));
  const qKey    = () => "sdq_sync_queue_" + ctx.store;
  const loadQ   = () => { try{ return JSON.parse(lsGet(qKey())) || []; }catch(e){ return []; } };
  const saveQ   = q => lsSet(qKey(), JSON.stringify(q));
  // per-store reset epoch this device knows about (see forceClear / resetEverywhere)
  const genKey  = () => "sdq_sync_gen_" + ctx.store;
  const loadGen = () => { const v = parseInt(lsGet(genKey()) || "0", 10); return Number.isFinite(v) ? v : 0; };
  const saveGen = n => lsSet(genKey(), String(n|0));

  // ---------- http ----------
  async function api(method, path, body){
    const cfg = loadCfg();
    if(!cfg || !cfg.url || !cfg.key) throw new Error("sync not configured");
    const ac = new AbortController();
    const t = setTimeout(()=>ac.abort(), FETCH_TIMEOUT_MS);
    try{
      const r = await fetch(cfg.url.replace(/\/+$/,"") + path, {
        method,
        headers: {"content-type":"application/json", "x-sdq-key": cfg.key},
        body: body ? JSON.stringify(body) : undefined,
        signal: ac.signal,
      });
      if(!r.ok) throw new Error("HTTP " + r.status + (r.status===401 ? " (wrong secret?)" : ""));
      return await r.json();
    } finally { clearTimeout(t); }
  }

  // ---------- queue & flush ----------
  function scheduleFlush(){
    if(!loadCfg()) return;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, FLUSH_DEBOUNCE_MS);
  }
  function enqueue(ev){
    const q = loadQ(); q.push(ev);
    if(q.length > 2000) q.splice(0, q.length - 2000);   // never let an unconfigured queue grow unbounded
    saveQ(q);
    setBadge();
    scheduleFlush();
  }

  async function flush(){
    if(flushing || !loadCfg()) return;
    const q = loadQ();
    if(q.length === 0){ setBadge(); return; }
    flushing = true;
    const batch = q.slice(0, MAX_BATCH);
    try{
      const r = await api("POST", "/events", {store: ctx.store, events: batch, gen: loadGen()});
      // a reset happened elsewhere while we were away: our whole (pre-reset) queue is void
      if(r && typeof r.resetGen === "number" && r.resetGen > loadGen()){ forceClear(r.resetGen); return; }
      const rest = loadQ().slice(batch.length);   // keep events enqueued during the await
      saveQ(rest);
      setBadge();
      if(rest.length) setTimeout(flush, 50);
    }catch(e){
      setBadge("err", e.message);                 // queue kept; will retry on next answer/online/load
    }finally{
      flushing = false;
    }
  }

  // ---------- pull / bootstrap ----------
  function localHasHistory(s){
    return s && (Object.keys(s.topics||{}).length || Object.keys(s.apps||{}).length
      || Object.keys(s.stepstats||{}).length || (s.sessions||[]).length);
  }

  // A reset happened elsewhere: this device is a generation behind. Drop the pre-reset
  // queued events, hard-clear the local store to its OWN empty default, adopt the new
  // gen, re-render. This is how an OFFLINE device gets wiped when it reconnects.
  function forceClear(serverGen){
    saveQ([]);                                   // pre-reset events are void — discard them
    saveGen(serverGen|0);
    if(ctx.clearStore) ctx.clearStore();         // each UI resets to its own defaultStore()
    else if(ctx.setStore) ctx.setStore({});      // fallback (older UI without clearStore)
    ctx.onRemoteUpdate && ctx.onRemoteUpdate();
    setBadge();
  }

  async function pull(){
    try{
      const remote = await api("GET", "/state?store=" + ctx.store);
      const serverGen = (remote._meta && remote._meta.resetGen) || 0;
      if(serverGen > loadGen()){ forceClear(serverGen); return; }   // catch up to a remote reset
      const hasRemote = remote._meta && (remote._meta.bootstrapped || remote._meta.items > 0);
      if(hasRemote){
        delete remote._meta;
        ctx.setStore(remote);                     // remote aggregates are the source of truth
        ctx.onRemoteUpdate && ctx.onRemoteUpdate();
        setBadge();
      } else if(localHasHistory(ctx.getStore())){
        if(confirm("Sync: the server has no history yet.\nUpload THIS device's local history as the baseline?\n(Do this once, from the device with the fullest history.)")){
          const r = await api("POST", "/bootstrap", {store: ctx.store, data: ctx.getStore()});
          setBadge(r.bootstrapped ? null : "err", r.bootstrapped ? "" : "bootstrap raced");
        }
      } else setBadge();
    }catch(e){
      setBadge("err", e.message);
    }
  }

  // ---------- UI: badge + settings panel ----------
  function injectUi(){
    const st = document.createElement("style");
    st.textContent = [
      ".sdq-sync-badge{position:fixed;top:10px;right:12px;z-index:1000;font:600 11px/1 -apple-system,system-ui,sans-serif;",
      " padding:6px 10px;border-radius:999px;border:1px solid var(--line,#334);background:var(--panel,#1a2233);",
      " color:var(--muted,#9aa7bd);cursor:pointer;user-select:none}",
      ".sdq-sync-badge.ok{color:var(--ok,#39d98a);border-color:var(--ok,#39d98a)}",
      ".sdq-sync-badge.warn{color:var(--warn,#f5b83d);border-color:var(--warn,#f5b83d)}",
      ".sdq-sync-badge.err{color:var(--bad,#ff5d5d);border-color:var(--bad,#ff5d5d)}",
      ".sdq-sync-panel{position:fixed;top:44px;right:12px;z-index:1001;width:340px;padding:14px;border-radius:12px;",
      " border:1px solid var(--line,#334);background:var(--panel,#1a2233);box-shadow:0 8px 30px rgba(0,0,0,.45)}",
      ".sdq-sync-panel h4{margin:0 0 8px;font-size:13px;color:var(--fg,#e8eefc)}",
      ".sdq-sync-panel label{display:block;font-size:11px;color:var(--muted,#9aa7bd);margin:8px 0 3px}",
      ".sdq-sync-panel input{width:100%;box-sizing:border-box;padding:7px 8px;border-radius:8px;border:1px solid var(--line,#334);",
      " background:var(--bg,#0d1220);color:var(--fg,#e8eefc);font:12px ui-monospace,Menlo,monospace}",
      ".sdq-sync-panel .r{display:flex;gap:8px;margin-top:12px}",
      ".sdq-sync-panel .msg{font-size:11px;margin-top:8px;min-height:14px}",
    ].join("\n");
    document.head.appendChild(st);

    badge = document.createElement("div");
    badge.className = "sdq-sync-badge";
    badge.onclick = togglePanel;
    document.body.appendChild(badge);
    setBadge();
  }

  function setBadge(state, detail){
    if(!badge) return;
    const cfg = loadCfg(), n = ctx ? loadQ().length : 0;
    if(!cfg){ badge.className="sdq-sync-badge"; badge.textContent="☁ sync off"; badge.title="Click to set up cross-device sync"; return; }
    if(state==="err"){ badge.className="sdq-sync-badge err"; badge.textContent="☁ ⚠ "+(n?n+" queued":"error"); badge.title=detail||""; return; }
    if(n>0){ badge.className="sdq-sync-badge warn"; badge.textContent="☁ "+n+" queued"; badge.title="Will retry automatically"; return; }
    badge.className="sdq-sync-badge ok"; badge.textContent="☁ synced"; badge.title="All progress on the server";
  }

  function togglePanel(){
    if(panel){ panel.remove(); panel=null; return; }
    const cfg = loadCfg() || {url:"", key:""};
    panel = document.createElement("div");
    panel.className = "sdq-sync-panel";
    panel.innerHTML =
      '<h4>☁ Cross-device sync</h4>' +
      '<label>Endpoint (Lambda Function URL)</label><input id="sdqSyncUrl" placeholder="https://…lambda-url…on.aws/" value="'+cfg.url.replace(/"/g,"&quot;")+'">' +
      '<label>Secret (x-sdq-key)</label><input id="sdqSyncKey" type="password" value="'+cfg.key.replace(/"/g,"&quot;")+'">' +
      '<div class="r"><button class="btn sec" id="sdqSyncSave">Save &amp; test</button>' +
      '<button class="btn ghost" id="sdqSyncOff">Disable</button></div>' +
      '<div class="msg" id="sdqSyncMsg"></div>';
    document.body.appendChild(panel);
    const msg = panel.querySelector("#sdqSyncMsg");
    panel.querySelector("#sdqSyncSave").onclick = async ()=>{
      const url = panel.querySelector("#sdqSyncUrl").value.trim().replace(/\/+$/,"");
      const key = panel.querySelector("#sdqSyncKey").value.trim();
      if(!/^https:\/\//.test(url) || !key){ msg.style.color="var(--bad)"; msg.textContent="Need an https URL and a secret."; return; }
      msg.style.color="var(--muted)"; msg.textContent="Testing…";
      saveCfg({url, key});
      try{
        await api("GET", "/state?store=" + ctx.store);
        msg.style.color="var(--ok)"; msg.textContent="Connected. Pulling state…";
        await flush(); await pull();
        setTimeout(()=>{ panel && panel.remove(); panel=null; }, 600);
      }catch(e){
        lsDel(CFG_KEY);
        msg.style.color="var(--bad)"; msg.textContent="Failed: " + e.message;
        setBadge();
      }
    };
    panel.querySelector("#sdqSyncOff").onclick = ()=>{
      lsDel(CFG_KEY);
      msg.style.color="var(--muted)"; msg.textContent="Sync disabled on this device (queue kept).";
      setBadge();
    };
  }

  // ---------- public API ----------
  return {
    init(c){
      ctx = c;
      injectUi();
      window.addEventListener("online", ()=>{ flush(); });
      if(loadCfg()){ flush().then(pull); }
    },
    pushAnswer(q, correct, qs){
      if(!ctx) return;
      const ev = {type:"answer", qid:q.id, topic:q.topic, level:q.level||"Unknown",
                  question:(q.q||"").slice(0,300), correct:!!correct, ts:Date.now()};
      // per-question mastery snapshot (optional 3rd arg = STORE.qstats[q.id]) so streak/t
      // survive a cross-device pull. Old callers omit it -> backend treats it as a legacy
      // answer event (aggregates + missed only), so this stays backward-compatible.
      if(qs){ ev.streak = qs.streak|0; ev.t = qs.t|0; ev.c = qs.c|0; }
      enqueue(ev);
    },
    pushSession(sess){
      if(!ctx) return;
      const ev = {type:"session", date:sess.date, correct:sess.correct, total:sess.total,
                  topics: Array.isArray(sess.topics) ? sess.topics.slice() : []};
      // optional walkthrough fields (quizzes don't set these; harmless when absent)
      if(sess.app     != null) ev.app     = sess.app;
      if(sess.appName != null) ev.appName = sess.appName;
      if(sess.mode    != null) ev.mode    = sess.mode;
      if(sess.walked  != null) ev.walked  = sess.walked;
      // engines push the running session after EVERY answer (same date key) —
      // coalesce in the queue so one session = one event, not one per answer
      const q = loadQ();
      const i = q.findIndex(e=>e.type==="session" && e.date===ev.date);
      if(i>=0){ q[i] = ev; saveQ(q); setBadge(); scheduleFlush(); }
      else enqueue(ev);
    },
    // walkthrough per-step event: carries the NEW streak so the backend can LWW it
    pushStep(ev){
      if(!ctx) return;
      enqueue({type:"step", app:ev.app, stepIdx:ev.stepIdx, correct:!!ev.correct,
               streak:ev.streak|0, t:ev.t|0,
               stage:(ev.stage||"").slice(0,120), decision:(ev.decision||"").slice(0,300),
               mode:ev.mode||"", ts:Date.now()});
    },
    // is cross-device sync configured on THIS device? (UI uses this to decide whether
    // a "reset everywhere" is even possible)
    isConfigured(){ return !!loadCfg(); },
    // Force a reset across ALL devices: bump the server reset epoch + wipe every progress
    // row, then clear locally. Offline devices pick up the new epoch on their next sync
    // (see forceClear). Throws on network/auth failure so the UI can report it.
    async resetEverywhere(){
      if(!ctx) return {ok:false, reason:"no-context"};
      if(!loadCfg()) return {ok:false, reason:"not-configured"};
      const r = await api("POST", "/reset", {store: ctx.store});
      const gen = (r && typeof r.gen === "number") ? r.gen : (loadGen() + 1);
      saveQ([]);                                 // discard any locally-queued (now-void) events
      saveGen(gen);
      if(ctx.clearStore) ctx.clearStore();
      ctx.onRemoteUpdate && ctx.onRemoteUpdate();
      setBadge();
      return {ok:true, gen};
    },
  };
})();
