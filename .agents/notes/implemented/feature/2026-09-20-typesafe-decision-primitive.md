# Agent Note: TypeSafe as a decision service plus a preset-granted tool row

Status: implemented

## Problem

Agent work keeps hitting decisions that ordinary code cannot make and that a large model should not be asked to
make in prose: does this incoming message need anyone to reply, which topic does this belong to, how urgent is this,
does this source actually support this claim. Writing a prompt and parsing its answer is slow and fragile, and every
consumer invents its own wording.

TypeSafe's System One models (Jev) are built for exactly that shape — one fast call returns a typed answer with a
probability distribution. What existed on this instance was the official `typesafe-ai` skill: a build-time guide
that contained **no request shape at all** (0 code blocks, 0 `system_one`/`curl`) and pointed at the live docs, whose
quickstart nudges an agent toward building a CLI wrapper. The skill therefore taught nothing executable and steered
toward new plumbing.

The capability needs two consumers, and they pull the design in different directions:

1. **The model inside a turn** — a tool it can call for a narrow judgement.
2. **Code with no model in the loop** — a chat/room gate deciding whether to wake a model at all, which cannot be a
   skill (skills only exist inside a model turn) nor an MCP tool (MCP tools are only reachable through the model).

## Decision

Ship two packages, keeping the service and the model face apart.

`@khorsheed/dsh-typesafe` is the profile-root **core row**: self-mounting, it publishes `ctx.typesafe` through
`ctx.provide` and carries no model-facing surface. `inject: ['credentials']`, and config carries only `apiKeyRef`
(default `TYPESAFE_API_KEY`) — every call resolves the key through the official credential seam, and a literal secret
is not accepted anywhere. `judge()` and `decide()` **never throw**: failures return
`{ ok: false, reason, detail, status? }` so a caller owns its own fail-open/fail-closed policy (the `agent/pre-step`
waterfall is awaited inline with no timeout, so a gate must bound itself regardless).

The named-question registry in `src/questions.ts` holds wording, type and threshold for `NEEDS_REPLY` and
`SHOULD_START_WORK` in one place, so the tool, a future code gate and the human reviewing them read the same
definitions.

`src/wire.ts` is the HTTP face — `POST {baseUrl}/v1/systemone`, `Authorization: Bearer <key>` — and imports nothing
from the harness. It owns a deadline that **races** the transport rather than only aborting its signal, so a
transport that ignores the signal cannot hang a caller's turn; `429`/`5xx` back off exponentially (honouring
`retry-after`), a circuit breaker opens after consecutive failures, and an optional cache keyed by
`hash(state + questions + model)` coalesces concurrent identical calls. One line is logged per judgement.

`@khorsheed/dsh-typesafe-tool` is the **preset-composed companion row** (`dsh.composition.component:
preset-composed-row`, no patch of its own): an agent preset names the row and only its sessions get the
`typesafe_judge` tool, the `typesafe:judge` guidance section and the `typesafe-decide` skill. It probes
`ctx.get('typesafe')` through a locally declared structural interface and registers through
`ctx.inject(['tools'|'systemPrompt'|'skills'])`; with the core absent it is a no-op plus one log line. The core is
named only as data in the row's `dsh.references` — **no import, no dependency edge**, the shape `dsh-reader` already
uses for `sideChat`, so the two packages cannot disturb each other's build order.

The skill's `metadata.credentials` declaration is deliberate: it is the capability catalog's own convention, so the
key gets a password field under 「工具与技能 → 凭据配置」 with no new UI, writing the same credential store the core
resolves. The tool description, guidance section and skill all state the same discipline — batch independent
questions in one call, keep thresholds in code, and **never build a CLI or wrapper process for TypeSafe**.

The official `typesafe-ai` skill was removed from `$DSH_HOME/skills/` at the user's direction: with a real tool in
place it could only steer an agent toward wrapper-building, and its content is one `npx skills add` away.

## Alternatives considered

**One self-mounting package carrying service + tool.** Simplest to build and the tool would be present everywhere.
Rejected because the repo's convention is that model tools and prompt guidance ride a preset-composed companion row
(datasets / mission / worktrees / eval all split this way): a tool inside the core cannot be un-granted per preset,
and the core is supposed to be surface-free.

**A typed peer dependency on the core plus an `ALLOWED_EDGES` entry.** This is how the other companion rows are
wired. Rejected in favour of the structural probe because it keeps the companion out of the shared edge list and
matches the already-precedented `dsh-reader` seam; the only shared-script edit this change needed is one
`NO_OWN_PATCH` entry, which the checker itself demands for a preset-composed row.

**An MCP server instead of a plugin.** There is no official TypeSafe MCP; the community ones (`jev-mcp` and
siblings) reintroduce exactly the `npx`-spawned external process the user wanted gone, and the code-side consumer
could still not call them without a model.

**Configuring the credential on the official skill's `metadata.credentials` (the first proposal sketch).** That was
the zero-code path before this package existed. Superseded: the value now belongs to the core's `apiKeyRef`, and the
skill that carries the declaration is our own, so an upstream `npx skills update` can no longer overwrite it.

**A project `AGENTS.md` rule banning new TypeSafe CLIs.** The user rejected it, correctly: a repository-wide
instruction is the wrong layer for a context-specific prohibition. The rule lives in the skill and the tool
description instead, where it loads exactly when it is relevant.

**A bundled CLI or shell helper in the skill.** Rejected outright — the whole point is that the capability is a tool
call, not new plumbing to install, locate and version.

## Consequences

- Two consumers share one implementation and one registry: the model calls `typesafe_judge`, code calls
  `ctx.typesafe`, and a future gate is roughly fifty lines (fetch state → `decide(id)` → map onto
  `{ kind: 'reject' | 'enter' }`).
- The core is honest about failure and bounded by construction, which is what makes it safe on a latency-critical
  path; the price is a slightly bulkier return type at every call site (`if (!result.ok)`).
- Latency is a network round trip. It has not been characterised on this deployment yet, and the deferred gate must
  carry a bounded timeout with `failMode: 'open'` before it can sit in front of anything user-visible.
- Thresholds in the registry are starting points that must be calibrated on real data — a shadow run (log decisions,
  change no behaviour) is the intended first step for the gate.
- `metadata.credentials` also injects `DSH_TYPESAFE_API_KEY` into bash executions (hidden by default, not a hard
  boundary). The `.env` path avoids it if that exposure is not wanted.
- Deliberately deferred: a `models()` listing (not needed for runtime decisions), the gate consumer itself (the
  multi-human chat ingress is still undecided), and room member-dispatch gating (needs an upstream seam — the room's
  `DispatchHooks.allows` is synchronous and built inside `RoomService`).
- Publishing is not done: the packages are deployed into the local 3080 profile as tarballs, and no npm release has
  been cut.
