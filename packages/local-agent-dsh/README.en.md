# `@khorsheed/dsh-local-agent-dsh`

English | [中文](README.md)

Delegate a task to dsh itself as a separate local CLI process, sibling to the kimi / codex / claude-code harnesses. It runs under its own scoped home, authenticates through the parent's API key, and resumes across rounds; a settings toggle (default off) turns the delegation tool on.

## Features

- **Delegate to dsh itself** — spawns a sub-dsh headless CLI process.
- **Scoped home** — its own `DSH_HOME` (`$DSH_HOME/local-agent/dsh`): profile, sessions, and state never mixed into the parent.
- **Resume across rounds** — pass the child session id back to continue the same session.
- **No separate login** — authenticates through the parent's `DEEPSEEK_API_KEY`; no device-code flow.
- **DeepSeek toggle, default off** — nothing model-visible until you flip the switch in Settings → 本地 Agent.
- **Model readback and per-cell working directory** — every settled round reads back the model from the sub-session event sources (`provider/model`) into the delegation record; orchestrators pass a `cwd` per cell, and a resume in a different directory is rejected.
- **Model readback and per-cell working directory** — every settled round reads back the model from the sub-session event sources (`provider/model`) into the delegation record; orchestrators pass a `cwd` per cell, and a resume in a different directory is rejected.
## Install

The family core and this bundle must be named in one command, then restart the profile:

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-dsh
```

No login step needed — `/dsh status` reports whether the parent's `DEEPSEEK_API_KEY` resolves.

Tarball installs (family packages unpublished on npm) need an `overrides:` block in the profile's `pnpm-workspace.yaml` pinning each family name to a `file:` tarball — inside a tarball the family edges are registry ranges, and the pin resolves headless and its siblings as **transitive** dependencies (headless itself declares no `dsh.bundle`, so even a mistaken direct-dependency install would mount nothing — but none is needed).

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
| `headlessBundleDir` | resolved from installation | headless bundle directory for the sub-profile symlink (**must be pinned** when the scoped home is resolved by more than one filesystem — see "Container delegation") |
| `live` | `false` | live driver: one resident `--serve` sub-dsh process per member; a delegation round is a turn sent to the living runtime (runtime-level graceful interrupt, push-mode mirroring); off — or a channel that cannot come up — means the one-shot exec path |
| `liveIdleMs` | `1800000` (30 min) | idle lifetime of a resident runtime before reclaim |
| `liveMirrorGranularity` | `event` | live mirror granularity; `token` additionally appends `assistant/chunk` deltas to the child session (write amplification — opt-in) |

### Default model (`model`)

When T30a gave the three CLI harnesses a `model` plugin-config key, dsh did not get one — the headless sub-dsh had no place to name a model per launch. **It has one now**: the headless `--model <provider/model>` overrides the sub-instance's default model selection, so this harness carries the same key.

**Absent = today's behavior.** Without the key the plugin adds no `--model` to the argv: the host instance's own `agentDefaultModel` selection decides which model runs, exactly as before.

**Set = every delegation round starts the sub-dsh with it.** Fresh and resume rounds alike, with `--model` after `--session-id` / `--resume`. The value is spelled `provider/model` (the shape `effectiveSettings.model` reports); a bare id names the model and keeps the instance's provider. It splits at the FIRST slash, so a model id that contains one survives.

The settings card's "Default model" writes the same key: a free-text input (no model catalog is built in) plus previously saved values as suggestions. Saving applies to the **next** round with no reload; clearing the field and saving unsets the key.

**A delegation's own model outranks this key.** An orchestrator may name the model for ONE delegation through the facade's `DelegationCallOptions.model`, which sits above this key (the four layers are in the family core README). The first round's request is recorded and every resume round re-requests it — `resume` takes no model of its own. A round carrying a delegation model is exec-only: a resident `--serve` sub-dsh binds its model with its own `--model` at spawn and then hosts every session it is handed.

**This is not an evaluation gap.** A run freezes its condition at setup: change the key mid-run and the next round's model read-back sees declared ≠ observed and fails the run as misattributed (frozen decision 5).

**Evaluation snapshot (`effectiveSettings`).** The harness's fairness snapshot carries the drive (exec/live), the no-pinned-endpoint flag, the CLI version (the very launch argv a delegation spawns, asked `--version`, cached against that entry script's path + mtime — the sub-dsh replicates the parent instance's own build), and the configured model (the host `agentDefaultModel` selection the sub-dsh inherits, formatted `provider/model`; when the service is absent or the selection unreadable the field drops out — never guessed): a headless sub-dsh has no sandbox or permission knob (the web-eval frozen baseline calls this harness unrestricted — the absent fields are themselves the honest condition-hash input), and the endpoint is the host instance's model config, which this provider never overrides. `/dsh status` and the `LocalAgentStatus` Remote attach the same snapshot.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.2-rc.1`): ✅ full — baseline moved to the 0.1.2-rc.1 API surface (single-arm 0.1.2 API consumption; the 0.1.1-rc.2 runtime arm is retired), full build+test green; minHost moves up to 0.1.2-rc.1 — older hosts stay on the previous release line.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.2-rc.1)

## Known Limitations

- No interactive or device-code login flow — the sub-dsh authenticates only through the parent's `DEEPSEEK_API_KEY` credential; `/dsh login` reports the harness has no login flow.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**The DeepSeek toggle.** Unlike the other family harnesses, this one mounts nothing model-visible by default. A mutually-exclusive switch sits in the dsh harness row's action area (Settings → 本地 Agent, namespace `local-agent-dsh`, default off): OFF keeps delegation on the official in-process subagent tools; ON registers the `dsh` harness, the `dsh-cli` delegation provider, and the family tool `subagent_dsh` alongside them — two coexisting delegation shapes (in-process continuable vs. separate CLI process) that the family tool description makes distinguishable. The switch flips the composition live via the settings watcher.

**Named scopes.** A scoped delegation runs against `<homesRoot>/dsh@<name>`: the sub-profile follows the directory — one is provisioned there when the directory is materialized — so that scope's rounds launch the sub-dsh from its own profile and write their session log there. The credential is not in the directory at all (dsh authenticates through the host instance), so a named scope changes the profile and the session records, not the account. Exec-only: the resident `serve` process is bound per member to the default scoped home.

**Container delegation.** An orchestrator may run the round inside an **already-acquired container** through the facade's `DelegationCallOptions.exec` (`{ container, workdir, env? }`): the argv becomes `docker exec -w <workdir> [-e NAME…] <container> <the same argv>` and everything else (session mirror, settle, recording) is byte-for-byte unchanged. `env` must name the in-container `DSH_HOME`; the resolved API key rides the argv only as the NAME `-e DEEPSEEK_API_KEY`, its value staying in the docker client's environment and out of the host process table. A container round adds two behaviors specific to this package. First, **`NODE_OPTIONS=--use-env-proxy` is injected automatically** (a caller that names `NODE_OPTIONS` in `target.env` keeps its own value): dsh's HTTP client is node's `fetch` (undici), which **does not read** `HTTP(S)_PROXY` by default, so in a unit whose only egress is a whitelist proxy it dials the API directly and fails while the proxy never even receives a `CONNECT`; the flag opens undici's `EnvHttpProxyAgent`. dsh is the only one of the four that needs it, so the provider supplies it rather than every caller remembering, and reports it in `effectiveSettings.containerNodeOptions` so the condition file can see the knob. Second, **the host-side sub-profile provisioning is skipped**: that profile's `node_modules` symlink points at the host installation of the headless bundle, which resolves to nothing inside a unit — and the scoped home is bind-mounted, so writing it would plant a broken profile in the directory the unit actually reads. A containerized caller names the unit's own entry and profile through the existing knobs (`cliLaunch`, `profileName`), and **the unit must carry the family headless bundle and its runtime dependency closure** — the image's in-box `headless` profile is a different, smaller app that does not accept `--session-id`/`--resume` and cannot host a delegation round. Measured: with the bundle staged in an `eval-env:pinned` unit, one "answer 2+2" round settles `completed` with output `4`, and `observedModel` reads back as `deepseek-official/deepseek-v4-flash` from the sub-dsh session log the container wrote into the host scoped home.

**When one scoped home is resolved by several filesystems (the dual-filesystem contract).** When the scoped home is read and written by BOTH the host (judge delegations, readiness probes) and container units (bind-mounted) — e.g. the T20c "one owner, one directory" eval layout — the sub-profile's `node_modules` symlink target is a **string**, interpreted by whichever filesystem reads it: pointing at the host installation leaves the link dangling inside a unit, and a host-side readiness re-probe re-provisions, writing the host-only path back (skipping the container round's own provisioning cannot fix the link ALREADY written). The contract is one sentence: **pin `headlessBundleDir` to an absolute path that exists in every filesystem involved** — on the host, a same-named symlink into the host installation's bundle (Node resolves from the realpath, so its dependency closure comes along); in the image, the real installation at the same path. Once pinned, a readiness re-provision merely rewrites the same target and no longer manufactures host-only paths. Two alternatives were evaluated and rejected. First, **copying the bundle into the scoped home**: family code imports service keys and classes from `@deepseek-ai/*` at runtime (`credentialRef`, `TypertRemoteService`, `SessionId`, …), so a copied closure creates a second instance of those packages, and cordis does service lookup and type checks by instance identity — the symptom is silently missing services, not an error. The bundle's `@deepseek-ai` peers must resolve from the SAME installation that runs the sub-dsh; pinning preserves that in both runtimes, copying necessarily breaks it. Second, **an extra bundle mount for the unit**: it breaks T20c's single-mount stance, and dsh is the only harness that would need it. The pin is therefore a caller-side, machine-level precondition (document it in the eval env/README); this package needs zero code change.

**Tool-call accounting.** Every settled round also reports how many tool calls it made, on the `settled` run-progress event (`toolCalls: { count, byName }`). What is counted is the `tool/call` events in THIS ROUND'S WINDOW — the same roundSpan the model and usage come from — keyed by the name each event carries, so a round a live poll already mirrored still reports its real count at settle. One accounting per round, never cumulative; a round that called nothing carries no field at all (absent is not zero).

**Delegation.** The provider generates one uuid (`session-<uuid>`), records the delegation (`childSessionId → cliSessionId` identity mapping), and spawns `dsh --profile headless-local-agent-dsh --session-id <uuid> "<task>"` with `env: { DSH_HOME: <scoped home>, DEEPSEEK_API_KEY: <resolved> }` and the parent session's cwd. The headless bundle (`@khorsheed/dsh-local-agent-dsh-headless`) creates a session with exactly that id — caller-supplied, never parsed from stdout — runs the task, prints the final assistant text, and exits 0/1. A later round passes the child session id as `resume`; the provider spawns `--resume <uuid>` and the sub-dsh resumes the same session via `agents.resume`.

**Live driver (`live: true`).** Replaces the per-round spawn: the member's first delegation brings up one resident `--serve` sub-dsh process, and every later round is a `turn/start` request to that living runtime over the family-internal stdio JSON-RPC wire (the headless package's `src/wire.ts`). Session events stream back as `session/event` notifications and mirror into the child session event-by-event (same fold rules as the file mirror, which runs once more at settle as reconciliation), and `cancel` lands as a runtime-level `turn/interrupt` (in-process `Agent.cancel`) — the process survives and the session stays continuable. Runtimes are reclaimed after an idle timeout (wire `shutdown`, then the SIGTERM ladder); after a crash the next round re-spawns and `agents.resume`s the on-disk session; a spawn/handshake failure marks the channel broken and permanently falls back to the exec path.

**Auth & provisioning.** No device-code login: the sub-dsh authenticates through the parent's `DEEPSEEK_API_KEY` credential (`apiKeyRef` config); `/dsh status` reports whether the credential resolves, `/dsh sessions` lists the sub-dsh's own sessions from its scoped-home store. The sub-profile lives at `profiles/headless-local-agent-dsh`: a manifest (listing only `@deepseek-ai/dsh-base`), the headless package's patch copied byte-for-byte as the profile's own patch layer, and one symlink resolving the headless bundle (for the loader's insert rows) — everything else resolves from the dsh installation anchor, so provisioning costs no pnpm install and is idempotent, rewriting automatically on content drift (upgrades and old-format healing). The parent replicates its own launch (or a configured `cliLaunch`) so the sub-dsh runs the same dsh build.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/local-agent-dsh`). Issues and contributions welcome there.
