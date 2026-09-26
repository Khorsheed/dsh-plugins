# @khorsheed/dsh-local-agent-kimi

English | [中文](README.md)

Delegate a task from any dsh session to the Kimi Code CLI on your machine — it runs in its own scoped home, and your `~/.kimi-code` stays untouched.

Getting the model to hand a whole chunk of work to another coding agent used to mean opening a terminal yourself, copy-pasting, and carrying the result back. This plugin gives every agent preset a `subagent_kimi` delegation tool and a `/kimi` command family: delegations run as child sessions in the session's workspace, their transcripts and progress show up in the subagent surface, results come back with real usage and timing, and the same handle resumes the conversation later.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/local-agent-kimi-settings.png" width="640" alt="the Kimi settings card: auth status, login/logout, default model, and the resident-mode toggle">

## Features

- **Delegate from any preset** — the `subagent_kimi` tool mounts at the profile root; standard/code/minimal/cordis and future presets need no per-preset variants.
- **Scoped home** — config, credentials, and sessions live under `$DSH_HOME/local-agent/kimi`, never in your `~/.kimi-code`.
- **Device-code login** — `/kimi login` shows the auth URL in the session; `/kimi logout` clears scoped credentials for a fresh account.
- **Resumable delegations** — pass back the self-described `resume` handle to continue the same Kimi session, with real per-round usage and timing.
- **Session records and transcript replay** — `/kimi sessions` lists this harness's delegations (never your personal sessions); `/kimi session <id>` renders the session's wire log as a readable transcript — thinking, tool calls, and results included.
- **Settings card** — the card on the plugin detail view (0.1.5: Settings → Plugins → configurable plugins) shows auth status and the scoped sessions at a glance; login/logout, the default model, and the resident-mode switch all hot-apply, no reload.
- **Model readback and per-cell working directory** — every settled round reads back the model from the wire.jsonl usage/request records into the delegation record; orchestrators pass a `cwd` per cell, and a resume in a different directory is rejected.
- **Resident driver (optional)** — `live: true` keeps one resident `kimi acp` process per member, one `session/prompt` per round, with runtime-level graceful cancel; off — or a channel that cannot come up — means the one-shot `kimi -p` path.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/local-agent-kimi-sessions.png" width="640" alt="the /kimi sessions delegation list and a /kimi session transcript replay inside a session">

## Install

Requires a running dsh profile and the Kimi Code CLI (`kimi`) on `PATH` — the plugin installs neither and never logs in on your behalf.

```sh
# Name both: `dsh plugin add` reconciles only direct dependencies.
dsh plugin --profile web add @khorsheed/dsh-local-agent
dsh plugin --profile web add @khorsheed/dsh-local-agent-kimi
```

Restart the web instance to activate, then run `/kimi login` once from a session. Uninstall:

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-kimi
```

The scoped home is kept on purpose so a reinstall needs no fresh login — delete `$DSH_HOME/local-agent/kimi` to remove every trace.

## Config

Optional: route Kimi's LLM requests through your own endpoint via the scoped `config.toml` (`$DSH_HOME/local-agent/kimi/config.toml`):

```toml
[providers."managed:kimi-code"]
base_url = "https://your-router.example/v1"
```

Edit **only this key** — provisioning never overwrites an existing config, and the `[services.moonshot_*]` base URLs must stay (they route the built-in search/fetch tools).

⚠️ **OAuth token exposure**: the scoped OAuth token is sent to whatever endpoint serves the request — point `base_url` only at endpoints you control or trust.

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

The settings card's "Default model" writes the provider setting for subsequent rounds. Its shared picker displays the scoped model directory, discovery source and completeness, plus an explicit model-ID input when needed. Clearing the selection follows the effective configuration/default chain. Saving does not interrupt an active round and requires no reload. If the shared picker is unavailable, the card retains its text-input fallback. Per-member model and effort changes use the durable controls described below.

The rich directory uses native ACP session model/configuration metadata when a live member exposes it, preserving labels and the current model's reasoning options. Before that it shows the member's scoped configuration as incomplete, configuration-sourced candidates. Reads create no disposable ACP sessions. Directory refresh and subscriptions use the shared core cache. The shared model picker and member effort controls are connected. Busy selections apply at the next complete turn boundary, including tool continuations; core owns current/pending state, cancellation and retry, while frozen evaluation members reject changes.

**A delegation's own model outranks this key.** An orchestrator may name the model for ONE delegation through the facade's `DelegationCallOptions.model`, which sits above this key (the layer order is in the family core README). The first round's request is recorded and every resume round re-requests it — `resume` takes no model of its own. In resident mode it becomes the member's **start model**: bound through the scoped-config rewrite before the runtime spawns; a resident runtime already bound to another model is retired first and respawns onto the new one, `session/load`-ing the same CLI session.

**Member-level switching (composer).** A member session's composer can switch that member's model: a **session-level override** ranking above every layer (the delegation record included). It lives in memory only and does not survive a host restart. In resident mode a switch retires the runtime whose bound model differs — the next round respawns onto the new model and `session/load`s the same CLI session, so the conversation carries over; on the one-shot drive the next round simply passes the new value to `-m`.

**This is not an evaluation gap.** A run freezes its condition at setup: change the key mid-run and the next round's model read-back sees declared ≠ observed and fails the run as misattributed (frozen decision 5).

**Evaluation snapshot (`effectiveSettings`).** The harness declares a live-read snapshot of its fairness-relevant settings for the evaluation condition hash: drive (exec/live, following the live preference), reasoning effort (read from the scoped config's `[thinking] effort`, falling back to the model's `default_effort`), whether tool use is auto-approved (the scoped config carries the `Bash(*)` allow rule), whether a custom endpoint is pinned (hostname only; the managed endpoint does not count as pinned), the configured model (the plugin config's `model` key first — it overrules the file every round — then the scoped config's top-level `default_model`; absent when neither names one — never guessed), and the CLI version (`kimi --version`, cached against the executable's path + mtime; absent when the CLI cannot be asked). `/kimi status` and the `LocalAgentStatus` Remote attach the same snapshot — this is the read side of web-eval frozen decisions 2 through 4.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ public API compatible — live generation rides the local-agent transient Remote and public Conversation nodes; suffix checkpoints provide recovery, and native final messages retain transcript and usage semantics. minHost is 0.1.5-rc.1; older hosts stay on the previous release line. 0.1.5 retired the per-chunk session event: token-granularity deltas no longer land in the child session log — they ride the run-progress channel and the round settles as one combined assistant/message (identical final text); a late-arriving usage whose carrier message already mirrored is dropped with a warn (the host has no usage-backfill event).
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.5-rc.1) — the `thinkingEffort` config item (default high, provision-time only) and the `effectiveSettings` evaluation snapshot are plugin-level: they read and write scoped files only, with no host-API dependency on either host line.

## Known Limitations

- **Login is interactive** — device-code only, one login at a time per harness, no API-key path.
- **Process bookkeeping touches the real home** — kimi writes content-free `~/.kimi-code/server/instances/*.json` regardless of `KIMI_CODE_HOME`; config, credentials, and sessions stay scoped.
- **`/kimi` commands need a Web session** — headless profiles can still delegate through a composition that mounts the tool row.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Scoped home and login.** Every Kimi process the bundle starts runs with `KIMI_CODE_HOME=$DSH_HOME/local-agent/kimi`. Login is device-code only: `/kimi login` surfaces the authorization URL and code in the session, the CLI polls in the background, and credentials land in the scoped home. `/kimi logout` removes the scoped credentials and OAuth cache (the kimi CLI has no logout command). On first boot the scoped home is provisioned with a `config.toml` — the user's own config with every `api_key` blanked, or a minimal managed config when the user has none — because the CLI refuses to authenticate without provider and model definitions; an existing config is never overwritten.

**Mounting.** The bundle patch registers the `kimi` harness and mounts the `subagent_kimi` tool at the profile root; the `kimi-cli` one-shot provider spawns `kimi -p` under the scoped home. The family core (`local-agent` row, shared scoped-homes root) ships in `@khorsheed/dsh-local-agent`'s own patch, declared here as a dependency. The browser settings card ships with this package's own `./client` half, composing the family core's shared building blocks (the auth block, the model picker): a standalone install renders it on this package's plugin detail view, a family-bundle install renders it through the row-level configure entry on the bundle's detail view, and a 0.1.5 host renders it under Settings → Plugins → configurable plugins. The identity triangle stays consistent: the `cordis.patch.yml` row id, tsdown's `clientBundle('@khorsheed/dsh-local-agent-kimi')`, and `src/invariant.ts`'s `PACKAGE_NAME`; the invariant companion also pins one contract — a registered `kimi` harness must name `KIMI_CODE_HOME` as its scoped-home variable.

**Session records and transcripts.** `/kimi sessions` lists the scoped home's `session_index.jsonl` — this harness's delegations, never the user's personal sessions. `/kimi session <id>` reads that session's `wire.jsonl` and renders a readable transcript: user prompts, thinking, and assistant replies are tagged with their wire turn number (1-based, matching the child session's `turn/start` numbering), tool calls render with arguments and results paired to their calls (file-editing calls render patch-style, unknown content types keep a visible marker), and kimi's auto-permission `<system-reminder>` messages are filtered out. The settings card shows auth status and the scoped sessions narrowed to the current workspace; while a login is pending the status keeps re-probing until credentials land.

**Model readback and the cwd override.** After every settled round the provider reports the actual model from the wire.jsonl `usage.record` (falling back to `llm.request`) events' `model` field — last one seen, since a resumed session's later rounds append later records — through the `settled` run-progress event, and merges it into the delegation record's `observedModel` field; absence is recorded, never guessed. An orchestrator may also pass a per-round working directory through the facade's `DelegationCallOptions.cwd` (recorded as the record's `cwd`); when a resume round resolves to a different directory than the recorded first round, it fails loud before any process spawns — a CLI session continues in the directory its first round ran in.

**Model broker.** The harness registers a `modelBroker` with the registry: the settings card reads the memberless `modelInfo` (effective layer + choices) and the member composer reads and writes the per-member override through the gateway. The resolution order is fixed: override → the delegation's recorded model → the plugin `model` key → the scoped `default_model` → the CLI's built-in default (which names nothing). Choices are the deduped union of the key, the scoped default, the config's `[models."…"]` tables, and the recent saves. The override and the start-model ledger are in-memory (cleared on restart); `setMemberModel` throws while the member has a round in flight, and otherwise retires the resident runtime when its bound model differs from the new effective one (a same-model switch is a no-op) — the next round respawns lazily.

**Tool-call accounting.** Every settled round also reports how many tool calls it made, on the `settled` run-progress event (`toolCalls: { count, byName }`). What is counted is the transcript's `tool.call` lines carrying THIS ROUND'S TURN — deliberately not the mirror window: in resident mode a live poll may have drained the settle pass's delta, and a resume round must not inherit the earlier rounds' calls. `byName` keys are the tool names the wire gave, verbatim. One accounting per round, never cumulative; a round that called nothing carries no field at all (absent is not zero).

**Resume.** A fresh delegation's result text self-describes the handle (`追问请带 resume="<childSessionId>"`); passing it back as the tool's optional `resume` parameter continues the same kimi session (`kimi -S session_<id> -p`) inside the same dsh child session. The handle never rides the prompt: it is resolved through the `localAgent` delegation registry only for the same parent session and provider that recorded the delegation — a forged handle is rejected before any CLI process starts.

**Isolation and accounting.** The child is a fresh session in the delegating session's workspace; the parent receives only the final answer or the exact error — child context, commentary, tool activity, and diffs never cross into the parent session. The provider opens `turn/start` at spawn and closes `turn/end` at settle, including on failure or abort (reason `error`/`aborted`), so durations equal real CLI runtime. Every mirrored step (assistant message, tool call/result) is wrapped in a `step/start`–`step/end` boundary pair at the same (turn, step) — the host's live conversation assembler registers a step only at its boundaries, so without them assistant messages do not render in the real-time view (only a full rebuild recovers them); the token granularity's streaming snapshots and completion folds also land before `turn/end`, boundaries included. Usage is the sum of the round's `usage.record` deltas (each one LLM request, not cumulative), carried on the round's final mirrored assistant message; the mirror filters kimi's auto-permission `<system-reminder>` messages, renders tool calls with arguments, pairs results to their calls, and advances incrementally so earlier messages never duplicate. Aborting settles the tool result immediately (SIGTERM→grace→SIGKILL) and keeps the partial work already mirrored.

**Named scopes.** `/kimi login --scope <name>` opens a second `KIMI_CODE_HOME` at `<homesRoot>/kimi@<name>`; the directory is provisioned with the same two steps in the same order (provider/model config first, then the permission rules — the permission write reads the config file). From then on that scope has its own login, its own wire log and its own transcript mirror. A scoped delegation is exec-only (the resident `kimi acp` is bound per member to the default scoped home) and carries **no member channel**: the bridge declaration is written into a scoped home's `mcp.json` and the socket is a single homes-root one, so a named absence beats a half-wired presence.

**Container delegation.** An orchestrator may run the round inside an **already-acquired container** through the facade's `DelegationCallOptions.exec` (`{ container, workdir, env? }`): the argv becomes `docker exec -w <workdir> [-e NAME…] <container> kimi -p …` and everything else (the wire.jsonl mirror and readback, settle, recording) is byte-for-byte unchanged. `env` must name the in-container `KIMI_CODE_HOME`, and it should be the read-write bind mount of the host scoped home — the transcript mirror and the model readback read the host copy of the wire log. A container round always takes the exec one-shot (the resident `kimi acp` is a host process) and **does not write** the member-bridge entry into `mcp.json`: that declaration names a host node path the unit cannot start, and leaving a broken server in a shared config file is worse than running one round without the member channel.

**Live driver (`live: true`).** Replaces the per-round spawn: the member's first delegation brings up one resident `kimi acp` process (ACP over stdio; the handshake requires the `loadSession` capability, otherwise the breaker falls back), `session/new` creates the session (the server-assigned id becomes the delegation record's `cliSessionId`), and every later round is one `session/prompt`; `cancel` lands as `session/cancel` — the process survives and the session stays continuable. The member bridge rides the ACP `mcpServers` inline declaration (no mcp.json write). `session/request_permission` is auto-answered unattended (first allow option, cancelled when none — matching `kimi -p`'s auto-approve). **Mirroring of completed items deliberately stays on the file fold**: ACP pushes token-level chunks, which are not isomorphic to the wire.jsonl line fold, so pushes only trigger throttled `mirrorKimiDelta` passes and the settle pass stays authoritative — one fold, one offset, and the two driver paths cannot drift. Live output folds each completed item 1:1; generation-time text uses the shared transient channel with a maximum batching wait of 50ms. Incremental recovery checkpoints are independent of browser publication, and native final messages replace transient presentation at the reserved (turn, step). Aborted streams retain a final message marked interrupted. Runtimes are reclaimed after an idle timeout (stdin EOF → SIGTERM ladder); after a crash the next round re-spawns and `session/load`s the on-disk session.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/local-agent-kimi`). Issues and contributions welcome there.
