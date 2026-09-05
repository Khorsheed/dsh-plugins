# dsh-local-agent-kimi

> Delegate to the Kimi Code CLI from any dsh session — your own `~/.kimi-code` stays untouched.

English | [中文](README.md)

The Kimi Code harness of the local-agent family: every agent preset gains a `subagent_kimi` delegation tool and a `/kimi` command family, backed by the real `kimi` CLI running in its own scoped home.

## Features

- **Delegate from any preset** — the `subagent_kimi` tool mounts at the profile root; no per-preset variants.
- **Scoped home** — config, credentials, and sessions live under `$DSH_HOME/local-agent/kimi`, never in your `~/.kimi-code`.
- **Device-code login** — `/kimi login` shows the auth URL in the session; `/kimi logout` clears scoped credentials for a fresh account.
- **Resumable delegations** — pass back the self-described `resume` handle to continue the same Kimi session, with real per-round usage and timing.
- **Session records + settings UI** — `/kimi sessions` lists your delegations; Settings → 本地 Agent shows auth status and the current workspace's sessions.
- **Model readback and per-cell working directory** — every settled round reads back the model from the wire.jsonl usage/request records into the delegation record; orchestrators pass a `cwd` per cell, and a resume in a different directory is rejected.
## Install

Requires a running dsh profile and the Kimi Code CLI (`kimi`) on `PATH` — the plugin installs neither and never logs in on your behalf.

```sh
# Name both: `dsh plugin add` reconciles only direct dependencies.
dsh plugin --profile web add @khorsheed/dsh-local-agent
dsh plugin --profile web add @khorsheed/dsh-local-agent-kimi
# Restart the profile, then run /kimi login once from a session.
```

Uninstall:

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
    thinkingEffort: high       # reasoning effort; written into a FRESH scoped config.toml ([thinking] effort and the model default_effort; low/high/max, default high). Provision-time only — an existing config is never overwritten
    live: false                # live driver: one resident kimi acp process per member, one session/prompt per round (runtime-level graceful session/cancel, push-triggered mirroring); off — or a channel that cannot come up — means the one-shot kimi -p path
    liveIdleMs: 1800000        # idle lifetime of a resident runtime before reclaim (default 30 min)
    liveMirrorGranularity: event  # live mirror granularity; token additionally appends ACP chunks as assistant/chunk (write amplification — opt-in)
```

**Evaluation snapshot (`effectiveSettings`).** The harness declares a live-read snapshot of its fairness-relevant settings for the evaluation condition hash: drive (exec/live, following the live preference), reasoning effort (read from the scoped config's `[thinking] effort`, falling back to the model's `default_effort`), whether tool use is auto-approved (the scoped config carries the `Bash(*)` allow rule), whether a custom endpoint is pinned (hostname only; the managed endpoint does not count as pinned), and the configured model (the scoped config's top-level `default_model`; absent when none is set — never guessed). `/kimi status` and the `LocalAgentStatus` Remote attach the same snapshot — this is the read side of web-eval frozen decisions 2 through 4.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.2`): ✅ full — the rc.8→0.1.1-rc.1 API audit (2026-08-21) confirms every surface this plugin consumes is unchanged or additive (the ProjectionDefinition restructure, cacheHitPercent return-type change, and the credentials/updated event rename do not touch this package); no source change was needed; re-audited for rc.2 (2026-08-22): consumed surface unchanged, full build+test green.
- source line (deepseek-harness master): ✅

## Known Limitations

- **Login is interactive** — device-code only, one login at a time per harness, no API-key path.
- **Process bookkeeping touches the real home** — kimi writes content-free `~/.kimi-code/server/instances/*.json` regardless of `KIMI_CODE_HOME`; config, credentials, and sessions stay scoped.
- **No transcript replay yet** — `/kimi sessions` lists records but does not render a session's conversation.
- **`/kimi` commands need a Web session** — headless profiles can still delegate through a composition that mounts the tool row.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Scoped home and login.** Every Kimi process the bundle starts runs with `KIMI_CODE_HOME=$DSH_HOME/local-agent/kimi`. Login is device-code only: `/kimi login` surfaces the authorization URL and code in the session, the CLI polls in the background, and credentials land in the scoped home. `/kimi logout` removes the scoped credentials and OAuth cache (the kimi CLI has no logout command). On first boot the scoped home is provisioned with a `config.toml` — the user's own config with every `api_key` blanked, or a minimal managed config when the user has none — because the CLI refuses to authenticate without provider and model definitions; an existing config is never overwritten.

**Mounting.** The bundle patch registers the `kimi` harness and mounts the `subagent_kimi` tool at the profile root; the `kimi-cli` one-shot provider spawns `kimi -p` under the scoped home. The family core (`local-agent` row, shared scoped-homes root) ships in `@khorsheed/dsh-local-agent`'s own patch, declared here as a dependency; the browser settings section ships with the family core's `./client` half.

**Session records.** `/kimi sessions` lists the scoped home's `session_index.jsonl` — this harness's delegations, never the user's personal sessions. The settings section renders the same list narrowed to records whose `workDir` matches the current session's cwd, and keeps re-probing auth status while a login is pending.

**Model readback and the cwd override.** After every settled round the provider reports the actual model from the wire.jsonl `usage.record` (falling back to `llm.request`) events' `model` field — last one seen, since a resumed session's later rounds append later records — through the `settled` run-progress event, and merges it into the delegation record's `observedModel` field; absence is recorded, never guessed. An orchestrator may also pass a per-round working directory through the facade's `DelegationCallOptions.cwd` (recorded as the record's `cwd`); when a resume round resolves to a different directory than the recorded first round, it fails loud before any process spawns — a CLI session continues in the directory its first round ran in.

**Resume.** A fresh delegation's result text self-describes the handle (`追问请带 resume="<childSessionId>"`); passing it back as the tool's optional `resume` parameter continues the same kimi session (`kimi -S session_<id> -p`) inside the same dsh child session. The handle never rides the prompt: it is resolved through the `localAgent` delegation registry only for the same parent session and provider that recorded the delegation — a forged handle is rejected before any CLI process starts.

**Isolation and accounting.** The child is a fresh session in the delegating session's workspace; the parent receives only the final answer or the exact error — child context, commentary, tool activity, and diffs never cross into the parent session. The provider opens `turn/start` at spawn and closes `turn/end` at settle, including on failure or abort (reason `error`/`aborted`), so durations equal real CLI runtime. Usage is the sum of the round's `usage.record` deltas (each one LLM request, not cumulative), carried on the round's final mirrored assistant message; the mirror filters kimi's auto-permission `<system-reminder>` messages, renders tool calls with arguments, pairs results to their calls, and advances incrementally so earlier messages never duplicate. Aborting settles the tool result immediately (SIGTERM→grace→SIGKILL) and keeps the partial work already mirrored.

**Live driver (`live: true`).** Replaces the per-round spawn: the member's first delegation brings up one resident `kimi acp` process (ACP over stdio; the handshake requires the `loadSession` capability, otherwise the breaker falls back), `session/new` creates the session (the server-assigned id becomes the delegation record's `cliSessionId`), and every later round is one `session/prompt`; `cancel` lands as `session/cancel` — the process survives and the session stays continuable. The member bridge rides the ACP `mcpServers` inline declaration (no mcp.json write). `session/request_permission` is auto-answered unattended (first allow option, cancelled when none — matching `kimi -p`'s auto-approve). **Mirroring deliberately stays on the file fold**: ACP pushes token-level chunks, which are not isomorphic to the wire.jsonl line fold, so pushes only trigger throttled `mirrorKimiDelta` passes and the settle pass stays authoritative — one fold, one offset, and the two driver paths cannot drift. Runtimes are reclaimed after an idle timeout (stdin EOF → SIGTERM ladder); after a crash the next round re-spawns and `session/load`s the on-disk session.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/local-agent-kimi`). Issues and contributions welcome there.
