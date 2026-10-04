# Agent Note: story-bible M1 — host-only memory core, focus scope, and the brief budget

Status: implemented

## Problem

Long-form serial fiction breaks the "just inject everything" answer: a 100-chapter work cannot ride in the prompt, so the model forgets canon, loses the last chapter's ending, lets foreshadows die, and writes characters wrong. The proposal (`proposals/active/2026-10-04-story-bible.md`, deliberately gitignored) designs a work-level memory system — registry, per-work memory/character/foreshadow/chapter store, three tools, three brief variants, a pointer section and a skill — and slices it into four milestones. M1 has to ship the memory core and the injection surface in a way that stays useful before any UI exists, and it has to make three calls the proposal leaves to implementation: how much surface M1 carries, how the per-session focus map is keyed and read, and how the brief's token budget is enforced.

## Decision

### M1 is host-only by design

The package mounts the core row (store + the `story` Remote data face with the full M1 verb set) and the `./agent` row (three origin-tagged tools, the pointer function section, the `story` skill), and declares **no `dsh.client`**. The right-sidebar tabs are M3's, but they will consume exactly the Remote verbs mounted now — so M1 is not a throwaway: every store verb, the Remote face, the tools and the brief renderer are the final objects. The M1 acceptance loop (focus → brief → write → review → reconcile) is fully drivable through the tools alone, which is also how the specs exercise it.

### The store: deployment state, re-rooted fence, per-table max+1 ids

State lives at `$DSH_HOME/state/story/` (deployment-level, never a session workspace). Every write goes through the mounted `ctx.fs` with the CALLING session's resolved MODE and session id, but the writable boundary re-rooted at the plugin's own state dir — the canvas store's fence pattern, so a read-only deployment still denies. `work.json` carries **no counters** (the proposal sketches "元信息 + 计数器"): every id (`m<n>` / `c<n>` / `p<n>`, chapter `n`) allocates max+1 over the file that owns it inside the same version-guarded write, which makes id allocation atomic with the write that needs it and removes a whole class of counter-drift bugs. The two JSONL journals append by guarded read-concat-write with one stale retry — `ctx.fs` has no append verb, and bare `node:fs` is never used for state; a lost race retries instead of clobbering. 写作中 is not stored: the chapter phase derives from the manuscript file having content (the proposal's 阶段从事实派生); only 规划中 → 已审过 → 已抽取 are durable facts.

### The focus scope: one string key, two readers

The focus map is `Map<string, {workId, title}>` keyed by `String(session.id)`. Two readers hit it: the tools, which hold `exec.agent.session`, and the pointer function section, which reads `context.agent?.sessionId` off the assemble context. Both stringify the same branded id, so the map needs one key shape. The map is process-lifetime on purpose — a restart means "nothing focused", which the tools answer with guidance text and the pointer answers with `''`. The title rides the map entry (captured at focus time) because the pointer is synchronous by the host's section contract and can never touch the filesystem. The pointer's degrade paths — no agent on the assemble context, no sessionId, no focus, even a throwing map — all render `''`; a guidance line must never fail a prompt assembly. For M1 without UI, `story_write(what=work, title)` is the focus entrance (existing title focuses, otherwise create+focus); the Remote `focusWork` is the same door the M3 tab will use.

### The brief budget: estimated tokens, deterministic tightening, honest 从略

The renderer is pure and synchronous over a `BriefData` the store gathers asynchronously (the pointer contract is why: a function section can never await). Budgets are proposal-fixed (write ~2k / plan ~2.5k estimated tokens; extract rides the chapter body unbudgeted). Estimation counts one CJK character as one token and ASCII at 4 chars/token — rough, stable, and good enough for a guard rail. A render first uses the comfortable caps (write: topK 8 foreshadows, 10 recaps, 3 experience entries per character; plan: 20 ledger rows, 5 recaps); when the estimate overshoots, it re-renders with tight caps and appends a 从略 footnote naming what was elided and where to fetch it (`story_read`), so the budget is a rule with a receipt rather than a silent truncation. The iron rule holds in every variant: never all chapters, never the whole foreshadow history, and ghost drafts (intent `draft`) never leak — the seed specs pin all three.

### The import gates stay in plugin code

`story_extract` prepare assembles the CP0 C-variant pack (instructions → full chapter body → plan → active ledger with ids → roster with ids → output schema); delegation to the host-native subagent is the main agent's own job, so a preset without the subagent tool degrades to the main agent running both phases with the gates unchanged. Import trusts no model: evidence must grep in the manuscript (exact, then whitespace-tolerant — line wraps are not fabrication), foreshadow ids must sit in the active-ledger whitelist re-derived at import time, new_* always pends, high lands reviewed with the 自动·可撤销 flag (retract archives it), medium/low pends, and plan verification is computed from the recorded mentions — a planned op with no touch pends as 计划落空 (「忘了还是改主意」是人答的题), while journal mentions carry `planned`/`reconciled` flags. Plan verification reads only what the import itself recorded, so a subagent that under-reports mentions produces a false positive for a human, never a silent drop.

## Alternatives considered

**Ship a minimal information page as the M1 client.** The proposal allows "无 UI 或最小信息页". A browser half would add the client bundle, locale files, the `dsh.client` declaration and a slot registration — all of which M3 replaces wholesale with the two real tabs. The Remote face mounted now is the actual M3 contract, so skipping the placeholder costs nothing and removes a rewrite.

**A `writing` chapter phase stored durably.** It would need a verb to set and clear it, and it can lie (an abandoned draft reads 写作中 forever). Deriving it from the manuscript file's existence is the proposal's own rule (阶段从事实派生) and can never disagree with reality.

**Counters in `work.json` for id allocation.** Two-file atomicity would be required to keep a counter and its table in step, and `ctx.fs` guards one file per write. Max+1 over the owning table inside the same guarded write is strictly safer; the counter file buys nothing at this scale.

**JSONL append via bare `node:fs`.** One syscall cheaper, and it leaves the fence: the sandbox policy would never see the write, the observation trail would miss it, and a read-only deployment could not refuse it. The guarded read-concat-write keeps every byte inside the same fence as the JSON documents.

**Async brief rendering inside the pointer section.** The host's function-section contract is synchronous, so the pointer reads only the in-memory focus map; the full brief never auto-injects at all (skill 与 brief 分离 — the model fetches it with `story_read`). This is also why `BriefData` gathering lives in the store (async) and rendering in `brief.ts` (sync, pure, snapshot-testable).

**Trust the subagent's `plan_results` for gate 5.** The subagent judges from the same mentions the import records, so its verdict adds nothing the code cannot compute — and trusting it would move a gate from plugin code into model output, which the proposal forbids (落库校验永远在插件服务代码里). The schema keeps `plan_results` as narration; the verdict is computed.

## Consequences

- M1 is fully usable headless: the specs drive the whole journey (focus → ghost card → plan → write brief → review → prepare → import → pending decisions) through the tools, and the CP1 fixture renders all three brief variants off the《梦境监护者》seed for copy review.
- The Remote verb set is frozen as the M3 UI's contract; changing a verb later is a wire change, not an internal refactor.
- The focus map dies with the process. If a deployment ever needs focus to survive restarts, the map needs a persisted twin — deliberately deferred, since the cost of re-focusing is one tool call.
- Token estimation is a heuristic, not a tokenizer; the budgets are guard rails with a 从略 receipt, and the seed specs pin the three variants under budget so regressions fail loudly.
- `story_read(what=works)` extends the proposal's `what` list by one row — the model otherwise has no way to discover focusable works in the UI-less M1. It is additive and documented in the README.
- `scripts/gen-typert.mts`'s `TYPERT_PACKAGES` gained the story-bible entry (the registry every `./typert` package joins), and `docs/packages.md` was regenerated — the two repo-level registrations a new package cannot avoid.

## Related

- Superseded by [canvas-novel engine](2026-10-04-canvas-novel-engine.md): the package is now `@khorsheed/dsh-canvas-novel`, the genre 长篇小说 on the canvas.
