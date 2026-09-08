# `@khorsheed/dsh-local-agent-claude-code`

English | [中文](README.md)

Delegate coding tasks to a locally installed Claude Code from any dsh agent preset — answers stream back live, and your personal `~/.claude` is never touched. The Claude Code harness of the [local-agent family](../local-agent/README.md).

## Features

- **Delegate from any preset** — the tool mounts once at the profile root; no per-preset variants.
- **Scoped home** — every Claude process runs with `CLAUDE_CONFIG_DIR` under `$DSH_HOME/local-agent/claude-code`; your personal `~/.claude` stays out of it.
- **Guided login, one command** — `/claude-code login` answers with the exact command to run in your own terminal (claude ≥2.1 prints its OAuth URL only on a TTY, so the host no longer spawns and scrapes) and watches the scoped home for the credential; `sessions`/`status`/`logout` and a Settings → 本地 Agent panel complete the family.
- **Resume a delegation** — pass back the result's `resume` handle to continue the same Claude session, with per-round accounting.
- **Live stream mirror** — the child session mirrors Claude's thinking, tool calls, and replies live; aborting keeps the partial transcript and real token usage.
- **Model readback and per-cell working directory** — every settled round reads back the model from stream-json’s system/init into the delegation record; orchestrators pass a `cwd` per cell, and a resume in a different directory is rejected.
## Install

Prerequisites: a running dsh profile, and the Claude Code CLI (`claude`) on `PATH` — the plugin does not install it. Install the family core together with this bundle (`dsh plugin add` reconciles only *direct* dependencies, so name both):

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-claude-code
```

Restart the profile, then run `/claude-code login` once from a session. Uninstall:

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-claude-code
```

The scoped home is kept on uninstall so a reinstall needs no fresh login; delete `$DSH_HOME/local-agent/claude-code` to remove every trace.

## Config

Optional fields on the bundle row:

- `permissionMode` — `skip` (default) passes `--dangerously-skip-permissions` so the child can write files without an approval prompt; `normal` runs without it, so approval-requiring actions (e.g. writing files) are denied.
- `baseUrl` — sets `ANTHROPIC_BASE_URL` for the child CLI (e.g. a self-hosted router or proxy); absent, the child inherits the host process environment. Config wins over environment.
- `live` — live driver: one resident stream-json process per member (`--input-format stream-json`), one stdin message per round (runtime-level graceful control interrupt, same-shape push stream); off — or a channel that cannot come up — means the one-shot `claude -p` path.
- `liveIdleMs` — idle lifetime of a resident runtime before reclaim (default 30 min).
- `liveMirrorGranularity` — live mirror granularity (default `event`); `token` additionally spawns with `--include-partial-messages` and appends deltas as `assistant/chunk` (write amplification — opt-in).

⚠️ `skip` has no OS-level sandbox — the child can write anywhere the host user can, including outside the workspace — and the scoped login's OAuth token is sent to whatever `baseUrl` points at. Prefer `normal` when a delegation needs confinement; point `baseUrl` only at endpoints you trust.

**Evaluation snapshot (`effectiveSettings`).** The harness declares a live-read snapshot of its fairness-relevant settings for the evaluation condition hash: drive (exec/live), the permission mode (`skip`/`normal`, plugin config), whether a non-default endpoint is in force (following the provider's own resolution order — the config item wins over the host environment's `ANTHROPIC_BASE_URL`; hostname only), and the configured model (the scoped `settings.json`'s `model`; the CLI's own default model stays the CLI's business and is never guessed — no key, no field), and the CLI version (`claude --version`, cached against the executable's path + mtime; absent when the CLI cannot be asked). `/claude-code status` and the `LocalAgentStatus` Remote attach the same snapshot.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.2`): ✅ full — the rc.8→0.1.1-rc.1 API audit (2026-08-21) confirms every surface this plugin consumes is unchanged or additive (the ProjectionDefinition restructure, cacheHitPercent return-type change, and the credentials/updated event rename do not touch this package); no source change was needed; re-audited for rc.2 (2026-08-22): consumed surface unchanged, full build+test green.
- source line (deepseek-harness master): ✅

## Known Limitations

- **macOS logout is config-only** — the keychain entry is left for the CLI's own `claude auth logout`; a fresh login rewrites the same slot, so the stale entry is harmless.
- **Linux credentials are not isolated** (upstream bug #47661) — claude reads the default `~/.claude/.credentials.json` even when the scoped home has none.
- **Interactive-session records may be missing** — under a custom `CLAUDE_CONFIG_DIR` the CLI may not write transcripts (upstream behavior).
- **Headless caveat** — `/claude-code` commands need a Web session; `--profile headless` delegates through a composition that mounts the tool row.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Model readback and the cwd override.** After every settled round the provider reports the actual model from the stream-json `system` (init) event's `model` field (e.g. `claude-opus-5[1m]`, verbatim — context-variant suffixes included) through the `settled` run-progress event, and merges it into the delegation record's `observedModel` field; absence is recorded, never guessed. An orchestrator may also pass a per-round working directory through the facade's `DelegationCallOptions.cwd` (recorded as the record's `cwd`); when a resume round resolves to a different directory than the recorded first round, it fails loud before any process spawns — a CLI session continues in the directory its first round ran in.

**Container delegation.** An orchestrator may run the round inside an **already-acquired container** through the facade's `DelegationCallOptions.exec` (`{ container, workdir, env? }`): the argv becomes `docker exec -w <workdir> [-e NAME…] <container> claude -p …` and everything else (stream-json parse, settle, recording) is byte-for-byte unchanged. `env` must name the in-container `CLAUDE_CONFIG_DIR`; on Linux claude **writes the scoped dir but reads the default home** (upstream #47661), so the caller normally bind-mounts the host scoped home read-write onto the container's default home and points `CLAUDE_CONFIG_DIR` at the same place. The keychain→file sync before every spawn still runs against the **host** scoped home, so a refreshed grant reaches the container through the mount. A container round always takes the exec one-shot and declares no member bridge. **Mind the host-only entries in the scoped `settings.json`**: measured, the `https_proxy` there — meant for the host daemon — points at nothing inside the unit and the round dies with `Connection refused`. The caller stages what it mounts.

```
src/index.ts                harness registration, /claude-code command family, config schema
src/claude-cli-provider.ts  one-shot provider: spawn, stream mirror, turn/token accounting
src/provision.ts            scoped-home provisioning and file-based logout
src/records.ts              auth probe and session-record listing from the scoped home
```

The bundle patch registers the `claude-code` harness into the family core (`@khorsheed/dsh-local-agent`, declared as a dependency — the claude bundle deliberately does not re-insert the core row, which would mount it twice) and mounts the `claude-local` provider, which spawns `claude -p --verbose --output-format stream-json` under the harness's scoped home. The `subagent_claude_code` tool is the family-owned tool (`@khorsheed/dsh-local-agent-tool-subagent`): the official subset (`description`/`prompt`) plus an optional `resume` parameter.

**Scope isolation.** On macOS the real credential lives in the OS keychain under a hashed entry (`Claude Code-credentials-<sha256(configDir)[:8]>`) keyed to the scoped home path — file-based logout cannot reach it, but a fresh login rewrites the same slot. On Linux, upstream bug #47661 means `CLAUDE_CONFIG_DIR` does not isolate the credentials file (see Known Limitations). Auth detection is a light file check of the scoped `.claude.json`'s `oauthAccount` — the CLI is never spawned just to probe.

**Session records.** `/claude-code sessions` lists the scoped home's `projects/<cwd-slug>/<uuid>.jsonl` session files — this agent's delegations, never your personal sessions. The slug is a lossy encoding of the workspace path, so the listed `workDir` comes from the file content (the first `user` event's `cwd` field), never the directory name. The Settings panel shows the same listing narrowed to the current workspace.

**Resume security.** The handle never rides the prompt: it is read only from the `resume` parameter, and the localAgent registry resolves it only for the same parent session and provider that recorded the delegation — a forged handle (unknown child session, another parent's session, or the wrong provider) is rejected before any CLI process starts.

**Stream mirror & accounting.** `thinking` blocks fold to `reasoning` blocks, `tool_use`/`tool_result` to tool lines (`[工具 Bash] <command> → output`), reply `text` to assistant text; resumed rounds append their own turn without duplication. The provider opens `turn/start` at spawn and closes `turn/end` on settle — including failure and cancellation — so `subagentTiming` duration equals actual CLI runtime and no window stays open; the final `assistant/message` carries token usage parsed from the JSON result (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` — Anthropic reports each separately).

**Model experience.** The child is a fresh one-shot `claude -p` in the delegating session's workspace; the parent submits only the standalone task text and sees only the final answer or the exact error, plus the resume self-description on a fresh delegation — Claude commentary, tool activity, and workspace diffs are not copied over. Child tokens never enter the parent's context; the child pays for its own Claude context and turn (cache reuse depends only on the scoped installation's provider, model, and history); the parent's KV cache is unaffected.

**Live driver (`live: true`).** Replaces the per-round spawn: the member's first delegation brings up one resident stream-json process (`claude -p --verbose --input-format stream-json --output-format stream-json`), the first stdin `user` message triggers `system/init` (the server-assigned session id becomes the delegation record's `cliSessionId`), and every later round is one stdin message. The event stream is byte-identical in shape to exec's stream-json, so each turn folds through the same `ClaudeStreamParser` (the last line held back until `result` carries usage, as in exec), and `cancel` lands as a `control_request interrupt` — the process survives and the session stays continuable. Reclaim is stdin EOF → SIGTERM; after a crash the next round reattaches with `--resume <session_id>`. The auth discipline is byte-identical to exec: only the scoped `CLAUDE_CONFIG_DIR` (plus an optional `baseUrl` override) is injected — the global `~/.claude` is never touched and no `auth` verb ever runs.

**Config notes.** The host environment is a startup-time snapshot — a later `export ANTHROPIC_BASE_URL` in another shell has no effect until the host restarts; check the host's environment, not your current shell, when diagnosing routing. Every delegation logs the effective endpoint at info level (`subagent-claude: delegating via <endpoint>`), and a failed run's error text names it. `skip` is the default because a one-shot CLI subagent has no approval surface; scope the host's own sandbox (e.g. run the host inside a sandboxed workspace) when a delegation needs confinement.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/local-agent-claude-code`). Issues and contributions welcome there.
