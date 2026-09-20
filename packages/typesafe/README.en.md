# @khorsheed/dsh-typesafe

English | [中文](README.md)

Turns TypeSafe's System One models (Jev is the flagship) into a host-side **judgement primitive**: small, fast, and
returning **typed answers with probabilities** instead of prose you have to parse. This is the profile-root **core
row** — it publishes the `ctx.typesafe` service for **other plugins to call in code** and carries no model-facing
surface of its own; the model-facing `typesafe_judge` tool, its guidance section and the skill live in the companion
row [`@khorsheed/dsh-typesafe-tool`](https://www.npmjs.com/package/@khorsheed/dsh-typesafe-tool), granted per preset.

## What it solves

When code needs common sense — does this message need a model to reply, which team owns this ticket, does the source
support this claim, which of these candidate values was meant — ordinary code cannot decide, and a prompt-and-parse
step is fragile and slow. TypeSafe answers with something you can `if` on directly: a noul is the probability of yes,
a choice is the winning option plus the full distribution and a confidence, a score is a level plus its distribution
and confidence.

**There is exactly one call surface**: `POST {baseUrl}/v1/systemone`, `Authorization: Bearer <KEY>`, body
`{ state, model, questions }`.

## Shape: a self-mounting core service

- Self-mounting (`dsh.bundle.patch`); the service name and the loader row id are both `typesafe`;
  `ctx.provide('typesafe', …)`.
- `export const inject = ['credentials']`: every call resolves the key **by reference** through the official
  credential seam (`apiKeyRef`, default `TYPESAFE_API_KEY`). **Config carries a reference name and never accepts a
  literal secret.**
- No model-facing surface at all: no tool, no skill, no prompt section. It exists for other plugins.
- The tool face is a separate package that can be installed and removed on its own; when the core is absent that row
  degrades to a no-op and never breaks boot.

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

**Contract: `judge` / `decide` never throw.** Every failure is a structured return, so the caller owns the
fail-open/fail-closed policy (the `agent/pre-step` seam is awaited inline with no timeout, so a gate must bound
itself anyway).

## The named question registry

Wording, type and **threshold** live in one place, `src/questions.ts`, shared by the tool, by code gates, and by the
human reviewing them:

| id | type | Purpose |
|---|---|---|
| `NEEDS_REPLY` | noul | Chat/room: does this message need a model to reply |
| `SHOULD_START_WORK` | noul | Chat/room: should work start now instead of more discussion |

The thresholds are starting points, not truths: validate them on your own data and set the policy from the
consequences.

## Bounds and resilience

- **Timeout**: `timeoutMs` (default 5000) owns a deadline that **races the transport** — a transport ignoring the
  abort signal still cannot hang a caller's turn. The caller's `AbortSignal` is relayed too.
- **Retry**: `429 / 5xx` back off exponentially (honouring `retry-after`), `retries` defaults to 1; `401 / 4xx`
  never retry.
- **Circuit breaker**: after `circuitBreakerThreshold` (default 3) consecutive failures the breaker opens for
  `circuitCooldownMs` (default 30s) and returns `circuit-open` immediately instead of making every message wait for
  a timeout.
- **Cache and coalescing**: with `cacheTtlMs > 0`, results are cached by `hash(state + questions + model)` and
  concurrent identical calls share one request; `{ fresh: true }` bypasses the cache.
- **Logging**: one line per judgement (model, per-question answer and confidence, latency, token usage);
  `logDecisions: false` silences it.
- **Validation**: empty question lists, duplicate ids, choice/score without criteria, and calls above
  `maxQuestionsPerCall` (default 32) are rejected before any network call.
- **Extractable**: `src/wire.ts` imports nothing from the harness — the piece to lift into a non-dsh caller.

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

1. **Recommended**: fill it once under 「设置 → 工具与技能 → typesafe-decide → 凭据配置」. That writes the host
   credential store (`$DSH_HOME/.credentials.yaml`, mode 0600) and the plugin re-resolves it per call.
2. Or put `TYPESAFE_API_KEY=…` in `$DSH_HOME/.env` or the invoking directory's `.env` (the user-env / project-env
   layers of credential resolution); a restart is required because the launch snapshot is frozen.
3. Or export it in the launch environment (the most trusted layer).

The key stays inside the host process: never in model context, never in the repository, never in configuration.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-typesafe
```

Install the companion row separately for the tool face (see its README); with only the core installed the service
works and the model simply sees no tool.

## Compatibility

- **npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`)**: ✅ complete — the self-mounting row plus `ctx.provide`,
  `ctx.credentials` reference resolution, `ctx.inject(['tools'])` / `ctx.inject(['systemPrompt'])` and
  `ctx.get('skills')` are all seams exercised on 0.1.5-rc.1.
- **Source line (deepseek-harness master)**: every seam used is a long-standing primitive and none has been renamed;
  not separately re-verified on master (`verifiedHost: 0.1.5-rc.1`).
- Hosts below 0.1.5 are unverified; `inject: ['credentials']` leaves this row pending (never a boot failure) in a
  composition without a credential service, where the service is then unavailable.

**Version lines**: `0.1.0` supports host `0.1.5-rc.1` and later.
