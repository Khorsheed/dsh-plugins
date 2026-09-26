# @khorsheed/dsh-typesafe

English | [中文](README.md)

The common-sense judgements your code needs, returned in one call as typed answers you can `if` on directly — a yes/no probability, an option, a level — each with probabilities and a confidence, not prose you have to parse.

Does this message need a model to reply? Which team owns this ticket? Is this claim supported by the source? Which of these candidate values was meant? Ordinary code cannot decide these, and a prompt-and-parse step is fragile and slow. This package turns TypeSafe's System One models (Jev is the flagship) into a host-side service, `ctx.typesafe`, for **other plugins to call in code**; it carries no model-facing surface of its own — the model-facing `typesafe_judge` tool, its guidance section and the skill live in the companion row [`@khorsheed/dsh-typesafe-tool`](https://www.npmjs.com/package/@khorsheed/dsh-typesafe-tool), granted per preset.

There is exactly one call surface: `POST {baseUrl}/v1/systemone`, `Authorization: Bearer <KEY>`, body `{ state, model, questions }`.

## Features

- **Typed judgements, not prose** — a noul is the probability of yes; a choice is the winning option plus the full distribution and a confidence; a score is a level plus its distribution, confidence and legend.
- **A whole batch in one call** — independent questions ride the same request and are answered in parallel server-side; the official parallel_questions cookbook measures 13 questions in one call at 12.2× cheaper and 10.0× faster than one call per question.
- **A named-question registry** — wording, type and threshold live in one place (`src/questions.ts`), shared by the tool, by code gates, and by the human reviewing them; `decide()` applies the registry threshold of a noul question and returns `meetsThreshold`.
- **Never throws** — every `judge` / `decide` failure is a structured return (`unconfigured` / `circuit-open` / `timeout` / `aborted` / `http` / `transport` / `decode` / `invalid-request`); the caller owns the fail-open/fail-closed policy.
- **Keys resolve by reference only** — config carries an `apiKeyRef` (default `TYPESAFE_API_KEY`) and never accepts a literal secret; every call re-resolves through the official credential seam (`ctx.credentials.resolve`) and never caches it.
- **Every call is bounded** — an owned timeout races the transport and the caller's `AbortSignal` is relayed; `429 / 5xx` back off exponentially (honouring `retry-after`) while `401 / 4xx` never retry; repeated failures trip a circuit breaker; an optional cache coalesces concurrent identical calls; every judgement logs one decision line.
- **No model-facing surface** — this package provides the service only. The tool face is a separate companion row that installs and removes on its own; with the core absent that row is a no-op and never breaks boot.
- **An extractable wire layer** — `src/wire.ts` imports nothing from the harness, ready to lift into a non-dsh caller.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-typesafe
```

The package declares `dsh.bundle`, so add merges its `cordis.patch.yml` row (loader row id `typesafe`) into the profile's bundles layer — no hand-editing of cordis.yml. Restart the web instance to activate. To let the model ask for judgements too, install the companion row `@khorsheed/dsh-typesafe-tool` (see its README); with only the core installed the service works and the model simply sees no tool.

```sh
dsh plugin --profile web remove @khorsheed/dsh-typesafe
```

## Service API

```ts
const typesafe = ctx.get('typesafe')

// Ask one registry question and apply its threshold
const decision = await typesafe.decide('NEEDS_REPLY', lastMessage)
if (decision.ok && decision.decision.meetsThreshold) { /* wake up */ }

// Ask a batch of independent questions in one call (the docs measure this at
// 12.2x cheaper and 10.0x faster than one call per question)
const judged = await typesafe.judge({
  state: { message, thread },
  questions: [
    { id: 'needs_reply', type: 'noul', instructions: '…' },
    { id: 'topic', type: 'choice', instructions: '…', criteria: { billing: '…', other: null } },
    { id: 'urgency', type: 'score', instructions: '…', criteria: ['can wait', 'this week', 'today'] },
  ],
})

// Readiness probe (settings surfaces, gates at startup)
await typesafe.health()   // { available, source?, reason?, lastError?, circuitOpenUntil? }
```

Result shape:

| Result | Meaning |
|---|---|
| `{ ok: true, judgement }` | `judgement.decisions[]` has one entry per question; plus `model` / `latencyMs` / `cached` / `usage` |
| `{ ok: false, reason, detail, status? }` | `unconfigured` / `circuit-open` / `timeout` / `aborted` / `http` / `transport` / `decode` / `invalid-request` |

**Contract: `judge` / `decide` never throw.** Every failure is a structured return, so the caller owns the fail-open/fail-closed policy (the `agent/pre-step` seam is awaited inline with no timeout, so a gate must bound itself anyway).

## The named-question registry

Wording, type and **threshold** live in one place, `src/questions.ts`, shared by the tool, by code gates, and by the human reviewing them:

| id | type | Purpose |
|---|---|---|
| `NEEDS_REPLY` | noul | Chat/room: does this message need a model to reply |
| `SHOULD_START_WORK` | noul | Chat/room: should work start now instead of more discussion |

The thresholds are starting points, not truths: validate them on your own data and set the policy from the consequences. The threshold comparison applies to noul questions only — choice and score answers carry no `meetsThreshold`.

## Configuration

```yaml
- id: typesafe
  name: '@khorsheed/dsh-typesafe'
  config:
    apiKeyRef: TYPESAFE_API_KEY        # a reference name, never the value
    baseUrl: https://api.typesafe.ai   # point at a gateway or private deployment
    defaultModel: jev-latest
    timeoutMs: 5000
    retries: 1
    cacheTtlMs: 0                      # 0 disables
    maxQuestionsPerCall: 32
    circuitBreakerThreshold: 3
    circuitCooldownMs: 30000
    logDecisions: true
```

## Setting the key (no CLI)

1. **Recommended**: fill it once under 「设置 → 工具与技能 → typesafe-decide → 凭据配置」 — that password field is contributed by the credential metadata of the `typesafe-decide` skill the companion row registers (rendered by capability-catalog), so it appears only when the companion row is installed. It writes the host credential store (`$DSH_HOME/.credentials.yaml`, mode 0600), and this service re-resolves it per call.
2. Or put `TYPESAFE_API_KEY=…` in `$DSH_HOME/.env` or the invoking directory's `.env` (the user-env / project-env layers of credential resolution) — the launch environment snapshot is frozen, so a restart is required.
3. Or export it in the launch environment (the most trusted layer).

The key stays inside the host process: never in model context, never in the repository, never in configuration.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ complete — the self-mounting row plus `ctx.provide` / `ctx.get` service publishing and `ctx.credentials.resolve` by-reference key resolution are all seams exercised on 0.1.5-rc.1; `minHost` is 0.1.5-rc.1.
- Source line (deepseek-harness master): every seam used is a long-standing primitive and none has been renamed; not separately re-verified on master (`verifiedHost: 0.1.5-rc.1`).
- Hosts below 0.1.5 are unverified; `inject: ['credentials']` leaves this row pending (never a boot failure) in a composition without a credential service, where the service is then unavailable.

**Version lines**: `0.1.0` supports host `0.1.5-rc.1` and later.

## Known Limitations

- **The settings-page key field comes from the companion row** — the credential input in 「工具与技能」 is contributed by the companion's skill metadata; a core-only composition sets the key through `.env` or the launch environment.
- **The cache lives in process memory** — the `cacheTtlMs` cache and the coalescing of concurrent identical calls are in-memory and empty again after a restart.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Architecture.** A host-only package with no browser half. `apply` builds one `TypeSafeService` and publishes it with `ctx.provide('typesafe', …)`; consumers pick it up via `ctx.get('typesafe')`. The identity triangle: the package name `@khorsheed/dsh-typesafe`, the `cordis.patch.yml` row (id `typesafe`, name equal to the package name), and `export const name = 'typesafe'` in `src/index.ts`. `export const inject = ['credentials']` is a hard injection: the key resolves through the credential seam on every call — a composition without a credential service leaves this row pending and never fails boot.

**Lifecycle of one call.** `judge` first validates locally (empty lists, duplicate ids, choice/score without criteria, calls above `maxQuestionsPerCall` — all rejected before any network call), then checks the breaker, then resolves the key, then consults the cache — keyed by `stableStringify({baseUrl, model, state, questions})` — and concurrent identical calls share one in-flight request. The serving path maps every throw from the wire layer onto a structured `Failure` and opens/closes the breaker by consecutive-failure count; a success writes the cache and logs one decision line (model, per-question answer and confidence, latency, token usage).

**A bounded transport.** Every wire attempt owns a deadline that **races** the transport rather than merely aborting its signal — a transport that ignores the abort still cannot hang a caller's turn (the `agent/pre-step` seam is awaited inline with no timeout, so a gate must bound itself anyway). Only `429 / 5xx` retry: exponential backoff from 250ms capped at 4s, honouring `retry-after` capped at 10s; `401 / 4xx` never retry. The caller's `AbortSignal` is relayed into every attempt.

**Registry and thresholds.** `decide` accepts a registry id or a one-off spec; a registry noul answer is compared against its threshold for `meetsThreshold` (choice/score get no threshold). Registry ids live in code only — the API never sees them and neither does the model: the instructions carry the whole meaning.

**The companion seam's direction.** Companion → core, one way only: the companion probes `ctx.get('typesafe')` structurally at apply time and never imports this package (the core is named only as data in the companion's manifest, via `dsh.references`), so neither package can break the other's build order. With the core absent the companion row is a no-op, and the composition boots cleanly either way.

**Exports.** The root export gives the `TypeSafeService` class, `resolveConfig`, `TYPE_SAFE_DEFAULTS`, `validateQuestions` / `decodeDecisions`, the registry helpers (`QUESTION_REGISTRY` / `QUESTION_IDS` / `isQuestionId` / `questionSpec` / `thresholdOf`), the wire helpers (`buildBody` / `callSystemOne` / `decodeAnswer` / `defaultTransport` / `stableStringify` / `TypeSafeWireError`) and all wire types.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/typesafe`). Issues and contributions welcome there.
