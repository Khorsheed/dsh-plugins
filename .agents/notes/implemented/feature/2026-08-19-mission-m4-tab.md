# Agent Note: mission — web session tab over a Typert Remote (milestone M4)

Status: implemented

English | [中文](2026-08-19-mission-m4-tab.zh.md)

## Problem

The [mission proposal](../../../proposals/active/2026-08-19-mission-tasks.md) reserves a web session tab (会话 tab 一节, ASCII sketch) as the human queue surface: five-bucket filter chips, a run selector defaulting to this session, the task table, a row detail panel, and the export button behind the same leak gate as the CLI. After [M1](2026-08-19-mission-m1.md), [M2 slash](2026-08-19-mission-m2-slash.md), and [M2 export](2026-08-19-mission-m2-export.md), the tab is the last v1 face — delivered as the datasets-tab pattern prescribes: a host-side `TypertRemoteService` data face plus a browser half registered on `conversation.view`.

## Decision

**Host** (`src/remote.ts`): `MissionRemoteService extends TypertRemoteService`, cordis key `missionRemote`, wire namespace `mission`, mounted by the plugin's apply. Every method takes the calling agent first and every optional selector rides a request object (the exact-arity lesson). `queue` scopes to the caller session's runs by default (`all` widens, `runId` names one, `buckets` filters); `get` returns the row detail (wire variants `MissionAttemptWire`/`MissionAnnotationWire` constrain `unknown` payloads to `JsonValue` — the generator rejects unconstrained unknowns on the boundary); `retry` writes `tab:<sessionId>`; `isReleasable` mirrors the service. The export pair splits the gate: `exportPlan` resolves guarded layers (datasets probe when mounted, explicit declarations additive) and returns the trigger list; `exportRun` re-plans FRESH and refuses any guarded layer not in the caller's `confirmed` list — a stale dialog never authorizes a changed layer set.

**Boundary types**: all Remote request/response types live in `src/types.ts`, re-exported through the public `./types` subpath (the generator's "public non-root type subpath" rule; `./src/*` does not count). The generated `lib/typert.remote-client.js` imports zod, so zod is a runtime dependency (datasets precedent).

**Client** (`src/client/`): `conversation.view` entry id `missions` order 35, after the datasets anatomy — inject `['slots', 'remote', 'locale']`, `$mount` then `ctx.get('remote.mission')`, a store factory (never a module singleton), zh/en dictionaries under the `mission` namespace. The view follows the sketch: bucket chips (multi-select), run scope selector (本会话 default / 全部 / one run), the table (# / title / bucket / template state / plan-blocked / duration — duration from `enteredCurrentAt`), per-run unreleased warnings, a detail panel (attempt/checkpoint/annotation counts) with retry + release check + export. The export dialog is the gate's web form: plan check → each guarded layer listed with its own checkbox → export enabled only when all are acknowledged. The filter chips follow the official toolbar-toggle convention (`ui-trajectory`'s TrajectoryToolbar): selection is `aria-pressed` ALONE (no parallel class, so semantics and visuals cannot drift), pressed = primary label + `interactive-bg-hover`, rest = quiet tertiary, `focus-visible` = the business-primary ring — the theme-adaptive tokens keep both states readable in light and dark.

**Build face**: the package moved to the datasets layout — solution tsconfig + `tsconfig.host.json`/`tsconfig.client.json`, `clientBundle('@khorsheed/dsh-mission', [...])` in tsdown, gen-typert registered in `scripts/gen-typert.mts`, `dsh.client` with the official six-inject set, build script `gen-typert && tsc -b && tsdown`.

Deviations from the sketch, honestly: no submit button (artifact upload plumbing is out of the Remote face's scope; tools/CLI cover submit); the export dialog writes to a host-side directory typed by the human (a browser cannot pick a server path).

## Alternatives considered

- **`export` as the Remote method name** — rejected: legal as a property but needlessly close to a keyword for a code-generated client; the pair is `exportPlan`/`exportRun`.
- **Trusting the dialog's confirmation** — rejected: the host re-plans and re-checks `confirmed` against the fresh guarded list, so a doctored or stale client cannot slide a guarded layer past.
- **Module-level store handle** — rejected per the datasets note; the factory keeps store identity per entry.

## Consequences

- All four faces plus the tab now share the one service kernel; the tab's writes (retry) are attributed `tab:<sessionId>` in history.
- Live smoke on the 0.1.0-rc.8-era web profile (own :3091 instance): the tab registered and rendered (chips, scope selector), and the wire namespace answered typed RPC envelopes. The queue success path could not be exercised live — every pre-existing demo session in the shared $DSH_HOME fails resume with pre-existing log damage from earlier datasets live-debugging (torn JSONL / unknown `datasets/binding` event), and minting a fresh session needs a model key the instance doesn't have; the success path is covered by the in-process Remote spec and the view spec instead.
- `package.json` gained the `./client`/`./typert`/`./remote`/`./types` exports and the runtime zod dependency; `dsh.compat` notes now describe the tab as shipped (web-only, headless serves the Remote without a consumer).

## Testing

`tests/remote.spec.ts` (5 tests, host): queue scoping (session default / all / buckets / runId), get + retry attribution, isReleasable, the exportRun re-check refusing unconfirmed guarded layers then accepting the confirmed export, the datasets probe supplying guarded layers. `tests/apply.client.spec.ts` (5 tests): inject declaration, Remote mount + entry registration, mount-failure resilience, the injected face binding all six verbs with the session id, teardown collapse. `tests/MissionsView.client.spec.tsx` (6 tests, jsdom + real store): table rendering with bucket/state/plan/duration cells, chip multi-select driving the request, scope widening, detail panel + retry/release-check notices, the unreleased warning, and the export dialog gating confirm until every guarded layer is acknowledged. Suite: 113/113; the bin smoke (built artifact) still passes.

## Cross-references

- [Mission proposal](../../../proposals/active/2026-08-19-mission-tasks.md) — the 会话 tab section and sketch this implements.
- [mission M2 export](2026-08-19-mission-m2-export.md) — the gate contract the tab's export dialog reuses; [mission M1](2026-08-19-mission-m1.md) — the service kernel.
