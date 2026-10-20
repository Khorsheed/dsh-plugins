# Agent Note: The family card's served-namespace gate kept it from ever mounting

Status: implemented

English | [中文](2026-10-21-family-card-ungated.zh.md)

## Problem

After the family-card wave ([2026-10-20-local-agent-family-card.md](../feature/2026-10-20-local-agent-family-card.md)) shipped to prod, the Plugins page showed NO local-agent card at all: the new「本机 Agent 委派」family card never appeared, and the companions — seeing a core that answers `registerHarnessCard` — had already given up their standalone `plugins.item` seats.

Root cause: the family card registered inside `configForms.whileServed(['local-agent'])`, copying the companions' convention. But `whileServed` reads the host's `settings.describe` answer, and the host's `describe()` only lists an entry when `volatileForm(schema)` is non-empty — i.e. when the plugin's `Config` has at least one `.volatile()` field (deepseek-harness `packages/settings/settings/src/index.ts` + `schema.ts`). The core's `Config` (`homesRoot`, `loginPromptTimeoutMs`) has NO volatile field, so the `local-agent` namespace is never served, the gate never fired, and the card never mounted. The companions gate on their OWN namespaces, which do carry volatile fields (`model`, `live`, …), so their standalone cards had always worked — which is why the copied convention looked safe and the gap only surfaced after the companions' fallback seats were retired by the new core.

## Decision

The core client registers the family `plugins.item` card **unconditionally** (`packages/local-agent/src/client/index.ts`): the client bundle loads only when the core row is in the composition, so the bundle's presence IS the install gate. A core whose server half failed still renders the card, with each section showing its degraded/unavailable state (the family's declare-and-degrade convention). The companions keep their own per-namespace `whileServed` gates unchanged — theirs encode "this harness's row is mounted and active", which the bundle's presence cannot answer for them (a bundle variant may carry the package without mounting the row).

No volatile field was added to the core `Config` to force the namespace into the describe answer: that would have surfaced the internal `homesRoot` knob in the native settings editor as a side effect.

## Alternatives considered

- Gate on `whileServed([...all companion namespaces])`. Rejected: hardcoding the harness list into the core inverts the family's layering (harnesses register dynamically; the core is harness-agnostic), and a core installed alone would show no card despite the designed empty state.
- Mark a core `Config` field `.volatile()` purely to serve the namespace. Rejected: exposes an internal knob as an editable form field to satisfy a gate that the bundle's presence already answers.
- Gate on the gateway Remote being mounted. Rejected: a boot-failed core would hide the card entirely, against degrade-don't-explode — the visible card with unavailable sections is the better failure surface.

## Consequences

- The family card renders wherever the core client bundle loads and the host declares the `plugins.item` slot (0.1.7-alpha.1+); `slots.inject` keeps older hosts silent without a throw.
- Mixed versions: a new core with OLD companions shows the family card (empty state) alongside the companions' standalone cards until the companions update — transient and self-healing.
- `tests/browser-plugin.client.spec.ts` now pins the unconditionality: the bench provides no `configForms` at all, and the registration test asserts the card mounts regardless.

## Verification

- `pnpm --filter @khorsheed/dsh-local-agent run build && pnpm --filter @khorsheed/dsh-local-agent test` — 378 tests green, including the rewritten registration spec.
- Prod 3080 already served the feature code; only the gate kept it from rendering. The core ships through `deploy:3080` (preflight + canary gate), after which the Plugins page shows the one family card with all four harness sections.
