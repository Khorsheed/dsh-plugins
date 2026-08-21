# `@khorsheed/dsh-local-agent-dsh-headless`

[English](README.md) | [中文](README.zh.md)

The sub-dsh one-shot app bundle for the `local-agent-dsh` harness: a direct core Agent/Session runner over `dsh-base` that accepts a **caller-supplied session id** — `--session-id <id>` creates a fresh session with exactly that id, `--resume <id>` continues the existing session with that id — prints the final assistant text, and exits. It is the sibling of the official `@deepseek-ai/dsh-headless` bundle, differing only in who owns the session id.

## Mounting discipline

**Never add this bundle to an interactive profile's `bundles`.** Its patch carries sub-profile-only rows — a persona override, `hmr` disabled, a `tools` mode override, a `code-runtime` insert, and the member-bridge MCP row — that collide with an interactive composition (duplicate `code-runtime` id) and leak overrides into real user sessions. The bundle is composed ONLY into the `headless-local-agent-dsh` sub-profile, which the parent `local-agent-dsh` provider auto-provisions under the dsh harness's scoped home (`provisionDshSubProfile`): its own `package.json`, patch layer, and bundle symlink are written there at runtime — there is nothing to mount by hand anywhere. If a main-profile-safe variant is ever needed, split a separate patch instead of reusing this one.

Patch edits must be boot-verified before landing (`dsh preflight` against a profile composing this bundle, or one real sub-dsh launch): the `!!js` tag is scalar-only and a mistagged collection fails at profile boot, before any plugin code runs. `tests/patch.spec.ts` pins the shape in-repo, but the boot check is the authoritative gate.

## Why a caller-supplied session id

The local-agent family needs to continue the *same* dsh conversation across delegations. The parent provider generates one uuid and passes the same value on every round: the fresh round creates the sub-dsh session with it, and each resume round continues exactly that session. The id travels as an invocation flag, never through stdout — the sub-dsh stdout stays format-pure, with no delimiter prefix and no risk of a task answer that happens to contain an id-like string being misparsed.

## Composition

This bundle's patch rides over `dsh-base` in its own profile (e.g. `headless-local-agent-dsh`):

```yaml
- id: local-agent-dsh-headless-startup
  name: '@khorsheed/dsh-local-agent-dsh-headless/startup'

- id: local-agent-dsh-headless-runner
  name: '@khorsheed/dsh-local-agent-dsh-headless'
  inject: [localAgentDshHeadlessStartup]
  config:
    task: !!js ctx.localAgentDshHeadlessStartup.task
    sessionId: !!js ctx.localAgentDshHeadlessStartup.sessionId
    resumeSessionId: !!js ctx.localAgentDshHeadlessStartup.resumeSessionId
```

The startup provider parses the task positional plus `--session-id` / `--resume` (mutually exclusive) and publishes the invocation; the runner creates (`agents.create({ sessionId })`) or resumes (`agents.resume({ resumeSessionId })`) that session, drives the task, flushes, prints the final assistant text, and exits 0 on a completed turn, 1 otherwise — mirroring the official headless runner.

## Invocation

```sh
dsh --profile headless-local-agent-dsh --session-id 6ba7... "run the tests"   # fresh
dsh --profile headless-local-agent-dsh --resume 6ba7... "run the rest"       # resume
```

With neither flag, the runner generates its own `session-<uuid>` id (the official headless behavior), so the bundle is a drop-in replacement for one-shot use.

## Notes

- The sub-dsh session store lives under its own `$DSH_HOME` (the harness's scoped home), so sub-dsh sessions never appear in the parent instance's session list.
- No `local-agent` family bundles belong in this composition: base's own in-process subagent tools stay, but nothing here spawns another dsh.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.1`): ✅ full — the rc.8→0.1.1-rc.1 API audit (2026-08-21) confirms every surface this plugin consumes is unchanged or additive (the ProjectionDefinition restructure, cacheHitPercent return-type change, and the credentials/updated event rename do not touch this package); no source change was needed.
- source line (deepseek-harness master): ✅
