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
    model: kimi-code/k3        # optional: every delegation round starts the CLI with it; absent passes no model at all (below)
    thinkingEffort: high       # reasoning effort; written into a FRESH scoped config.toml ([thinking] effort and the model default_effort; low/high/max, default high). Provision-time only — an existing config is never overwritten
    live: false                # live driver: one resident kimi acp process per member, one session/prompt per round (runtime-level graceful session/cancel, push-triggered mirroring); off — or a channel that cannot come up — means the one-shot kimi -p path
    liveIdleMs: 1800000        # idle lifetime of a resident runtime before reclaim (default 30 min)
    liveMirrorGranularity: event  # live mirror granularity; token additionally appends ACP chunks as assistant/chunk (write amplification — opt-in)
```

### Default model (`model`)

⚠️ **This key's meaning changed.** It used to apply exactly once, when a FRESH scoped home was provisioned: it became the `default_model` of the written `config.toml`, and an existing config was left alone. It now applies to **every delegation round**. The provisioning mirror is kept: a fresh scoped home with no user config to mirror still gets its minimal managed config built around this value.

**Absent = today's behavior.** Without this key the plugin adds no model flag to the argv at all: the scoped `config.toml`'s top-level `default_model` decides which model runs.

**Set = every delegation round starts the CLI with it.** The value must name a model the scoped `config.toml` defines (a `[models."…"]` key) — `-m` resolves against kimi's own model table.

| Drive | How it is passed |
|---|---|
| one-shot (default) | `kimi -m <model> -p <task>`; a resume round is `kimi -S <session> -m <model> -p <task>` — `-S` still leads and `-m` hugs `-p` (anything after `-p` is read as the prompt) |
| resident (`live: true`) | `kimi acp` has **no** model flag, so the scoped `config.toml`'s top-level `default_model` is rewritten to the value before each runtime spawns. The write is in place and idempotent: only that one top-level line moves, while comments, model tables, providers and `[thinking]` stay byte-identical; with no config to write into, none is created (provisioning owns creation), the round still runs, and the model read-back is what surfaces a mismatch |

So: the one-shot drive never touches your `config.toml`; the resident drive rewrites its `default_model` line.

The settings card's "Default model" writes the same key: a free-text input (no model catalog is built in) plus previously saved values as suggestions. Saving applies to the **next** round, leaves rounds in flight alone, and needs no reload. Clearing the field and saving unsets the key.

**This is not an evaluation gap.** A run freezes its condition at setup: change the key mid-run and the next round's model read-back sees declared ≠ observed and fails the run as misattributed (frozen decision 5).

**Evaluation snapshot (`effectiveSettings`).** The harness declares a live-read snapshot of its fairness-relevant settings for the evaluation condition hash: drive (exec/live, following the live preference), reasoning effort (read from the scoped config's `[thinking] effort`, falling back to the model's `default_effort`), whether tool use is auto-approved (the scoped config carries the `Bash(*)` allow rule), whether a custom endpoint is pinned (hostname only; the managed endpoint does not count as pinned), and the configured model (the plugin config's `model` key first — it overrules the file every round — then the scoped config's top-level `default_model`; absent when neither names one — never guessed), and the CLI version (`kimi --version`, cached against the executable's path + mtime; absent when the CLI cannot be asked). `/kimi status` and the `LocalAgentStatus` Remote attach the same snapshot — this is the read side of web-eval frozen decisions 2 through 4.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.2-rc.1`): ✅ full — baseline moved to the 0.1.2-rc.1 API surface (single-arm 0.1.2 API consumption; the 0.1.1-rc.2 runtime arm is retired), full build+test green; minHost moves up to 0.1.2-rc.1 — older hosts stay on the previous release line.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.2-rc.1)

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

**Tool-call accounting.** Every settled round also reports how many tool calls it made, on the `settled` run-progress event (`toolCalls: { count, byName }`). What is counted is the transcript's `tool.call` lines carrying THIS ROUND'S TURN — deliberately not the mirror window: in resident mode a live poll may have drained the settle pass's delta, and a resume round must not inherit the earlier rounds' calls. `byName` keys are the tool names the wire gave, verbatim. One accounting per round, never cumulative; a round that called nothing carries no field at all (absent is not zero).

**Named scopes.** `/kimi login --scope <name>` opens a second `KIMI_CODE_HOME` at `<homesRoot>/kimi@<name>`; the directory is provisioned with the same two steps in the same order (provider/model config first, then the permission rules — the permission write reads the config file). From then on that scope has its own login, its own wire log and its own transcript mirror. A scoped delegation is exec-only (the resident `kimi acp` is bound per member to the default scoped home) and carries **no member channel**: the bridge declaration is written into a scoped home's `mcp.json` and the socket is a single homes-root one, so a named absence beats a half-wired presence.

**Container delegation.** An orchestrator may run the round inside an **already-acquired container** through the facade's `DelegationCallOptions.exec` (`{ container, workdir, env? }`): the argv becomes `docker exec -w <workdir> [-e NAME…] <container> kimi -p …` and everything else (the wire.jsonl mirror and readback, settle, recording) is byte-for-byte unchanged. `env` must name the in-container `KIMI_CODE_HOME`, and it should be the read-write bind mount of the host scoped home — the transcript mirror and the model readback read the host copy of the wire log. A container round always takes the exec one-shot (the resident `kimi acp` is a host process) and **does not write** the member-bridge entry into `mcp.json`: that declaration names a host node path the unit cannot start, and leaving a broken server in a shared config file is worse than running one round without the member channel.

**Resume.** A fresh delegation's result text self-describes the handle (`追问请带 resume="<childSessionId>"`); passing it back as the tool's optional `resume` parameter continues the same kimi session (`kimi -S session_<id> -p`) inside the same dsh child session. The handle never rides the prompt: it is resolved through the `localAgent` delegation registry only for the same parent session and provider that recorded the delegation — a forged handle is rejected before any CLI process starts.

**Isolation and accounting.** The child is a fresh session in the delegating session's workspace; the parent receives only the final answer or the exact error — child context, commentary, tool activity, and diffs never cross into the parent session. The provider opens `turn/start` at spawn and closes `turn/end` at settle, including on failure or abort (reason `error`/`aborted`), so durations equal real CLI runtime. Usage is the sum of the round's `usage.record` deltas (each one LLM request, not cumulative), carried on the round's final mirrored assistant message; the mirror filters kimi's auto-permission `<system-reminder>` messages, renders tool calls with arguments, pairs results to their calls, and advances incrementally so earlier messages never duplicate. Aborting settles the tool result immediately (SIGTERM→grace→SIGKILL) and keeps the partial work already mirrored.

**Live driver (`live: true`).** Replaces the per-round spawn: the member's first delegation brings up one resident `kimi acp` process (ACP over stdio; the handshake requires the `loadSession` capability, otherwise the breaker falls back), `session/new` creates the session (the server-assigned id becomes the delegation record's `cliSessionId`), and every later round is one `session/prompt`; `cancel` lands as `session/cancel` — the process survives and the session stays continuable. The member bridge rides the ACP `mcpServers` inline declaration (no mcp.json write). `session/request_permission` is auto-answered unattended (first allow option, cancelled when none — matching `kimi -p`'s auto-approve). **Mirroring deliberately stays on the file fold**: ACP pushes token-level chunks, which are not isomorphic to the wire.jsonl line fold, so pushes only trigger throttled `mirrorKimiDelta` passes and the settle pass stays authoritative — one fold, one offset, and the two driver paths cannot drift. Runtimes are reclaimed after an idle timeout (stdin EOF → SIGTERM ladder); after a crash the next round re-spawns and `session/load`s the on-disk session.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/local-agent-kimi`). Issues and contributions welcome there.
