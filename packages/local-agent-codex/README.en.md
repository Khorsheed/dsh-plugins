# `@khorsheed/dsh-local-agent-codex`

English | [中文](README.md)

**Live output migration.** Live runs always consume incremental output. The old `liveMirrorGranularity: event | token` key is accepted for existing profiles but ignored; changing it never changes a running process. Exec remains available for evaluation. Final provider items remain authoritative, including tool history and usage.

Delegate coding tasks from any dsh agent preset to your locally installed Codex CLI. Delegations run under a plugin-scoped home, so your personal `~/.codex` — config, credentials, sessions — is never touched.

## Features

- **Delegate from any preset** — the `subagent_codex` tool mounts at the profile root; no per-preset setup.
- **Scoped-home isolation** — all Codex state lives in `$DSH_HOME/local-agent/codex`, separate from your `~/.codex`.
- **In-session login** — device-code `/codex login`, with auth status and sign-out under Settings → 本地 Agent.
- **Resume a thread** — pass `resume="<childSessionId>"` to continue the same codex thread in the same dsh child session.
- **Custom endpoint** — route Codex's LLM requests through your own router via a scoped `config.toml` provider.
- **Read-back and per-cell working directory** — every settled round reads the model, CLI version and usage back out of its own rollout into the delegation record; the file is located by thread id, cwd and time window, so concurrent runs each read their own round. Orchestrators pass a `cwd` per cell, and a resume in a different directory is rejected.
## Install

Prerequisites: a dsh profile and the Codex CLI (`codex`) on `PATH` — the plugin neither installs it nor logs in for you.

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent
dsh plugin --profile web add @khorsheed/dsh-local-agent-codex
# restart the profile, then run /codex login once from a session
```

Both packages must be named explicitly — `dsh plugin add` reconciles only direct dependencies.

Uninstall:

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-codex
```

The scoped home (`$DSH_HOME/local-agent/codex`) is kept so a reinstall needs no fresh login; delete it to remove every trace.

## Config

Optional, in the profile patch layer:

```yaml
- id: local-agent-codex
  config:
    sandbox: workspace-write   # codex exec policy: read-only | workspace-write | danger-full-access
    model: gpt-5.2             # optional: every delegation round starts the CLI with it; absent passes no model flag at all (below)
    live: false                # live driver: one resident codex app-server process per member, one turn per round (runtime-level graceful interrupt, push-mode mirroring); off — or a channel that cannot come up — means the one-shot exec path
    liveIdleMs: 1800000        # idle lifetime of a resident runtime before reclaim (default 30 min)
```

### Default model (`model`)

**Absent = today's behavior.** Without this key the plugin adds no model flag to the argv at all: the scoped `config.toml`'s top-level `model` decides which model runs, and codex's own default decides when that is missing too.

**Set = every delegation round starts the CLI with it.** A fresh round and a resume round are treated alike:

| Drive | How it is passed |
|---|---|
| one-shot (default) | `codex exec -m <model> …` — `-m` is an option of `codex exec` itself, so it precedes the `resume` subcommand (`codex exec resume` declares no `-m` of its own) |
| resident (`live: true`) | `codex app-server -c model="<model>" --stdio` — the app-server has no `-m`, so the model rides the process-level `-c` override the CLI documents for this |

The scoped `config.toml` is never rewritten: `-m` overrules it per round and the file stays exactly as you edited it.

The settings card’s "Default model" writes the provider setting for subsequent rounds. Its shared picker displays the scoped model directory, discovery source and completeness, plus an explicit model-ID input when needed. Clearing the selection follows the effective configuration/default chain. Saving does not interrupt an active round and requires no reload. If the shared picker is unavailable, the card retains its text-input fallback. Per-member model and effort changes use the durable controls described below.

The rich directory read now preserves native display labels, hidden candidates and reasoning options, traverses pagination, and uses the core cache and refresh subscription. Its context follows the member's scope and cwd. Failed refreshes retain the last successful snapshot as stale; configuration and history suggestions retain their source labels. The shared model picker and member effort controls are connected. Busy selections apply at the next complete turn boundary, including tool continuations; core owns current/pending state, cancellation and retry, while frozen evaluation members reject changes. A native catalog candidate is not proof of account access.

**A delegation's own model outranks this key.** An orchestrator may name the model for ONE delegation through the facade's `DelegationCallOptions.model` (the fixed order: session override > delegation record > this key > scoped config > CLI built-in). The first round's request is recorded and every resume round re-requests it — `resume` takes no model of its own. In live mode such a round is no longer refused: the model becomes the member's **start model**, bound at the app-server spawn; a resident runtime bound to a different model is retired first (the same codex thread resumes via thread/resume) so the round respawns onto the asked-for model.

**Member-level switching (the composer model picker).** A member session can switch its model per session: an in-memory session-level override, the highest-priority layer, deliberately lost on a host restart. A switch is refused while a round is in flight; when idle and the member has a resident runtime bound to a different model, the switch retires that runtime — the next round respawns onto the new model while the CLI session (rollout) itself carries over. On the one-shot (exec) drive there is no resident process, so the override simply decides the next round's `-m`.

**This is not an evaluation gap.** A run freezes its condition at setup: change the key mid-run and the next round's model read-back sees declared ≠ observed and fails the run as misattributed (frozen decision 5). "A new run follows the new value, a running one is never switched underneath you" is the design, not an oversight.

## Custom endpoint

Route Codex's LLM requests through your own endpoint by adding a custom provider to the scoped `$DSH_HOME/local-agent/codex/config.toml` (built-in providers can't be overridden, `OPENAI_BASE_URL` is ignored, and provisioning never overwrites an existing config):

```toml
[model_providers.dsh-router]
name = "dsh-router"
base_url = "https://your-router.example/v1"
model_provider = "dsh-router"
```

The last line selects the provider for delegations; keep the rest of the file intact.

⚠️ **Credential exposure**: the scoped `auth.json` token is sent to whatever endpoint serves the request — only use endpoints you control or trust. Each delegation logs the effective endpoint at info level.

**Evaluation snapshot (`effectiveSettings`).** The harness declares a live-read snapshot of its fairness-relevant settings for the evaluation condition hash: drive (exec/live), the sandbox policy (plugin config), the reasoning effort (the scoped config's top-level `model_reasoning_effort`), whether a custom endpoint is pinned (read from the scoped config's provider, hostname only), the configured model (the plugin config's `model` key first — it overrules the file on every argv — then the scoped config's top-level `model`; absent when neither names one — never guessed), and the CLI version (`codex --version`, cached against the executable's path + mtime; absent when the CLI cannot be asked). `/codex status` and the `LocalAgentStatus` Remote attach the same snapshot.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ public API compatible. Live generation uses the local-agent transient Remote and public Conversation nodes; suffix checkpoints provide recovery, and native final messages retain transcript and usage semantics. Browser P95 acceptance is tracked separately in the room coordinator proposal. Older hosts stay on the previous release line.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.5-rc.1)

## Known Limitations

- **Login needs one browser step** — device-code only; no API-key path.
- **`codex exec` is non-interactive** — actions the sandbox policy would approve are denied, not prompted; see the `sandbox` config.
- **Headless caveat** — `/codex` commands need a Web session; headless can still delegate via a composition mounting the tool row.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Named scopes.** `/codex login --scope <name>` opens a second scoped home at `<homesRoot>/codex@<name>`: the directory is provisioned with the same `config.toml` that pins credential storage to a file rather than the macOS keychain, so that scope's login lands in its own `auth.json`. A scoped delegation runs `codex exec` there, writes its rollout there and reads it back from there — exec-only, because the resident app-server is bound to the default scoped home.

**Bundle composition.** The patch registers the `codex` harness (scoped `CODEX_HOME`, device-code login, rollout-file session records) and mounts `subagent_codex` at the profile root; the `codex-local` one-shot provider spawns `codex exec` under that home. The settings section ships with the family core's `./client` half; the core itself comes from `@khorsheed/dsh-local-agent`, declared as a dependency.

**Login and credentials.** `/codex login` shows the device-code URL in-session and polls in the background; credentials land in the scoped home on authorization. First start writes a minimal `config.toml` pinning `cli_auth_credentials_store = "file"` — Codex's default `auto` would resolve to the macOS keychain, leaking credentials outside the scoped home and defeating this package's `auth.json` presence check; an existing config is left untouched. `/codex logout` deletes the scoped `auth.json`, so a later login authorizes a fresh account.

**Session records.** `/codex sessions` lists the scoped home's `sessions/YYYY/MM/DD/rollout-*.jsonl` files — sessions this plugin's delegations created, never your personal ones. The settings section narrows the list to records whose `workDir` matches the session cwd.

**Read-back and the cwd override.** After every settled round the provider reads three facts back out of that round's own rollout file, reports them through the `settled` run-progress event, and merges them into `delegations.jsonl`: the model (`turn_context.payload.model` — codex 0.144.0's exec stream carries no model at all, so the rollout is the only authority; filtered to this round's time window, so a resumed thread's earlier models are never misread), the CLI version (`session_meta.payload.cli_version` — written by the codex build that actually served the round, a stronger answer than probing the executable afterwards), and the token usage a non-completed round never streamed (the last `token_count`). Absence is recorded, never guessed.

**Tool-call accounting.** Every settled round also reports how many tool calls it made, on the `settled` run-progress event (`toolCalls: { count, byName }`). The count comes only from the `item.completed` branches the stream fold ALREADY walks — no new parse path: `command_execution`, `web_search_call`, `file_change`, and `function_call` each count once, and `function_call_output` is a result, not a second call. `byName` keys are **codex's own item types** (`command_execution`), not the display names the mirrored cards carry (`Bash`) — the accounting records what the CLI calls the thing. One accounting per round, never cumulative; a round that called nothing carries no field at all (absent is not zero). Measured: one "list the directory and count the files" round reads back `{count: 1, byName: {command_execution: 1}}`, and a two-command round reads back `{count: 2}`.

Both the locate and the scan are calibrated for concurrency. codex writes `turn_context` when the TURN STARTS, so a round that then produces enough events pushes it past the end of any tail-only scan — which read back null in a real evaluation run (the 38 KB smoke round read fine, the 100–500 KB cells did not), so a tail miss is followed by a bounded full-file read. The locate takes the round's **cwd** alongside the thread id: concurrent delegations put several cells' files inside one time window, and `session_meta.payload.cwd` is what tells them apart. A window holding candidates but none in this round's directory reports nothing rather than a neighbour's round — except when the window holds exactly one candidate, where the mismatch is path skew rather than ambiguity. An orchestrator may also pass a per-round working directory through the facade's `DelegationCallOptions.cwd` (recorded as the record's `cwd`); when a resume round resolves to a different directory than the recorded first round, it fails loud before any process spawns — a CLI session continues in the directory its first round ran in.

**Container delegation.** An orchestrator may run the round inside an **already-acquired container** through the facade's `DelegationCallOptions.exec` (`{ container, workdir, env? }`): the argv becomes `docker exec -w <workdir> [-e NAME…] <container> codex exec …` and everything else (stream parse, settle, rollout readback, recording) is byte-for-byte unchanged. `env` must name the in-container `CODEX_HOME`, and it should be the read-write bind mount of the host scoped home — the rollout readback reads the host copy. A container round always takes the exec one-shot (the resident app-server is a host process) and declares no member bridge (a host unix socket cannot reach into the container). Measured: one "answer 2+2" round in an `eval-env:pinned` unit settles `completed` with output `4`, and `observedModel` reads back as `gpt-5.6-sol` from the rollout the container wrote into the host scoped home.

**Resume.** The family tool (`@khorsheed/dsh-local-agent-tool-subagent`) adds an optional `resume` parameter to the official `description`/`prompt` subset. A fresh delegation's result self-describes its handle (`追问请带 resume="<childSessionId>"`); passing it back continues the same codex thread (`codex exec --json resume <thread_id>`) in the same dsh child session, with per-round accounting. The handle is read only from the `resume` parameter and resolved by the `localAgent` registry only for the recording parent session and provider — a forged handle is rejected before any CLI process starts.

**Event-stream mirror.** The subagent session mirrors the `codex exec --json` stream in order: `reasoning` → reasoning blocks, `agent_message` → reply text, `command_execution`/`web_search_call`/`function_call_output` → tool lines (`[工具 Bash] <command> → output`), `file_change` → an `ApplyPatch` card (kind and path per change), `function_call` (e.g. the multi-agent `wait`) → a card under its own name with the `function_call_output` merged in; the final `agent_message` is the run output and the round's usage rides the last mirrored assistant message. Resumed rounds append their own turn without duplication. Aborting settles the tool result immediately while keeping the events and usage already received.

**Model experience.** Each delegation is a fresh one-shot `codex exec` in the delegating session's workspace. The parent submits only the task text and sees only the final answer or the exact error — Codex commentary, tool activity, and workspace diffs never cross into the parent session, and child tokens never enter the parent's context.

**Live driver (`live: true`).** Replaces the per-round spawn: the member's first delegation brings up one resident `codex app-server --stdio` process (same scoped home, same `-c` member-bridge declaration), creates a persisted thread (`thread/start` with `ephemeral: false`), and every later round is a `turn/start` to that living runtime; `item/completed` events fold into the child session as they arrive (same `CodexTranscriptLine` fold and append core as exec, the last line held back until `turn/completed` to carry usage), and `cancel` lands as `turn/interrupt` — the process survives and the thread stays continuable. Approval-shaped server→client requests are auto-answered unattended (cancel/decline, matching exec behavior). Runtimes are reclaimed after an idle timeout (the app-server wire has no shutdown method: stdin EOF → SIGTERM ladder); after a crash the next round re-spawns and `thread/resume`s the on-disk thread; a handshake failure trips a cooldown breaker and falls back to exec per round.

**Accounting.** The provider opens `turn/start` at spawn and closes `turn/end` at settle — including on `error`/`aborted` — so `subagentTiming` duration equals real CLI runtime; the final assistant message carries token usage parsed from the event stream. Codex's `input_tokens` includes cache hits, so the uncached bucket is `input_tokens − cached_input_tokens`, `cached_input_tokens` maps to cache read, and there is no cache-write concept — the `tokenUsage` projection never double-counts cache hits. Resumed rounds repeat this under their own turn number. **Usage fallback for non-completed terminal states (aborted/error).** An interrupted or failed round never sees `turn.completed`, so its event stream carries no usage — yet codex has already written the round's real token spend to the rollout file under the scoped home. The exec mirror then recovers the LAST `token_count` of THIS run's rollout file and attaches it as the round's usage: the file is located by thread id (the `session_meta` head id), falling back to the spawn-time window when the stream was truncated before `thread.started`; the caliber is byte-identical to `turn.completed` (`input − cached` and the rest, via the shared `usageFromCodex`). A hard kill that wrote no `token_count` at all still leaves the round without usage — the fallback never guesses.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/local-agent-codex`). Issues and contributions welcome there.
