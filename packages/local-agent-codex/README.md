# `@khorsheed/dsh-local-agent-codex`

English | [中文](README.zh.md)

The Codex harness of the [local-agent family](../../local-agent/local-agent/README.md). The bundle patch registers the `codex` harness (`CODEX_HOME` scoped home, `codex login --device-auth` device-code flow, rollout-file session records) and mounts the `subagent_codex_local` tool at the **profile root** — the `codex-local` one-shot provider spawns `codex exec` under the harness's scoped home, so every agent preset can delegate without per-preset variants. The browser settings section ships with the family core's `./client` half (Settings → 本地 Agent), roster-driven per harness.

> The family core (`local-agent` row, shared scoped-homes root) ships in the framework bundle `@khorsheed/dsh-local-agent`'s own patch, which this bundle declares as a dependency — `dsh plugin add` reconciles only *direct* dependencies into the profile's bundles layer, so install the core bundle together with this one (two commands). The codex bundle deliberately does not re-insert that row — a duplicate would mount the core twice.

## Prerequisites

- A running dsh profile (`dsh --profile web`, `--profile headless`, or a custom one); install the family core bundle alongside this one.
- The Codex CLI (`codex`) on `PATH` (the same binary the user runs interactively). The plugin does not install it, log in on the user's behalf, or touch the user's own `~/.codex`.

## Install

```sh
# 1. Install the family core and this bundle into a profile.
dsh plugin --profile web add @khorsheed/dsh-local-agent
dsh plugin --profile web add @khorsheed/dsh-local-agent-codex

# 2. Restart the profile. The first start provisions the scoped home; the
#    subagent_codex_local tool mounts at the profile root, so every preset
#    can delegate — no preset step needed.

# 3. Run /codex login once from a session.
```

## Uninstall

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-codex
```

Removing the bundle unregisters the harness, its `/<name>` command family, the tool row, and the UI rows. One user-owned directory is left in place on purpose: the scoped home (`$DSH_HOME/local-agent/codex`) keeps sessions and credentials so a reinstall needs no fresh login. Delete it to remove every trace.

## Scope isolation

Every Codex process the bundle starts (login, delegation) runs with `CODEX_HOME` set to the harness's scoped home (default `$DSH_HOME/local-agent/codex`). Config, credentials, and sessions stay there, never colliding with the user's own `~/.codex`. Login is device-code only: `/codex login` surfaces the authorization URL and code in the session and the CLI polls in the background; credentials land in the scoped home when the user authorizes. The first start writes a minimal `config.toml` into the scoped home pinning `cli_auth_credentials_store = "file"` — Codex's default `auto` resolves to the OS keychain on macOS, which would both leak credentials outside the scoped home and defeat this package's `auth.json` presence check. An existing config is respected untouched. `/codex logout` removes the scoped `auth.json`, so a later login authorizes a fresh account.

## Custom endpoint

Codex's LLM requests can be routed through a custom endpoint, but only by adding a **custom provider** to the scoped `config.toml` (`$DSH_HOME/local-agent/codex/config.toml`) — codex refuses to override a built-in provider (`model_providers contains reserved built-in provider IDs`), and the `OPENAI_BASE_URL` environment variable is not honored. Edit in place (provisioning never overwrites an existing config):

```toml
[model_providers.dsh-router]
name = "dsh-router"
base_url = "https://your-router.example/v1"
model_provider = "dsh-router"
```

The last line selects the custom provider for delegations. Everything else in the file (`cli_auth_credentials_store`, any other providers) must be preserved.

⚠️ **Credential exposure**: codex's scoped `auth.json` token is sent to whatever endpoint serves the request. Pointing `base_url` at an untrusted address hands that token to it; only use endpoints you control or trust.

Every delegation logs the effective custom endpoint at info level (`subagent-codex: delegating via <endpoint>`), and a failed run's error text names the endpoint it used. A richer provider editor (endpoint + model + auth key) is planned separately.

## Session records

`/codex sessions` lists the scoped home's `sessions/YYYY/MM/DD/rollout-*.jsonl` rollout files (Codex's own append-only session log) — the sessions this agent's delegations created, never the user's personal sessions. The family core's browser settings section renders the same listing narrowed to the current session's workspace (only records whose `workDir` matches the session cwd), so one project's codex sessions never surface in another project's session; `/codex sessions` itself always shows the full list. The settings section (Settings → 本地 Agent) shows the harness auth status with a web-login button that surfaces the device-code URL; while a login is pending, the status keeps re-probing until the credentials land. An authenticated row adds a sign-out button that runs `/codex logout`, so switching accounts is a sign-out then a fresh login.

## Continuation (resume)

The `subagent_codex_local` tool is the family-owned tool (`@khorsheed/dsh-local-agent-tool-subagent`) — the official subset (`description`/`prompt`) plus an optional `resume` parameter. A **fresh** delegation's result text self-describes the handle (`追问请带 resume="<childSessionId>"`); passing it back as `resume` in a later round continues the SAME codex thread (`codex exec --json resume <thread_id>`) inside the SAME dsh child session, with per-round accounting: the turn number increments, `turn/start`/`turn/end` pair per round, and usage rides that round's assistant message.

The handle never rides the prompt: it is read only from the `resume` parameter, and the localAgent registry resolves it only for the same parent session and provider that recorded the delegation — a forged handle (unknown child session, another parent's session, or the wrong provider) is rejected before any CLI process starts. The descriptor cannot carry the target (its schema rejects unknown fields), so the family passes it through the `localAgent` service's delegation registry instead.

## Model Experience

### Child request

#### What the model sees

The Codex child is a fresh one-shot `codex exec` process in the delegating Session's workspace, started under the scoped home. The parent submits the standalone task text; the parent conversation never crosses the process boundary.

#### Token effect

The child pays for an independent Codex context and turn. Child tokens never enter the parent's context.

#### KV Cache effect

Independent of the parent request cache. Reuse depends only on the scoped Codex installation's own provider, model, and history.

### Parent tool result, indirectly

#### What the model sees

Through the family tool (`subagent_codex_local`), the parent sees only the selected final Codex answer or the consumer's exact error, plus the resume self-description on a fresh delegation. Codex commentary, tool activity, and workspace diffs are not copied into the parent Session.

#### Token effect

Parent input grows only by the final answer or error retained in the tool result. This bundle adds no parent tool schema by itself.

#### KV Cache effect

No effect.

### Delegation accounting

The child session carries real usage and timing: the provider opens `turn/start` when the CLI spawns and closes `turn/end` when it settles — including on failure or cancellation (reason `error`/`aborted`) — so the `subagentTiming` projection's duration equals the actual CLI runtime and the window never stays open on a failed run; the final `assistant/message` carries the turn's token usage parsed from the `codex exec --json` event stream. Codex's `input_tokens` is the TOTAL input including cache hits (OpenAI-style; `input_tokens + output_tokens` equals the rollout's `total_tokens`), so the uncached bucket is `input_tokens − cached_input_tokens`, `cached_input_tokens` maps to cache read, `output_tokens` to output; codex has no cache-write concept. The `tokenUsage` projection counts the delegation without double counting cache hits. Each resumed round repeats this accounting under its own incrementing turn number.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.1`): ✅ full — the rc.8→0.1.1-rc.1 API audit (2026-08-21) confirms every surface this plugin consumes is unchanged or additive (the ProjectionDefinition restructure, cacheHitPercent return-type change, and the credentials/updated event rename do not touch this package); no source change was needed.
- source line (deepseek-harness master): ✅

## Known Limitations and Deferred Work

- **Login requires one interactive step** — the device-code URL appears in the session; credentials appear only after the user authorizes in the browser. No API-key path.
- **Full event-stream mirror** — the dsh subagent session mirrors the `codex exec --json` event stream in order: `reasoning` items fold to `reasoning` blocks, `agent_message` items to reply text, and `command_execution`/`web_search_call`/`function_call_output` items to tool lines (`[工具 Bash] <command> → output`); the final `agent_message` is the run output and the round's usage rides the last mirrored assistant message. The stream is naturally incremental per round, so resumed rounds append their own turn without duplication. Aborting a run settles the tool result immediately and still mirrors the events already received, so a cancelled round keeps its partial reasoning/commands and real usage.
- **`codex exec` runs non-interactively** — actions the sandbox policy would need to approve are denied rather than prompted; `sandbox` plugin config (default `workspace-write`) selects the policy.
- **Headless caveat** — `/codex` commands and the header dropdown need a Web session; `--profile headless` can still delegate through a composition that mounts the tool row.
