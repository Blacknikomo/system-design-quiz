/* algorithms-viz.js — step-through visualizations for algorithms.html.
   One shared frame engine; every algorithm registers scenarios (frame generators)
   and a draw(frame) → html function. Frames are produced by RUNNING instrumented
   copies of the reference implementations, so the animation can't drift from truth.
   Vanilla JS, offline, no libs (AGENTS.md §2). Testable headlessly: window.ALGO_VIZ. */
(function () {
  "use strict";
  const REG = {};

  /* ---------- shared draw helpers (pure string builders — no DOM) ---------- */
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // row of array cells; marks: [{i, cls, lab}]
  function cells(vals, marks = [], opts = {}) {
    return '<div class="vcells">' + vals.map((v, i) => {
      const ms = marks.filter((m) => m.i === i);
      const cls = ms.map((m) => m.cls || "").join(" ");
      const labs = ms.map((m) => m.lab).filter(Boolean);
      return '<div class="vcell ' + cls + '">' + esc(v) +
        (labs.length ? '<div class="vlab">' + labs.map(esc).join("·") + "</div>" : "") + "</div>";
    }).join("") + "</div>";
  }
  function row(label, inner) {
    return '<div class="vrow"><div class="rl">' + esc(label) + "</div>" + inner + "</div>";
  }
  function chips(items, hot = []) {
    if (!items.length) return '<span class="vempty">(empty)</span>';
    return '<div class="vchips">' + items.map((x, i) =>
      '<span class="vchip' + (hot.includes(i) ? " hot" : "") + '">' + esc(x) + "</span>").join("") + "</div>";
  }
  function kv(obj, hotKeys = [], hitKeys = []) {
    const ks = Object.keys(obj);
    if (!ks.length) return '<span class="vempty">(empty)</span>';
    return '<div class="vkv">' + ks.map((k) =>
      '<span class="' + (hitKeys.includes(k) ? "hit" : hotKeys.includes(k) ? "hot" : "") + '">' +
      esc(k) + " → " + esc(obj[k]) + "</span>").join("") + "</div>";
  }

  // small graph SVG. nodes: {id:{x,y}}, edges: [[a,b,weight?]],
  // st: {cur, done:Set, queued:Set, dist:{}, hot:[a,b]}
  function gsvg(nodes, edges, st, opts = {}) {
    const w = opts.w || 470, hh = opts.h || 205, R = 16, dir = !!opts.directed;
    const mid = opts.mid || "m";
    let s = '<svg viewBox="0 0 ' + w + " " + hh + '" style="max-width:' + w + 'px;width:100%;display:block" xmlns="http://www.w3.org/2000/svg">';
    if (dir) s += '<defs><marker id="arr' + mid + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" style="fill:var(--muted)"/></marker></defs>';
    for (const [a, b, wt] of edges) {
      const A = nodes[a], B = nodes[b];
      const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy);
      const x1 = A.x + dx / L * (R + 2), y1 = A.y + dy / L * (R + 2);
      const x2 = B.x - dx / L * (R + (dir ? 7 : 2)), y2 = B.y - dy / L * (R + (dir ? 7 : 2));
      const hot = st.hot && st.hot[0] === a && st.hot[1] === b;
      s += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 +
        '" style="stroke:' + (hot ? "var(--accent)" : "var(--line)") + ";stroke-width:" + (hot ? 2.5 : 1.5) + '"' +
        (dir ? ' marker-end="url(#arr' + mid + ')"' : "") + "/>";
      if (wt != null) s += '<text x="' + ((A.x + B.x) / 2 + 8) + '" y="' + ((A.y + B.y) / 2 - 5) +
        '" text-anchor="middle" style="fill:var(--warn);font-size:11px;font-family:monospace">' + wt + "</text>";
    }
    for (const id in nodes) {
      const n = nodes[id];
      let stroke = "var(--line)", fill = "var(--panel)", width = 1.5;
      if (st.queued && st.queued.has(id)) { stroke = "var(--warn)"; width = 2; }
      if (st.done && st.done.has(id)) { stroke = "var(--ok)"; width = 2; }
      if (st.cur === id) { stroke = "var(--accent)"; fill = "rgba(var(--accent-rgb),.18)"; width = 2.5; }
      s += '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + R + '" style="fill:' + fill + ";stroke:" + stroke + ";stroke-width:" + width + '"/>' +
        '<text x="' + n.x + '" y="' + (n.y + 4) + '" text-anchor="middle" style="fill:var(--txt);font-size:12px;font-weight:700">' + esc(id) + "</text>";
      const d = st.dist && st.dist[id];
      if (d !== undefined) s += '<text x="' + n.x + '" y="' + (n.y - 22) + '" text-anchor="middle" style="fill:var(--accent);font-size:11px;font-family:monospace">' + esc(d) + "</text>";
    }
    return s + "</svg>";
  }

  /* ================= 1. BINARY SEARCH ================= */
  function bsFrames(arr, target) {
    const F = []; let lo = 0, hi = arr.length - 1;
    F.push({ arr, lo, hi, mid: null, msg: "Search <b>" + target + "</b> — inclusive bounds: lo=0, hi=" + hi + ", loop while lo ≤ hi" });
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      F.push({ arr, lo, hi, mid, msg: "mid = (" + lo + "+" + hi + ")&gt;&gt;1 = <b>" + mid + "</b>; arr[mid] = " + arr[mid] });
      if (arr[mid] === target) { F.push({ arr, lo, hi, mid, found: mid, msg: "arr[" + mid + "] = " + target + " → <b>return " + mid + "</b>" }); return F; }
      if (arr[mid] < target) { lo = mid + 1; F.push({ arr, lo, hi, mid: null, msg: arr[mid] + " &lt; " + target + " → mid is ruled out, go right: lo = mid+1 = <b>" + lo + "</b>" }); }
      else { hi = mid - 1; F.push({ arr, lo, hi, mid: null, msg: arr[mid] + " &gt; " + target + " → mid is ruled out, go left: hi = mid−1 = <b>" + hi + "</b>" }); }
    }
    F.push({ arr, lo, hi, mid: null, fail: true, msg: "lo(" + lo + ") &gt; hi(" + hi + ") — range empty → <b>return -1</b>. With <code>lo &lt; hi</code> we'd have quit one step early." });
    return F;
  }
  function lbFrames(arr, target) {
    const F = []; let lo = 0, hi = arr.length;
    F.push({ arr, lo, hi, mid: null, ex: true, msg: "Lower bound of <b>" + target + "</b> — the OTHER template: hi = length (exclusive), loop while lo &lt; hi" });
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      F.push({ arr, lo, hi, mid, ex: true, msg: "mid = " + mid + "; arr[mid] = " + arr[mid] });
      if (arr[mid] < target) { lo = mid + 1; F.push({ arr, lo, hi, mid: null, ex: true, msg: arr[mid] + " &lt; " + target + " → lo = mid+1 = " + lo }); }
      else { hi = mid; F.push({ arr, lo, hi, mid: null, ex: true, msg: arr[mid] + " ≥ " + target + " → <b>hi = mid = " + hi + "</b> (mid may BE the answer — keep it)" }); }
    }
    F.push({ arr, lo, hi, mid: null, ex: true, found: lo, msg: "lo = hi = <b>" + lo + "</b> → first index with arr[i] ≥ " + target + " (insertion point)" });
    return F;
  }
  REG.bsearch = {
    scenarios: [
      { label: "find 11", gen: () => bsFrames([1, 3, 5, 7, 9, 11, 13], 11) },
      { label: "miss 6", gen: () => bsFrames([1, 3, 5, 7, 9, 11, 13], 6) },
      { label: "lowerBound 6", gen: () => lbFrames([1, 3, 5, 7, 9, 11, 13], 6) }
    ],
    draw(f) {
      const vals = f.ex ? f.arr.concat(["∅"]) : f.arr;
      const marks = [];
      for (let i = 0; i < vals.length; i++) {
        const out = f.ex ? (i < f.lo || i >= f.hi) : (i < f.lo || i > f.hi);
        if (out && i !== f.mid && i !== f.found) marks.push({ i, cls: "dim" });
      }
      if (f.mid != null) marks.push({ i: f.mid, cls: "hot", lab: "mid" });
      if (f.found != null) marks.push({ i: f.found, cls: "ok", lab: f.ex ? "insert here" : "found" });
      marks.push({ i: f.lo, cls: "", lab: "lo" });
      marks.push({ i: Math.min(f.hi, vals.length - 1), cls: "", lab: f.ex ? "hi (excl)" : "hi" });
      return row("array" + (f.ex ? " + one-past-the-end" : ""), cells(vals, marks));
    }
  };

  /* ================= 2. MERGE ================= */
  function mergeFrames(a, b) {
    const F = []; const out = []; let i = 0, j = 0;
    const snap = (msg, x = {}) => F.push({ a, b, out: out.slice(), i, j, msg, ...x });
    snap("Two cursors. Compare heads, always take the smaller — ties go to <b>a</b> (stability).");
    while (i < a.length && j < b.length) {
      if (a[i] <= b[j]) { out.push(a[i]); i++; snap("a[" + (i - 1) + "]=" + a[i - 1] + " ≤ b[" + j + "]=" + b[j] + " → take from <b>a</b>", { took: "a" }); }
      else { out.push(b[j]); j++; snap("a[" + i + "]=" + a[i] + " &gt; b[" + (j - 1) + "]=" + b[j - 1] + " → take from <b>b</b>", { took: "b" }); }
    }
    if (i < a.length || j < b.length) snap("One side is exhausted — <b>drain the tail</b> of the other. Forgetting this drops " + (a.length - i + b.length - j) + " element(s)!", { drain: true });
    while (i < a.length) { out.push(a[i]); i++; snap("drain a[" + (i - 1) + "] = " + a[i - 1], { drain: true }); }
    while (j < b.length) { out.push(b[j]); j++; snap("drain b[" + (j - 1) + "] = " + b[j - 1], { drain: true }); }
    snap("Done: " + out.length + " elements, sorted, stable.", { done: true });
    return F;
  }
  REG.merge = {
    scenarios: [{ label: "merge", gen: () => mergeFrames([1, 4, 9], [2, 3, 10, 11]) }],
    draw(f) {
      const mA = f.a.map((_, x) => x < f.i ? { i: x, cls: "dim" } : null).filter(Boolean);
      if (f.i < f.a.length) mA.push({ i: f.i, cls: f.drain ? "win" : "hot", lab: "i" });
      const mB = f.b.map((_, x) => x < f.j ? { i: x, cls: "dim" } : null).filter(Boolean);
      if (f.j < f.b.length) mB.push({ i: f.j, cls: f.drain ? "win" : "hot", lab: "j" });
      const mO = f.out.length ? [{ i: f.out.length - 1, cls: "ok" }] : [];
      return row("a", cells(f.a, mA)) + row("b", cells(f.b, mB)) +
        row("out", f.out.length ? cells(f.out, mO) : '<span class="vempty">(empty)</span>');
    }
  };

  /* ================= 3. PARTITION (Lomuto) ================= */
  function partFrames(arr0) {
    const arr = arr0.slice(); const F = []; const lo = 0, hi = arr.length - 1; const pivot = arr[hi]; let i = lo;
    const snap = (msg, x = {}) => F.push({ arr: arr.slice(), i, pivotIdx: hi, msg, ...x });
    snap("pivot = arr[" + hi + "] = <b>" + pivot + "</b>. i = 0 marks the boundary of the «&lt; pivot» zone; j scans up to (not including) the pivot.");
    for (let j = lo; j < hi; j++) {
      if (arr[j] < pivot) {
        const swapped = i !== j;
        [arr[i], arr[j]] = [arr[j], arr[i]]; i++;
        snap("arr[j=" + j + "] = " + arr[i - 1] + " &lt; " + pivot + " → " + (swapped ? "swap it into the zone" : "already in place") + ", i → " + i, { j });
      } else {
        snap("arr[j=" + j + "] = " + arr[j] + " ≥ " + pivot + " → leave it right of the boundary", { j });
      }
    }
    [arr[i], arr[hi]] = [arr[hi], arr[i]];
    snap("Final swap: pivot lands at index <b>" + i + "</b> — its FINAL sorted position.", { done: i });
    F.push({ arr: arr.slice(), i, pivotIdx: i, done: i, msg: "Recurse on [0.." + (i - 1) + "] and [" + (i + 1) + ".." + hi + "] — the pivot is EXCLUDED. Including it → infinite recursion on duplicates." });
    return F;
  }
  REG.partition = {
    scenarios: [{ label: "partition", gen: () => partFrames([5, 2, 9, 1, 7, 3]) }],
    draw(f) {
      const marks = [];
      for (let x = 0; x < f.i; x++) marks.push({ i: x, cls: "win" });
      if (f.done == null) marks.push({ i: f.pivotIdx, cls: "bad", lab: "pivot" });
      else marks.push({ i: f.done, cls: "ok", lab: "pivot·final" });
      if (f.j != null) marks.push({ i: f.j, cls: "hot", lab: "j" });
      if (f.i < f.arr.length && f.done == null) marks.push({ i: f.i, lab: "i (zone end)" });
      return row("array — green zone = «< pivot»", cells(f.arr, marks));
    }
  };

  /* ================= shared graph for BFS / DFS ================= */
  const GNODES = { A: { x: 60, y: 45 }, B: { x: 205, y: 45 }, C: { x: 60, y: 155 }, D: { x: 205, y: 155 }, E: { x: 340, y: 100 }, F: { x: 430, y: 160 } };
  const GEDGES = [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"], ["D", "E"], ["E", "F"]];
  const GADJ = { A: ["B", "C"], B: ["A", "D"], C: ["A", "D"], D: ["B", "C", "E"], E: ["D", "F"], F: ["E"] };

  /* ================= 4. BFS ================= */
  function bfsFrames() {
    const F = []; const dist = { A: 0 }; const queue = ["A"]; let head = 0;
    const snap = (msg, x = {}) => F.push({ dist: { ...dist }, q: queue.slice(head), msg, ...x });
    snap("Start at A: dist[A]=0, enqueue A. The dist map doubles as the visited set.");
    while (head < queue.length) {
      const u = queue[head++];
      snap("Dequeue <b>" + u + "</b> (dist " + dist[u] + ") — scan its neighbors", { cur: u });
      const skipped = [];
      for (const v of GADJ[u]) {
        if (dist[v] === undefined) {
          dist[v] = dist[u] + 1; queue.push(v);
          snap(v + " unseen → dist[" + v + "] = " + dist[v] + ", enqueue. Marked <b>on enqueue</b> — it can never enter the queue twice.", { cur: u, hot: [u, v] });
        } else skipped.push(v);
      }
      if (skipped.length) snap(skipped.join(", ") + " already " + (skipped.length > 1 ? "have" : "has") + " dist — skip. (Marking on dequeue instead would let duplicates pile up here.)", { cur: u });
    }
    snap("Queue empty — done. dist[] holds shortest hop counts from A.", { done: true });
    return F;
  }
  REG.bfs = {
    scenarios: [{ label: "BFS from A", gen: bfsFrames }],
    draw(f) {
      const seen = new Set(Object.keys(f.dist));
      const st = { cur: f.cur, done: f.done ? seen : null, queued: new Set(f.q), dist: f.dist, hot: f.hot };
      if (!f.done) st.done = new Set([...seen].filter((n) => !f.q.includes(n) && n !== f.cur));
      return gsvg(GNODES, GEDGES, st, { mid: "bfs" }) +
        row("queue (front → back)", chips(f.q)) +
        row("dist", kv(f.dist, f.hot ? [f.hot[1]] : []));
    }
  };

  /* ================= 5. DFS ================= */
  function dfsFrames() {
    const F = []; const visited = new Set(); const stack = [];
    const snap = (msg, x = {}) => F.push({ visited: new Set(visited), stack: stack.slice(), msg, ...x });
    (function go(u, from) {
      visited.add(u); stack.push(u);
      snap("Visit <b>" + u + "</b> — marked BEFORE exploring its neighbors (cycle safety), recursion depth " + stack.length, { cur: u, hot: from ? [from, u] : null });
      for (const v of GADJ[u]) {
        if (visited.has(v)) snap(v + " already visited — skip. Without mark-before-recurse, the " + u + "↔" + v + " edge would recurse forever.", { cur: u, hot: [u, v] });
        else go(v, u);
      }
      stack.pop();
      snap("<b>" + u + "</b> exhausted — return (backtrack to " + (stack[stack.length - 1] || "done") + ")", { cur: stack[stack.length - 1] });
    })("A", null);
    snap("All 6 nodes visited. Max recursion depth here: 5 — on a 10⁵-node chain this is a stack overflow.", { done: true });
    return F;
  }
  REG.dfs = {
    scenarios: [{ label: "DFS from A", gen: dfsFrames }],
    draw(f) {
      const st = { cur: f.cur, done: f.done ? f.visited : new Set([...f.visited].filter((n) => !f.stack.includes(n))), queued: new Set(f.stack), hot: f.hot };
      return gsvg(GNODES, GEDGES, st, { mid: "dfs" }) +
        row("call stack (bottom → top)", chips(f.stack, f.stack.length ? [f.stack.length - 1] : [])) +
        row("visited", chips([...f.visited]));
    }
  };

  /* ================= 6. TOPO SORT (Kahn) ================= */
  const TNODES = { A: { x: 55, y: 45 }, B: { x: 55, y: 160 }, C: { x: 185, y: 100 }, D: { x: 315, y: 45 }, E: { x: 315, y: 160 }, F: { x: 435, y: 100 } };
  const TEDGES = [["A", "C"], ["B", "C"], ["C", "D"], ["C", "E"], ["D", "F"], ["E", "F"]];
  function topoFrames() {
    const F = []; const adj = {}; const indeg = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };
    for (const [u, v] of TEDGES) { (adj[u] = adj[u] || []).push(v); indeg[v]++; }
    const queue = []; const order = []; let head = 0;
    const snap = (msg, x = {}) => F.push({ indeg: { ...indeg }, q: queue.slice(head), order: order.slice(), msg, ...x });
    for (const v of Object.keys(indeg)) if (indeg[v] === 0) queue.push(v);
    snap("Count incoming edges. indeg 0 = «no prerequisites» → seed the queue: " + queue.join(", "));
    while (head < queue.length) {
      const u = queue[head++]; order.push(u);
      snap("Dequeue <b>" + u + "</b> → append to order. Now «remove» its outgoing edges.", { cur: u });
      for (const v of adj[u] || []) {
        indeg[v]--;
        if (indeg[v] === 0) { queue.push(v); snap(u + "→" + v + ": indeg[" + v + "] → 0 — ALL prerequisites done → enqueue " + v, { cur: u, hot: [u, v] }); }
        else snap(u + "→" + v + ": indeg[" + v + "] → " + indeg[v] + " — still waiting on other prerequisites", { cur: u, hot: [u, v] });
      }
    }
    snap("order.length = " + order.length + " = n → valid ordering: " + order.join(" → ") + ". If it were &lt; n, a cycle ate the rest — the check everyone forgets.", { done: true });
    return F;
  }
  REG.topo = {
    scenarios: [{ label: "Kahn's algorithm", gen: topoFrames }],
    draw(f) {
      const st = { cur: f.cur, done: new Set(f.order), queued: new Set(f.q), hot: f.hot, dist: f.indeg };
      return gsvg(TNODES, TEDGES, st, { directed: true, mid: "topo" }) +
        row("indeg (shown above each node)", kv(f.indeg, f.hot ? [f.hot[1]] : [])) +
        row("queue", chips(f.q)) + row("order", chips(f.order, f.order.length && f.cur === f.order[f.order.length - 1] ? [f.order.length - 1] : []));
    }
  };

  /* ================= MinHeap (mirror of the page's implementation) ========= */
  class MinHeap {
    constructor(cmp = (a, b) => a - b) { this.a = []; this.cmp = cmp; }
    get size() { return this.a.length; }
    push(x) { const a = this.a; a.push(x); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (this.cmp(a[p], a[i]) <= 0) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
    pop() { const a = this.a; if (!a.length) return undefined; const top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = 2 * i + 2; let m = i; if (l < a.length && this.cmp(a[l], a[m]) < 0) m = l; if (r < a.length && this.cmp(a[r], a[m]) < 0) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  }

  /* ================= 7. DIJKSTRA ================= */
  const DJNODES = { a: { x: 60, y: 100 }, b: { x: 230, y: 45 }, c: { x: 230, y: 160 }, d: { x: 400, y: 100 } };
  const DJEDGES = [["a", "b", 4], ["a", "c", 1], ["c", "b", 2], ["b", "d", 1], ["c", "d", 6]];
  function dijkstraFrames() {
    const adj = {}; for (const [u, v, w] of DJEDGES) (adj[u] = adj[u] || []).push([v, w]);
    const F = []; const dist = { a: 0 }; const pq = new MinHeap((x, y) => x[0] - y[0]); pq.push([0, "a"]);
    const pqView = () => pq.a.slice().sort((x, y) => x[0] - y[0]).map(([d, n]) => "[" + d + "," + n + "]");
    const snap = (msg, x = {}) => F.push({ dist: { ...dist }, pq: pqView(), msg, ...x });
    snap("dist[a]=0, push [0,a]. PQ entries are [dist, node] — shown sorted.");
    while (pq.size) {
      const [d, u] = pq.pop();
      if (d > (dist[u] ?? Infinity)) { snap("Pop [" + d + "," + u + "] — <b>STALE</b>: dist[" + u + "] is already " + dist[u] + ". Skip. This is lazy deletion earning its keep.", { cur: u, stale: true }); continue; }
      snap("Pop [" + d + "," + u + "] — smallest tentative distance, now FINAL. Relax its edges.", { cur: u });
      for (const [v, w] of adj[u] || []) {
        const nd = d + w;
        if (nd < (dist[v] ?? Infinity)) {
          const old = dist[v]; dist[v] = nd; pq.push([nd, v]);
          snap(u + "→" + v + " (w=" + w + "): " + d + "+" + w + " = " + nd + (old !== undefined ? " &lt; " + old + " → improve" : " → first path") + ", push [" + nd + "," + v + "]" + (old !== undefined ? ". The old [" + old + "," + v + "] stays in the PQ as a future stale entry." : ""), { cur: u, hot: [u, v] });
        } else snap(u + "→" + v + " (w=" + w + "): " + d + "+" + w + " = " + nd + " ≥ dist[" + v + "]=" + dist[v] + " — no improvement", { cur: u, hot: [u, v] });
      }
    }
    snap("PQ empty. Shortest distances: " + Object.entries(dist).map(([k, v]) => k + "=" + v).join(", ") + ". Note b=3 went via c, and the direct a→b edge (4) lost.", { done: true });
    return F;
  }
  REG.dijkstra = {
    scenarios: [{ label: "Dijkstra from a", gen: dijkstraFrames }],
    draw(f) {
      const st = { cur: f.cur, dist: f.dist, hot: f.hot, done: f.done ? new Set(Object.keys(f.dist)) : null };
      return gsvg(DJNODES, DJEDGES, st, { directed: true, mid: "dj" }) +
        row("priority queue (sorted view)", chips(f.pq, f.stale ? [0] : [])) +
        row("dist (shown above nodes)", kv(f.dist, f.hot ? [f.hot[1]] : []));
    }
  };

  /* ================= 8. SLIDING WINDOW ================= */
  function windowFrames(s) {
    const F = []; const last = {}; let best = 0, left = 0, bestL = 0, bestR = -1;
    const snap = (msg, x = {}) => F.push({ s, left, right: x.right ?? -1, last: { ...last }, best, bestL, bestR, msg, ...x });
    snap("Expand right every step; jump left forward past duplicates; record best AFTER the window is valid.");
    for (let right = 0; right < s.length; right++) {
      const c = s[right];
      if (last[c] !== undefined && last[c] >= left) {
        const from = left; left = last[c] + 1;
        snap("'" + c + "' seen at index " + last[c] + " — INSIDE the window → jump left " + from + " → <b>" + left + "</b> (past the duplicate, not left++)", { right, jump: true, hotKey: c });
      } else if (last[c] !== undefined) {
        snap("'" + c + "' was seen at " + last[c] + ", but that's BEHIND the window (&lt; left=" + left + ") — the ≥ left guard says: ignore it, do NOT move left backwards", { right, hotKey: c });
      }
      last[c] = right;
      const len = right - left + 1;
      if (len > best) { best = len; bestL = left; bestR = right; }
      snap("window [" + left + ".." + right + "] len = " + right + "−" + left + "<b>+1</b> = " + len + (len === best && bestR === right ? " → new best" : " (best " + best + ")"), { right });
    }
    snap("Answer: <b>" + best + "</b> — substring \"" + s.slice(bestL, bestR + 1) + "\"", { right: s.length - 1, done: true });
    return F;
  }
  REG.window = {
    scenarios: [
      { label: '"abcabcbb"', gen: () => windowFrames("abcabcbb") },
      { label: '"abba" (the ≥left trap)', gen: () => windowFrames("abba") }
    ],
    draw(f) {
      const marks = [];
      for (let i = 0; i < f.s.length; i++) {
        if (f.right >= 0 && i >= f.left && i <= f.right) marks.push({ i, cls: "win" });
        else if (f.right >= 0 && i < f.left) marks.push({ i, cls: "dim" });
      }
      if (f.right >= 0) marks.push({ i: f.right, cls: "hot", lab: "right" });
      if (f.left < f.s.length) marks.push({ i: f.left, lab: "left" });
      return row("string — highlighted = current window", cells(f.s.split(""), marks)) +
        row("last seen index", kv(f.last, f.hotKey ? [f.hotKey] : [])) +
        row("best", '<span class="vchip ok">' + f.best + "</span>");
    }
  };

  /* ================= 9. TWO POINTERS ================= */
  function twoPtrFrames(arr, target) {
    const F = []; let i = 0, j = arr.length - 1;
    const snap = (msg, x = {}) => F.push({ arr, i, j, msg, ...x });
    snap("Sorted array, pointers at both ends. Target sum: <b>" + target + "</b>. Loop while i &lt; j (strict — no self-pairing).");
    while (i < j) {
      const sum = arr[i] + arr[j];
      if (sum === target) { snap(arr[i] + " + " + arr[j] + " = " + target + " → <b>found [" + i + ", " + j + "]</b>", { found: true }); return F; }
      if (sum < target) { snap(arr[i] + " + " + arr[j] + " = " + sum + " &lt; " + target + " → too small; only moving i right can grow the sum", {}); i++; }
      else { snap(arr[i] + " + " + arr[j] + " = " + sum + " &gt; " + target + " → too big; only moving j left can shrink it", {}); j--; }
    }
    snap("i meets j — no pair sums to " + target + " → return null", { fail: true });
    return F;
  }
  REG.twoptr = {
    scenarios: [
      { label: "find 9", gen: () => twoPtrFrames([1, 2, 4, 7, 11, 15], 9) },
      { label: "miss 100", gen: () => twoPtrFrames([1, 2, 4, 7, 11, 15], 100) }
    ],
    draw(f) {
      const marks = [];
      for (let x = 0; x < f.arr.length; x++) if (x < f.i || x > f.j) marks.push({ i: x, cls: "dim" });
      marks.push({ i: f.i, cls: f.found ? "ok" : "hot", lab: "i" });
      marks.push({ i: f.j, cls: f.found ? "ok" : "hot", lab: "j" });
      return row("array (sorted)", cells(f.arr, marks));
    }
  };

  /* ================= 10. HEAP ================= */
  function heapSVG(a, hot = []) {
    const w = 400, hh = 190, R = 15;
    let s = '<svg viewBox="0 0 ' + w + " " + hh + '" style="max-width:' + w + 'px;width:100%;display:block" xmlns="http://www.w3.org/2000/svg">';
    const pos = (i) => {
      const l = Math.floor(Math.log2(i + 1)), k = i + 1 - (1 << l), n = 1 << l;
      return { x: w * (k + 0.5) / n, y: 30 + l * 62 };
    };
    for (let i = 1; i < a.length; i++) {
      const p = pos((i - 1) >> 1), c = pos(i);
      s += '<line x1="' + p.x + '" y1="' + p.y + '" x2="' + c.x + '" y2="' + c.y + '" style="stroke:var(--line);stroke-width:1.5"/>';
    }
    for (let i = 0; i < a.length; i++) {
      const p = pos(i); const isHot = hot.includes(i);
      s += '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + R + '" style="fill:' + (isHot ? "rgba(var(--accent-rgb),.18)" : "var(--panel)") + ";stroke:" + (isHot ? "var(--accent)" : "var(--line)") + ';stroke-width:2"/>' +
        '<text x="' + p.x + '" y="' + (p.y + 4) + '" text-anchor="middle" style="fill:var(--txt);font-size:12px;font-family:monospace;font-weight:700">' + a[i] + "</text>" +
        '<text x="' + (p.x + R + 4) + '" y="' + (p.y - 8) + '" style="fill:var(--muted);font-size:9px;font-family:monospace">' + i + "</text>";
    }
    return s + "</svg>";
  }
  function heapFrames() {
    const F = []; const a = []; const popped = [];
    const snap = (msg, hot = []) => F.push({ a: a.slice(), popped: popped.slice(), hot, msg });
    for (const x of [5, 2, 9, 1, 7]) {
      a.push(x); let i = a.length - 1;
      snap("push(" + x + ") — append at index " + i + ", then sift UP while smaller than its parent", [i]);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p] <= a[i]) { if (a.length > 1) snap("parent a[" + p + "]=" + a[p] + " ≤ " + a[i] + " — heap property holds, stop", [i, p]); break; }
        [a[p], a[i]] = [a[i], a[p]];
        snap("a[" + p + "]=" + a[i] + " &gt; " + a[p] + " → swap with parent (i−1)&gt;&gt;1 = " + p, [p, i]);
        i = p;
      }
    }
    for (let n = 0; n < 2; n++) {
      const top = a[0]; const last = a.pop(); popped.push(top);
      if (a.length) {
        a[0] = last;
        snap("pop() → <b>" + top + "</b>. Move LAST element (" + last + ") to the root, then sift DOWN", [0]);
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = 2 * i + 2; let m = i;
          if (l < a.length && a[l] < a[m]) m = l;
          if (r < a.length && a[r] < a[m]) m = r;
          if (m === i) { snap("no child is smaller — stop. Both children compared: 2i+1 AND 2i+2.", [i]); break; }
          [a[m], a[i]] = [a[i], a[m]];
          snap("smallest of {node, left=2i+1, right=2i+2} is a[" + m + "] → swap", [i, m]);
          i = m;
        }
      } else snap("pop() → <b>" + top + "</b> — heap is now empty", []);
    }
    snap("Popped in order: " + popped.join(", ") + " — always the minimum. Array IS the tree: no pointers, just index math.", []);
    return F;
  }
  REG.heap = {
    scenarios: [{ label: "push ×5, pop ×2", gen: heapFrames }],
    draw(f) {
      return heapSVG(f.a, f.hot) +
        row("backing array", f.a.length ? cells(f.a, f.hot.map((i) => ({ i, cls: "hot" }))) : '<span class="vempty">(empty)</span>') +
        row("popped", f.popped.length ? chips(f.popped) : '<span class="vempty">(none yet)</span>');
    }
  };

  /* ================= 11. LRU ================= */
  function lruFrames() {
    const F = []; const cap = 2; const m = new Map();
    const snap = (op, msg, x = {}) => F.push({ entries: [...m.entries()].map(([k, v]) => k + ":" + v), op, msg, ...x });
    snap("", "Capacity 2. Map iteration order = insertion order: leftmost is the LRU victim.");
    const put = (k, v) => {
      const had = m.has(k);
      if (had) { m.delete(k); snap("put(" + k + "," + v + ")", "key exists → <b>delete first</b> (plain set() would keep its old position), then re-insert at the back", { hot: k }); }
      m.set(k, v);
      snap("put(" + k + "," + v + ")", (had ? "re-inserted" : "inserted") + " <b>" + k + "</b> at the most-recent end", { hot: k });
      if (m.size > cap) {
        const oldest = m.keys().next().value; m.delete(oldest);
        snap("put(" + k + "," + v + ")", "size &gt; " + cap + " → evict the FIRST key in iteration order: <b>" + oldest + "</b> (least recently used)", { evicted: oldest });
      }
    };
    const get = (k) => {
      if (!m.has(k)) { snap("get(" + k + ")", "<b>" + k + "</b> not present → miss (undefined). Note: has(), not truthiness — a stored 0 must count as a hit.", { miss: k }); return; }
      const v = m.get(k); m.delete(k); m.set(k, v);
      snap("get(" + k + ")", "hit → " + v + ". Delete + re-insert moves <b>" + k + "</b> to the most-recent end — without this, the cache is FIFO, not LRU.", { hot: k });
    };
    put("a", 1); put("b", 2); get("a"); put("c", 3); get("b"); put("a", 9);
    snap("", "Final state. Everything was O(1): Map lookup + delete + insert.");
    return F;
  }
  REG.lru = {
    scenarios: [{ label: "put/get/evict", gen: lruFrames }],
    draw(f) {
      const hot = f.entries.findIndex((e) => e.startsWith((f.hot || "§") + ":"));
      return (f.op ? row("operation", '<span class="vchip hot">' + esc(f.op) + "</span>") : "") +
        row("Map order — LRU (evict side) → MRU", f.entries.length ? chips(f.entries, hot >= 0 ? [hot] : []) : '<span class="vempty">(empty)</span>') +
        (f.evicted ? row("evicted", '<span class="vchip bad">' + esc(f.evicted) + "</span>") : "") +
        (f.miss ? row("result", '<span class="vchip bad">miss</span>') : "");
    }
  };

  /* ================= 12. MEMOIZATION ================= */
  function memoFrames() {
    const F = []; const memo = new Map([[0, 0], [1, 1]]); const stack = [];
    const mv = () => Object.fromEntries(memo);
    const snap = (msg, x = {}) => F.push({ stack: stack.slice(), memo: mv(), msg, ...x });
    snap("fib(5) with base cases pre-seeded. Watch how memo hits prune the exponential tree to a line.");
    (function fib(n) {
      if (memo.has(n)) { snap("fib(" + n + "): memo <b>has</b> " + n + " → return " + memo.get(n) + " instantly. (Truthiness instead of has() would recompute fib(0)=0 forever.)", { hit: String(n) }); return memo.get(n); }
      stack.push("fib(" + n + ")");
      snap("fib(" + n + "): miss → recurse. Call depth: " + stack.length, {});
      const val = fib(n - 1) + fib(n - 2);
      memo.set(n, val);
      stack.pop();
      snap("fib(" + n + ") = " + val + " → <b>write to memo BEFORE returning</b>", { set: String(n) });
      return val;
    })(5);
    snap("Done: fib(5) = 5 with just 4 real computations — every subtree was answered from the Map.", {});
    return F;
  }
  REG.memo = {
    scenarios: [{ label: "fib(5)", gen: memoFrames }],
    draw(f) {
      return row("call stack", f.stack.length ? chips(f.stack, [f.stack.length - 1]) : '<span class="vempty">(empty)</span>') +
        row("memo Map", kv(f.memo, f.set ? [f.set] : [], f.hit ? [f.hit] : []));
    }
  };

  /* ================= 13. DEBOUNCE / THROTTLE ================= */
  function dtFrames() {
    const MS = 300, TOTAL = 1300;
    const events = [50, 150, 250, 500, 560, 900];
    // simulate the page's exact implementations on a virtual clock
    const dFires = [], tFires = [];
    { // debounce: fire at last-event-of-burst + MS
      let timerAt = null, args = null;
      for (const t of events) { timerAt = t + MS; args = t; // clearTimeout + setTimeout
        const next = events.find((e) => e > t);
        if (next === undefined || next >= timerAt) dFires.push({ t: timerAt, args });
      }
    }
    { // throttle (leading + trailing)
      let last = -Infinity, timerAt = null, lastArgs = null;
      const fireTrailingBefore = (t) => {
        while (timerAt !== null && timerAt <= t) { tFires.push({ t: timerAt, args: lastArgs, tr: true }); last = timerAt; timerAt = null; }
      };
      for (const t of events) {
        fireTrailingBefore(t);
        if (t - last >= MS) { last = t; tFires.push({ t, args: t }); }
        else if (timerAt === null) timerAt = last + MS;
        lastArgs = t;
      }
      fireTrailingBefore(Infinity);
    }
    const pts = [
      ...events.map((t) => ({ t, kind: "evt", msg: "t=" + t + "ms: event fires (e.g. a keystroke). Debounce: reset the timer to t+" + MS + ". Throttle: " + (tFires.some((f) => f.t === t && !f.tr) ? "≥" + MS + "ms since last run → <b>leading call NOW</b>" : "too soon → remember args for the trailing call") })),
      ...dFires.map((f) => ({ t: f.t, kind: "dfire", msg: "t=" + f.t + "ms: <b>debounce fires</b> with args from t=" + f.args + " — the burst has been quiet for " + MS + "ms" })),
      ...tFires.filter((f) => f.tr).map((f) => ({ t: f.t, kind: "tfire", msg: "t=" + f.t + "ms: <b>throttle trailing call</b> with the LATEST args (t=" + f.args + ") — the last event of the burst is not lost" }))
    ].sort((a, b) => a.t - b.t || (a.kind === "evt" ? -1 : 1));
    const F = pts.map((p) => ({ t: p.t, events, dFires, tFires, total: TOTAL, msg: p.msg }));
    F.push({ t: TOTAL, events, dFires, tFires, total: TOTAL, msg: "6 events → debounce ran " + dFires.length + "× (after quiet gaps), throttle ran " + tFires.length + "× (spread evenly). Neither dropped the final event." });
    F.unshift({ t: 0, events, dFires, tFires, total: TOTAL, msg: "6 events hit within 1.3s; window = " + MS + "ms. Step through time →" });
    return F;
  }
  REG.debounce = {
    scenarios: [{ label: "same burst, both", gen: dtFrames }],
    draw(f) {
      const tl = (label, pts, cls) => row(label, '<div class="vtl">' +
        pts.map((p) => '<span class="vdot ' + cls + (p.t <= f.t ? "" : " future") + '" style="left:' + (p.t / f.total * 100) + '%" title="t=' + p.t + 'ms"></span>').join("") +
        '<span class="vnow" style="left:' + (f.t / f.total * 100) + '%"></span></div>');
      return tl("events (t=" + f.t + "ms)", f.events.map((t) => ({ t })), "evt") +
        tl("debounce(300) fires", f.dFires, "fire") +
        tl("throttle(300) fires", f.tFires, "fire");
    }
  };

  /* ================= 14. PROMISE POOL ================= */
  function poolFrames() {
    // tasks (durations ms), limit 2 — simulated discrete-event execution of the page's pool
    const dur = [300, 100, 200, 250, 150, 100], TOTAL = 600;
    const lanes = [[], []]; let next = 0;
    const free = [0, 0]; // time each worker becomes free
    const F = [];
    const snap = (t, msg) => F.push({ t, lanes: lanes.map((l) => l.map((b) => ({ ...b }))), total: TOTAL, msg });
    snap(0, "6 task <b>factories</b>, limit 2 → spawn exactly 2 workers. Each worker: claim index synchronously, run, repeat.");
    // discrete-event sim of the two workers
    const evts = [];
    while (next < dur.length) {
      const w = free[0] <= free[1] ? 0 : 1;
      const start = free[w], i = next++;
      const end = start + dur[i];
      lanes[w].push({ i, start, end });
      evts.push({ t: start, msg: "t=" + start + ": worker " + (w + 1) + " claims task <b>T" + (i + 1) + "</b> (index " + i + " grabbed with next++ BEFORE the await) — runs " + dur[i] + "ms" });
      evts.push({ t: end, msg: "t=" + end + ": <b>T" + (i + 1) + " resolves</b> → results[" + i + "] written (original order preserved); worker " + (w + 1) + " loops for the next index" });
      free[w] = end;
    }
    evts.sort((a, b) => a.t - b.t);
    for (const e of evts) snap(e.t, e.msg);
    snap(TOTAL, "All 6 done at t=550. Sequential would take 1100ms; unlimited Promise.all would slam 6 requests at once. Pool = 2 in flight, always.");
    return F;
  }
  REG.pool = {
    scenarios: [{ label: "6 tasks, limit 2", gen: poolFrames }],
    draw(f) {
      const lane = (label, blocks) => row(label, '<div class="vlane">' +
        blocks.filter((b) => b.start <= f.t).map((b) => {
          const end = Math.min(b.end, f.t), w = (end - b.start) / f.total * 100;
          const cls = b.end <= f.t ? "done" : "run";
          return '<span class="vblk ' + cls + '" style="left:' + (b.start / f.total * 100) + "%;width:" + Math.max(w, 3) + '%">T' + (b.i + 1) + "</span>";
        }).join("") + '<span class="vnow" style="left:' + (f.t / f.total * 100) + '%"></span></div>');
      return lane("worker 1", f.lanes[0]) + lane("worker 2", f.lanes[1]);
    }
  };

  /* ================= 15. DEEP CLONE ================= */
  function cloneFrames() {
    // hand-scripted trace of deepClone({user:{name:"Ada"}, tags:["a","b"], self:<cycle>})
    const F = [];
    const f = (msg, cloneRepr, seen, hot) => F.push({ msg, cloneRepr, seen, hot });
    f("Input: <code>root = {user:{name:\"Ada\"}, tags:[\"a\",\"b\"], self: root}</code> — note the cycle.",
      "?", [], null);
    f("root is an object, not in seen → create the empty clone <b>{}</b> and register it in the WeakMap <b>BEFORE recursing</b> into children.",
      "{ }", ["root → clone·root"], "root");
    f("key <code>user</code>: object → recurse. Create {}, register it, copy the primitive <code>name</code> straight across.",
      '{ user: {name:"Ada"} }', ["root → clone·root", "user → clone·user"], "user");
    f("key <code>tags</code>: Array.isArray → create [], register, copy primitive elements.",
      '{ user: {name:"Ada"}, tags: ["a","b"] }', ["root → clone·root", "user → clone·user", "tags → clone·tags"], "tags");
    f("key <code>self</code>: seen.has(root) → <b>HIT</b> — reuse clone·root instead of recursing. Without the WeakMap this is infinite recursion → stack overflow.",
      '{ user: {…}, tags: […], self: ⟲clone·root }', ["root → clone·root ✓HIT", "user → clone·user", "tags → clone·tags"], "self");
    f("Done. The clone's <code>self</code> points at the <b>clone</b>, not the original — the cycle is faithfully reproduced. structuredClone() does all of this for you.",
      '{ user: {name:"Ada"}, tags: ["a","b"], self: ⟲ }', ["root → clone·root", "user → clone·user", "tags → clone·tags"], null);
    return F;
  }
  REG.clone = {
    scenarios: [{ label: "clone w/ cycle", gen: cloneFrames }],
    draw(f) {
      return row("clone under construction", '<pre class="vpre">' + esc(f.cloneRepr) + "</pre>") +
        row("seen (WeakMap: original → clone)", f.seen.length ? chips(f.seen, f.seen.findIndex((s) => s.includes("HIT")) >= 0 ? [f.seen.findIndex((s) => s.includes("HIT"))] : []) : '<span class="vempty">(empty)</span>');
    }
  };

  /* ================= 16. EVENT LOOP ================= */
  function elFrames() {
    const F = [];
    const f = (msg, stack, micro, macro, out, hot) => F.push({ msg, stack, micro, macro, out, hot });
    f("The script starts: one call stack, two queues. Rule: stack empties → drain ALL microtasks → then ONE macrotask.",
      ["main()"], [], [], [], null);
    f("<code>console.log(\"1: sync\")</code> — runs immediately on the stack.",
      ["main()"], [], [], ["1: sync"], "out");
    f("<code>setTimeout(cb, 0)</code> — cb goes to the <b>macrotask</b> queue. \"0ms\" means «not before the next loop turn», never «now».",
      ["main()"], [], ["timeout cb"], ["1: sync"], "macro");
    f("<code>Promise.resolve().then(cb)</code> — cb goes to the <b>microtask</b> queue.",
      ["main()"], ["then cb"], ["timeout cb"], ["1: sync"], "micro");
    f("<code>console.log(\"2: sync\")</code> — still synchronous. Both queued callbacks keep waiting.",
      ["main()"], ["then cb"], ["timeout cb"], ["1: sync", "2: sync"], "out");
    f("main() returns — stack is empty. Now drain the ENTIRE microtask queue first.",
      [], ["then cb"], ["timeout cb"], ["1: sync", "2: sync"], "micro");
    f("Microtask runs: <code>\"3: microtask\"</code>. If it queued more microtasks, they'd ALL run before any timer (that's how microtask chains starve rendering).",
      ["then cb"], [], ["timeout cb"], ["1: sync", "2: sync", "3: microtask"], "out");
    f("Microtasks empty → take ONE macrotask: the timer callback finally runs.",
      ["timeout cb"], [], [], ["1: sync", "2: sync", "3: microtask", "4: macrotask"], "out");
    f("Order: sync → all microtasks → one macrotask (→ repeat). Every <code>await</code> parks the rest of its function as a microtask continuation.",
      [], [], [], ["1: sync", "2: sync", "3: microtask", "4: macrotask"], null);
    return F;
  }
  REG.eventloop = {
    scenarios: [{ label: "classic snippet", gen: elFrames }],
    draw(f) {
      const col = (label, items, hot) => row(label + (hot ? " ◀" : ""), items.length ? chips(items, hot ? [items.length - 1] : []) : '<span class="vempty">(empty)</span>');
      return col("call stack", f.stack, false) +
        col("microtask queue", f.micro, f.hot === "micro") +
        col("macrotask queue", f.macro, f.hot === "macro") +
        col("console", f.out, f.hot === "out");
    }
  };

  /* SENTINEL:PART2 */

  /* ---------- engine (DOM) ---------- */
  if (typeof window !== "undefined") window.ALGO_VIZ = REG;
  if (typeof document === "undefined") return;

  function build(el, def) {
    let scen = 0, frames = def.scenarios[0].gen(), idx = 0, timer = null;
    el.innerHTML =
      '<div class="viz-head"><span class="viz-title">🎛 Step through</span>' +
      (def.scenarios.length > 1 ? def.scenarios.map((s, i) => '<button class="vbtn scen" data-s="' + i + '">' + esc(s.label) + "</button>").join("") : "") +
      '<button class="vbtn" data-a="reset" title="restart">⏮</button>' +
      '<button class="vbtn" data-a="prev" title="back">◀</button>' +
      '<button class="vbtn" data-a="next" title="step">▶</button>' +
      '<button class="vbtn" data-a="play">⏵ play</button>' +
      '<span class="viz-cnt"></span></div><div class="viz-stage"></div><div class="viz-msg"></div>';
    const stage = el.querySelector(".viz-stage"), msg = el.querySelector(".viz-msg"),
      cnt = el.querySelector(".viz-cnt"), playBtn = el.querySelector('[data-a="play"]');
    function stop() { if (timer) { clearInterval(timer); timer = null; playBtn.textContent = "⏵ play"; } }
    function render() {
      stage.innerHTML = def.draw(frames[idx]);
      msg.innerHTML = frames[idx].msg || "";
      cnt.textContent = (idx + 1) + " / " + frames.length;
      el.querySelectorAll(".scen").forEach((b, i) => b.classList.toggle("on", i === scen));
    }
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.s !== undefined) { scen = +b.dataset.s; frames = def.scenarios[scen].gen(); idx = 0; stop(); render(); return; }
      const a = b.dataset.a;
      if (a === "reset") { idx = 0; stop(); }
      if (a === "prev") { idx = Math.max(0, idx - 1); stop(); }
      if (a === "next") { idx = Math.min(frames.length - 1, idx + 1); stop(); }
      if (a === "play") {
        if (timer) stop();
        else {
          if (idx >= frames.length - 1) idx = 0;
          playBtn.textContent = "⏸ pause";
          timer = setInterval(() => { if (idx >= frames.length - 1) stop(); else { idx++; render(); } }, 1400);
        }
      }
      render();
    });
    render();
  }
  document.querySelectorAll("[data-viz]").forEach((el) => {
    const def = REG[el.dataset.viz];
    if (def) build(el, def);
  });
})();
