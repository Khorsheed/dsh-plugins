# `@deepseek-ai/dsh-local-agent-kimi`

English | [中文](README.zh.md)

The Kimi Code harness of the [local-agent family](../../local-agent/local-agent/README.md). The bundle patch registers the `kimi` harness (`KIMI_CODE_HOME` scoped home, `kimi login` device-code flow, `session_index.jsonl` records) and mounts the `subagent_kimi` tool at the **profile root** — the `kimi-cli` one-shot provider spawns `kimi -p` under the harness's scoped home, so every agent preset can delegate without per-preset variants. The family core (`local-agent` row, shared scoped-homes root) ships in the framework bundle `@deepseek-ai/dsh-local-agent`'s own patch, which this bundle declares as a dependency — installing this bundle alone still mounts the core. The browser settings section ships with the family core's `./client` half (Settings → 本地 Agent), roster-driven per harness.

## Prerequisites

- A running dsh profile (`dsh --profile web`, `--profile headless`, or a custom one) — this bundle is an installable patch layer, not a standalone application.
- The Kimi Code CLI (`kimi`) on `PATH` (the same binary the user runs interactively). The plugin does not install it, log in on the user's behalf, or touch the user's own `~/.kimi-code`.

## Install

The family core is its own bundle (`@deepseek-ai/dsh-local-agent`); install it together with the harness bundle so the `local-agent` row mounts (the harness bundle declares the core as a dependency, but `dsh plugin add` reconciles only direct dependencies into the profile's bundles layer):

```sh
# 1. Install the family core and this bundle into a profile.
dsh plugin --profile web add @deepseek-ai/dsh-local-agent
dsh plugin --profile web add @deepseek-ai/dsh-local-agent-kimi

# 2. Restart the profile. The first start provisions the scoped home and
#    removes any legacy `<base>-kimi` preset variants from earlier versions;
#    the `subagent_kimi` tool mounts at the profile root, so every preset can
#    delegate — no preset step needed.

# 3. Run /kimi login once from a session.
```

## Uninstall

```sh
dsh plugin --profile web remove @deepseek-ai/dsh-local-agent-kimi
```

Removing the bundle unregisters the harness, its `/<name>` command family, the tool row, and the UI rows. One user-owned directory is left in place on purpose: the scoped home (`$DSH_HOME/local-agent/kimi`) keeps sessions and credentials so a reinstall needs no fresh login. Delete it to remove every trace.

## Scope isolation

Every Kimi process the bundle starts (login, delegation) runs with `KIMI_CODE_HOME` set to the harness's scoped home (default `$DSH_HOME/local-agent/kimi`). Config, credentials, and sessions stay there, never colliding with the user's own `~/.kimi-code`. Login is device-code only: `/kimi login` surfaces the authorization URL and code in the session and the CLI polls in the background; credentials land in the scoped home when the user authorizes. `/kimi logout` removes the scoped credentials and OAuth cache — the kimi CLI has no logout command — so a later login authorizes a fresh account. The scoped home is provisioned with a `config.toml` on first boot — the user's own config copied with every `api_key` blanked, or a minimal kimi-managed config when the user has none — because the kimi CLI refuses to authenticate without provider and model definitions. An existing config is respected untouched.

## Custom endpoint

Kimi's LLM requests route through the `base_url` of the `managed:kimi-code` provider in the scoped `config.toml` (`$DSH_HOME/local-agent/kimi/config.toml`):

```toml
[providers."managed:kimi-code"]
base_url = "https://your-router.example/v1"
```

Edit **only that key** in place — the file already exists after provisioning, and everything else (`models` definitions, the `oauth` sub-table, `permission.rules`) must be preserved. Provisioning never overwrites an existing config, so your edit survives restarts and reinstalls. Do **not** change the `[services.moonshot_*]` base URLs: those route the built-in search/fetch tools, and a self-hosted router usually wants only the LLM path redirected.

⚠️ **OAuth token exposure**: the scoped login's OAuth token is sent to whatever endpoint serves the request. Pointing `base_url` at an untrusted address hands that token to it; only use endpoints you control or trust.

Every delegation logs the effective endpoint at info level (`subagent-kimi: delegating via <endpoint>`), and a failed run's error text names the endpoint it used.

## Session records

`/kimi sessions` lists the scoped home's `session_index.jsonl` (kimi's own append-only index) — the sessions this agent's delegations created, never the user's personal sessions. The family core's browser settings section renders the same listing narrowed to the current session's workspace (only records whose `workDir` matches the session cwd), so one project's kimi sessions never surface in another project's session; `/kimi sessions` itself always shows the full list. The settings section (Settings → 本地 Agent) shows the harness auth status with a web-login button that surfaces the device-code URL; while a login is pending, the status keeps re-probing until the credentials land. An authenticated row adds a sign-out button that runs `/kimi logout`, so switching accounts is a sign-out then a fresh login.

## Continuation (resume)

The `subagent_kimi` tool is the family-owned tool (`@khorsheed/dsh-local-agent-tool-subagent`) — the official subset (`description`/`prompt`) plus an optional `resume` parameter. A **fresh** delegation's result text self-describes the handle (`追问请带 resume="<childSessionId>"`); passing it back as `resume` in a later round continues the SAME kimi session (`kimi -S session_<id> -p`) inside the SAME dsh child session, with per-round accounting: the turn number increments, `turn/start`/`turn/end` pair per round, usage rides that round's final mirrored assistant message, and the wire-log mirror advances incrementally so earlier messages are never duplicated.

The handle never rides the prompt: it is read only from the `resume` parameter, and the localAgent registry resolves it only for the same parent session and provider that recorded the delegation — a forged handle (unknown child session, another parent's session, or the wrong provider) is rejected before any CLI process starts. The descriptor cannot carry the target (its schema rejects unknown fields), so the family passes it through the `localAgent` service's delegation registry instead.

## Model Experience

### Child request

#### What the model sees

The Kimi child is a fresh ACP session in the delegating Session's workspace, started by `kimi acp` with the scoped home. The parent submits the standalone task text; the parent conversation never crosses the process boundary.

#### Token effect

The child pays for an independent Kimi context and turn. Child tokens never enter the parent's context.

#### KV Cache effect

Independent of the parent request cache. Reuse depends only on the scoped Kimi installation's own provider, model, and history.

### Parent tool result, indirectly

#### What the model sees

Through the family tool (`subagent_kimi`), the parent sees only the selected final Kimi answer or the consumer's exact error, plus the resume self-description on a fresh delegation. Kimi commentary, tool activity, and workspace diffs are not copied into the parent Session.

#### Token effect

Parent input grows only by the final answer or error retained in the tool result. This bundle adds no parent tool schema by itself.

#### KV Cache effect

No effect.

### Delegation accounting

The child session carries real usage and timing: the provider opens `turn/start` when the CLI spawns and closes `turn/end` when it settles — including on failure or cancellation (reason `error`/`aborted`) — so the `subagentTiming` projection's duration equals the actual CLI runtime and the window never stays open on a failed run. The mirror is harness-comparison grade: it filters kimi's auto-permission `<system-reminder>` user messages, renders tool calls with their arguments (`[工具 WebSearch] 查询词`), pairs each tool result to its own call, tags every line with its wire turn, and carries the round's summed token usage (`inputOther` → uncached input, `output` → output, `inputCacheRead` → cache read, `inputCacheCreation` → cache write) on the round's final assistant message. Aborting a run settles the tool result immediately (the CLI kill is dispose's SIGTERM→grace→SIGKILL ladder) and still mirrors whatever the wire already recorded, so a cancelled round keeps its partial work and real usage. The usage is the SUM of every `usage.record` in the round's delta — each record is ONE LLM request's accounting, not cumulative — so the `tokenUsage` projection counts the delegation. Each resumed round repeats this accounting under its own incrementing turn number.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.0-rc.7`): ✅ full — the runtime touches only the official public stable surface (slots, core services, core events, cordis 4.x, schemastery).
- source line (deepseek-harness master): ✅

## Known Limitations and Deferred Work

- **Login requires one interactive step** — the device-code URL appears in the session; credentials appear only after the user authorizes in the browser. No API-key path.
- **One login at a time per harness** — a second `/kimi login` while one is pending is refused.
- **Process bookkeeping touches the real home** — kimi writes its server-instance bookkeeping (`~/.kimi-code/server/instances/*.json`, content-free server_id/pid/port/heartbeat) to the real home regardless of `KIMI_CODE_HOME`; config, credentials, and sessions stay scoped.
- **Config is provisioned once** — a scoped home without `config.toml` gets a redacted copy of the user's own config (or a minimal managed config); the copy is written before the first delegation because a config-less scoped home fails ACP authentication.
- **No transcript replay yet** — `/kimi sessions` lists records but does not render a session's conversation; full replay through `kimi export` is deferred.
- **Headless caveat** — `/kimi` commands and the header dropdown need a Web session; `--profile headless` can still delegate through a composition that mounts the tool row.
