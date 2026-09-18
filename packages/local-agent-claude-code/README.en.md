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
- `model` — every delegation round starts the CLI with it (`claude -p --model <model>`); absent passes no model flag at all. See below.
- `baseUrl` — sets `ANTHROPIC_BASE_URL` for the child CLI (e.g. a self-hosted router or proxy); absent, the child inherits the host process environment. Config wins over environment.
- `live` — live driver: one resident stream-json process per member (`--input-format stream-json`), one stdin message per round (runtime-level graceful control interrupt, same-shape push stream); off — or a channel that cannot come up — means the one-shot `claude -p` path.
- `liveIdleMs` — idle lifetime of a resident runtime before reclaim (default 30 min).

### Default model (`model`)

**Absent = today's behavior.** Without this key the plugin adds no model flag to the argv at all: the scoped `settings.json`'s `model` decides which model runs, and claude's own default decides when that is missing too (the plugin never guesses what it is).

**Set = every delegation round starts the CLI with it.** All four argv variants — fresh and resume, one-shot and resident (`live: true`) — carry `--model <model>`, placed before the member channel's `--allowedTools … --`: that flag is variadic and everything after its `--` is the task text.

One-shot (exec) rounds never rewrite the scoped `settings.json`: `--model` overrules it per round and the file stays exactly as you edited it. A resident (live) spawn scratches the member's effective model into that file (a `--resume` reattach honors the file's model over the `--model` flag) and restores the previous value before a spawn that binds none; the "CLI config" layer that status and the settings card report is always the value you configured, never a member's scratch.

The settings card's "Default model" writes the same key: a free-text input (no model catalog is built in); saving applies to the **next** round, leaves rounds in flight alone, and needs no reload. Clearing the field and saving unsets the key, which falls back to the YAML composition base and from there to "absent" above. While unset, the input itself **displays the default it currently follows** as a dimmed placeholder (inherited, never a pinned value: the scoped settings.json `model`, else the CLI's built-in default, else the last observed model). The chevron menu is the single choice list (the native datalist is gone): its leading item is "Default (follow …)" — checked while unset, picking it clears the draft back to follow-default — and the rest come from the family gateway's model surface (the settings value, the scoped-file default, and recently saved values, deduped); typing by hand always works. With the gateway absent (an older core) the card falls back to the previously saved values and the bare input.

**A delegation's own model outranks this key.** An orchestrator may name the model for ONE delegation through the facade's `DelegationCallOptions.model`, which sits above this key (the layer order is in the family core README). The first round's request is recorded and every resume round re-requests it — `resume` takes no model of its own. In resident mode a fresh delegation's model binds as the member's start model at the runtime's spawn: a runtime bound to a different model retires first, and the same CLI session resumes on the new process.

**Session-level member switching.** The member composer's model picker writes a **session-level override** through the family gateway's `setMemberModel` — it outranks the delegation model and this key, lives in memory only, and deliberately neither survives a host restart nor enters the settings. A switch is refused while the member has a round in flight; with the live driver on, switching to a different model retires the member's resident runtime so the next round respawns onto the new model while resuming the SAME CLI session (the conversation carries over), and a same-model switch is a no-op.

**This is not an evaluation gap.** A run freezes its condition at setup: change the key mid-run and the next round's model read-back sees declared ≠ observed and fails the run as misattributed (frozen decision 5). "A new run follows the new value, a running one is never switched underneath you" is the design, not an oversight.

⚠️ `skip` has no OS-level sandbox — the child can write anywhere the host user can, including outside the workspace — and the scoped login's OAuth token is sent to whatever `baseUrl` points at. Prefer `normal` when a delegation needs confinement; point `baseUrl` only at endpoints you trust.

**Evaluation snapshot (`effectiveSettings`).** The harness declares a live-read snapshot of its fairness-relevant settings for the evaluation condition hash: drive (exec/live), the permission mode (`skip`/`normal`, plugin config), whether a non-default endpoint is in force (following the provider's own resolution order — the config item wins over the host environment's `ANTHROPIC_BASE_URL`; hostname only), and the configured model (the plugin config's `model` key first — it overrules the file on every argv — then the scoped `settings.json`'s `model`; the CLI's own default model stays the CLI's business and is never guessed — neither key, no field), and the CLI version (`claude --version`, cached against the executable's path + mtime; absent when the CLI cannot be asked). `/claude-code status` and the `LocalAgentStatus` Remote attach the same snapshot.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ full — the live mirror folds every output item 1:1 into the child session log, and the host ui-chat's wholesale replace of a repeated assistant/message at one coordinate (shipped since 0.1.5-rc.1) provides the incremental live rendering. Adapted to format v2/v3 and handle-based sessionPersistence; build+test green; minHost moves up to 0.1.5-rc.1 — older hosts stay on the previous release line.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.5-rc.1)

## Known Limitations

- **macOS logout is config-only** — the keychain entry is left for the CLI's own `claude auth logout`; a fresh login rewrites the same slot, so the stale entry is harmless.
- **One grant cannot be shared between a host round and a container round** — the two use different stores on macOS, and a rotation on either side invalidates the other's token family. A containerized condition takes its own named scope; see Container delegation.
- **Linux credentials are not isolated** (upstream bug #47661) — claude reads the default `~/.claude/.credentials.json` even when the scoped home has none.
- **Interactive-session records may be missing** — under a custom `CLAUDE_CONFIG_DIR` the CLI may not write transcripts (upstream behavior).
- **Headless caveat** — `/claude-code` commands need a Web session; `--profile headless` delegates through a composition that mounts the tool row.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Model readback and the cwd override.** After every settled round the provider reports the actual model from the stream-json `system` (init) event's `model` field (e.g. `claude-opus-5[1m]`, verbatim — context-variant suffixes included) through the `settled` run-progress event, and merges it into the delegation record's `observedModel` field; absence is recorded, never guessed. When no layer and no record names a model, the 默认 surface's last-observed hint reads the member's OWN transcript (`projects/<cwd-slug>/<sessionId>.jsonl`, or the tree's newest for the memberless card) — the history backstop for rounds that predate the settle channel; read-only, never a write into `delegations.jsonl`. An orchestrator may also pass a per-round working directory through the facade's `DelegationCallOptions.cwd` (recorded as the record's `cwd`); when a resume round resolves to a different directory than the recorded first round, it fails loud before any process spawns — a CLI session continues in the directory its first round ran in.

**Tool-call accounting.** Every settled round also reports how many tool calls it made, on the `settled` run-progress event (`toolCalls: { count, byName }`). The count is taken in the `tool_use` branch the stream fold ALREADY walks, and `byName` keys are the block's own `name` (`Bash`, `Read`, `TodoWrite`, or an MCP tool's full `mcp__server__tool`), carried verbatim and never normalized across harnesses. `TodoWrite` counts too: the fold diverts it into the todo snapshot instead of the transcript, but the CLI still called it. One accounting per round, never cumulative; a round that called nothing carries no field at all (absent is not zero). Measured: a "read two files, then list the directory" round reads back `{count: 3, byName: {Read: 2, Bash: 1}}`, matching the mirrored tool cards one for one.

**Named scopes.** `/claude-code login --scope <name>` opens a second `CLAUDE_CONFIG_DIR` at `<homesRoot>/claude-code@<name>`, and the login argv is built from the directory BEING logged in (`env CLAUDE_CONFIG_DIR=… claude auth login` — that assignment outranks the spawn env, so a hard-coded default would authorize the wrong directory under `--scope`). claude's keychain item is keyed by the config directory's path, so a named scope gets its own keychain item for free — the one credential store among the four harnesses that is path-isolated by nature. A scoped delegation runs `claude -p` against that directory, reconciles keychain↔file there, and reads back from there; exec-only.

**Container delegation.** An orchestrator may run the round inside an **already-acquired container** through the facade's `DelegationCallOptions.exec` (`{ container, workdir, env? }`): the argv becomes `docker exec -w <workdir> [-e NAME…] <container> claude -p …` and everything else (stream-json parse, settle, recording) is byte-for-byte unchanged. `env` must name the in-container `CLAUDE_CONFIG_DIR`, and the caller bind-mounts the host scoped home read-write onto that path. Measured on claude 2.1.272 inside the evaluation image, the in-container CLI reads AND writes `<CLAUDE_CONFIG_DIR>/.credentials.json`, and its whole state tree (`projects/`, `sessions/`, …) lands there too; the older upstream-#47661 behavior (Linux writes the scoped dir but reads the default home) does not describe that version. The credential reconcile before every spawn still runs against the **host** scoped home, so a refreshed grant reaches the container through the mount — and it is **newer-wins, not a mirror**, because the unit is a SECOND WRITER to that same file. The CLI inside a unit has no keychain, so it rotates the grant in the mounted file; an unconditional keychain→file mirror would then hand the next run a refresh token the unit already spent, the endpoint rejects it, and the CLI answers by CLEARING the file — which logs the whole instance out, because that file is the instance's credential. The reconcile therefore writes the keychain blob only when it is not older than the file's (access-token expiry decides; an undefined expiry on either side keeps the keychain writing, and an unusable file never wins). The mount stays read-write for a second reason as well: the round's transcripts land in `projects/` under the same directory, and the evaluation's model read-back parses them from the host side of that mount. A container round always takes the exec one-shot and declares no member bridge.

**A container round needs its OWN scope, and the discipline is not optional.** claude is the only harness here with two credential stores, and measured on macOS 2.1.274 they do not have one reader: the HOST CLI reads and writes the KEYCHAIN, while the CLI inside a unit — Linux, no keychain — reads and writes the mounted file. One grant refreshed from both is one grant refreshed twice, and the endpoint rotates single-use refresh tokens by invalidating the whole token FAMILY: whichever side did not refresh last is left holding a dead token. Measured end to end — a container round rotated the file, and the next host round answered `OAuth session expired and could not be refreshed` although the file's own access token was still hours from expiry, recoverable only by a fresh login. Newer-wins keeps the FILE side correct, which is what the unit and every status probe read, but nothing can write the unit's rotation back into the keychain (`security add-generic-password` would put the secret in argv, so it is refused). So the container side and the host side must be two INDEPENDENT grants: give every containerized claude condition its own named scope, authorize it once with `/claude-code login --scope <name>`, and never run a host-side claude round in that scope. The evaluation refuses a plan that breaks this before it acquires a unit. **Mind the host-only entries in the scoped `settings.json`**: measured, the `https_proxy` there — meant for the host daemon — points at nothing inside the unit and the round dies with `Connection refused`. The caller stages what it mounts.

```
src/index.ts                harness registration, /claude-code command family, config schema
src/claude-cli-provider.ts  one-shot provider: spawn, stream mirror, turn/token accounting
src/provision.ts            scoped-home provisioning and file-based logout
src/records.ts              auth probe and session-record listing from the scoped home
```

The bundle patch registers the `claude-code` harness into the family core (`@khorsheed/dsh-local-agent`, declared as a dependency — the claude bundle deliberately does not re-insert the core row, which would mount it twice) and mounts the `claude-local` provider, which spawns `claude -p --verbose --output-format stream-json` under the harness's scoped home. The `subagent_claude_code` tool is the family-owned tool (`@khorsheed/dsh-local-agent-tool-subagent`): the official subset (`description`/`prompt`) plus an optional `resume` parameter.

**Scope isolation.** On macOS the real credential lives in the OS keychain under a hashed entry (`Claude Code-credentials-<sha256(configDir)[:8]>`) keyed to the scoped home path — file-based logout cannot reach it, but a fresh login rewrites the same slot. Which store the CLI itself uses is VERSION-dependent and was measured, not assumed: 2.1.236 wrote the keychain and read the file (the split this mirror exists for), while 2.1.274 on macOS reads and writes the keychain, and 2.1.272 on Linux reads and writes the scoped file. The file therefore stays authoritative for this package's own probes and for a container round; the keychain is what a host CLI on current macOS actually uses. Auth detection is a light file check of the scoped `.claude.json`'s `oauthAccount` — the CLI is never spawned just to probe. The probe also reconciles the two stores, so it obeys the same newer-wins rule as the spawn sites: it runs on every status read and every readiness check, and an unconditional mirror there would undo a containerized round's refresh just as surely.

**Session records.** `/claude-code sessions` lists the scoped home's `projects/<cwd-slug>/<uuid>.jsonl` session files — this agent's delegations, never your personal sessions. The slug is a lossy encoding of the workspace path, so the listed `workDir` comes from the file content (the first `user` event's `cwd` field), never the directory name. The Settings panel shows the same listing narrowed to the current workspace.

**Resume security.** The handle never rides the prompt: it is read only from the `resume` parameter, and the localAgent registry resolves it only for the same parent session and provider that recorded the delegation — a forged handle (unknown child session, another parent's session, or the wrong provider) is rejected before any CLI process starts.

**Stream mirror & accounting.** `thinking` blocks fold to `reasoning` blocks, `tool_use`/`tool_result` to tool lines (`[工具 Bash] <command> → output`), reply `text` to assistant text; resumed rounds append their own turn without duplication. Edit-family calls (Edit/Write/MultiEdit/NotebookEdit) fold into ApplyPatch-style cards — the path on the args line, the actual edit (old/new strings or the whole file body) as the card body, the same shape codex's fileChange mirror uses; server-side tools (`server_tool_use` web_search/web_fetch) pair with their results by id into visible WebSearch/WebFetch cards; a `redacted_thinking` block folds to a visible placeholder think line (the content is server-encrypted by design — the line says so); every other tool's input keeps its one-scalar summary, with a truncated JSON summary as the fallback instead of dropping. Every mirrored step is wrapped in a `step/start`–`step/end` pair at its own (turn, step) — the host's live conversation view registers steps only on those boundaries, so a boundary-less assistant message stays unrendered until a full rebuild. The provider opens `turn/start` at spawn and closes `turn/end` on settle — including failure and cancellation — so `subagentTiming` duration equals actual CLI runtime and no window stays open; the final `assistant/message` carries token usage parsed from the JSON result (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` — Anthropic reports each separately).

**Model experience.** The child is a fresh one-shot `claude -p` in the delegating session's workspace; the parent submits only the standalone task text and sees only the final answer or the exact error, plus the resume self-description on a fresh delegation — Claude commentary, tool activity, and workspace diffs are not copied over. Child tokens never enter the parent's context; the child pays for its own Claude context and turn (cache reuse depends only on the scoped installation's provider, model, and history); the parent's KV cache is unaffected.

**Live driver (`live: true`).** Replaces the per-round spawn: the member's first delegation brings up one resident stream-json process (`claude -p --verbose --input-format stream-json --output-format stream-json`), the first stdin `user` message triggers `system/init` (the server-assigned session id becomes the delegation record's `cliSessionId`), and every later round is one stdin message. The event stream is byte-identical in shape to exec's stream-json, so each turn folds through the same `ClaudeStreamParser` (the last line held back until `result` carries usage, as in exec), and `cancel` lands as a `control_request interrupt` — the process survives and the session stays continuable. Reclaim is stdin EOF → SIGTERM; after a crash the next round reattaches with `--resume <session_id>`. A runtime binds the member's effective model at spawn (session-level override → delegation model → settings key) and scratches it into the scoped `settings.json` (a `--resume` reattach honors the file over the flag); a runtime whose bound model no longer matches the round's resolution retires before the respawn. A `permissionMode: normal` spawn omits `--dangerously-skip-permissions`, so the CLI's server→client control requests (the `can_use_tool` approval surface) are auto-answered with allow by the driver — a subagent has no approval surface, matching exec's effective behavior under skip; any other subtype gets an error answer instead of a silent hang. The auth discipline is byte-identical to exec: only the scoped `CLAUDE_CONFIG_DIR` (plus an optional `baseUrl` override) is injected — the global `~/.claude` is never touched and no `auth` verb ever runs.

**Config notes.** The host environment is a startup-time snapshot — a later `export ANTHROPIC_BASE_URL` in another shell has no effect until the host restarts; check the host's environment, not your current shell, when diagnosing routing. Every delegation logs the effective endpoint at info level (`subagent-claude: delegating via <endpoint>`), and a failed run's error text names it. `skip` is the default because a one-shot CLI subagent has no approval surface; scope the host's own sandbox (e.g. run the host inside a sandboxed workspace) when a delegation needs confinement.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/local-agent-claude-code`). Issues and contributions welcome there.
