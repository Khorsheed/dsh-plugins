# `@khorsheed/dsh-local-agent-codex`

English | [中文](README.md)

Delegate coding tasks from any dsh agent preset to your locally installed Codex CLI. Delegations run under a plugin-scoped home, so your personal `~/.codex` — config, credentials, sessions — is never touched.

## Features

- **Delegate from any preset** — the `subagent_codex` tool mounts at the profile root; no per-preset setup.
- **Scoped-home isolation** — all Codex state lives in `$DSH_HOME/local-agent/codex`, separate from your `~/.codex`.
- **In-session login** — device-code `/codex login`, with auth status and sign-out under Settings → 本地 Agent.
- **Resume a thread** — pass `resume="<childSessionId>"` to continue the same codex thread in the same dsh child session.
- **Custom endpoint** — route Codex's LLM requests through your own router via a scoped `config.toml` provider.

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
    live: false                # live driver: one resident codex app-server process per member, one turn per round (runtime-level graceful interrupt, push-mode mirroring); off — or a channel that cannot come up — means the one-shot exec path
    liveIdleMs: 1800000        # idle lifetime of a resident runtime before reclaim (default 30 min)
    liveMirrorGranularity: event  # live mirror granularity; token additionally appends assistant/chunk deltas (write amplification — opt-in)
```

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

**Evaluation snapshot (`effectiveSettings`).** The harness declares a live-read snapshot of its fairness-relevant settings for the evaluation condition hash: drive (exec/live), the sandbox policy (plugin config), the reasoning effort (the scoped config's top-level `model_reasoning_effort`), and whether a custom endpoint is pinned (read from the scoped config's provider, hostname only). `/codex status` and the `LocalAgentStatus` Remote attach the same snapshot.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.2`): ✅ full — the rc.8→0.1.1-rc.1 API audit (2026-08-21) confirms every surface this plugin consumes is unchanged or additive (the ProjectionDefinition restructure, cacheHitPercent return-type change, and the credentials/updated event rename do not touch this package); no source change was needed; re-audited for rc.2 (2026-08-22): consumed surface unchanged, full build+test green.
- source line (deepseek-harness master): ✅

## Known Limitations

- **Login needs one browser step** — device-code only; no API-key path.
- **`codex exec` is non-interactive** — actions the sandbox policy would approve are denied, not prompted; see the `sandbox` config.
- **Headless caveat** — `/codex` commands need a Web session; headless can still delegate via a composition mounting the tool row.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Bundle composition.** The patch registers the `codex` harness (scoped `CODEX_HOME`, device-code login, rollout-file session records) and mounts `subagent_codex` at the profile root; the `codex-local` one-shot provider spawns `codex exec` under that home. The settings section ships with the family core's `./client` half; the core itself comes from `@khorsheed/dsh-local-agent`, declared as a dependency.

**Login and credentials.** `/codex login` shows the device-code URL in-session and polls in the background; credentials land in the scoped home on authorization. First start writes a minimal `config.toml` pinning `cli_auth_credentials_store = "file"` — Codex's default `auto` would resolve to the macOS keychain, leaking credentials outside the scoped home and defeating this package's `auth.json` presence check; an existing config is left untouched. `/codex logout` deletes the scoped `auth.json`, so a later login authorizes a fresh account.

**Session records.** `/codex sessions` lists the scoped home's `sessions/YYYY/MM/DD/rollout-*.jsonl` files — sessions this plugin's delegations created, never your personal ones. The settings section narrows the list to records whose `workDir` matches the session cwd.

**Resume.** The family tool (`@khorsheed/dsh-local-agent-tool-subagent`) adds an optional `resume` parameter to the official `description`/`prompt` subset. A fresh delegation's result self-describes its handle (`追问请带 resume="<childSessionId>"`); passing it back continues the same codex thread (`codex exec --json resume <thread_id>`) in the same dsh child session, with per-round accounting. The handle is read only from the `resume` parameter and resolved by the `localAgent` registry only for the recording parent session and provider — a forged handle is rejected before any CLI process starts.

**Event-stream mirror.** The subagent session mirrors the `codex exec --json` stream in order: `reasoning` → reasoning blocks, `agent_message` → reply text, `command_execution`/`web_search_call`/`function_call_output` → tool lines (`[工具 Bash] <command> → output`); the final `agent_message` is the run output and the round's usage rides the last mirrored assistant message. Resumed rounds append their own turn without duplication. Aborting settles the tool result immediately while keeping the events and usage already received.

**Model experience.** Each delegation is a fresh one-shot `codex exec` in the delegating session's workspace. The parent submits only the task text and sees only the final answer or the exact error — Codex commentary, tool activity, and workspace diffs never cross into the parent session, and child tokens never enter the parent's context.

**Live driver (`live: true`).** Replaces the per-round spawn: the member's first delegation brings up one resident `codex app-server --stdio` process (same scoped home, same `-c` member-bridge declaration), creates a persisted thread (`thread/start` with `ephemeral: false`), and every later round is a `turn/start` to that living runtime; `item/completed` events fold into the child session as they arrive (same `CodexTranscriptLine` fold and append core as exec, the last line held back until `turn/completed` to carry usage), and `cancel` lands as `turn/interrupt` — the process survives and the thread stays continuable. Approval-shaped server→client requests are auto-answered unattended (cancel/decline, matching exec behavior). Runtimes are reclaimed after an idle timeout (the app-server wire has no shutdown method: stdin EOF → SIGTERM ladder); after a crash the next round re-spawns and `thread/resume`s the on-disk thread; a handshake failure trips a cooldown breaker and falls back to exec per round.

**Accounting.** The provider opens `turn/start` at spawn and closes `turn/end` at settle — including on `error`/`aborted` — so `subagentTiming` duration equals real CLI runtime; the final assistant message carries token usage parsed from the event stream. Codex's `input_tokens` includes cache hits, so the uncached bucket is `input_tokens − cached_input_tokens`, `cached_input_tokens` maps to cache read, and there is no cache-write concept — the `tokenUsage` projection never double-counts cache hits. Resumed rounds repeat this under their own turn number. **Usage fallback for non-completed terminal states (aborted/error).** An interrupted or failed round never sees `turn.completed`, so its event stream carries no usage — yet codex has already written the round's real token spend to the rollout file under the scoped home. The exec mirror then recovers the LAST `token_count` of THIS run's rollout file and attaches it as the round's usage: the file is located by thread id (the `session_meta` head id), falling back to the spawn-time window when the stream was truncated before `thread.started`; the caliber is byte-identical to `turn.completed` (`input − cached` and the rest, via the shared `usageFromCodex`). A hard kill that wrote no `token_count` at all still leaves the round without usage — the fallback never guesses.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/local-agent-codex`). Issues and contributions welcome there.
