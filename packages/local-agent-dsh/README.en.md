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
| `permissions` | unset (follows dsh-base) | the sub-dsh's permission preset: `read-only` / `workspace-write` / `danger-full-access`, written into the sub-profile's patch layer by provisioning — see "Permission boundary" |
| `live` | `false` | live driver: one resident `--serve` sub-dsh process per member; a delegation round is a turn sent to the living runtime (runtime-level graceful interrupt, push-mode mirroring); off — or a channel that cannot come up — means the one-shot exec path |
| `liveIdleMs` | `1800000` (30 min) | idle lifetime of a resident runtime before reclaim |

### Default model (`model`)

When T30a gave the three CLI harnesses a `model` plugin-config key, dsh did not get one — the headless sub-dsh had no place to name a model per launch. **It has one now**: the headless `--model <provider/model>` overrides the sub-instance's default model selection, so this harness carries the same key.

**Absent = today's behavior.** Without the key the plugin adds no `--model` to the argv: the host instance's own `agentDefaultModel` selection decides which model runs, exactly as before.

**Set = every delegation round starts the sub-dsh with it.** Fresh and resume rounds alike, with `--model` after `--session-id` / `--resume`. The value is spelled `provider/model` (the shape `effectiveSettings.model` reports); a bare id names the model and keeps the instance's provider. It splits at the FIRST slash, so a model id that contains one survives.

The settings card's "Default model" writes the same key: a free-text input (no model catalog is built in). Saving applies to the **next** round with no reload; clearing the field and saving unsets the key. While unset, the input itself **displays the default it currently follows** as a dimmed placeholder (inherited, never a pinned value: the current `agentDefaultModel` selection, else the host instance default, else the last observed model). The chevron menu is the single choice list (the native datalist is gone): its leading item is "Default (follow the host …)" — checked while unset, picking it clears the draft back to follow-default — and the rest are the model broker's deduped union (this key + the host default selection + **the host adapter enumeration** + recently used): the broker reads the public `ctx.llm` surface (`listProviders` × `listModels` — the same trio the host's own model picker is built on) and offers every model the host instance can run, spelled `provider/model`, refreshing on the `llm/adapters-updated` event. No catalog is ever hardcoded; when the enumeration is unreadable that layer is simply empty and the other layers answer as usual; typing by hand always works. When the core or the broker is absent the card degrades to the old bare input (recent-models suggestions only).

**A delegation's own model outranks this key.** An orchestrator may name the model for ONE delegation through the facade's `DelegationCallOptions.model` (the fixed order: session override > delegation record > this key > host default selection > CLI built-in). The first round's request is recorded and every resume round re-requests it — `resume` takes no model of its own. In live mode such a round is no longer refused: the model becomes the member's **start model**, bound at the `--serve` spawn through `--model`; a resident runtime bound to a different model is retired first (the sub-dsh session resumes from disk) so the round respawns onto the asked-for model.

**Member-level switching (the composer model picker).** A member session can switch its model per session: an in-memory session-level override, the highest-priority layer, deliberately lost on a host restart. A switch is refused while a round is in flight; when idle and the member has a resident runtime bound to a different model, the switch retires that runtime — the next round respawns onto the new model while the sub-dsh session itself carries over. On the one-shot (exec) drive there is no resident process, so the override simply decides the next round's `--model`.

**This is not an evaluation gap.** A run freezes its condition at setup: change the key mid-run and the next round's model read-back sees declared ≠ observed and fails the run as misattributed (frozen decision 5).

**Evaluation snapshot (`effectiveSettings`).** The harness's fairness snapshot carries the drive (exec/live), the no-pinned-endpoint flag, the CLI version (the very launch argv a delegation spawns, asked `--version`, cached against that entry script's path + mtime — the sub-dsh replicates the parent instance's own build), and the configured model (the host `agentDefaultModel` selection the sub-dsh inherits, formatted `provider/model`; when the service is absent or the selection unreadable the field drops out — never guessed): `sandbox` is the permission preset the sub-profile pins, reported **only when one is configured** (absence is still the honest condition-hash input — this scope pins no boundary and runs what dsh-base composes), and the endpoint is the host instance's model config, which this provider never overrides. `/dsh status` and the `LocalAgentStatus` Remote attach the same snapshot.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ⚠️ one degradation — `liveMirrorGranularity: token` no longer writes per-token deltas into the child session log (the host retired the per-chunk event); deltas ride the run-progress channel and the round settles as one combined message (identical final text). Everything else is full (adapted to format v2/v3 and handle-based sessionPersistence; build+test green); minHost moves up to 0.1.5-rc.1 — older hosts stay on the previous release line.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.5-rc.1)

## Known Limitations

- No interactive or device-code login flow — the sub-dsh authenticates only through the parent's `DEEPSEEK_API_KEY` credential; `/dsh login` reports the harness has no login flow.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**The DeepSeek toggle.** Unlike the other family harnesses, this one mounts nothing model-visible by default. A mutually-exclusive switch sits in the dsh harness row's action area (Settings → 本地 Agent, namespace `local-agent-dsh`, default off): OFF keeps delegation on the official in-process subagent tools; ON registers the `dsh` harness, the `dsh-cli` delegation provider, and the family tool `subagent_dsh` alongside them — two coexisting delegation shapes (in-process continuable vs. separate CLI process) that the family tool description makes distinguishable. The switch flips the composition live via the settings watcher.

**The session log is resolved by generation, never hardcoded.** A sub-dsh's history lives in `<scoped home>/sessions/<project>/<session id>/`, but WHICH file holds it is the host's generation choice: the original generation is `session.jsonl`, and every later one carries a lowercase `vN` — host 0.1.5 writes `session.v3.jsonl.zstd`. Either basename may also carry `.zstd` (compression is the default). This package parses every directory entry by the host's own rule (`^session(\.v[1-9][0-9]*)?\.jsonl$`, matched after any compression suffix is stripped — `.v0`, leading zeros, uppercase, `session.lock` and temporary files are not generations), takes the NUMERICALLY HIGHEST one, and carries the chosen filename back on the read-back result (`sessionLogFile`).

What hardcoding one name costs has been measured: after the host moved to 0.1.5 a delegation round still settled `completed` while observedModel, usage and toolCalls went absent ALL AT ONCE, and `/dsh sessions` listed nothing — downstream, "the log could not be read" looks exactly like "this round produced nothing". The session mirror and `/dsh sessions` therefore resolve through one shared function: the two readers cannot disagree about where a session's history lives. The old line's `session.jsonl(.zstd)` is still read, so historical directories keep working.

**Named scopes.** A scoped delegation runs against `<homesRoot>/dsh@<name>`: the sub-profile follows the directory — one is provisioned there when the directory is materialized — so that scope's rounds launch the sub-dsh from its own profile and write their session log there. The credential is not in the directory at all (dsh authenticates through the host instance), so a named scope changes the profile and the session records, not the account. Exec-only: the resident `serve` process is bound per member to the default scoped home.

**Per-scope preset roster (the capability face becomes a factor).** The sub-profile's patch may carry one more layer: an `insert` row mounting `@deepseek-ai/dsh-agent-presets` whose `default` is this scope's preset id, which the headless agent loader joins in its agent setup. Without the layer the behavior is exactly what it was before the field existed — the model-facing rows sit in the host plane and the agent reads them off the global layer. With it, **the scope directory IS the capability face**: two scopes whose rosters name two presets are two subjects, and the difference is a file a person can read.

```ts
import { provisionDshSubProfile, readSubProfilePreset } from '@khorsheed/dsh-local-agent-dsh/provision'

provisionDshSubProfile(scopedHome, { preset: { id: 'eval-lean' } })
readSubProfilePreset(scopedHome)   // 'eval-lean' — the generated layer is a parseable one
```

Where the preset directories come from: the sub-dsh launches with `DSH_HOME=<scoped home>`, so the roster's own user root is `<scoped home>/.agent-presets` — drop a preset directory there and that scope has a preset of its own (`roots` / `includeShippedRoot` / `includeUserRoot` override the derived roots). The roster module is deliberately **not** symlinked: it is an official package, already in the dsh installation anchor's closure beside `@deepseek-ai/dsh-base`. A linked second copy would give it a second `@deepseek-ai/cordis`, and cordis does service lookup and type checks by instance identity — the symptom is silently missing services, not an error (the same trap the dual-filesystem contract above describes for the bundle). A deployment whose anchor genuinely lacks it gets the loader's own "cannot resolve" message, which names the module better than this step could. A preset id must match `[a-z0-9][a-z0-9-]*` (it is a directory name). Re-provision without `preset` and the layer disappears again.

**The scope's own copy of the preset (the only arrangement a container round can use).** `provisionDshScope` turns "drop a preset directory in `<scoped home>/.agent-presets`" into a checkable procedure — and it is the **only** arrangement a container round can use: an evaluation unit bind-mounts the scoped home and nothing else, so a roster whose `roots` name the deployment's preset root names a path the unit does not have and the sub-dsh will not start (`preset "eval-lean" not found`). A copy in the scope's own user root is `<scope>/.agent-presets/<id>` on the host and `/creds/dsh/.agent-presets/<id>` inside the unit — one directory, because the unit binds the scope.

```ts
import { provisionDshScope, readScopeSubProfile } from '@khorsheed/dsh-local-agent-dsh/provision'

// Explicit request: re-sync the copy from the deployment's preset root and persist the decision
provisionDshScope(scopedHome, config, { preset: 'eval-lean', presetRoot })
readScopeSubProfile(scopedHome)   // { preset: 'eval-lean' }
// Every later provisioning (a restart's materialization, a host round's self-heal) needs no telling
provisionDshScope(scopedHome, config, { presetRoot })
```

Three things worth stating on their own:

- **Where the preset resolves from**: *explicit argument → `<scoped home>/sub-profile.json` → plugin config*. The middle one is not a convenience. This module regenerates `cordis.patch.yml` WHOLE, and the registry re-provisions a scope the first time anything names it in a fresh host process — so a roster layer hand-appended to the patch silently disappears there, and the next read-back reports a scope that rosters nothing. The scope's own declaration is how it survives, and it is also the only way "two scopes rostering two presets" is expressible at all on a config that is **instance-global**.
- **When the copy is refreshed**: only by the call that carries an explicit `preset` (the evaluation's `conditions provision`). Every other provisioning copies only when the directory is ABSENT, and otherwise leaves it alone and REPORTS whether it still matches the source byte for byte. Nothing may move the subject under a run.
- **A preset used as a factor may not name an absolute path**: the same preset is read from three directories (the deployment's preset root, the scope's copy, the unit's mount point), so an absolute path is wrong in at least two of them — and wrong silently, since `skill-filesystem` treats a root it cannot read as an empty one. The form that travels is the loader's own expression, as the shipped `cordis` preset writes it: `!!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"`, where `baseUrl` is the composition's own directory. A preset naming one is refused at the snapshot, with that idiom in the message.

**Permission boundary (`permissions`).** The file-effect boundary a sub-dsh's bash calls run under, and the approval policy a denied call escalates through, written by provisioning as one more patch layer: two **override** rows pinning `sandbox-policy`'s `mode` and `user-approval`'s `policy` (paired by dsh-base's own `permission-presets` table — `danger-full-access` with `never`, the other two with `ask`; pinning two plugins separately and letting them drift apart builds a boundary nobody can run inside and nobody can be asked about). Leave the key unset and no layer is written at all: the sub-dsh runs dsh-base's `workspace-write` + `ask`, byte for byte the behavior before this field existed.

```ts
import { provisionDshSubProfile, readSubProfilePermissions } from '@khorsheed/dsh-local-agent-dsh/provision'

provisionDshSubProfile(scopedHome, { permissions: 'danger-full-access' })
readSubProfilePermissions(scopedHome)   // 'danger-full-access' — the generated layer is a parseable layer
```

**Why the scope directory rather than an environment variable.** Those two dsh-base rows otherwise read `DSH_PERMISSION_MODE`, but the value belongs to the subject under test: written into the sub-profile it travels with the scope directory — including the copy bind-mounted into a container unit, where `home.sha` already hashes it — whereas riding the spawn env puts another name into that unit's composite fingerprint, and every key unrelated to the condition makes "these two cells differ in exactly one factor" harder to say. The layer lands after the base layer, so the literal wins over that variable and the boundary stops depending on whoever spawned the process.

**When to pin `danger-full-access`.** Only where something else already IS the boundary: a one-shot evaluation unit, a disposable container. On a developer's machine the sub-dsh shares the real home and `workspace-write` is the right default — which is what leaving the key unset gives you. The converse also holds: **without the pin there is no shell inside a unit.** A container image typically carries no bubblewrap and gets no Landlock from the kernel (measured: `landlock-run`'s probe reports `unusable`), and the sandbox fails closed by design rather than quietly running unconfined, so every bash call takes `SANDBOX_UNAVAILABLE`; a headless sub-dsh has no approval channel either, so the model's sanctioned escalation retry only earns "no approval channel is available". Together, the agent simply has no shell (measured in I5·T39's G14).

**Container delegation.** An orchestrator may run the round inside an **already-acquired container** through the facade's `DelegationCallOptions.exec` (`{ container, workdir, env? }`): the argv becomes `docker exec -w <workdir> [-e NAME…] <container> <the same argv>` and everything else (session mirror, settle, recording) is byte-for-byte unchanged. `env` must name the in-container `DSH_HOME`; the resolved API key rides the argv only as the NAME `-e DEEPSEEK_API_KEY`, its value staying in the docker client's environment and out of the host process table. A container round adds two behaviors specific to this package. First, **`NODE_OPTIONS=--use-env-proxy` is injected automatically** (a caller that names `NODE_OPTIONS` in `target.env` keeps its own value): dsh's HTTP client is node's `fetch` (undici), which **does not read** `HTTP(S)_PROXY` by default, so in a unit whose only egress is a whitelist proxy it dials the API directly and fails while the proxy never even receives a `CONNECT`; the flag opens undici's `EnvHttpProxyAgent`. dsh is the only one of the four that needs it, so the provider supplies it rather than every caller remembering, and reports it in `effectiveSettings.containerNodeOptions` so the condition file can see the knob. Second, **the host-side sub-profile provisioning is skipped**: that profile's `node_modules` symlink points at the host installation of the headless bundle, which resolves to nothing inside a unit — and the scoped home is bind-mounted, so writing it would plant a broken profile in the directory the unit actually reads. A containerized caller names the unit's own entry and profile through the existing knobs (`cliLaunch`, `profileName`), and **the unit must carry the family headless bundle and its runtime dependency closure** — the image's in-box `headless` profile is a different, smaller app that does not accept `--session-id`/`--resume` and cannot host a delegation round. Measured: with the bundle staged in an `eval-env:pinned` unit, one "answer 2+2" round settles `completed` with output `4`, and `observedModel` reads back as `deepseek-official/deepseek-v4-flash` from the sub-dsh session log the container wrote into the host scoped home.

**When one scoped home is resolved by several filesystems (the dual-filesystem contract).** When the scoped home is read and written by BOTH the host (judge delegations, readiness probes) and container units (bind-mounted) — e.g. the T20c "one owner, one directory" eval layout — the sub-profile's `node_modules` symlink target is a **string**, interpreted by whichever filesystem reads it: pointing at the host installation leaves the link dangling inside a unit, and a host-side readiness re-probe re-provisions, writing the host-only path back (skipping the container round's own provisioning cannot fix the link ALREADY written). The contract is one sentence: **pin `headlessBundleDir` to an absolute path that exists in every filesystem involved** — on the host, a same-named symlink into the host installation's bundle (Node resolves from the realpath, so its dependency closure comes along); in the image, the real installation at the same path. Once pinned, a readiness re-provision merely rewrites the same target and no longer manufactures host-only paths. Two alternatives were evaluated and rejected. First, **copying the bundle into the scoped home**: family code imports service keys and classes from `@deepseek-ai/*` at runtime (`credentialRef`, `TypertRemoteService`, `SessionId`, …), so a copied closure creates a second instance of those packages, and cordis does service lookup and type checks by instance identity — the symptom is silently missing services, not an error. The bundle's `@deepseek-ai` peers must resolve from the SAME installation that runs the sub-dsh; pinning preserves that in both runtimes, copying necessarily breaks it. Second, **an extra bundle mount for the unit**: it breaks T20c's single-mount stance, and dsh is the only harness that would need it. The pin is therefore a caller-side, machine-level precondition (document it in the eval env/README); this package needs zero code change.

**Tool-call accounting.** Every settled round also reports how many tool calls it made, on the `settled` run-progress event (`toolCalls: { count, byName }`). What is counted is the `tool/call` events in THIS ROUND'S WINDOW — the same roundSpan the model and usage come from — keyed by the name each event carries, so a round a live poll already mirrored still reports its real count at settle. One accounting per round, never cumulative; a round that called nothing carries no field at all (absent is not zero).

**Delegation.** The provider generates one uuid (`session-<uuid>`), records the delegation (`childSessionId → cliSessionId` identity mapping), and spawns `dsh --profile headless-local-agent-dsh --session-id <uuid> "<task>"` with `env: { DSH_HOME: <scoped home>, DEEPSEEK_API_KEY: <resolved> }` and the parent session's cwd. The headless bundle (`@khorsheed/dsh-local-agent-dsh-headless`) creates a session with exactly that id — caller-supplied, never parsed from stdout — runs the task, prints the final assistant text, and exits 0/1. A later round passes the child session id as `resume`; the provider spawns `--resume <uuid>` and the sub-dsh resumes the same session via `agents.resume`.

**Live driver (`live: true`).** Replaces the per-round spawn: the member's first delegation brings up one resident `--serve` sub-dsh process, and every later round is a `turn/start` request to that living runtime over the family-internal stdio JSON-RPC wire (the headless package's `src/wire.ts`). Session events stream back as `session/event` notifications and mirror into the child session event-by-event (same fold rules as the file mirror, which runs once more at settle as reconciliation), and `cancel` lands as a runtime-level `turn/interrupt` (in-process `Agent.cancel`) — the process survives and the session stays continuable. The fold is a verbatim copy: the caller task's `user/message`, every `assistant/message`, the tool event pairs, and the sub-dsh's own `step/start`–`step/end` boundary pairs (each carrying its own (turn, step) coordinates) all cross — the host's real-time conversation view only registers a step at a boundary, so without them an assistant message renders only after a full-page rebuild; turn boundaries and scaffolding user messages (agent-instructions, plugin, and other sources) stay behind, and an interrupted step crosses as an open pair (start without end), with no boundary ever synthesized. Runtimes are reclaimed after an idle timeout (wire `shutdown`, then the SIGTERM ladder); after a crash the next round re-spawns and `agents.resume`s the on-disk session; a spawn/handshake failure marks the channel broken and permanently falls back to the exec path.

**Auth & provisioning.** No device-code login: the sub-dsh authenticates through the parent's `DEEPSEEK_API_KEY` credential (`apiKeyRef` config); `/dsh status` reports whether the credential resolves, `/dsh sessions` lists the sub-dsh's own sessions from its scoped-home store. The sub-profile lives at `profiles/headless-local-agent-dsh`: a manifest (listing only `@deepseek-ai/dsh-base`), the headless package's patch copied byte-for-byte as the profile's own patch layer, and one symlink resolving the headless bundle (for the loader's insert rows) — everything else resolves from the dsh installation anchor, so provisioning costs no pnpm install and is idempotent, rewriting automatically on content drift (upgrades and old-format healing). The parent replicates its own launch (or a configured `cliLaunch`) so the sub-dsh runs the same dsh build.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/local-agent-dsh`). Issues and contributions welcome there.
