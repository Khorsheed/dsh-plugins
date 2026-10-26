# @khorsheed/dsh-local-agent-kimi full reference

> The full write-up for developers and operators: configuration, auth and endpoints, internals. Until 2026-10-26 this was the package README; the user-facing introduction is the [README](../README.en.md).

English | [中文](reference.md)

Delegate a task from any dsh session to the Kimi Code CLI on your machine — it runs in its own scoped home, and your `~/.kimi-code` stays untouched.

Getting the model to hand a whole chunk of work to another coding agent used to mean opening a terminal yourself, copy-pasting, and carrying the result back. This plugin gives every agent preset a `subagent_kimi` delegation tool and a `/kimi` command family: delegations run as child sessions in the session's workspace, their transcripts and progress show up in the subagent surface, results come back with real usage and timing, and the same handle resumes the conversation later.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-kimi-settings.png" width="640" alt="the Kimi settings card: auth status, login/logout, default model, and the resident-mode toggle">

## Features

- **Per-session delegation grant** — the `subagent_kimi` tool is this package's `./tool` composition entry, granted to the sessions of an agent preset that names it (e.g. dev mode); sessions on other presets never see it.
- **Scoped home** — config, credentials, and sessions live under `$DSH_HOME/local-agent/kimi`, never in your `~/.kimi-code`.
- **Endpoint credential (the only auth mode)** — fill `baseUrl` + `apiKey` on the card's Authentication section (saved as the default scope's `endpoint-auth.json`, mode 0600, local only) or preconfigure the profile row, and the scope is authenticated; every named scope may override the deployment pair field by field with its own `endpoint-auth.json`. The managed provider reads the key through its `api_key_env` indirection from the child process's environment — the key never lands in `config.toml` (an evaluation-condition input). Container rounds share the host's credential; nothing is authorized inside a unit. There is no web login and no device code. The "Verify endpoint & list models" button next to it runs a token-free probe against the SAVED endpoint (`GET <baseUrl>/v1/models`, Bearer header) and answers with reachability plus the served model list.
- **Resumable delegations** — pass back the self-described `resume` handle to continue the same Kimi session, with real per-round usage and timing.
- **Session records and transcript replay** — `/kimi sessions` lists this harness's delegations (never your personal sessions); `/kimi session <id>` renders the session's wire log as a readable transcript — thinking, tool calls, and results included.
- **Settings card** — a section of the core's「Local Agent Delegation」family card on the Plugins page (on an older core, this package's own `plugins.item` card; mounted while the Host serves the `local-agent-kimi` namespace) shows auth status and the scoped sessions at a glance; login/logout, the available-models shortlist (ordered, the first entry is the default; empty = the legacy chain), and the resident-mode switch all hot-apply, no reload.
- **Model readback and per-cell working directory** — every settled round reads back the model from the wire.jsonl usage/request records into the delegation record; orchestrators pass a `cwd` per cell, and a resume in a different directory is rejected.
- **Resident driver (optional)** — `live: true` keeps one resident `kimi acp` process per member, one `session/prompt` per round, with runtime-level graceful cancel; off — or a channel that cannot come up — means the one-shot `kimi -p` path.

## Install

Requires a running dsh profile and the Kimi Code CLI (`kimi`) on `PATH` — the plugin installs neither and never logs in on your behalf.

```sh
# Name both: `dsh plugin add` reconciles only direct dependencies.
dsh plugin --profile web add @khorsheed/dsh-local-agent
dsh plugin --profile web add @khorsheed/dsh-local-agent-kimi
```

Restart the web instance to activate, then fill the endpoint and key in the Kimi section's Authentication block of the「Local Agent Delegation」family card (the Plugins page) — or preconfigure the profile row; with neither, the status reads unauthenticated. Uninstall:

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-kimi
```

The scoped home is kept on purpose so a reinstall keeps its credential — delete `$DSH_HOME/local-agent/kimi` to remove every trace.

## Config

Optional: route Kimi's LLM requests through your own endpoint via the scoped `config.toml` (`$DSH_HOME/local-agent/kimi/config.toml`):

```toml
[providers."managed:kimi-code"]
base_url = "https://your-router.example/v1"
```

Edit **only this key** — provisioning never overwrites an existing config, and the `[services.moonshot_*]` base URLs must stay (they route the built-in search/fetch tools).

⚠️ **Credential exposure**: the endpoint key is sent to whatever endpoint serves the request — point `baseUrl` only at endpoints you control or trust.

Plugin config of its own (optional, in the profile patch layer):

```yaml
- id: local-agent-kimi
  config:
    model: kimi-code/k3        # optional: every delegation round starts the CLI with it; absent passes no model at all (below)
    thinkingEffort: high       # reasoning effort; written into a FRESH scoped config.toml ([thinking] effort and the model default_effort; low/high/max, default high). Provision-time only — an existing config is never overwritten
    live: false                # resident driver: one resident kimi acp process per member, one session/prompt per round (runtime-level graceful session/cancel, push-triggered mirroring); off — or a channel that cannot come up — means the one-shot kimi -p path
    liveIdleMs: 1800000        # idle lifetime of a resident runtime before reclaim (default 30 min)
```

**Migration note.** Live runs always consume incremental output: the old `liveMirrorGranularity: event | token` key is accepted for existing profiles but ignored, and changing it never changes a running process. Exec remains available for evaluation. Final provider items remain authoritative, including tool history and usage.

### Default model (`model`)

⚠️ **This key's meaning changed.** It used to apply exactly once, when a FRESH scoped home was provisioned: it became the `default_model` of the written `config.toml`, and an existing config was left alone. It now applies to **every delegation round**. The provisioning mirror is kept: a fresh scoped home with no user config to mirror still gets its minimal managed config built around this value.

**Absent = today's behavior.** Without this key the plugin adds no model flag to the argv at all: the scoped `config.toml`'s top-level `default_model` decides which model runs.

**Set = every delegation round starts the CLI with it.** The value must name a model the scoped `config.toml` defines (a `[models."…"]` key) — `-m` resolves against kimi's own model table.

| Drive | How it is passed |
|---|---|
| one-shot (default) | `kimi -m <model> -p <task>`; a resume round is `kimi -S <session> -m <model> -p <task>` — `-S` still leads and `-m` hugs `-p` (anything after `-p` is read as the prompt) |
| resident (`live: true`) | `kimi acp` has **no** model flag, so the scoped `config.toml`'s top-level `default_model` is rewritten to the value before each runtime spawns. The write is in place and idempotent: only that one top-level line moves, while comments, model tables, providers and `[thinking]` stay byte-identical; with no config to write into, none is created (provisioning owns creation), the round still runs, and the model read-back is what surfaces a mismatch |

So: the one-shot drive never touches your `config.toml`; the resident drive rewrites its `default_model` line.

The settings card's「Available models」section maintains an **ordered model shortlist**: "Add model" checks entries off the endpoint's served catalog, so the list can only hold what the endpoint actually serves; drag rows to reorder. **The first entry is the default model** — every delegation round starts the CLI with it (an argv flag one-shot, or the scoped `default_model` rewrite before a resident spawn), outranked only by member session overrides and delegation-level picks. The list persists in the scoped home's `models.json` (each named scope may carry its own, the same file mechanism as the endpoint credential), every edit saves immediately and applies to the next round. **Empty = the legacy chain** (the `model` key → the scoped config's top-level `default_model` → the CLI built-in). kimi's `-m` resolves against the scoped config's `[models."…"]` tables (verified against kimi-cli 2.1.1: a bare endpoint id without a table is not runnable), so adding a served id that has no table yet provisions its managed table in the same write (the endpoint-reported display name, effort levels and context window ride along). Per-member model and effort changes use the durable controls described below. The member session's model/effort dialog mirrors this shortlist exactly: the candidates are the list (in list order); a member's currently bound model outside the list stays visible so an existing binding never renders blank.

The directory's vocabulary comes from the endpoint itself (`GET <baseUrl>/v1/models`); the scoped config's model tables only enrich it: when a served id matches a managed table's `model`, the candidate's value is the TABLE KEY (the name `-m` actually runs), and display name / reasoning efforts prefer the endpoint's answer with the table as fallback. A resident member's native ACP configOptions remain that member's authoritative directory (labels plus the current model's reasoning options). With no credential, a rejected credential, an unreachable-shape answer or no models served, the directory loads empty with the reason; a transport failure keeps the last good snapshot and retries on the cache's schedule. Reads create no disposable ACP sessions. Directory refresh and subscriptions use the shared core cache. The shared model picker and member effort controls are connected. Busy selections apply at the next complete turn boundary, including tool continuations; core owns current/pending state, cancellation and retry, while frozen evaluation members reject changes.

**A delegation's own model outranks this key.** An orchestrator may name the model for ONE delegation through the facade's `DelegationCallOptions.model`, which sits above this key (the layer order is in the family core README). The first round's request is recorded and every resume round re-requests it — `resume` takes no model of its own. In resident mode it becomes the member's **start model**: bound through the scoped-config rewrite before the runtime spawns; a resident runtime already bound to another model is retired first and respawns onto the new one, `session/load`-ing the same CLI session.

**Member-level switching (composer).** A member session's composer can switch that member's model: a **session-level override** ranking above every layer (the delegation record included). It lives in memory only and does not survive a host restart. In resident mode a switch retires the runtime whose bound model differs — the next round respawns onto the new model and `session/load`s the same CLI session, so the conversation carries over; on the one-shot drive the next round simply passes the new value to `-m`.

**This is not an evaluation gap.** A run freezes its condition at setup: change the key mid-run and the next round's model read-back sees declared ≠ observed and fails the run as misattributed (frozen decision 5).

**Evaluation snapshot (`effectiveSettings`).** The harness declares a live-read snapshot of its fairness-relevant settings for the evaluation condition hash: drive (exec/live, following the live preference), reasoning effort (read from the scoped config's `[thinking] effort`, falling back to the model's `default_effort`), whether tool use is auto-approved (the scoped config carries the `Bash(*)` allow rule), whether a custom endpoint is pinned (hostname only; the managed endpoint does not count as pinned), the configured model (the scope's `models.json` first entry first, then the plugin config's `model` key — it overrules the file every round — then the scoped config's top-level `default_model`; absent when none names one — never guessed), and the CLI version (`kimi --version`, cached against the executable's path + mtime; absent when the CLI cannot be asked). `/kimi status` and the `LocalAgentStatus` Remote attach the same snapshot — this is the read side of web-eval frozen decisions 2 through 4.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ public API compatible — live generation rides the local-agent transient Remote and public Conversation nodes; suffix checkpoints provide recovery, and native final messages retain transcript and usage semantics. minHost is 0.1.5-rc.1; older hosts stay on the previous release line. 0.1.5 retired the per-chunk session event: token-granularity deltas no longer land in the child session log — they ride the run-progress channel and the round settles as one combined assistant/message (identical final text); a late-arriving usage whose carrier message already mirrored is dropped with a warn (the host has no usage-backfill event). The settings card renders as a section of the core's「Local Agent Delegation」family card (the core's `plugins.item` entry on the Plugins page, 0.1.7-alpha.1+; on an older core this package falls back to its own `plugins.item` card), mounted through `configForms.whileServed` while the Host serves the `local-agent-kimi` namespace; 0.1.5 renders no card (the host removed the `settings.plugin.item` seat) — every other surface is unchanged.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.2.1-rc.1) — host-021 wave: full build+test green against the 0.2.1-rc.1 tree; delegation migrated to `ctx.subagents.startActivation` (managed activation), and run.id is now unique per execution. The `thinkingEffort` config item (default high, provision-time only) and the `effectiveSettings` evaluation snapshot are plugin-level: they read and write scoped files only, with no host-API dependency on either host line.

## Known Limitations

- **No web login** — the endpoint credential is the only auth path (the card or the profile row; a kimi-for-coding platform key or a relay key alike). The kimi-subscription OAuth path is not part of this package.
- **Process bookkeeping touches the real home** — kimi writes content-free `~/.kimi-code/server/instances/*.json` regardless of `KIMI_CODE_HOME`; config, credentials, and sessions stay scoped.
- **`/kimi` commands need a Web session** — headless profiles can still delegate through a composition that mounts the tool row.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Scoped home and credentials.** Every Kimi process the bundle starts runs with `KIMI_CODE_HOME=$DSH_HOME/local-agent/kimi`. Authentication is endpoint-key only: the scope's `endpoint-auth.json` (mode 0600) merges field by field over the profile row's `baseUrl`/`apiKey`; the managed provider (`managed:kimi-code`) declares `api_key_env = "DSH_KIMI_ENDPOINT_KEY"` in config.toml (the kimi CLI natively reads the key from a named environment variable — mutually exclusive with an inline `api_key`), so the key lives only in endpoint-auth.json and in the child process's environment, and `config.toml` never carries a secret and stays a legitimate evaluation-condition input. The card's Authentication section edits exactly this file for the default scope (through the family gateway's `endpointAuth`/`configureEndpoint` Remotes); saving a baseUrl re-points the managed provider's `base_url` in the same write (clearing it falls back to kimi's own service), and an idempotent pre-spawn pass applies hand-edits just as immediately. The one-shot `kimi -p`, the resident `kimi acp`, and container rounds (`containerExecSpawn`'s name-only env forwarding) share the same injection. On first boot the scoped home is provisioned with a `config.toml` — the user's own config with every `api_key` blanked and migrated onto the env-key shape, or a minimal managed config when the user has none. The OAuth era's `credentials/` and `oauth/` directories are swept on every provision — this package no longer reads them, and keeping them would let a dead grant authenticate while the status reads unauthenticated. `/kimi logout` deletes the scope's `endpoint-auth.json`; when the credential comes entirely from the profile row, logout refuses and names the profile as the place to edit.

**Mounting.** The bundle patch registers the `kimi` harness (exactly one provider row); the `subagent_kimi` tool is this package's `./tool` composition entry (sharing the family core's `./tool-factory` implementation), granted per session by an agent preset that names it — the dev preset's `tool-subagent-kimi` row is the grant point. The `kimi-cli` one-shot provider spawns `kimi -p` under the scoped home. The family core (`local-agent` row, shared scoped-homes root) ships in `@khorsheed/dsh-local-agent`'s own patch, declared here as a dependency. The browser settings card ships with this package's own `./client` half, composing the family core's shared building blocks (the auth block, the model picker): it renders as a section of the core's「Local Agent Delegation」family card, mounted through `configForms.whileServed` while the Host serves the `local-agent-kimi` namespace — one section for a standalone install, a family bundle, or a mode pack alike (on an older core, this package's own `plugins.item` card instead). The identity triangle stays consistent: the `cordis.patch.yml` row id, the package.json name, and tsdown's `clientBundle('@khorsheed/dsh-local-agent-kimi')`.

**Session records and transcripts.** `/kimi sessions` lists the scoped home's `session_index.jsonl` — this harness's delegations, never the user's personal sessions. `/kimi session <id>` reads that session's `wire.jsonl` and renders a readable transcript: user prompts, thinking, and assistant replies are tagged with their wire turn number (1-based, matching the child session's `turn/start` numbering), tool calls render with arguments and results paired to their calls (file-editing calls render patch-style, unknown content types keep a visible marker), and kimi's auto-permission `<system-reminder>` messages are filtered out. The settings card shows auth status and the scoped sessions narrowed to the current workspace; while a login is pending the status keeps re-probing until credentials land.

**Model readback and the cwd override.** After every settled round the provider reports the actual model from the wire.jsonl `usage.record` (falling back to `llm.request`) events' `model` field — last one seen, since a resumed session's later rounds append later records — through the `settled` run-progress event, and merges it into the delegation record's `observedModel` field; absence is recorded, never guessed. An orchestrator may also pass a per-round working directory through the facade's `DelegationCallOptions.cwd` (recorded as the record's `cwd`); when a resume round resolves to a different directory than the recorded first round, it fails loud before any process spawns — a CLI session continues in the directory its first round ran in.

**Model broker.** The harness registers a `modelBroker` with the registry: the settings card reads the memberless `modelInfo` (effective layer + choices) and the member composer reads and writes the per-member override through the gateway. The resolution order is fixed: override → the delegation's recorded model → the scope's `models.json` first entry → the plugin `model` key → the scoped `default_model` → the CLI's built-in default (which names nothing). Choices: a non-empty `models.json` is the COMPLETE vocabulary (nothing outside the endpoint's served catalog sneaks in); empty falls back to the legacy chain — the deduped union of the key, the scoped default, the config's `[models."…"]` tables, and the recent saves. The override and the start-model ledger are in-memory (cleared on restart); `setMemberModel` throws while the member has a round in flight, and otherwise retires the resident runtime when its bound model differs from the new effective one (a same-model switch is a no-op) — the next round respawns lazily.

**Tool-call accounting.** Every settled round also reports how many tool calls it made, on the `settled` run-progress event (`toolCalls: { count, byName }`). What is counted is the transcript's `tool.call` lines carrying THIS ROUND'S TURN — deliberately not the mirror window: in resident mode a live poll may have drained the settle pass's delta, and a resume round must not inherit the earlier rounds' calls. `byName` keys are the tool names the wire gave, verbatim. One accounting per round, never cumulative; a round that called nothing carries no field at all (absent is not zero).

**Resume.** A fresh delegation's result text self-describes the handle (`追问请带 resume="<childSessionId>"`); passing it back as the tool's optional `resume` parameter continues the same kimi session (`kimi -S session_<id> -p`) inside the same dsh child session. The handle never rides the prompt: it is resolved through the `localAgent` delegation registry only for the same parent session and provider that recorded the delegation — a forged handle is rejected before any CLI process starts.

**Isolation and accounting.** The child is a fresh session in the delegating session's workspace; the parent receives only the final answer or the exact error — child context, commentary, tool activity, and diffs never cross into the parent session. The provider opens `turn/start` at spawn and closes `turn/end` at settle, including on failure or abort (reason `error`/`aborted`), so durations equal real CLI runtime. Every mirrored step (assistant message, tool call/result) is one atomic `step/start`–`step/end` triple at the same (turn, step) — the host's live conversation assembler registers a step only at its boundaries, and the released-log reader admits only dense, strictly sequential steps on a cold read. Token-granularity deltas ride the `local-agent/stream` live channel while their durable content lands as one triple at the completion fold or settle, before `turn/end`; a tool call folds its whole native lifecycle (advertisement, call, result) once the wire records its result, and a call it never records settles with an interrupted placeholder. The fold's grain is the wire step (one LLM request): a step's thinking, reply and tool calls fold into ONE dsh step — one assistant message carrying the reasoning/text/tool-call blocks with the call/result pairs inside the same boundary, the host session's own shape, so Context Lens reads one request per LLM call with per-request real usage; a step the wire has not closed yet (no `step.end`) waits whole in incremental passes and lands whole once closed. Each `usage.record` (one request's accounting, not cumulative) rides its own step's message; the mirror filters kimi's auto-permission `<system-reminder>` messages, renders tool calls with arguments, pairs results to their calls, and advances incrementally so earlier messages never duplicate. Aborting settles the tool result immediately (SIGTERM→grace→SIGKILL) and keeps the partial work already mirrored.

**Named scopes.** a named scope opens a second `KIMI_CODE_HOME` at `<homesRoot>/kimi@<name>`; the directory is provisioned with the same two steps in the same order (provider/model config first, then the permission rules — the permission write reads the config file). From then on that scope has its own endpoint-auth.json, its own wire log and its own transcript mirror. A scoped delegation is exec-only (the resident `kimi acp` is bound per member to the default scoped home) and carries **no member channel**: the bridge declaration is written into a scoped home's `mcp.json` and the socket is a single homes-root one, so a named absence beats a half-wired presence.

**Container delegation.** An orchestrator may run the round inside an **already-acquired container** through the facade's `DelegationCallOptions.exec` (`{ container, workdir, env? }`): the argv becomes `docker exec -w <workdir> [-e NAME…] <container> kimi -p …` and everything else (the wire.jsonl mirror and readback, settle, recording) is byte-for-byte unchanged. `env` must name the in-container `KIMI_CODE_HOME`, and it should be the read-write bind mount of the host scoped home — the transcript mirror and the model readback read the host copy of the wire log. A container round always takes the exec one-shot (the resident `kimi acp` is a host process) and **does not write** the member-bridge entry into `mcp.json`: that declaration names a host node path the unit cannot start, and leaving a broken server in a shared config file is worse than running one round without the member channel.

**Live driver (`live: true`).** Replaces the per-round spawn: the member's first delegation brings up one resident `kimi acp` process (ACP over stdio; the handshake requires the `loadSession` capability, otherwise the breaker falls back), `session/new` creates the session (the server-assigned id becomes the delegation record's `cliSessionId`), and every later round is one `session/prompt`; `cancel` lands as `session/cancel` — the process survives and the session stays continuable. The member bridge rides the ACP `mcpServers` inline declaration (no mcp.json write). `session/request_permission` is auto-answered unattended (first allow option, cancelled when none — matching `kimi -p`'s auto-approve). **Mirroring of completed items deliberately stays on the file fold**: ACP pushes token-level chunks, which are not isomorphic to the wire.jsonl line fold, so pushes only trigger throttled `mirrorKimiDelta` passes and the settle pass stays authoritative — one fold, one offset, and the two driver paths cannot drift. Live output folds each completed item 1:1; generation-time text uses the shared transient channel with a maximum batching wait of 50ms. Incremental recovery checkpoints are independent of browser publication, and native final messages replace transient presentation at the reserved (turn, step). Aborted streams retain a final message marked interrupted. Runtimes are reclaimed after an idle timeout (stdin EOF → SIGTERM ladder); after a crash the next round re-spawns and `session/load`s the on-disk session.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/local-agent-kimi`). Issues and contributions welcome there.
