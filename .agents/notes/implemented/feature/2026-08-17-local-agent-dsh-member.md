# Agent Note: dsh as a local-agent family member — the engine itself as a delegation target

Status: implemented

English | [中文](2026-08-17-local-agent-dsh-member.zh.md)

## Problem

The `@khorsheed/dsh-local-agent` family (kimi / codex / claude-code) lacks a member for the engine itself: delegating dsh as a local CLI target. The dsh member shares the same shape as the other three (scoped home, session records, delegation provider, resume) and reuses the parent instance's existing `DEEPSEEK_API_KEY` — no new login flow. The settings section (Settings → a DeepSeek page next to 本地 Agent) provides a mutually exclusive toggle: **OFF (default) → only the official in-process subagent is registered; the dsh harness/provider/tool are not mounted at all**; **ON → additionally registers `subagent_dsh` (external process form) alongside the official in-process tool**. The exclusivity is about "whether dsh is registered", not "how many tools": when ON, the model sees both the official subagent (in-process, continuable) and `subagent_dsh` (separate CLI process) with different semantics — the family tool description states "separate process, its own scoped home" so the model can tell them apart.

## Decision

### 1. Child headless bundle: `@khorsheed/dsh-local-agent-dsh-headless`

Sibling bundle of the official headless: the patch overlays `dsh-base` (system-prompt/hmr/tools/code-runtime rows identical to the official one) and inserts the family startup + runner rows.

- **Session id is caller-supplied, never parsed from stdout** (review fix ①): the first round runs `dsh --profile headless-local-agent-dsh --session-id <uuid> "<task>"`; the runner passes that uuid to `agents.create({ sessionId })`; resume `--resume <uuid>` goes through the public `ctx.agents.resume({ resumeSessionId })` (the same path as official continuation cold resume). stdout stays clean — no separator prefix, and an answer that merely looks like an id is never misparsed.
- startup parses `--session-id`/`--resume` (mutually exclusive) plus the task positional with commander; **commander names `--resume`'s attributeName `resume` (not camelCase), so the mapping to the service field must convert it explicitly** (`--session-id` auto-becomes `sessionId` — asymmetric, a real pitfall hit in testing).
- The rest mirrors the official runner: `loader.await` → `agents.create`/`resume` → `whenIdle` → `followup` → `whenIdle` → `sessions.flush` → summarize → print → `io.exit(0|1)`. `installModelSelection` registers two waterfall listeners and returns a disposer (rc.7); setup only calls it without returning — no explicit dispose is needed within the process lifetime.
- The session id and the `session-` prefix match the parent-side format; child dsh sessions land in their own scoped-home store.

### 2. Child profile provisioning (zero pnpm install)

The child dsh's `$DSH_HOME` is the harness scoped home (`$DSH_HOME/local-agent/dsh`), so its profile directory must live under the scoped home (`profiles/headless-local-agent-dsh`). Provisioning does exactly four things:

- writes `package.json`: `bundles = ["@deepseek-ai/dsh-base", "@khorsheed/dsh-local-agent-dsh-headless"]`;
- writes an empty user-layer `cordis.patch.yml` (`[]`);
- one symlink: `node_modules/@khorsheed/dsh-local-agent-dsh-headless` → the family bundle directory (resolved from the installation via `createRequire(import.meta.url).resolve(.../package.json)`; `headlessBundleDir` config can override);
- everything else (dsh-base and its whole dependency graph, cordis, the healed `profiles/node_modules` fallback) is auto-resolved by boot from the dsh install anchor — `healProfilesModuleFallback` runs before `loadProfile`, and dsh-base is a direct dependency of the CLI app so it is necessarily healed.

Idempotent: an existing manifest/patch is never overwritten; the symlink is replaced only when it points at the wrong target (a real directory throws). The call is synchronous, before the first delegation, with no async waits.

### 3. Parent-side `@khorsheed/dsh-local-agent-dsh`: toggle controller + `dsh-cli` provider

- **Controller** (the patch inserts a single `local-agent-dsh` row): registers the settings namespace `local-agent-dsh` (`{enabled: boolean}`, default **false**); `sync(enabled)` on ON registers the `dsh` harness + `DshCliProvider` + dynamically `ctx.plugin`-mounts the family tool (`subagent_dsh`, config provider `dsh-cli`); OFF disposes everything. A settings `watch` flips registration in real time; a **generation counter** keeps an in-flight tool mount from pushing dispose onto an already-dead disposer list after a flip/unmount.
- **harness**: `name: 'dsh'`, `homeEnvVar: 'DSH_HOME'`, `delegationProvider: 'dsh-cli'`, **no login** (review fix: `LocalAgentHarness.login` becomes optional; `/dsh login` answers "无 device-code 登录，经宿主凭据认证" — see the core change below), `isAuthenticated` = whether `credentials.resolve(credentialRef(apiKeyRef))` yields a value, records read the child dsh's own session store.
- **provider** (`dsh-cli`): the fresh round sets `runId = SessionId(randomUUID())`, creates the parent-side childSession (descriptor + turn marker), **records the delegation first** (childSessionId == cliSessionId, an identity mapping requiring no stdout parsing), spawns `[launch, '--profile', profileName, '--session-id', runId, task]`; the resume round does `resolveDelegation` + `acquireResumeLock` + child-session reuse + spawn `--resume <id>`. The spawn spec's **env explicitly contains `DSH_HOME: <scoped home>` and `DEEPSEEK_API_KEY: <resolved>`** (review fix ③: the subprocess seam's scrub strips `DEEPSEEK_API_KEY` (matches `SENSITIVE_ENV_PATTERN`) and every `DSH_*`; an explicit env layer merged after the scrub is the only passing path; without `DSH_HOME`, child dsh would fall to the default `~/.dsh` and write sessions into the parent instance's store).
- **launch copy**: default `[process.execPath, ...process.execArgv, process.argv[1] ?? 'dsh']` — the child dsh runs the same node + tsx + bin.ts as the parent instance; `cliLaunch` config can override the whole array. **Deployment pitfall**: schemastery parses a missing `z.array(...)` field inside `z.object` as `[]` (not `undefined`), and the empty array was treated as "override to no prefix", swallowing launch — spawn started with a bare `--profile` and hit ENOENT; `dshLaunchArgv` must treat an empty array as no override (only `length > 0` applies), with a regression test.
- Settlement follows the family abort-branch pattern (requestCancel settles immediately, dispose kills); exit-0 with no output → error; no credentials → fail loud before spawn.
- **dsh does no transcript mirror**: the full conversation lives in the child dsh's own store (the records adapter can list it); the parent-side childSession carries only the descriptor + turn markers + final answer, avoiding duplicate records.

### 4. Settings toggle UI

The `local-agent-dsh` package ships a client (`dsh.client` row; the `clientBundle` artifact carries the `window.__ModuleLoader__.load` header): `ctx.settingsScope.bind({namespace: 'local-agent-dsh'})` binds the scope and puts the toggle **into the action area of the dsh harness row on the 本地 Agent page** — the core settings section offers a provider-neutral, per-harness-filtered action slot `local-agent.settings.row-action` (`renderSlot(..., { only: harness.id })`; it only renders, it does not know the concrete harness), and the dsh client contributes a mutually exclusive switch button (`id='dsh'`, `role="switch"`, writes `scope.set('enabled', …)`; disabled when the namespace is unavailable) via `slots.inject`. The separate tab and the card below the row are removed. The host watcher receives the write and flips registration in real time — **the toggle is the composition**. The row button does not reuse 重新授权/退出登录: those are authentication actions (device-code/logout) and dsh has no login flow — reusing them would lie semantically and mix two state machines ("credential state" and "registration state") into one row.

## Core changes (three review fixes)

- `LocalAgentHarness.login` becomes optional; `handle()` answers "无 device-code 登录流程" for harnesses without login; `runLogin` explicitly receives the login call.
- Fact fix: the official base ships in-process subagent tools (`tool-subagent` spawn/continuable, `tool-subagent-fork`, `tool-subagent-control`, `tool-subagent-list-agents`) — the safety boundary is that **base does not contain the local-agent family** (process recursion dsh→dsh→dsh only appears with the family bundle); base stays untouched by default and the child profile reuses the official base composition.
- `DSH_HOME` and `DEEPSEEK_API_KEY` are explicitly injected into `spec.env`.

## Alternatives considered

### Why not always-on registration (no toggle)?

Always registering the dsh member would blur the base boundary: the official base's safety property is that it contains the in-process subagent tools but **not** the local-agent family, so recursion (dsh→dsh→dsh) cannot arise without the family bundle. It would also silently mix two tool semantics (in-process continuable vs separate CLI process). The mutually exclusive toggle keeps base untouched by default and makes the registration explicit.

### Why not reuse the official headless runner?

The official headless has no caller-supplied session id — the id is derived from the run; the family needs the parent-chosen uuid (identity mapping, no stdout parsing) plus the family startup/runner rows. Parsing the session id out of stdout was rejected (review fix ①) as fragile — an answer that looks like an id would be misparsed.

### Why not inherit the parent environment?

The subprocess seam's scrub strips `DEEPSEEK_API_KEY` and every `DSH_*` from the inherited environment, so the child would run credential-less and, without `DSH_HOME`, fall to the default `~/.dsh` and pollute the parent instance's store. An explicit env layer merged after the scrub is the only reliable path (review fix ③).

### Why not a device-code login flow for dsh?

The dsh member reuses the parent's resolved `DEEPSEEK_API_KEY`; a login flow would add surface for no gain and would entangle the "credential state" machine with the "registration state" machine. The row action area therefore hosts only the registration toggle; auth actions stay harness-specific.

## Consequences

- dsh joins the family at zero install cost: the child profile is provisioned with four files/symlink and boot resolves the rest from the install anchor; the toggle is the entire composition surface.
- Safety boundary held: base composition is untouched; the family headless profile never joins the local-agent family bundle; recursion appears only when the user explicitly turns the member on.
- No double bookkeeping: dsh does no transcript mirror — the child's store is the record of truth, and the parent-side childSession keeps only descriptor + turns + final answer.
- The delegation mapping stays in memory (same limitation as kimi/codex); persistence after parent restart is owned by the codex persistence proposal.

## Testing

- **Child dsh runner live nonce** (manual verification before writing the provider, passed on the first try): `dsh --profile headless-local-agent-dsh --session-id <uuid> "记住口令 1739"` creates a session and remembers it; `--resume <uuid> "刚才的口令是什么"` answers **1739** in the same child dsh session; child dsh sessions land in the scratch scoped home's `sessions/`, never touching the parent instance store.
- Unit tests: headless bundle, 19 cases (startup session-id/resume/mutual exclusion/help; runner creates with the caller id, resume via `factory.resume`, falls back to generation when no id, flush before exit, abort/error/missing appExit); `local-agent-dsh`, 24 cases (controller OFF = zero registration / ON registers harness+provider+tool / watch flip; provider fresh argv/env/identity record; resume `--resume`/lock/turn 2; missing credentials fail loud; missing cwd; exit-0 no output → error; abort settles immediately; records read the zstd header; provision idempotent/symlink repair/install resolution; client switch read/write/disabled when unavailable).
- `pnpm typecheck` green; family `pnpm test` green; `verify-translation-pairing` 39 pairs in sync.

## Deferred

- Delegation-mapping persistence (resume after a parent restart) — same limitation as kimi/codex (delegations live in memory); owned by milestone M4 of the [local-agent delegation API proposal](../../../proposals/active/2026-08-18-local-agent-delegation-api.md).
