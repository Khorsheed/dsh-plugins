# `@deepseek-ai/dsh-local-agent-claude-code`

English | [中文](README.zh.md)

The Claude Code harness of the [local-agent family](../../local-agent/local-agent/README.md). The bundle patch registers the `claude-code` harness (`CLAUDE_CONFIG_DIR` scoped home, `claude auth login` browser flow, project-file session records) and mounts the `subagent_claude_code_local` tool at the **profile root** — the `claude-local` one-shot provider spawns `claude -p --output-format json` under the harness's scoped home, so every agent preset can delegate without per-preset variants. The browser settings section ships with the family core's `./client` half (Settings → 本地 Agent), roster-driven per harness.

> The family core (`local-agent` row, shared scoped-homes root) ships in the framework bundle `@deepseek-ai/dsh-local-agent`'s own patch, which this bundle declares as a dependency — `dsh plugin add` reconciles only *direct* dependencies into the profile's bundles layer, so install the core bundle together with this one (two commands). The claude bundle deliberately does not re-insert that row — a duplicate would mount the core twice.

## Prerequisites

- A running dsh profile (`dsh --profile web`, `--profile headless`, or a custom one); install the family core bundle alongside this one.
- The Claude Code CLI (`claude`) on `PATH` (the same binary the user runs interactively). The plugin does not install it or touch the user's own `~/.claude`.

## Install

```sh
# 1. Install the family core and this bundle into a profile.
dsh plugin --profile web add @deepseek-ai/dsh-local-agent
dsh plugin --profile web add @deepseek-ai/dsh-local-agent-claude-code

# 2. Restart the profile. The first start provisions the scoped home; the
#    subagent_claude_code_local tool mounts at the profile root, so every
#    preset can delegate — no preset step needed.

# 3. Run /claude-code login once from a session.
```

## Uninstall

```sh
dsh plugin --profile web remove @deepseek-ai/dsh-local-agent-claude-code
```

Removing the bundle unregisters the harness, its `/<name>` command family, the tool row, and the UI rows. One user-owned directory is left in place on purpose: the scoped home (`$DSH_HOME/local-agent/claude-code`) keeps the config so a reinstall needs no fresh login. Delete it to remove every trace.

## Scope isolation

Every Claude process the bundle starts (login, delegation) runs with `CLAUDE_CONFIG_DIR` set to the harness's scoped home (default `$DSH_HOME/local-agent/claude-code`). Config, project sessions, and history stay there, never colliding with the user's own `~/.claude`. Login is a browser OAuth flow: `/claude-code login` runs `claude auth login` and surfaces the authorization URL in the session while the CLI polls in the background; the scoped `.claude.json` records the `oauthAccount` once authorized. `/claude-code logout` removes the scoped config file, so a later login authorizes a fresh account.

**Credential storage platform caveat**: on macOS the actual credential lives in the OS keychain under a hashed entry (`Claude Code-credentials-<sha256(configDir)[:8]>`) keyed to the scoped home path — `/claude-code logout` cannot reach it (the file-based logout contract), but a fresh login rewrites the same hashed slot, so the stale entry is harmless. On Linux, upstream bug #47661 means `CLAUDE_CONFIG_DIR` does NOT isolate the credentials file: claude writes the scoped dir but READS the default `~/.claude/.credentials.json`, so delegations may use credentials from the user's default home even when the scoped home has none. Auth detection is a light file check of the scoped `.claude.json`'s `oauthAccount` only — the CLI is never spawned just to probe.

## Session records

`/claude-code sessions` lists the scoped home's `projects/<cwd-slug>/<uuid>.jsonl` session files (Claude Code's own append-only session log) — the sessions this agent's delegations created, never the user's personal sessions. The directory slug is a **lossy** encoding of the workspace path (separators become dashes and distinct paths can collide), so the listed `workDir` always comes from the file CONTENT (the first `user` event's `cwd` field), never the directory name. The family core's browser settings section renders the same listing narrowed to the current session's workspace; `/claude-code sessions` itself always shows the full list.

## Continuation (resume)

The `subagent_claude_code_local` tool is the family-owned tool (`@khorsheed/dsh-local-agent-tool-subagent`) — the official subset (`description`/`prompt`) plus an optional `resume` parameter. A **fresh** delegation's result text self-describes the handle (`追问请带 resume="<childSessionId>"`); passing it back as `resume` in a later round continues the SAME claude session (`claude -p --resume <session_id>`) inside the SAME dsh child session, with per-round accounting: the turn number increments, `turn/start`/`turn/end` pair per round, and usage rides that round's assistant message.

The handle never rides the prompt: it is read only from the `resume` parameter, and the localAgent registry resolves it only for the same parent session and provider that recorded the delegation — a forged handle (unknown child session, another parent's session, or the wrong provider) is rejected before any CLI process starts. The descriptor cannot carry the target (its schema rejects unknown fields), so the family passes it through the `localAgent` service's delegation registry instead.

## Model Experience

### Child request

#### What the model sees

The Claude child is a fresh one-shot `claude -p` process in the delegating Session's workspace, started under the scoped home. The parent submits the standalone task text; the parent conversation never crosses the process boundary.

#### Token effect

The child pays for an independent Claude context and turn. Child tokens never enter the parent's context.

#### KV Cache effect

Independent of the parent request cache. Reuse depends only on the scoped Claude installation's own provider, model, and history.

### Parent tool result, indirectly

#### What the model sees

Through the family tool (`subagent_claude_code_local`), the parent sees only the selected final Claude answer or the consumer's exact error, plus the resume self-description on a fresh delegation. Claude commentary, tool activity, and workspace diffs are not copied into the parent Session.

#### Token effect

Parent input grows only by the final answer or error retained in the tool result. This bundle adds no parent tool schema by itself.

#### KV Cache effect

No effect.

### Delegation accounting

The child session carries real usage and timing: the provider opens `turn/start` when the CLI spawns and closes `turn/end` when it settles — including on failure or cancellation (reason `error`/`aborted`) — so the `subagentTiming` projection's duration equals the actual CLI runtime and the window never stays open on a failed run; the final `assistant/message` carries the turn's token usage parsed from the `claude -p --output-format json` result (`input_tokens` → uncached input, `output_tokens` → output, `cache_read_input_tokens` → cache read, `cache_creation_input_tokens` → cache write — Anthropic reports each separately, no subtraction needed), so the `tokenUsage` projection counts the delegation.

## Config

This bundle accepts two plugin config fields (both optional):

- `permissionMode` — `skip` (default) passes `--dangerously-skip-permissions` to `claude -p` so the child can write files without an interactive approval prompt; `normal` runs without it (approval-requiring actions are denied).
- `baseUrl` — sets `ANTHROPIC_BASE_URL` for the child CLI; absent inherits the host process environment (e.g. a user-level proxy like `https://proxy.example.com/anthropic`).

**Permission-mode risk**: `skip` grants the child the same filesystem reach as the user running the dsh host — unlike codex, claude (and kimi) have **no OS-level sandbox**, so a `skip` child can write anywhere the user can, including outside the delegating workspace. `skip` is the working default because a one-shot CLI subagent has no approval surface; switch to `normal` when the delegated task must be confined to approval-able actions (note `normal` will deny writes in non-interactive mode, so file-producing tasks fail). Prefer scoping the host's own sandbox (e.g. run the dsh host inside a sandboxed workspace) if the delegation needs both file writes and workspace confinement.

## Custom endpoint

Claude's LLM requests can be routed through a custom endpoint (e.g. a self-hosted model router or a proxy) two ways:

- **Cordis config** — set `baseUrl` on the bundle row's config; it is passed to the child as `ANTHROPIC_BASE_URL`.
- **Host environment** — export `ANTHROPIC_BASE_URL` in the shell that starts the dsh host; it is inherited by every delegation child.

Priority is config over environment. **The environment is a startup-time snapshot**: a long-running dsh process captures `ANTHROPIC_BASE_URL` when it boots, so later `export` in a different shell has no effect until the host restarts — check the host's own environment, not your current shell, when diagnosing a delegation that routes unexpectedly.

⚠️ **OAuth token exposure**: the scoped login's OAuth token is sent to whatever endpoint serves the request. Pointing `baseUrl` at an untrusted address hands that token to it; only use endpoints you control or trust.

Every delegation logs the effective endpoint at info level (`subagent-claude: delegating via <endpoint>`), and a failed run's error text names the endpoint it used.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.0-rc.7`): ✅ full — the runtime touches only the official public stable surface (slots, core services, core events, cordis 4.x, schemastery).
- source line (deepseek-harness master): ✅

## Known Limitations and Deferred Work

- **Login requires one interactive step** — the browser OAuth URL appears in the session; credentials appear only after the user authorizes in the browser.
- **macOS logout is config-only** — `/claude-code logout` removes the scoped `.claude.json`; the keychain entry (hashed to the scoped home path) is left for the CLI's own `claude auth logout` and is rewritten on the next login.
- **Linux credentials are not isolated** (upstream bug #47661) — `CLAUDE_CONFIG_DIR` does not redirect the credentials file; documented above.
- **Interactive-session records may be missing** — claude's headless `-p` runs write project session files, but interactive sessions under a custom `CLAUDE_CONFIG_DIR` may not write transcripts (upstream behavior); records list what the CLI actually wrote.
- **Full stream-json mirror** — the delegation runs `claude -p --verbose --output-format stream-json` and the dsh subagent session mirrors the event stream in order: `thinking` blocks fold to `reasoning` blocks, `tool_use`/`tool_result` blocks to tool lines (`[工具 Bash] <command> → output`), and reply `text` blocks to assistant text; the final assistant text is the run output and the round's usage rides the last mirrored assistant message. Resumed rounds append their own turn without duplication. Aborting a run settles the tool result immediately and still mirrors the stream-json events already received, so a cancelled round keeps its partial thinking/tool activity and real usage.
- **Headless caveat** — `/claude-code` commands and the header dropdown need a Web session; `--profile headless` can still delegate through a composition that mounts the tool row.
