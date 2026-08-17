# Agent Note: local-agent 家族新增 dsh 成员（local-agent-dsh）

Status: proposed

English | [中文](2026-08-17-local-agent-dsh-member.zh.md)

## Problem

The `@khorsheed/dsh-local-agent` family (kimi / codex / claude-code) lacks a member for the harness's own engine: delegating to dsh itself as a local CLI. A dsh member gives the same shape as the other three (scoped home, session records, delegation provider, resume) while reusing the parent instance's existing `DEEPSEEK_API_KEY` — no new login flow. The browser settings section (Settings → 本地 Agent) needs a mutually-exclusive DeepSeek switch: ON registers the dsh provider and delegation tool (external process, own `$DSH_HOME`, specifiable cwd, resume across restarts); OFF does not register, and delegation keeps using the official in-process subagent (current behavior). Mutual exclusion avoids showing the model two overlapping delegation tools.

## Proposal

### 1. Family headless runner with resume (replaces the official runner row)

The official `@deepseek-ai/dsh-headless` bundle's runner is a patch-inserted plugin (`- id: headless-runner / name: '@deepseek-ai/dsh-headless'`, config: `task`). A family headless profile reuses the official dsh-base composition but **disables the official runner row and inserts a family runner**, the same patch-replacement mechanism the family already uses for tool-subagent rows. The family runner mirrors the official logic (`agents.create` + `followup` + summarize + io.exit) with two changes:

- **Session id is provider-supplied, never parsed from stdout**: first round runs `dsh --profile <family-headless> --session-id <uuid> "<task>"` and the runner passes that uuid to `agents.create({ sessionId, ... })`; resume runs `dsh --profile <family-headless> --resume <uuid> "<task>"` and the runner calls `ctx.agents.resume({ resumeSessionId, agentOptions, setup })` (a public API, already used by the official continuation cold-resume path). Official headless stdout stays format-pure — no delimiter prefix, no false-positive parsing of a task answer that happens to contain an id-like string. This is cleaner than kimi/claude/codex, which all recover their session id from output streams.
- **cwd is specifiable**: the official runner uses `process.cwd()`; the family runner inherits the provider's spawn cwd.

### 2. `local-agent-dsh` harness + `dsh-cli` provider

- Harness `name: 'dsh'`, scoped home `$DSH_HOME/local-agent/dsh` (the sub-dsh's own `DSH_HOME`, where its session store lives — durable across restarts). Records read the sub-dsh session store. `delegationProvider: 'dsh-cli'`.
- No login UI/device-code: `isAuthenticated` = whether `ctx.credentials.resolve(credentialRef('DEEPSEEK_API_KEY'))` yields a value; `login` omitted.
- Provider spawns `dsh --profile <family-headless> [--session-id <uuid> | --resume <uuid>] "<task>"` with `spec.env` explicitly containing **both**:
  - `DEEPSEEK_API_KEY` (resolved from `ctx.credentials`; `scrubbedParentEnv` removes it because it matches `SENSITIVE_ENV_PATTERN`, and explicit env layers merge after the scrub),
  - `DSH_HOME=<parent $DSH_HOME>/local-agent/dsh` (the scrub removes all `DSH_*` names; without the explicit injection the sub-dsh would default to `~/.dsh` and write sessions into the parent instance's store — silently mixing sub-dsh sessions into the parent's session list).
- Spawn cwd = parent session cwd.
- Resume uses the existing family resume mechanism (intent FIFO, per-child lock, per-round accounting); `childSessionId → cliSessionId` mapping where `cliSessionId` is the provider-supplied uuid.

### 3. local-agent core: `login` becomes optional

`LocalAgentHarness.login` is currently required (`handle()` calls `this.login(harness)` which reads `harness.login.command`). Change to optional; the login branch reports "no login flow" for harnesses without one. `isAuthenticated` already supports probe-style checks (dsh harness uses it).

### 4. Settings mutual-exclusion switch

One switch row for DeepSeek in the settings section. Host side subscribes via `SettingsScope.watch()`: ON registers `DshCliProvider` (effect-scoped, reversible) + delegation tool; OFF disposes it. The official in-process subagent tools are base-bundle-owned and outside the switch's control — OFF naturally leaves only the official tool. Default OFF = current behavior.

## Alternatives considered

### Why provider-supplied session id instead of parsing stdout?

Parsing stdout requires a delimiter prefix, pollutes the official format-pure headless stdout, and risks false positives when a task answer contains an id-like string. `agents.create({ sessionId })` already accepts a caller-supplied id, and the provider owns the mapping anyway (it needs the id for resume). Parsing adds three failure modes for zero benefit.

### Why reuse official headless composition instead of a custom minimal profile?

The official base bundle carries the in-process delegation tools (`tool-subagent` spawn/continuable, `tool-subagent-fork` one-shot, `tool-subagent-control` send_message/interrupt, `list-agents`). These are a feature, not a risk — they keep dsh's sub-agent capability on par with claude's Task tool. The real safety boundary is that **base does not contain the local-agent family**: process-recursive dsh→dsh→dsh would require the family's own profile additions, and in-process delegation spawns no new process (env is not re-propagated to grandchildren). Base's subagent rows keep official default `maxDepth`; the family profile uses the official combination unchanged.

## Acceptance criteria

- First round: `dsh --profile <family-headless> --session-id <uuid> "task"` creates a session with that exact id, prints the final answer, exits. Resume: `--resume <uuid> "follow-up"` continues the same session and prints its answer.
- Restart the parent profile, then resume a dsh delegation: the mapping survives via the scoped-home file, the parent-session ownership check still rejects a forged cross-session handle, and the resumed round appends into the same dsh child session.
- Sub-dsh runs with `DSH_HOME=$DSH_HOME/local-agent/dsh` and `DEEPSEEK_API_KEY` set; its sessions never appear in the parent instance's session list.
- Settings switch: ON registers the dsh tool, OFF disposes it, default OFF; the model never sees both the dsh tool and the official subagent tool simultaneously.

## Risks

- `agents.resume` in this composition is unproven until exercised (model selection via `setup` must be wired the same way `agents.create` does). Verify with a manual nonce run before writing the provider: `--session-id <uuid> "记住口令 X"` then `--resume <uuid> "刚才的口令是什么"`.
- The family headless profile must never add local-agent family bundles — that would re-open the process-recursive nesting the base boundary closes.
- Credential propagation: the key is explicitly in the sub-dsh env; the sub-dsh LLM layer consumes the same ref (expected), and the family profile must not install delegation tools that would forward env to further grandchildren.
