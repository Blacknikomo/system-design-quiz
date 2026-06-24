# AGENTS.md — Interactive System-Design Study Service

Guide for AI agents (and humans) extending this service. Read this before adding questions, simulators, or features. It documents the architecture, data schemas, conventions, step-by-step extension recipes, validation, and git workflow.

> **Purpose of the service:** help a candidate prepare for FAANG Engineering-Manager / Staff system-design interviews. Two pillars: a **self-test quiz** and **interactive simulators** that visualize how key technologies work internally. Content is grounded in HelloInterview's *System Design in a Hurry*.

---

## 1. Repository layout

This git repo is rooted at `interactive/`. Branch: `main`. Remote: `github.com:Blacknikomo/system-design-quiz`.

```
interactive/
├── AGENTS.md            # this file
├── .gitignore           # ignores .DS_Store, _patches/
├── index.html           # hub: links every simulator + the quiz
├── style.css            # SHARED theme + visual primitives (all pages link it)
├── system-design-quiz.html   # the quiz (single self-contained file)
├── redis.html           # 9 technology simulators, one file each:
├── kafka.html
├── elasticsearch.html
├── cassandra.html
├── dynamodb.html
├── postgres.html
├── flink.html
├── zookeeper.html
└── api-gateway.html
```

Related, **outside this repo** (in the parent `FAANG Interviews/` folder):
- `hi-knowledge/` — distilled HelloInterview notes (`core-concepts.md`, `key-technologies.md`, `patterns.md`, `question-breakdowns.md`, `README.md`). The quiz content is derived from these. Keep notes and quiz in sync.
- `system-design-tracker.md` — the candidate's diagnostic + gap list.

---

## 2. Global conventions (apply to every file)

- **Self-contained, vanilla, offline.** Each page is plain HTML + CSS + vanilla JS. No build step, no frameworks, no external libraries, no network calls. A page must work by double-clicking it (over `file://`).
- **No external CDNs.** Do not add script/style `src` to remote hosts.
- **Theming via `style.css`.** Every page links `<link rel="stylesheet" href="style.css">` and uses the shared CSS variables/classes (see §5). Do **not** redefine the theme inline; small page-specific layout tweaks in a tiny `<style>` are acceptable only when necessary.
- **Dark theme tokens** live in `:root` of `style.css` (`--bg --panel --accent --ok --bad --warn ...`). Use the variables, never hard-coded hex (except inside `style.css`).
- **`localStorage` is allowed here** (these are real local files, not sandboxed artifacts). The quiz uses it for history. Migrate old shapes defensively.
- **Accuracy over everything.** This is interview-prep material. A wrong "correct" answer or an accidentally-true distractor is worse than a dull one. When unsure of a fact, verify against `hi-knowledge/` or HelloInterview before writing.

---

## 3. The quiz — architecture (`system-design-quiz.html`)

A single file. All logic in one `<script>`. Sections, in order: question bank → `SOURCES` map + helpers → storage → setup view → quiz engine → results → stats → view routing.

### 3.1 Question object schema

The bank is `const QUESTIONS = [ ... ]`. Every question is one object:

```js
{
  id:"q12db",            // STABLE short id (see §3.2). Shown in UI for debugging.
  topic:"Redis",         // grouping; must have a SOURCES entry (§3.3)
  diff:"basic"|"tricky", // difficulty
  level:"Mid"|"Senior"|"Staff",  // seniority at which the answer is expected
  type:"single"|"multi", // single = one correct; multi = select-all
  q:"...",               // question text
  options:["...", ...],  // 2–5 options, plain text
  correct:[1],           // indices into options (one for single; >=2 for multi)
  why:"...",             // concise explanation shown after answering
  more:"...",            // OPTIONAL: extra paragraph of depth
  accept:"...",          // OPTIONAL: names a defensible-but-inferior option and why the chosen one is ideal
  src:"https://..."      // OPTIONAL: specific HelloInterview URL; else falls back to SOURCES[topic]
}
```

Field invariants (enforced by validation, §7):
- `correct` indices in range; no duplicates.
- `type:"single"` ⇒ exactly one correct. `type:"multi"` ⇒ ≥2 correct.
- `diff` ∈ {basic, tricky} only. `level` ∈ {Mid, Senior, Staff}. (Historic bug: never use `diff:"single"`.)
- `id` unique across the bank.
- Options unique within a question.

### 3.2 IDs

IDs are a short stable hash of the question text (djb2 → base36, prefixed `q`, with a numeric suffix on collision). They are stable across reordering, so reference questions by id (e.g. "fix `#qhggv`"). When adding a question by hand you may assign any unique `q....` id; or regenerate all with the snippet in §7.

### 3.3 Sources (HelloInterview links)

`const SOURCES = { topic: url, ... }` maps **every topic** to its HelloInterview page (`B` is the base URL). `sourceFor(q)` returns `q.src || SOURCES[q.topic] || <intro>`. `sourceLabel(url)` derives a readable label from the path (e.g. `HelloInterview · Key Technology: Redis`).

**Rule:** if you add a new `topic`, you MUST add a `SOURCES[topic]` entry. Validation flags any topic without one.

### 3.4 Storage schema (`localStorage["sdq_history_v1"]`)

```js
{
  topics: { [topic]: {correct, total} },
  sessions: [ {date, correct, total, topics:[...]} ],   // recent first, capped 50
  levels:  { [level]: {correct, total} },                // per seniority
  missed:  { [id]: {id, topic, level, question, misses, lastMissed, recoveredAt?} }
}
```
`recordAnswer(q, correct)` updates topics + levels + missed. `defaultStore()` defines the shape; on load, missing `levels`/`missed` are migrated in. **If you change this shape, add a migration**, don't break existing saved history.

### 3.5 Weak-topics export (`sd-quiz-weak-analysis/v1`)

`buildWeakAnalysis()` → object downloaded by the Export button. Consumers (other agents) use it to generate targeted questions. Shape: `{schema, exportedAt, summary, weakTopics[], untestedTopics[], byLevel, byTopic[], missedQuestions[], note}`. `weak` = accuracy < 0.6 over ≥3 attempts (`isWeak`). Each weak topic and missed question carries its HelloInterview `source`. **If you extend the export, bump the schema version.**

### 3.6 Rendering & filters

- Setup: topic chips (`selectedTopics`), `diffSel`, `levelSel`, `lenSel`, shuffle. `matchingPool()` = questions whose topic is selected AND match diff AND match level.
- Per-question option order is shuffled at session start into `_opts`/`_correct` (originals untouched).
- Feedback after answering shows: `why` → `accept` (gold "Also defensible") → `more` → `📖 Source` link.
- Weak topics (⚠, red) surface in the chips and the Stats bars.

---

## 4. Answer-option quality bar (READ THIS before writing options)

The most important content rule. Past bug: correct answers were long+detailed while distractors were short throwaways, so the answer was guessable by length/elimination.

When writing or editing options:
1. **All options comparable in length & specificity.** The correct one must NOT be the longest "tell" — keep every option within ~±30% length of the others.
2. **Distractors must be believable** — common misconceptions, adjacent-but-wrong tech, or real-but-inferior approaches. No filler ("do it twice", "it doesn't matter", "shut down the service").
3. **The learner should have to think.** No obviously-silly option.
4. **Never make a distractor accidentally true.**
5. Rare case: a distractor is genuinely defensible-but-inferior → keep one best `correct` and add an `accept` note explaining the ideal. Only use multiple `correct` when the question is truly `type:"multi"`.

A length-balance metric (§7) flags questions where the correct option is the longest by a wide margin or where ≥2 distractors are very short. Keep the flagged count low.

---

## 5. The simulators — shared design contract

Every `<tech>.html` follows the same skeleton so they look and behave consistently. Mirror an existing one (e.g. `redis.html` is the reference implementation; `cassandra.html` is the most feature-rich).

### 5.1 Page structure

```html
<div class="wrap">
  <div class="topbar"><div>
    <div class="back"><a href="index.html">← All technologies</a></div>
    <h1>ICON Name — short subtitle</h1>
    <div class="sub">one-line intro</div>
  </div></div>

  <div class="card"> <!-- description -->
    tags (.tag / .tag.accent), a short paragraph, and a callout (.note.info|.warn|.gotcha)
  </div>

  <div class="card"><h3>controls</h3> inputs (label.fld>input) + buttons (.btn variants) </div>

  <div class="card">
    <div class="stage" id="stage"><div class="nodes" id="nodes"></div></div>
    <div class="explain" id="explain">what just happened / why</div>
  </div>

  <div class="cols">
    <div class="card"><h3>Log</h3><div class="log" id="log"></div></div>
    <div class="card"><h3>What you're seeing</h3><ol class="steps small"><li>…</li></ol></div>
  </div>
</div>
```

### 5.2 Required JS helpers (define before wiring buttons; call `reset()` on load)

- `logLine(cls, msg)` — append a line to `#log` (`cls` ∈ ok/err/warn/info/cmd/t).
- `explain(html)` — set the `#explain` box (the "why").
- `fly(fromEl, toEl, label, cls)` — animate an absolutely-positioned `.packet` between two nodes inside `#stage` using `getBoundingClientRect` (see `redis.html`). Use for moving data/requests.
- `reset()` — rebuild model + render. Wire a **Reset** button.
- Keep model state in plain JS objects; re-render from state (don't mutate DOM ad hoc).

### 5.3 CSS vocabulary available in `style.css` (reuse, don't restyle)

Layout: `.wrap .topbar .back .card .row .cols .fld .pill .small .muted`
Buttons: `.btn` + `.sec .ghost .warn .bad`
Tags/notes: `.tag(.accent/.topic/.tricky/.lvl-Mid/.lvl-Senior/.lvl-Staff)` · `.note(.info/.warn/.gotcha)`
Stage: `.stage .nodes .node(.primary/.replica/.active/.dead/.flash-ok/.flash-bad)` · `.node .title` · `.badge` · `.kv(.new/.stale)` · `.kv .k` · `.packet(.repl/.read/.bad)`
Log/feedback/steps: `.log(.l/.t/.ok/.err/.warn/.info/.cmd)` · `.explain` · `.steps li(.done/.current)`

### 5.4 Content bar

Each simulator must (a) describe the technology, (b) let the user run its typical operations step-by-step, and (c) **visualize the signature internal mechanic** and call out the signature gotcha in a `.note.gotcha`. Examples already built: Redis async replication + stale reads + failover data loss; Kafka partitions/offsets/consumer-groups/replay; Cassandra ring + QUORUM + LSM write path; DynamoDB partitions + eventual-vs-strong + GSI; Flink tumbling windows + watermarks; ZooKeeper znodes + ephemeral leader election; etc.

---

## 6. Extension recipes

### 6.1 Add quiz questions
1. Pick/confirm the `topic`. If new, add a `SOURCES[topic]` entry pointing to the right HelloInterview page.
2. Write each object with the full schema (§3.1). Follow the option-quality bar (§4). Set `level` (heuristic: foundational → Mid, trade-off/gotcha → Senior, staff-signal concepts like fencing tokens / Lambda architecture / virtual waiting queue / OT-vs-CRDT / saga countermeasures → Staff). Add `src` if a more specific page than the topic default fits. Add `more` for depth; `accept` where a distractor is defensible.
3. Give each a unique `id` (or run the regeneration snippet, §7).
4. Run validation (§7). Keep the length-balance flag count low.
5. Mirror the new knowledge into `hi-knowledge/` if it introduces a concept.

### 6.2 Add a simulator
1. Copy `redis.html` as a starting template; rename, update title/subtitle/intro.
2. Implement the model + operations following the contract (§5). Reuse the shared classes and helpers.
3. Add a card to `index.html` (`<a class="hub-card" href="<file>.html">…</a>`).
4. Validate JS (§7) and click through every button.

### 6.3 Add a feature to the quiz
Keep it in the single file, vanilla JS. If it persists data, extend the storage schema **with a migration** (§3.4) and bump the export schema if relevant (§3.5).

---

## 7. Validation (run before committing)

All checks are runnable from a shell with Node. Extract the page's script and syntax-check it:

```bash
node -e 'const fs=require("fs");const h=fs.readFileSync("system-design-quiz.html","utf8");
const s=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join("\n;\n");
fs.writeFileSync("/tmp/q.js",s);' && node --check /tmp/q.js
```

Question-bank integrity + length-balance metric:

```bash
node -e 'const fs=require("fs");let h=fs.readFileSync("system-design-quiz.html","utf8");
const m=h.match(/const QUESTIONS = (\[[\s\S]*?\n\];)/);let arr;eval("arr="+m[1].replace(/;$/,""));
const keys=new Set([...h.match(/const SOURCES = \{([\s\S]*?)\n\};/)[1].matchAll(/"([^"]+)":B\+/g)].map(x=>x[1]));
let errs=0,seen=new Set();
arr.forEach(q=>{
  if(!q.id||!q.topic||!q.q||!q.options||!q.correct||!q.why)errs++;
  if(!["basic","tricky"].includes(q.diff))errs++;
  if(!["Mid","Senior","Staff"].includes(q.level))errs++;
  q.correct.forEach(c=>{if(c<0||c>=q.options.length)errs++;});
  if(q.type==="single"&&q.correct.length!==1)errs++;
  if(q.type==="multi"&&q.correct.length<2)errs++;
  if(new Set(q.options).size!==q.options.length)errs++;
  if(seen.has(q.id))errs++; seen.add(q.id);
  if(!keys.has(q.topic))errs++;            // every topic needs a SOURCES entry
});
// length-balance: flag guessable single-answer questions
let flagged=0;
arr.filter(q=>q.type==="single").forEach(q=>{const L=q.options.map(o=>o.length);const cl=L[q.correct[0]];
  const d=L.filter((_,i)=>!q.correct.includes(i));const avg=d.reduce((a,b)=>a+b,0)/d.length;
  if((cl>Math.max(...d)&&cl/avg>=1.5)||d.filter(x=>x<28).length>=2)flagged++;});
console.log("questions:",arr.length,"| errors:",errs,"| guessable-by-length:",flagged);'
```

Targets: `errors: 0`, `guessable-by-length` as low as practical (legitimate enumerations like L4-vs-L7 may remain). For simulators, just run the `node --check` step. Always also click through the UI for behavioral bugs.

Regenerate all IDs (if needed):
```bash
# djb2 base36 of the first 80 chars of the question text, prefixed "q", deduped
```
(See git history of `system-design-quiz.html` for the exact one-off script; IDs are otherwise stable.)

---

## 8. Bulk-edit pattern (for large content passes)

When changing many questions at once (e.g. rebalancing options, adding a field):
1. **Export** the bank to JSON slices, split across parallel workers/subagents.
2. Each worker returns patches **keyed by `id`** (never by array index) — e.g. `{id, options, correct, why, more?, accept?}`.
3. **Merge by id**: `eval` the array, apply patches by id, then **re-serialize the whole array** to clean JS with a small serializer (escape `\` and `"`, collapse newlines). This avoids fragile in-place string surgery.
4. Re-run validation (§7) and spot-check a sample for preserved correctness.

Temp files for this go in `_patches/` (git-ignored).

---

## 9. Git workflow

- Repo root: `interactive/`. Branch: `main`. Remote: `origin git@github.com:Blacknikomo/system-design-quiz.git` (SSH).
- **Agents in a sandbox can commit but CANNOT push** (the SSH key lives on the owner's machine). Make the commit(s); the owner runs `git push origin main`.
- **Commit messages:** Conventional Commits style with a detailed body. Prefixes: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`. Explain *what and why*, list notable changes. Examples in `git log`.
- Make **logically-scoped commits** (don't mix a cleanup with a feature — stage selectively).
- Never commit `_patches/` or `.DS_Store` (already git-ignored).
- `hi-knowledge/` is **outside** this repo today; if you want it versioned, raise it with the owner before re-rooting.

---

## 10. How this service was built (process history)

1. **Research first.** Read HelloInterview *System Design in a Hurry* (Core Concepts, Key Technologies, Patterns) and 12 Question Breakdowns via a logged-in browser; distilled them into `hi-knowledge/` notes — facts before format.
2. **Quiz** built from the notes: started ~60 Qs, grew to 262 across ~50 topics (core concepts, key-tech deep dives, patterns, breakdowns, architecture/decomposition). Added seniority levels, stable IDs, per-answer source links, and the "which subsystems are required" decomposition style.
3. **Simulators**: defined a shared `style.css` design system + page contract, built `redis.html` as the reference, then the other 8 via parallel subagents following the contract.
4. **Quality passes**: rebalanced answer options bank-wide (§4) using the bulk-edit pattern (§8); added the weak-topics export (§3.5) to drive future targeted question generation.
5. **Validation** at every step (§7); **git** with scoped, detailed commits (§9).

**Guiding principles:** research before building; one self-contained file per page; shared theme; technical accuracy is non-negotiable; reference questions/state by stable id; keep `hi-knowledge/` notes and the quiz in sync.
