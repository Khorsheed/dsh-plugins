# `@khorsheed/dsh-local-agent-dsh`

English | [中文](README.md)

Delegate a task to dsh itself as a separate local CLI process, sibling to the kimi / codex / claude-code harnesses. It runs under its own scoped home, authenticates through the parent's API key, and resumes across rounds; a settings toggle (default off) turns the delegation tool on.

## Features

- **Delegate to dsh itself** — spawns a sub-dsh headless CLI process.
- **Scoped home** — its own `DSH_HOME` (`$DSH_HOME/local-agent/dsh`): profile, sessions, and state never mixed into the parent.
- **Resume across rounds** — pass the child session id back to continue the same session.
- **No separate login** — authenticates through the parent's `DEEPSEEK_API_KEY`; no device-code flow.
- **DeepSeek toggle, default off** — nothing model-visible until you flip the switch in Settings → 本地 Agent.

## Install

The family core and this bundle must be named in one command, then restart the profile:

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-dsh
```

No login step needed — `/dsh status` reports whether the parent's `DEEPSEEK_API_KEY` resolves.

Uninstall:

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-dsh
```

The scoped home (`$DSH_HOME/local-agent/dsh`) is kept on purpose — it holds the sub-dsh's own sessions; delete it to remove every trace.

## Config

| field | default | meaning |
| --- | --- | --- |
| `profileName` | `headless-local-agent-dsh` | sub-dsh profile under the scoped home |
| `apiKeyRef` | `DEEPSEEK_API_KEY` | credential reference the sub-dsh resolves |
| `cliLaunch` | parent's own launch | dsh launch argv prefix override |
| `headlessBundleDir` | resolved from installation | headless bundle directory for the sub-profile symlink |
| `live` | `false` | live driver: one resident `--serve` sub-dsh process per member; a delegation round is a turn sent to the living runtime (runtime-level graceful interrupt, push-mode mirroring); off — or a channel that cannot come up — means the one-shot exec path |
| `liveIdleMs` | `1800000` (30 min) | idle lifetime of a resident runtime before reclaim |
| `liveMirrorGranularity` | `event` | live mirror granularity; `token` additionally appends `assistant/chunk` deltas to the child session (write amplification — opt-in) |

**Evaluation snapshot (`effectiveSettings`).** The harness's fairness snapshot carries the drive (exec/live), the no-pinned-endpoint flag, and the configured model (the host `agentDefaultModel` selection the sub-dsh inherits, formatted `provider/model`; when the service is absent or the selection unreadable the field drops out — never guessed): a headless sub-dsh has no sandbox or permission knob (the web-eval frozen baseline calls this harness unrestricted — the absent fields are themselves the honest condition-hash input), and the endpoint is the host instance's model config, which this provider never overrides. `/dsh status` and the `LocalAgentStatus` Remote attach the same snapshot.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.2`): ✅ full — the rc.8→0.1.1-rc.1 API audit (2026-08-21) confirms every surface this plugin consumes is unchanged or additive (the ProjectionDefinition restructure, cacheHitPercent return-type change, and the credentials/updated event rename do not touch this package); no source change was needed; re-audited for rc.2 (2026-08-22): consumed surface unchanged, full build+test green.
- source line (deepseek-harness master): ✅

## Known Limitations

- No interactive or device-code login flow — the sub-dsh authenticates only through the parent's `DEEPSEEK_API_KEY` credential; `/dsh login` reports the harness has no login flow.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**The DeepSeek toggle.** Unlike the other family harnesses, this one mounts nothing model-visible by default. A mutually-exclusive switch sits in the dsh harness row's action area (Settings → 本地 Agent, namespace `local-agent-dsh`, default off): OFF keeps delegation on the official in-process subagent tools; ON registers the `dsh` harness, the `dsh-cli` delegation provider, and the family tool `subagent_dsh` alongside them — two coexisting delegation shapes (in-process continuable vs. separate CLI process) that the family tool description makes distinguishable. The switch flips the composition live via the settings watcher.

**Delegation.** The provider generates one uuid (`session-<uuid>`), records the delegation (`childSessionId → cliSessionId` identity mapping), and spawns `dsh --profile headless-local-agent-dsh --session-id <uuid> "<task>"` with `env: { DSH_HOME: <scoped home>, DEEPSEEK_API_KEY: <resolved> }` and the parent session's cwd. The headless bundle (`@khorsheed/dsh-local-agent-dsh-headless`) creates a session with exactly that id — caller-supplied, never parsed from stdout — runs the task, prints the final assistant text, and exits 0/1. A later round passes the child session id as `resume`; the provider spawns `--resume <uuid>` and the sub-dsh resumes the same session via `agents.resume`.

**Live driver (`live: true`).** Replaces the per-round spawn: the member's first delegation brings up one resident `--serve` sub-dsh process, and every later round is a `turn/start` request to that living runtime over the family-internal stdio JSON-RPC wire (the headless package's `src/wire.ts`). Session events stream back as `session/event` notifications and mirror into the child session event-by-event (same fold rules as the file mirror, which runs once more at settle as reconciliation), and `cancel` lands as a runtime-level `turn/interrupt` (in-process `Agent.cancel`) — the process survives and the session stays continuable. Runtimes are reclaimed after an idle timeout (wire `shutdown`, then the SIGTERM ladder); after a crash the next round re-spawns and `agents.resume`s the on-disk session; a spawn/handshake failure marks the channel broken and permanently falls back to the exec path.

**Auth & provisioning.** No device-code login: the sub-dsh authenticates through the parent's `DEEPSEEK_API_KEY` credential (`apiKeyRef` config); `/dsh status` reports whether the credential resolves, `/dsh sessions` lists the sub-dsh's own sessions from its scoped-home store. The sub-profile lives at `profiles/headless-local-agent-dsh`: a manifest (`@deepseek-ai/dsh-base` + the family headless bundle), an empty user layer, and one symlink resolving the headless bundle — everything else resolves from the dsh installation anchor, so provisioning costs no pnpm install and is idempotent. The parent replicates its own launch (or a configured `cliLaunch`) so the sub-dsh runs the same dsh build.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/local-agent-dsh`). Issues and contributions welcome there.
