# `@khorsheed/dsh-local-agent-claude-code`

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
dsh plugin --profile web add @khorsheed/dsh-local-agent-claude-code

# 2. Restart the profile. The first start provisions the scoped home; the
#    subagent_claude_code_local tool mounts at the profile root, so every
#    preset can delegate — no preset step needed.

# 3. Run /claude-code login once from a session.
```

## Uninstall

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-claude-code
```

Removing the bundle unregisters the harness, its `/<name>` command family, the tool row, and the UI rows. One user-owned directory is left in place on purpose: the scoped home (`$DSH_HOME/local-agent/claude-code`) keeps the config so a reinstall needs no fresh login. Delete it to remove every trace.

## Scope isolation

Every Claude process the bundle starts (login, delegation) runs with `CLAUDE_CONFIG_DIR` set to the harness's scoped home (default `$DSH_HOME/local-agent/claude-code`). Config, project sessions, and history stay there, never colliding with the user's own `~/.claude`. Login is a browser OAuth flow: `/claude-code login` runs `claude auth login` and surfaces the authorization URL in the session while the CLI polls in the background; the scoped `.claude.json` records the `oauthAccount` once authorized. `/claude-code logout` removes the scoped config file, so a later login authorizes a fresh account.

**Credential storage platform caveat**: on macOS the actual credential lives in the OS keychain under a hashed entry (`Claude Code-credentials-<sha256(configDir)[:8]>`) keyed to the scoped home path — `/claude-code logout` cannot reach it (the file-based logout contract), but a fresh login rewrites the same hashed slot, so the stale entry is harmless. On Linux, upstream bug #47661 means `CLAUDE_CONFIG_DIR` does NOT isolate the credentials file: claude writes the scoped dir but READS the default `~/.claude/.credentials.json`, so delegations may use credentials from the user's default home even when the scoped home has none. Auth detection is a light file check of the scoped `.claude.json`'s `oauthAccount` only — the CLI is never spawned just to probe.

## Session records

`/claude-code sessions` lists the scoped home's `projects/<cwd-slug>/<uuid>.jsonl` session files (Claude Code's own append-only session log) — the sessions this agent's delegations created, never the user's personal sessions. The directory slug is a **lossy** encoding of the workspace path (separators become dashes and distinct paths can collide), so the listed `workDir` always comes from the file CONTENT (the first `user` event's `cwd` field), never the directory name. The family core's browser settings section renders the same listing narrowed to the current session's workspace; `/claude-code sessions` itself always shows the full list.

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

Through `dsh-tool-subagent`, the parent sees only the selected final Claude answer or the consumer's exact error. Claude commentary, tool activity, and workspace diffs are not copied into the parent Session.

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

## Known Limitations and Deferred Work

- **Login requires one interactive step** — the browser OAuth URL appears in the session; credentials appear only after the user authorizes in the browser.
- **macOS logout is config-only** — `/claude-code logout` removes the scoped `.claude.json`; the keychain entry (hashed to the scoped home path) is left for the CLI's own `claude auth logout` and is rewritten on the next login.
- **Linux credentials are not isolated** (upstream bug #47661) — `CLAUDE_CONFIG_DIR` does not redirect the credentials file; documented above.
- **Interactive-session records may be missing** — claude's headless `-p` runs write project session files, but interactive sessions under a custom `CLAUDE_CONFIG_DIR` may not write transcripts (upstream behavior); records list what the CLI actually wrote.
- **v1 mirrors only the final answer** — the JSON result's `result` field is appended as a single assistant message; a full event-stream mirror is deferred to v2.
- **Headless caveat** — `/claude-code` commands and the header dropdown need a Web session; `--profile headless` can still delegate through a composition that mounts the tool row.
