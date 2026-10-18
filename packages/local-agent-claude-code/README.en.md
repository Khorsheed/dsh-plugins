# @khorsheed/dsh-local-agent-claude-code

English | [中文](README.md)

Delegate coding tasks to the Claude Code on this machine — thinking, tool calls, and replies stream back live, and your personal `~/.claude` is never touched.

Any dsh agent preset that names this package's `./tool` composition entry (e.g. dev mode) can delegate: the child session is visible end to end — abortable, resumable — and every round's accounting (the actual model, token usage, tool-call count) reads back for real. Authentication is endpoint-key based (`baseUrl` + `apiKey`/`authToken`), scope-isolated: the plugin only ever manages the one directory `$DSH_HOME/local-agent/claude-code`, so your personal installation and credentials stay out of it from start to finish. There is no OAuth web flow: a container round uses the same credential as a host round, with nothing to authorize inside the container. The Claude Code harness of the [local-agent family](../local-agent/README.md).

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/08-local-agent.png" width="640" alt="the Local Agent family cards under Settings → Plugins → plugin configuration, the Claude Code row's status dot showing its auth state">

## Features

- **Per-session delegation grant** — the `subagent_claude_code` tool is this package's `./tool` composition entry, granted to the sessions of an agent preset that names it; no per-preset variants.
- **Scoped home** — every Claude process runs with `CLAUDE_CONFIG_DIR` under `$DSH_HOME/local-agent/claude-code`; your personal `~/.claude` stays out of it.
- **Endpoint credentials, no web authorization** — configure `baseUrl` + `apiKey` (or `authToken`) on the bundle row and the harness is authenticated; the status panel reads authenticated immediately. Each named scope can override the deployment defaults with its own `endpoint-auth.json`. `sessions`/`status`/`logout` and a Settings → 本地 Agent panel complete the family.
- **Resume a delegation** — pass back the result's `resume` handle to continue the same Claude session, with per-round accounting.
- **Live stream mirror** — the child session mirrors Claude's thinking, tool calls, and replies live; aborting keeps the partial transcript and real token usage.
- **Model readback and per-cell working directory** — every settled round reads back the model from stream-json's system/init into the delegation record; orchestrators pass a `cwd` per cell, and a resume in a different directory is rejected.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-claude-code-card.png" width="640" alt="the expanded Local Agent · Claude Code settings card: the authentication block, the default-model picker, and the resident-mode (live) switch">

## Install

Prerequisites: a running dsh profile, and the Claude Code CLI (`claude`) on `PATH` — the plugin does not install it. Install the family core together with this bundle (`dsh plugin add` reconciles only *direct* dependencies, so name both):

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-claude-code
```

Before restarting the web instance, configure the endpoint credential on this package's profile row (`baseUrl` + `apiKey` or `authToken`, see below); unconfigured, the status reads not authenticated. Uninstall:

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-claude-code
```

The scoped home is kept on uninstall — the `endpoint-auth.json` and the session records live there; delete `$DSH_HOME/local-agent/claude-code` to remove every trace.

## Config

Optional fields on the bundle row:

- `permissionMode` — `skip` (default) passes `--dangerously-skip-permissions` so the child can write files without an approval prompt; `normal` runs without it, so approval-requiring actions (e.g. writing files) are denied.
- `model` — every delegation round starts the CLI with it (`claude -p --model <model>`); absent passes no model flag at all. See below.
- `baseUrl` — the deployment-level endpoint, sent to the child CLI as `ANTHROPIC_BASE_URL` (e.g. a relay such as `https://openproxy.to/claude`, or a self-hosted router); absent means Anthropic's own endpoint. A same-named variable exported in the host shell is NEVER read — the child environment is scrubbed on principle, and routing is decided by the config and the scope file alone.
- `apiKey` — the deployment-level credential, sent as `ANTHROPIC_API_KEY` (the `x-api-key` header). Keep it in the local profile only; never commit it.
- `authToken` — the other credential shape, sent as `ANTHROPIC_AUTH_TOKEN` (the `Authorization: Bearer` header) — some relays accept only Bearer. When both keys are set, the CLI's own precedence applies.
- `proxyUrl` — an HTTP proxy for the child CLI's own traffic, provisioned into the scoped `settings.json` env block; for when the host process environment carries no proxy (a supervisor-spawned instance does not inherit your shell exports). It is a local traffic forwarder — a different layer from `baseUrl`'s endpoint routing.
- `live` — live driver: one resident stream-json process per member (`--input-format stream-json`), one stdin message per round (runtime-level graceful control interrupt, same-shape push stream); off — or a channel that cannot come up — means the one-shot `claude -p` path.
- `liveIdleMs` — idle lifetime of a resident runtime before reclaim (default 30 min).

> **Migration note (next release line — breaking)** — the OAuth web flow is removed wholesale: `/claude-code login` no longer exists, and the keychain/`.credentials.json` reconcile is gone with it. Configure `baseUrl` + `apiKey` on the profile row BEFORE upgrading (an official console key against the default endpoint works too), or the upgraded instance reads unauthenticated. The old `liveMirrorGranularity: event | token` key is still accepted for existing profiles but ignored.

> **Per-scope override** — `<scopedHome>/endpoint-auth.json` (mode 0600) overrides the deployment config field by field: `{ "baseUrl": …, "apiKey": …, "authToken": … }`, and an absent field falls back to the config value. A file naming only `apiKey` is exactly "rotate this scope's key". `/claude-code logout` clears this file; when the credential comes from the plugin config alone, logout refuses and names the profile row as the place to edit.

### Default model (`model`)

**Absent = today's behavior.** Without this key the plugin adds no model flag to the argv at all: the scoped `settings.json`'s `model` decides which model runs, and claude's own default decides when that is missing too (the plugin never guesses what it is).

**Set = every delegation round starts the CLI with it.** All four argv variants — fresh and resume, one-shot and resident (`live: true`) — carry `--model <model>`, placed before the member channel's `--allowedTools … --`: that flag is variadic and everything after its `--` is the task text.

One-shot (exec) rounds never rewrite the scoped `settings.json`: `--model` overrules it per round and the file stays exactly as you edited it. A resident (live) spawn scratches the member's effective model into that file (a `--resume` reattach honors the file's model over the `--model` flag) and restores the previous value before a spawn that binds none; the "CLI config" layer that status and the settings card report is always the value you configured, never a member's scratch.

The settings card's "Default model" writes the provider setting for subsequent rounds. Its shared picker displays the scoped model directory, discovery source and completeness, plus an explicit model-ID input when needed. Clearing the selection follows the effective configuration/default chain. Saving does not interrupt an active round and requires no reload. If the shared picker is unavailable, the card retains its text-input fallback. Per-member model and effort changes use the durable controls described below.

The model surface now also reads Claude's native `initialize` directory, preserving selection aliases, display labels, resolved names and supported effort levels. It shares the core cache and refresh subscription, retains successful data after a failed refresh, and labels historical suggestions separately. This scoped control probe sends no user task and writes no model settings. An older CLI without this directory reports unsupported; native candidates do not establish account entitlement. The shared model picker and member effort controls are connected. Busy selections apply at the next complete turn boundary, including tool continuations; core owns current/pending state, cancellation and retry, while frozen evaluation members reject changes.

**A delegation's own model outranks this key.** An orchestrator may name the model for ONE delegation through the facade's `DelegationCallOptions.model`, which sits above this key (the layer order is in the family core README). The first round's request is recorded and every resume round re-requests it — `resume` takes no model of its own. In resident mode a fresh delegation's model binds as the member's start model at the runtime's spawn: a runtime bound to a different model retires first, and the same CLI session resumes on the new process.

**Session-level member switching.** The member composer's model picker writes a **session-level override** through the family gateway's `setMemberModel` — it outranks the delegation model and this key, lives in memory only, and deliberately neither survives a host restart nor enters the settings. A switch is refused while the member has a round in flight; with the live driver on, switching to a different model retires the member's resident runtime so the next round respawns onto the new model while resuming the SAME CLI session (the conversation carries over), and a same-model switch is a no-op.

**This is not an evaluation gap.** A run freezes its condition at setup: change the key mid-run and the next round's model read-back sees declared ≠ observed and fails the run as misattributed (frozen decision 5). "A new run follows the new value, a running one is never switched underneath you" is the design, not an oversight.

⚠️ `skip` has no OS-level sandbox — the child can write anywhere the host user can, including outside the workspace — and the endpoint credential is sent to whatever `baseUrl` points at. Prefer `normal` when a delegation needs confinement; point `baseUrl` only at endpoints you trust.

**Evaluation snapshot (`effectiveSettings`).** The harness declares a live-read snapshot of its fairness-relevant settings for the evaluation condition hash: drive (exec/live), the permission mode (`skip`/`normal`, plugin config), whether a non-default endpoint is in force (following the provider's own resolution — the scope's `endpoint-auth.json` overrides the plugin config field by field; hostname only — key material never enters the snapshot, and the file's name matches the evaluation contract hash's credential denylist, so not even its digest enters a condition fingerprint), and the configured model (the plugin config's `model` key first — it overrules the file on every argv — then the scoped `settings.json`'s `model`; the CLI's own default model stays the CLI's business and is never guessed — neither key, no field), and the CLI version (`claude --version`, cached against the executable's path + mtime; absent when the CLI cannot be asked). `/claude-code status` and the `LocalAgentStatus` Remote attach the same snapshot.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ public API compatible. Live generation uses the local-agent transient Remote and public Conversation nodes; incremental durable recovery checkpoints handle persistence, and native final messages retain transcript and usage semantics. Browser P95 acceptance is tracked by the room coordinator proposal. minHost is 0.1.5-rc.1 — older hosts stay on the previous release line. The settings card now mounts only on the Plugins page's `plugins.item` seat on host 0.1.7-alpha.1+ (`configForms.whileServed` follows the served `local-agent-claude-code` namespace); 0.1.5 renders no card (the host removed the `settings.plugin.item` seat) — every other surface is unchanged.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.2.1-rc.1) — host-021 wave: full build+test green against the 0.2.1-rc.1 tree; delegation moved to `ctx.subagents.startActivation` (managed activation), and run.id is now unique per execution.

## Known Limitations

- **Logout clears only the scope's own file** — a deployment-level credential from the plugin config is unaffected; edit the profile row to change it.
- **A bad credential costs the retry budget** — a dead key makes the CLI retry up to its limit (measured ≈8 minutes) before the 401 surfaces; the status's `rejected` grade appears when that round settles.
- **Interactive-session records may be missing** — under a custom `CLAUDE_CONFIG_DIR` the CLI may not write transcripts (upstream behavior).
- **Headless caveat** — `/claude-code` commands need a Web session; `--profile headless` delegates through a composition that mounts the tool row.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Model readback and the cwd override.** After every settled round the provider reports the actual model from the stream-json `system` (init) event's `model` field (e.g. `claude-opus-5[1m]`, verbatim — context-variant suffixes included) through the `settled` run-progress event, and merges it into the delegation record's `observedModel` field; absence is recorded, never guessed. When no layer and no record names a model, the 默认 surface's last-observed hint reads the member's OWN transcript (`projects/<cwd-slug>/<sessionId>.jsonl`, or the tree's newest for the memberless card) — the history backstop for rounds that predate the settle channel; read-only, never a write into `delegations.jsonl`. An orchestrator may also pass a per-round working directory through the facade's `DelegationCallOptions.cwd` (recorded as the record's `cwd`); when a resume round resolves to a different directory than the recorded first round, it fails loud before any process spawns — a CLI session continues in the directory its first round ran in.

**Tool-call accounting.** Every settled round also reports how many tool calls it made, on the `settled` run-progress event (`toolCalls: { count, byName }`). The count is taken in the `tool_use` branch the stream fold ALREADY walks, and `byName` keys are the block's own `name` (`Bash`, `Read`, `TodoWrite`, or an MCP tool's full `mcp__server__tool`), carried verbatim and never normalized across harnesses. `TodoWrite` counts too: the fold diverts it into the todo snapshot instead of the transcript, but the CLI still called it. One accounting per round, never cumulative; a round that called nothing carries no field at all (absent is not zero). Measured: a "read two files, then list the directory" round reads back `{count: 3, byName: {Read: 2, Bash: 1}}`, matching the mirrored tool cards one for one.

**The endpoint credential model.** Authentication has exactly one form: `endpoint-auth.ts` merges the scope's `endpoint-auth.json` field by field over the plugin config triple (`baseUrl`/`apiKey`/`authToken`), and the provider, the live driver and the model catalog resolve and inject it (`ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`) at every spawn — a key rotation takes effect on the next round, no reload. Measured: claude 2.1.296 in a brand-new scoped home runs `claude -p` on these variables alone — the CLI scaffolds `.claude.json` itself, and headless mode has no onboarding or key-approval gate. The auth probe is a light file-plus-config check (a non-empty key is authenticated), and the CLI is never spawned just to probe; the `endpoint-auth.json` mtime serves as the credential stamp — a round's 401 grades the credential `rejected`, and rewriting the file (rotating the key) recovers it, one-to-one with the OAuth era's "a fresh login rewrites the marker".

**Named scopes.** Each named scope opens another `CLAUDE_CONFIG_DIR` at `<homesRoot>/claude-code@<name>`: its own `endpoint-auth.json`, its own session records, its own credential grade. A scope without a file follows the deployment config — which is exactly how one configuration serves every scope. A scoped delegation runs `claude -p` against that directory and reads back from it; exec-only.

**Container delegation.** An orchestrator may run the round inside an **already-acquired container** through the facade's `DelegationCallOptions.exec` (`{ container, workdir, env? }`): the argv becomes `docker exec -w <workdir> [-e NAME…] <container> claude -p …` and everything else (stream-json parse, settle, recording) is byte-for-byte unchanged. `env` must name the in-container `CLAUDE_CONFIG_DIR`, and the caller bind-mounts the host scoped home read-write onto that path. The endpoint credential crosses into the unit through the family's container forwarding: the provider's resolved `ANTHROPIC_*` variables ride NAME-ONLY `-e` flags whose values the docker client's own environment carries — the key never appears on an argv or in a process table, so a container round uses the SAME credential as a host round with zero authorization steps inside the unit. An API key neither refreshes nor rotates, so the OAuth era's two-store fork (host and container racing one grant's rotation) does not exist under endpoint credentials. The mount stays read-write because the round's transcripts land in `projects/` under the same directory, and the evaluation's model read-back parses them from the host side of that mount. A container round always takes the exec one-shot and declares no member bridge. **Mind the host-only entries in the scoped `settings.json`**: measured, the `https_proxy` there — meant for the host daemon — points at nothing inside the unit and the round dies with `Connection refused`. The caller stages what it mounts.

```
src/index.ts                harness registration, /claude-code command family, config schema
src/endpoint-auth.ts        the endpoint credential: scope-file ↔ config merge, env construction, stamp and clearing
src/claude-cli-provider.ts  one-shot provider: spawn, stream mirror, turn/token accounting
src/provision.ts            scoped-home provisioning (the proxy env block)
src/records.ts              session-record listing and transcript model read-back from the scoped home
src/tool.ts                 the `./tool` composition entry: the `subagent_claude_code` delegation tool (preset-granted)
```

The bundle patch registers the `claude-code` harness into the family core (`@khorsheed/dsh-local-agent`, declared as a dependency — the claude bundle deliberately does not re-insert the core row, which would mount it twice) and mounts the `claude-local` provider, which spawns `claude -p --verbose --output-format stream-json` under the harness's scoped home. The `subagent_claude_code` tool is the family-owned tool (this package's `./tool` composition entry, sharing the family core's `./tool-factory` implementation), granted per session by an agent preset that names the row: the official subset (`description`/`prompt`) plus an optional `resume` parameter.

**Session records.** `/claude-code sessions` lists the scoped home's `projects/<cwd-slug>/<uuid>.jsonl` session files — this agent's delegations, never your personal sessions. The slug is a lossy encoding of the workspace path, so the listed `workDir` comes from the file content (the first `user` event's `cwd` field), never the directory name. The Settings panel shows the same listing narrowed to the current workspace.

**Resume security.** The handle never rides the prompt: it is read only from the `resume` parameter, and the localAgent registry resolves it only for the same parent session and provider that recorded the delegation — a forged handle (unknown child session, another parent's session, or the wrong provider) is rejected before any CLI process starts.

**Stream mirror & accounting.** `thinking` blocks fold to `reasoning` blocks, `tool_use`/`tool_result` to tool lines (`[工具 Bash] <command> → output`), reply `text` to assistant text; resumed rounds append their own turn without duplication. Edit-family calls (Edit/Write/MultiEdit/NotebookEdit) fold into ApplyPatch-style cards — the path on the args line, the actual edit (old/new strings or the whole file body) as the card body, the same shape codex's fileChange mirror uses; server-side tools (`server_tool_use` web_search/web_fetch) pair with their results by id into visible WebSearch/WebFetch cards; a `redacted_thinking` block folds to a visible placeholder think line (the content is server-encrypted by design — the line says so); every other tool's input keeps its one-scalar summary, with a truncated JSON summary as the fallback instead of dropping. Every mirrored step is wrapped in a `step/start`–`step/end` pair at its own (turn, step) — the host's live conversation view registers steps only on those boundaries, so a boundary-less assistant message stays unrendered until a full rebuild. The provider opens `turn/start` at spawn and closes `turn/end` on settle — including failure and cancellation — so `subagentTiming` duration equals actual CLI runtime and no window stays open; the final `assistant/message` carries token usage parsed from the JSON result (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` — Anthropic reports each separately).

**Model experience.** The child is a fresh one-shot `claude -p` in the delegating session's workspace; the parent submits only the standalone task text and sees only the final answer or the exact error, plus the resume self-description on a fresh delegation — Claude commentary, tool activity, and workspace diffs are not copied over. Child tokens never enter the parent's context; the child pays for its own Claude context and turn (cache reuse depends only on the scoped installation's provider, model, and history); the parent's KV cache is unaffected.

**Live driver (`live: true`).** Replaces the per-round spawn: the member's first delegation brings up one resident stream-json process (`claude -p --verbose --input-format stream-json --output-format stream-json`), the first stdin `user` message triggers `system/init` (the server-assigned session id becomes the delegation record's `cliSessionId`), and every later round is one stdin message. The event stream is byte-identical in shape to exec's stream-json, so each turn folds through the same `ClaudeStreamParser` (the last line held back until `result` carries usage, as in exec), and `cancel` lands as a `control_request interrupt` — the process survives and the session stays continuable. Reclaim is stdin EOF → SIGTERM; after a crash the next round reattaches with `--resume <session_id>`. A runtime binds the member's effective model at spawn (session-level override → delegation model → settings key) and scratches it into the scoped settings.json (a `--resume` reattach honors the file over the flag); a runtime whose bound model no longer matches the round's resolution retires before the respawn. A `permissionMode: normal` spawn omits `--dangerously-skip-permissions`, so the CLI's server→client control requests (the `can_use_tool` approval surface) are auto-answered with allow by the driver — a subagent has no approval surface, matching exec's effective behavior under skip; any other subtype gets an error answer instead of a silent hang. The auth discipline is byte-identical to exec: only the scoped `CLAUDE_CONFIG_DIR` plus the resolved endpoint credential variables are injected — the global `~/.claude` is never touched and no `auth` verb ever runs.

**Config notes.** Every delegation logs the effective endpoint at info level (`subagent-claude: delegating via <endpoint>`), and a failed run's error text names it — diagnose routing from that log and the profile row, not from your current shell's environment. `skip` is the default because a one-shot CLI subagent has no approval surface; scope the host's own sandbox (e.g. run the host inside a sandboxed workspace) when a delegation needs confinement.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/local-agent-claude-code`). Issues and contributions welcome there.
