# Agent Note: local-agent delegation inside an acquired container

Status: implemented

English | [中文](2026-09-09-local-agent-container-exec.zh.md)

## Problem

The web-eval orchestrator (I3) must run each evaluation cell inside a controlled unit, but every family delegation spawned its CLI on the host: `ctx.subprocess.spawn` with a host cwd and a host scoped home. The four harnesses had already been proven to run inside the frozen evaluation image (T16, one minimal `exec` each), so the missing piece was purely transport — how a delegation round reaches a container that lab already acquired — with the hard constraint that nothing downstream of the spawn may change: a containerized round must parse, settle, read back and record exactly as a host round does, or the evaluation is comparing two different mechanisms.

## Decision

- **One optional call option.** `DelegationCallOptions.exec` carries `DelegationExecTarget = { container, workdir, env? }` and rides the staged delegation intent (both `fresh` and `resume` kinds), the same channel `cwd` uses and for the same reason: the host `SubagentStartRequest` contract has no place for a family-private start fact. Absent everywhere, every round is byte-for-byte what it was.
- **The transport is one shared function.** `containerExecSpawn(target, { argv, env }, who)` in the core rewrites a launch into `docker exec -w <workdir> [-e NAME…] <container> <the same argv>`. `stdio` stays piped, `graceMs` is unchanged, and the host `cwd` still applies — it is now the docker CLIENT's working directory. Each provider calls it at its single spawn site; nothing else in the four providers' stream parsing, settle chains, readback or `delegations.jsonl` writes moved.
- **`exec` is the only docker verb the family owns.** Acquiring, inspecting, mounting and destroying a unit belong to the caller (lab); no provider imports lab, and the target is just a name plus a path.
- **Values never ride the argv.** Every forwarded variable appears as a NAME-only `-e` flag; the docker CLI resolves each from its own environment, which `containerExecSpawn` returns as the spawn env under the same `delegationEnv` scrub. A resolved credential (the sub-dsh API key) therefore stays out of the host process table, exactly as it does on the host path. The forwarded set is the DEFINED entries of the provider's explicit env layer (tombstones carry no value), overridden per key by `target.env`; the ambient inheritance allowlist (`PATH`, `HOME`, the proxy variables) is deliberately not forwarded, because inside the unit those belong to the image and to the `docker run` that created it. Names are sorted, so one launch has one argv. The docker client keeps its own daemon coordinates (`DOCKER_HOST`, `DOCKER_CONTEXT`, …) from the host environment.
- **The caller must name the in-container scoped home.** `containerScopedHome` fails the round — before any session record or process — when `target.env` omits `CODEX_HOME` / `CLAUDE_CONFIG_DIR` / `KIMI_CODE_HOME` / `DSH_HOME`. Forwarding the provider's host path instead would start the CLI in a directory that does not exist inside the unit: no credentials, no rollout to read back, and nothing in the output naming the cause.
- **The scoped home stays a HOST directory, bind-mounted read-write.** This is what keeps readback and recording untouched: codex's rollout locator, kimi's wire log mirror and the sub-dsh session mirror all read `spec.env[<HOME VAR>]` — a host path — off the host filesystem, and credential refreshes the CLI performs land back on the host. A named volume would have forced `docker cp` into every readback path.
- **A container round is exec-only.** The live drivers run resident processes on the host, which is the transport the target exists to replace, so a target skips the live branch on both the fresh and the resume path (the evaluation drive is exec-only anyway — frozen decision 2).
- **A container round carries no member channel.** The bridge is a host unix socket and its MCP declaration names a host node path; kimi's declaration is additionally written INTO the scoped home's shared `mcp.json`. Declining the channel for the round is better than injecting a server the unit cannot start, so the providers skip the registration entirely — not even a token is minted.
- **dsh carries the one extra knob.** On a container target the provider injects `NODE_OPTIONS=--use-env-proxy` (a caller naming `NODE_OPTIONS` on the target keeps its own value) and reports it as `LocalAgentEffectiveSettings.containerNodeOptions`, unconditionally, because the injection is unconditional in code. dsh's HTTP client is node's `fetch` (undici), which does not read `HTTP(S)_PROXY`: in a unit whose only egress is a whitelist proxy the round dials the API directly and fails while the proxy never receives a `CONNECT`. It also skips the host-side sub-profile provisioning, whose `node_modules` symlink resolves to nothing inside a unit and would be written into the bind-mounted scoped home; a containerized caller names the unit's own entry and profile through the existing `cliLaunch` / `profileName` knobs, and the unit must carry the family headless bundle and its runtime dependency closure.

## Real-machine verification

One "answer 2+2" delegation per harness against the T16 image (`eval-env:pinned`, `sha256:ed988b33…`) on the sealed evaluation network, each provider driven through its own `start()` with the exec target and a real subprocess spawn:

| Harness | Result | Evidence |
|---|---|---|
| codex | `completed`, output `4` | `observedModel` `gpt-5.6-sol`, read back from the rollout the CONTAINER wrote into the HOST scoped home |
| claude | `error` — `OAuth session expired and could not be refreshed` | Same failure on the host control (`401 API key is invalid`); the proxy log shows the refresh reaching `platform.claude.com` and then being refused on `console.anthropic.com`, which the evaluation whitelist does not carry. Transport verified: the argv is the expected `docker exec …`, the stream-json parsed, `observedModel` `claude-opus-5[1m]` |
| kimi | `error` — `provider.auth_error: 403 monthly usage limit` | The same account-side quota T16 recorded; `observedModel` `kimi-for-coding` read back from the wire log the container wrote into the host scoped home |
| dsh | `error` in the unit; `completed`, output `4` on the host control (`observedModel` `deepseek-official/deepseek-v4-flash`) | The image's in-box `headless` profile is a different, smaller app with no `--session-id`; the same `docker exec` shape without that flag answers `4` inside the same unit with `--use-env-proxy` doing its job |

The four findings that belong to the environment rather than to this code: the evaluation whitelist misses claude's `console.anthropic.com` refresh fallback; the image must ship the family headless bundle plus its runtime dependencies for dsh; a live scoped home bind-mounted whole carries host-only settings into the unit (claude's scoped `settings.json` names a host-daemon `https_proxy` that fails with `Connection refused` inside a unit); and kimi's account quota is still exhausted.

## Alternatives considered

**Extract the CLI drivers into a standalone package** (the README's second I3 route). Deferred: the eval orchestrator is the only consumer, so extraction would buy an abstraction boundary nobody is standing on the other side of, while moving four working drivers across a package boundary — the change with the highest chance of a behavior difference in exactly the code this task must leave byte-identical. The condition to revisit is a SECOND consumer; then the seam is drawn by two real callers instead of guessed from one.

**Pass `K=V` on the docker argv.** Rejected: it puts the resolved sub-dsh API key into the host process table, where `/proc/<pid>/cmdline` is world-readable on Linux. The NAME-only form is documented docker behavior (a bare name resolves from the client's environment; a name unset there is removed from the container env) and was verified against docker 28.1.1 before the code depended on it.

**Forward only `target.env` and nothing of the provider's.** Rejected: the dsh round's credential and every provider's endpoint override are computed inside the provider from host services the caller cannot reach. Forwarding the provider's own layer with caller override keeps "same delegation, different transport" true.

**Carry the target on the `SubagentStartRequest`.** Rejected for the reason `cwd` was: the harness seam is fixed by the no-host-fork rule, and the staged-intent channel exists precisely for family-private start facts.

**Record the container and workdir in the delegation record and check them on resume.** Rejected for this change: the record write is one of the lines that must not move, and the anchor it already carries (the host `cwd`) is what a resume compares. The caller repeats the target exactly as it repeats the cwd; a swapped container is a caller error nothing recorded can catch, which is stated in both READMEs rather than left implied.

**Mount the scoped home as a named volume.** Rejected: readback has to read the CLI's own files (codex's rollout, kimi's wire log, the sub-dsh session log), and a named volume would require `docker cp` in every readback path. A host bind mount makes readback and credential write-back the same filesystem operation they already were.

**Let a container round keep the member channel and the live driver.** Rejected: both are host-process mechanisms. Injecting a bridge declaration the unit cannot start (and, for kimi, writing it into a shared `mcp.json`) trades a clean absence for a broken presence.

**Have the provider provision the dsh sub-profile inside the unit.** Rejected: the provider owns exactly one docker verb. Staging what a unit contains is the caller's job, and doing it from the provider would mean the family writing into an environment lab declared.

## Consequences

- The orchestrator can put a cell's CLI inside a lab unit without any change to how the round is parsed, settled, read back or recorded — the property the evaluation's comparability rests on.
- A containerized round runs without the member channel and without the live driver. Both are named absences, not silent ones.
- The caller stages what it mounts. Bind-mounting a live scoped home carries host-only settings into the unit; the claude `settings.json` proxy is the measured instance, and it fails loudly rather than subtly.
- `containerNodeOptions` is a new `LocalAgentEffectiveSettings` field, so a condition hash computed over the snapshot changes once for the dsh harness. It is additive: clients written before it ignore it.
- The transport is pinned by tests at the argv level in all five packages (container and host argv for fresh and resume, the NAME-only env forwarding, the credential staying off the argv, the missing-scoped-home refusal, dsh's `NODE_OPTIONS` and its caller override) and by one real delegation per harness against the frozen image.
