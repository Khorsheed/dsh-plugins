# `@khorsheed/dsh-local-agent-claude-code`

English | [中文](README.zh.md)

Delegate coding tasks to a locally installed Claude Code from any dsh agent preset. This bundle — the Claude Code harness of the [local-agent family](../local-agent/README.md) — mounts a `subagent_claude_code_local` tool at the profile root: the model hands off a task, a one-shot `claude -p` runs it in the delegating session's workspace under a scoped home, and the answer streams back into a dsh subagent session with its thinking and tool activity mirrored live. Your own `~/.claude` is never touched.

## Features

- **Delegate from any preset** — the tool mounts once at the profile root, so every agent preset can hand off tasks without per-preset variants.
- **Scoped home** — every Claude process (login, delegation) runs with `CLAUDE_CONFIG_DIR` under `$DSH_HOME/local-agent/claude-code`; config, project sessions, and history stay there and never collide with your personal `~/.claude`.
- **Browser login, one command** — `/claude-code login` runs the `claude auth login` OAuth flow and surfaces the authorization URL in the session; `/claude-code sessions`, `status`, and `logout` complete the command family.
- **Resume a delegation** — a fresh delegation's result self-describes a `resume` handle; passing it back continues the same Claude session inside the same dsh child session, with per-round accounting.
- **Live stream mirror** — the child session mirrors Claude's event stream in order (thinking → reasoning blocks, tool calls → tool lines, replies → assistant text); aborting a run settles immediately and keeps the partial transcript and real token usage.
- **Settings UI included** — the family core's browser half renders per-harness auth status, web login, and session records under Settings → 本地 Agent, roster-driven per harness.

## Install

Prerequisites: a running dsh profile (`dsh --profile web`, `--profile headless`, or a custom one), and the Claude Code CLI (`claude`) on `PATH` — the plugin does not install it. Install the family core together with this bundle (`dsh plugin add` reconciles only *direct* dependencies into the profile's bundles layer, so name both in one command):

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-claude-code
```

Then restart the profile — the first start provisions the scoped home — and run `/claude-code login` once from a session. Uninstall:

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-claude-code
```

Removing the bundle unregisters the harness, its `/claude-code` command family, the tool row, and the UI rows. The scoped home (`$DSH_HOME/local-agent/claude-code`) is left in place on purpose so a reinstall needs no fresh login; delete it to remove every trace.

## Config

Two optional fields on the bundle row:

- `permissionMode` — `skip` (default) passes `--dangerously-skip-permissions` to `claude -p` so the child can write files without an interactive approval prompt; `normal` runs without it, so approval-requiring actions are denied (in non-interactive mode that means file-producing tasks fail).
- `baseUrl` — sets `ANTHROPIC_BASE_URL` for the child CLI (e.g. a self-hosted model router or a proxy like `https://proxy.example.com/anthropic`); absent, the child inherits the host process environment. Config wins over environment.

**Permission-mode risk**: `skip` grants the child the same filesystem reach as the user running the dsh host — unlike codex, claude has no OS-level sandbox, so a `skip` child can write anywhere the user can, including outside the delegating workspace. `skip` is the working default because a one-shot CLI subagent has no approval surface; prefer `normal`, or scope the host's own sandbox (e.g. run the dsh host inside a sandboxed workspace), when the delegation needs confinement.

**Custom endpoint notes**: the host environment is a startup-time snapshot — a long-running dsh process captures `ANTHROPIC_BASE_URL` at boot, so a later `export` in another shell has no effect until the host restarts; check the host's own environment, not your current shell, when diagnosing a delegation that routes unexpectedly. ⚠️ The scoped login's OAuth token is sent to whatever endpoint serves the request — point `baseUrl` only at endpoints you control or trust. Every delegation logs the effective endpoint at info level (`subagent-claude: delegating via <endpoint>`), and a failed run's error text names the endpoint it used.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.1`): ✅ full — the rc.8→0.1.1-rc.1 API audit (2026-08-21) confirms every surface this plugin consumes is unchanged or additive (the ProjectionDefinition restructure, cacheHitPercent return-type change, and the credentials/updated event rename do not touch this package); no source change was needed.
- source line (deepseek-harness master): ✅

## Known Limitations

- **Login requires one interactive step** — the browser OAuth URL appears in the session; credentials appear only after the user authorizes in the browser.
- **macOS logout is config-only** — `/claude-code logout` removes the scoped `.claude.json`; the OS keychain entry (hashed to the scoped home path) is left for the CLI's own `claude auth logout` and is rewritten on the next login, so the stale entry is harmless.
- **Linux credentials are not isolated** (upstream bug #47661) — `CLAUDE_CONFIG_DIR` does not redirect the credentials file: claude writes the scoped dir but reads the default `~/.claude/.credentials.json`, so delegations may use the default home's credentials even when the scoped home has none.
- **Interactive-session records may be missing** — headless `-p` runs write project session files, but interactive sessions under a custom `CLAUDE_CONFIG_DIR` may not write transcripts (upstream behavior); records list what the CLI actually wrote.
- **Headless caveat** — `/claude-code` commands and the header dropdown need a Web session; `--profile headless` can still delegate through a composition that mounts the tool row.

## How it works

<details>
<summary>Internals (click to expand)</summary>

The bundle patch registers the `claude-code` harness into the family core (`@khorsheed/dsh-local-agent`, declared as a dependency — the claude bundle deliberately does not re-insert the core row, which would mount it twice) and mounts the `claude-local` one-shot provider, which spawns `claude -p --verbose --output-format stream-json` under the harness's scoped home.

**Scope isolation.** On macOS the real credential lives in the OS keychain under a hashed entry (`Claude Code-credentials-<sha256(configDir)[:8]>`) keyed to the scoped home path — `/claude-code logout` cannot reach it (the file-based logout contract), but a fresh login rewrites the same hashed slot. On Linux, upstream bug #47661 means `CLAUDE_CONFIG_DIR` does NOT isolate the credentials file (see Known Limitations). Auth detection is a light file check of the scoped `.claude.json`'s `oauthAccount` only — the CLI is never spawned just to probe.

**Session records.** `/claude-code sessions` lists the scoped home's `projects/<cwd-slug>/<uuid>.jsonl` session files (Claude Code's own append-only session log) — the sessions this agent's delegations created, never the user's personal sessions. The directory slug is a **lossy** encoding of the workspace path (separators become dashes and distinct paths can collide), so the listed `workDir` always comes from the file CONTENT (the first `user` event's `cwd` field), never the directory name. The family core's browser settings section renders the same listing narrowed to the current session's workspace; `/claude-code sessions` itself always shows the full list.

**Resume security.** The `subagent_claude_code_local` tool is the family-owned tool (`@khorsheed/dsh-local-agent-tool-subagent`) — the official subset (`description`/`prompt`) plus an optional `resume` parameter. The handle never rides the prompt: it is read only from the `resume` parameter, and the localAgent registry resolves it only for the same parent session and provider that recorded the delegation — a forged handle (unknown child session, another parent's session, or the wrong provider) is rejected before any CLI process starts. The descriptor cannot carry the target (its schema rejects unknown fields), so the family passes it through the `localAgent` service's delegation registry instead.

**Stream mirror.** The delegation runs `claude -p --verbose --output-format stream-json` and the dsh subagent session mirrors the event stream in order: `thinking` blocks fold to `reasoning` blocks, `tool_use`/`tool_result` blocks to tool lines (`[工具 Bash] <command> → output`), and reply `text` blocks to assistant text; the final assistant text is the run output and the round's usage rides the last mirrored assistant message. Resumed rounds append their own turn without duplication.

**Delegation accounting.** The child session carries real usage and timing: the provider opens `turn/start` when the CLI spawns and closes `turn/end` when it settles — including on failure or cancellation (reason `error`/`aborted`) — so the `subagentTiming` projection's duration equals the actual CLI runtime and the window never stays open on a failed run. The final `assistant/message` carries the turn's token usage parsed from the JSON result (`input_tokens` → uncached input, `output_tokens` → output, `cache_read_input_tokens` → cache read, `cache_creation_input_tokens` → cache write — Anthropic reports each separately, no subtraction needed), so the `tokenUsage` projection counts the delegation.

**Model experience.** The Claude child is a fresh one-shot `claude -p` process in the delegating session's workspace, started under the scoped home; the parent submits the standalone task text and the parent conversation never crosses the process boundary. Through the family tool the parent sees only the selected final Claude answer or the consumer's exact error, plus the resume self-description on a fresh delegation — Claude commentary, tool activity, and workspace diffs are not copied into the parent session. Child tokens never enter the parent's context, the child pays for an independent Claude context and turn (cache reuse depends only on the scoped Claude installation's own provider, model, and history), and the parent's KV cache is unaffected.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/local-agent-claude-code`). Issues and contributions welcome there.
