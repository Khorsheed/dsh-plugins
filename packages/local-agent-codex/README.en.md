# @khorsheed/dsh-local-agent-codex

English | [中文](README.md)

Hand coding tasks to the Codex CLI installed on your own machine — an endpoint credential or its own login, its own session records, and your `~/.codex` never gets touched.

dsh agents already get work done, but some tasks you simply want to give to your local Codex CLI: its account, its models, the toolchain you know. This plugin wires Codex in as a dsh local subagent — any agent preset can delegate with one call through the `subagent_codex` tool; delegations run inside a plugin-scoped home (`$DSH_HOME/local-agent/codex`), so your personal config, credentials and sessions are never touched; the process details (reasoning, tool calls, file changes) mirror live into the child session, and the final answer comes back to the parent. Authentication is endpoint-key only (`baseUrl` + `apiKey` — a relay or an official platform key alike): container rounds share the host's credential and nothing is authorized inside the unit. There is no web login and no device code — no OAuth flow exists in this package.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/08-local-agent.png" width="640" alt="the Local Agent · Codex card on the Settings → plugin configuration page, its header status dot showing the auth state at a glance">

## Features

- **Per-session delegation grant** — the `subagent_codex` tool is this package's `./tool` composition entry, granted to the sessions of an agent preset that names it (e.g. dev mode); no per-preset setup.
- **Scoped-home isolation** — all Codex state (config, credentials, rollout session records) lives in `$DSH_HOME/local-agent/codex`, separate from your `~/.codex`.
- **Endpoint credential (the only auth mode)** — fill `baseUrl` + `apiKey` on the card's Authentication section (saved as the default scope's `endpoint-auth.json`, mode 0600, local only) or preconfigure the profile row, and the scope is authenticated; every named scope may override the deployment pair field by field with its own `endpoint-auth.json`. Every round routes at the endpoint through a custom provider (`wire_api=responses`, verified end-to-end against codex-cli 0.163.0 through a relay), the key riding the process environment. The host shell's environment is never read; there is no web login.
- **Resident mode (live)** — one resident `codex app-server` process per member, one turn per round: output streams into the child session in real time, cancel does not kill the process, and a crash resumes the same thread; off — or a channel that cannot come up — means the one-shot `codex exec` path, hot-switched without a reload.
- **Settings card** — a section of the core's「Local Agent Delegation」family card on the Plugins page (on an older core, this package's own Plugins detail-page card): sign-in, the available-models shortlist (ordered, the first entry is the default; empty = the legacy chain), and the resident switch; a save applies on the next round.
- **Resume a thread** — pass `resume="<childSessionId>"` to continue the same codex thread in the same dsh child session, even across host restarts.
- **Custom endpoint** — configure the endpoint credential on the card or the profile row to route through your relay; a hand-edited custom provider in the scoped `config.toml` stays authoritative too (never overwritten).
- **Read-back and per-cell working directory** — every settled round reads the model, CLI version and usage back out of its own rollout into the delegation record; the file is located by thread id, cwd and time window, so concurrent runs each read their own round. Orchestrators pass a `cwd` per cell, and a resume in a different directory is rejected.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-codex-card.png" width="640" alt="the expanded Codex settings card: auth status with sign-in and sign-out, the default model, and the resident-mode switch">

## Install

Prerequisites: a working dsh profile and the Codex CLI (`codex`) on `PATH` — the plugin neither installs it nor logs in for you.

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent
dsh plugin --profile web add @khorsheed/dsh-local-agent-codex
```

Both packages must be named explicitly — `dsh plugin add` reconciles only direct dependencies, so the family core is never mounted by a transitive dependency. Restart the web instance to activate, then fill the endpoint and key in the Codex section's Authentication block of the「Local Agent Delegation」family card (the Plugins page) — or preconfigure the profile row; with neither, the status reads unauthenticated.

Uninstall:

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-codex
```

The scoped home (`$DSH_HOME/local-agent/codex`) is kept on purpose, so a reinstall needs no fresh login; delete it to remove every trace.

## Config

Optional, in the profile patch layer:

```yaml
- id: local-agent-codex
  config:
    sandbox: workspace-write   # codex exec policy: read-only | workspace-write | danger-full-access
    baseUrl: https://your-relay.example/openai/v1  # optional: deployment-level endpoint (an OpenAI-compatible /v1 root); absent leaves the scope file or the web login to decide
    apiKey: sk-...             # optional: deployment-level endpoint key (Bearer); keep it local, never commit it
    model: gpt-5.2             # optional: every delegation round starts the CLI with it; absent passes no model flag at all (below)
    live: false                # live driver: one resident codex app-server process per member, one turn per round (runtime-level graceful interrupt, push-mode mirroring); off — or a channel that cannot come up — means the one-shot exec path
    liveIdleMs: 1800000        # idle lifetime of a resident runtime before reclaim (default 30 min)
```

### Endpoint credential (`baseUrl` + `apiKey`)

**A configured key = every round routes at the endpoint.** When the scope's resolution (the scope's own `endpoint-auth.json` merged field by field over the profile row) carries a non-empty key, every delegation injects a custom provider on the argv (`-c model_provider=… -c model_providers.…={base_url, env_key=OPENAI_API_KEY, wire_api=responses}`) and the key travels in the process environment — `config.toml` is never rewritten, `auth.json` never consulted, the web login never participates. The one-shot exec, the resident app-server, and the model-catalog probes all ride the same credential. A key without a `baseUrl` targets OpenAI's own endpoint (an official platform key needs no relay — the built-in provider reads the same variable). Clearing the key (save the field blank on the card) reads unauthenticated.

**The card's Authentication section edits the default scope's `endpoint-auth.json`** (mode 0600, local only; through the family gateway's `endpointAuth`/`configureEndpoint` Remotes, so no session is needed) — keys never enter the profile document, and the file's name matches the evaluation contract hash's credential denylist, so it never enters a condition fingerprint either. The "Verify endpoint & list models" button next to it runs a token-free probe against the SAVED endpoint (`GET <baseUrl>/v1/models`, Bearer header) and answers with reachability plus the served model list. The file also accepts a hand-written `"wireApi": "chat"` (the card never edits it and preserves it on save) for relays that only speak chat/completions.

> **A bad key costs retry time** — a dead key makes the CLI retry against the endpoint for minutes before reporting a 401; `/codex status` shows the `rejected` grade only after that round settles. Re-saving the key (rewriting endpoint-auth.json) is the recovery.

> **Migration note (next release line, breaking)** — the web login is removed outright: `/codex login` no longer exists, and the device-code/browser grant with it; the first boot after the upgrade sweeps the scoped home's leftover `auth.json`, so a stale grant cannot keep authenticating while the status reads unauthenticated. Configure `baseUrl` + `apiKey` on the card or the profile row BEFORE upgrading (an official platform key works as well as a relay key), or the upgraded instance reads unauthenticated.
>
> **Logout clears only the scope's own file** — `/codex logout` removes the scope's `endpoint-auth.json`; when the credential comes entirely from the profile row, logout refuses and names the profile as the place to edit.

**Legacy key migration.** Live runs always consume incremental output: the old `liveMirrorGranularity: event | token` key is accepted for existing profiles but ignored, and changing it never changes a running process. Exec remains available for evaluation; final provider items remain authoritative, including tool history and usage.

### Default model (`model`)

**Absent = today's behavior.** Without this key the plugin adds no model flag to the argv at all: the scoped `config.toml`'s top-level `model` decides which model runs, and codex's own default decides when that is missing too.

**Set = every delegation round starts the CLI with it.** A fresh round and a resume round are treated alike:

| Drive | How it is passed |
|---|---|
| one-shot (default) | `codex exec -m <model> …` — `-m` is an option of `codex exec` itself, so it precedes the `resume` subcommand (`codex exec resume` declares no `-m` of its own) |
| resident (`live: true`) | `codex app-server -c model="<model>" --stdio` — the app-server has no `-m`, so the model rides the process-level `-c` override the CLI documents for this |

The scoped `config.toml` is never rewritten: `-m` overrules it per round and the file stays exactly as you edited it.

The settings card's「Available models」section maintains an **ordered model shortlist**: "Add model" checks entries off the endpoint's served catalog, so the list can only hold what the endpoint actually serves; drag rows to reorder. **The first entry is the default model** — every delegation round starts the CLI with it (`codex exec -m` one-shot, `-c model=…` on the resident app-server), outranked only by member session overrides and delegation-level picks. The list persists in the scoped home's `models.json` (each named scope may carry its own, the same file mechanism as the endpoint credential), every edit saves immediately and applies to the next round. **Empty = the legacy chain** (the `model` key below → the scoped `config.toml` → the CLI built-in). Per-member model and effort changes use the durable controls described below.

The rich directory's vocabulary comes from the endpoint itself (`GET <baseUrl>/v1/models` — the same probe the "Verify endpoint & list models" button runs): a local registry cannot prove what the endpoint serves, and a dead key can no longer hide behind the CLI's local list. The native app-server `model/list` probe is demoted to metadata enrichment, running concurrently: it alone carries the display names, hidden candidates, reasoning-effort options and the `isDefault` compiled default, so a served id that matches the registry carries those over, while an id only the endpoint serves stands as a plain entry; a native failure warns once and the endpoint data is a complete answer on its own. With no credential, a rejected credential, an unexpected HTTP status, or a non-`/v1/models`-shaped reply, the directory loads empty with the reason; a transport failure throws, so the cache keeps the last good snapshot marked stale and retries (the openproxy relay once 500'd and recovered on its own — exactly the case this semantics is for). The probe context follows the member's scope and cwd. The shared model picker and member effort controls are connected. Busy selections apply at the next complete turn boundary, including tool continuations; core owns current/pending state, cancellation and retry, while frozen evaluation members reject changes. A native catalog candidate is not proof of account access.

**A delegation's own model outranks this key.** An orchestrator may name the model for ONE delegation through the facade's `DelegationCallOptions.model` (the fixed order: session override > delegation record > the shortlist's first entry > this key > scoped config > CLI built-in). The first round's request is recorded and every resume round re-requests it — `resume` takes no model of its own. In live mode such a round is no longer refused: the model becomes the member's **start model**, bound at the app-server spawn; a resident runtime bound to a different model is retired first (the same codex thread resumes via thread/resume) so the round respawns onto the asked-for model.

**Member-level switching (the composer model picker).** A member session can switch its model per session: an in-memory session-level override, the highest-priority layer, deliberately lost on a host restart. A switch is refused while a round is in flight; when idle and the member has a resident runtime bound to a different model, the switch retires that runtime — the next round respawns onto the new model while the CLI session (rollout) itself carries over. On the one-shot (exec) drive there is no resident process, so the override simply decides the next round's `-m`.

**This is not an evaluation gap.** A run freezes its condition at setup: change the key mid-run and the next round's model read-back sees declared ≠ observed and fails the run as misattributed (frozen decision 5). "A new run follows the new value, a running one is never switched underneath you" is the design, not an oversight.

## Custom endpoint

The endpoint credential (the card or the profile row) is the only credentialed route. You may still add a custom provider to the scoped `$DSH_HOME/local-agent/codex/config.toml` (built-in providers can't be overridden, `OPENAI_BASE_URL` is ignored, and provisioning never overwrites an existing config) — but its `env_key` reads the CHILD's environment, the host shell's same-named variables are scrubbed, and only the endpoint credential's key rides along, so a hand-written provider is useful in practice only for endpoints that need no auth (e.g. a local router):

```toml
[model_providers.dsh-router]
name = "dsh-router"
base_url = "https://your-router.example/v1"
model_provider = "dsh-router"
```

The last line selects the provider for delegations; keep the rest of the file intact. An endpoint credential with a key wins over the file's `model_provider` selection (the argv's provider overrides it).

⚠️ **Credential exposure**: the endpoint key is sent to whatever endpoint serves the request — only use endpoints you control or trust. Each delegation logs the effective endpoint at info level.

**Evaluation snapshot (`effectiveSettings`).** The harness declares a live-read snapshot of its fairness-relevant settings for the evaluation condition hash: drive (exec/live), the sandbox policy (plugin config), the reasoning effort (the scoped config's top-level `model_reasoning_effort`), whether a custom endpoint is pinned (the endpoint credential first — the scope's `endpoint-auth.json` merged field by field over the plugin config; with no key, the scoped config's custom provider answers; hostname only, key material never enters the snapshot), the configured model (the scope's `models.json` first entry first, then the plugin config's `model` key — it overrules the file on every argv — then the scoped config's top-level `model`; absent when none names one — never guessed), and the CLI version (`codex --version`, cached against the executable's path + mtime; absent when the CLI cannot be asked). `/codex status` and the `LocalAgentStatus` Remote attach the same snapshot.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ public API compatible. Live generation uses the local-agent transient Remote and public Conversation nodes; incremental durable checkpoints provide recovery, and native final messages retain their transcript and usage semantics. End-to-end latency acceptance is tracked by the room coordinator proposal. minHost 0.1.5-rc.1 — older hosts stay on the previous release line. The settings card renders as a section of the core's「Local Agent Delegation」family card (the core's `plugins.item` entry on the Plugins page, 0.1.7-alpha.1+; on an older core this package falls back to its own `plugins.item` card), mounted through `configForms.whileServed` while the Host serves the `local-agent-codex` namespace; 0.1.5 renders no card (the host removed the `settings.plugin.item` seat) — every other surface is unchanged.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.2.1-rc.1) — host-021 wave: full build+test green against the 0.2.1-rc.1 tree; delegation moved to `ctx.subagents.startActivation` (managed activation), and run.id is now unique per execution.

## Known Limitations

- **No web login** — the endpoint credential is the only auth path (the card or the profile row; an official platform key works as well as a relay key). The ChatGPT-subscription OAuth path is not part of this package.
- **`codex exec` is non-interactive** — actions the sandbox policy would approve are denied, not prompted; in resident mode approval-shaped requests are likewise auto-declined unattended (cancel/decline). See the `sandbox` config.
- **Named scopes are exec-only** — the resident app-server binds the default scoped home, so a scoped delegation never enters live mode.
- **Headless caveat** — `/codex` commands need a Web session; headless can still delegate via a composition mounting the tool row.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Named scopes.** `/codex login --scope <name>` opens a second scoped home at `<homesRoot>/codex@<name>`: the directory is provisioned with the same `config.toml` that pins credential storage to a file rather than the macOS keychain, so that scope's login lands in its own `auth.json`. A scoped delegation runs `codex exec` there, writes its rollout there and reads it back from there — exec-only, because the resident app-server is bound to the default scoped home.

**Bundle composition.** The patch registers the `codex` harness (scoped `CODEX_HOME`, PTY login, rollout-file session records) — exactly one provider row; since the family fold the `subagent_codex` tool is this package's `./tool` composition entry, granted per session by an agent preset that names it (the dev preset's `tool-subagent-codex-local` row), no longer mounted at the profile root. The family keeps the official model-facing name `subagent_codex`: the official preset row of that name already ships `disabled: true`, and the patch disables the profile-root row once more, so a community install can never register two `subagent_codex` tools; a user who deliberately re-enables the official row in their own preset layer gets a loud duplicate-name conflict and must choose one, by design. The `codex-local` provider spawns `codex exec` under that home (the one-shot drive when live is off). The browser half ships with this package's `./client`: the Codex settings card composes the family core's shared `ProviderAuthBlock`, rendering as a section of the core's「Local Agent Delegation」family card — mounted through `configForms.whileServed` while the Host serves the `local-agent-codex` namespace, one section for a standalone install, a family bundle, or a mode pack alike (on an older core, this package's own `plugins.item` card instead); card writes ride the bound settingsScope and hot-apply without a reload. The core itself comes from `@khorsheed/dsh-local-agent`, declared as a dependency.

**Credentials.** Endpoint-key only, no login flow: the scope's `endpoint-auth.json` (mode 0600) merges field by field over the profile row's `baseUrl`/`apiKey`, and when the resolution carries a key, every round injects a custom provider on the argv (`wire_api=responses`, the key in the process environment — verified against codex-cli 0.163.0 on a fresh scope with no login file at all, straight through a relay). First start writes a minimal `config.toml` pinning `cli_auth_credentials_store = "file"` — Codex's default `auto` would resolve to the macOS keychain, so a hand-run `codex login` inside the scoped home would leak the grant outside it; an existing config is left untouched. Every boot also sweeps the web-login era's leftover `auth.json` — this package no longer reads it, and keeping it would let a stale grant authenticate while the status reads unauthenticated. `/codex logout` deletes the scoped `endpoint-auth.json`, so a later configuration rotates the key.

**Session records.** `/codex sessions` lists the scoped home's `sessions/YYYY/MM/DD/rollout-*.jsonl` files — sessions this plugin's delegations created, never your personal ones. The records entry in the session header (provided by the family core's client) narrows the same list to records whose `workDir` matches the session cwd.

**Read-back and the cwd override.** After every settled round the provider reads three facts back out of that round's own rollout file, reports them through the `settled` run-progress event, and merges them into `delegations.jsonl`: the model (`turn_context.payload.model` — codex 0.144.0's exec stream carries no model at all, so the rollout is the only authority; filtered to this round's time window, so a resumed thread's earlier models are never misread), the CLI version (`session_meta.payload.cli_version` — written by the codex build that actually served the round, a stronger answer than probing the executable afterwards), and the token usage a non-completed round never streamed (the last `token_count`). Absence is recorded, never guessed.

**Tool-call accounting.** Every settled round also reports how many tool calls it made, on the `settled` run-progress event (`toolCalls: { count, byName }`). The count comes only from the `item.completed` branches the stream fold ALREADY walks — no new parse path: `command_execution`, `web_search_call`, `file_change`, and `function_call` each count once, and `function_call_output` is a result, not a second call. `byName` keys are **codex's own item types** (`command_execution`), not the display names the mirrored cards carry (`Bash`) — the accounting records what the CLI calls the thing. One accounting per round, never cumulative; a round that called nothing carries no field at all (absent is not zero). Measured: one "list the directory and count the files" round reads back `{count: 1, byName: {command_execution: 1}}`, and a two-command round reads back `{count: 2}`.

Both the locate and the scan are calibrated for concurrency. codex writes `turn_context` when the TURN STARTS, so a round that then produces enough events pushes it past the end of any tail-only scan — which read back null in a real evaluation run (the 38 KB smoke round read fine, the 100–500 KB cells did not), so a tail miss is followed by a bounded full-file read. The locate takes the round's **cwd** alongside the thread id: concurrent delegations put several cells' files inside one time window, and `session_meta.payload.cwd` is what tells them apart. A window holding candidates but none in this round's directory reports nothing rather than a neighbour's round — except when the window holds exactly one candidate, where the mismatch is path skew rather than ambiguity. An orchestrator may also pass a per-round working directory through the facade's `DelegationCallOptions.cwd` (recorded as the record's `cwd`); when a resume round resolves to a different directory than the recorded first round, it fails loud before any process spawns — a CLI session continues in the directory its first round ran in.

**Container delegation.** An orchestrator may run the round inside an **already-acquired container** through the facade's `DelegationCallOptions.exec` (`{ container, workdir, env? }`): the argv becomes `docker exec -w <workdir> [-e NAME…] <container> codex exec …` and everything else (stream parse, settle, rollout readback, recording) is byte-for-byte unchanged. `env` must name the in-container `CODEX_HOME`, and it should be the read-write bind mount of the host scoped home — the rollout readback reads the host copy. A container round always takes the exec one-shot (the resident app-server is a host process) and declares no member bridge (a host unix socket cannot reach into the container). Measured: one "answer 2+2" round in an `eval-env:pinned` unit settles `completed` with output `4`, and `observedModel` reads back as `gpt-5.6-sol` from the rollout the container wrote into the host scoped home.

**Resume.** The family tool (this package's `./tool` composition entry, sharing the family core's `./tool-factory` implementation) adds an optional `resume` parameter to the official `description`/`prompt` subset. A fresh delegation's result self-describes its handle (`追问请带 resume="<childSessionId>"`); passing it back continues the same codex thread (`codex exec --json resume <thread_id>`) in the same dsh child session, with per-round accounting. The handle is read only from the `resume` parameter and resolved by the `localAgent` registry only for the recording parent session and provider — a forged handle is rejected before any CLI process starts.

**Event-stream mirror.** The subagent session mirrors the `codex exec --json` stream in order (live rounds fold the app-server's `item/completed` notifications through the same shared fold): `reasoning` → reasoning blocks, `agent_message` → reply text, `command_execution`/`web_search_call`/`function_call_output` → tool lines (`[工具 Bash] <command> → output`), `file_change` → an `ApplyPatch` card (kind and path per change), `function_call` (e.g. the multi-agent `wait`) → a card under its own name with the `function_call_output` merged in; the final `agent_message` is the run output and the round's usage rides the last mirrored assistant message. Every tool line lands as the native lifecycle inside its one atomic step — an assistant message advertising the tool-call content block (id, name and arguments strictly identical to the call event), the `tool/call`, then its `tool/result` — the pairing the released-log reader validates on every cold read; a call the stream never records a result for (an output-less `web_search_call`, a command truncated by a kill) closes with a synthesized interrupted error result (`（工具调用被中断，未能记录返回结果）`). Resumed rounds append their own turn without duplication. Aborting settles the tool result immediately while keeping the events and usage already received.

**Model experience.** Each delegation is a fresh one-shot `codex exec` in the delegating session's workspace. The parent submits only the task text and sees only the final answer or the exact error — Codex commentary, tool activity, and workspace diffs never cross into the parent session, and child tokens never enter the parent's context.

**Live driver (`live: true`).** Replaces the per-round spawn: the member's first delegation brings up one resident `codex app-server --stdio` process (same scoped home, same `-c` member-bridge declaration), creates a persisted thread (`thread/start` with `ephemeral: false`), and every later round is a `turn/start` to that living runtime; `item/completed` events fold into the child session as they arrive (same `CodexTranscriptLine` fold and append core as exec, the last line held back until `turn/completed` to carry usage), and `cancel` lands as `turn/interrupt` — the process survives and the thread stays continuable. Approval-shaped server→client requests are auto-answered unattended (cancel/decline, matching exec behavior). Runtimes are reclaimed after an idle timeout (the app-server wire has no shutdown method: stdin EOF → SIGTERM ladder); after a crash the next round re-spawns and `thread/resume`s the on-disk thread; a handshake failure trips a cooldown breaker and falls back to exec per round.

**Accounting.** The provider opens `turn/start` at spawn and closes `turn/end` after the settle mirror (mirrored steps must land inside the turn window — the released-log reader rejects a step outside an open turn) — including on `error`/`aborted` — so `subagentTiming` duration equals real CLI runtime; the final assistant message carries token usage parsed from the event stream. Codex's `input_tokens` includes cache hits, so the uncached bucket is `input_tokens − cached_input_tokens`, `cached_input_tokens` maps to cache read, and there is no cache-write concept — the `tokenUsage` projection never double-counts cache hits. Resumed rounds repeat this under their own turn number. **Usage fallback for non-completed terminal states (aborted/error).** An interrupted or failed round never sees `turn.completed`, so its event stream carries no usage — yet codex has already written the round's real token spend to the rollout file under the scoped home. The exec mirror then recovers the LAST `token_count` of THIS run's rollout file and attaches it as the round's usage: the file is located by thread id (the `session_meta` head id), falling back to the spawn-time window when the stream was truncated before `thread.started`; the caliber is byte-identical to `turn.completed` (`input − cached` and the rest, via the shared `usageFromCodex`). A hard kill that wrote no `token_count` at all still leaves the round without usage — the fallback never guesses.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/local-agent-codex`). Issues and contributions welcome there.
