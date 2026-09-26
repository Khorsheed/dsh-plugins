# Agent Note: preset-composed tool rows declare their core service as an inject (the apply-time probe loses rc.1's boot order)

Status: implemented

## Problem

On 2026-09-27 the owner noticed `typesafe_judge` missing from the capability catalog on the 3080 production instance. Diagnosis (probe patched into the live install, boot log read after a gated restart) showed the row applying with `typesafe: ABSENT` — and `credentials: ABSENT` alongside it, while the host-plane services (`tools`, `skills`, `systemPrompt`) resolved fine.

Root cause: on the rc.1 host line the agent-preset registry activates a preset's standing scope **at registry-apply time**, which lands before the profile's later bundle rows have applied. The six community tool companions (typesafe-tool, worktrees-tool, room-tool, datasets-tool, eval-tool, mission-tool) each probed their core service with a one-shot `ctx.get('<core>')` at apply; the probe saw ABSENT, the apply returned early, and — the row having completed — nothing ever re-ran it. Cordis service visibility was never the problem (a scratch cross-scope reproduction resolves root-provided services from a scope both ways); the one-shot timing was. On 0.1.5 the registry's mount order differed and the same probe won, so the latent race only surfaced with the rc.1 upgrade. Every one of the six rows was dead in every preset on 3080; the official inventory still showed them 已启用 because row-mounted ≠ registration-happened.

## Decision

All six companions now **declare the core service in their package-level `inject`** (`typesafe`, `worktrees`, `room`, `datasets`, `dshEval`, `mission`): the row pends until the core provides (the preset registry's audit tolerates pending rows — "waiting for \<core\>" — and re-activates them when the provider appears), then the whole body applies. This is the sanctioned owning-family pattern local-agent's providers already used; `COMMUNITY_SERVICE_INJECTORS` in scripts/check-plugin-independence.ts gained the six pairs. The in-apply `ctx.get` guard stays as the defensive direct-call path (the unit tests invoke `apply` without the loader's inject machinery), and the deferred `ctx.inject(['tools'|...])` registrations inside the body are unchanged — that lesson (the tools registry's own mount race) still stands.

## Alternatives considered

**Keep the probe, re-probe when the core appears (ctx.inject inside apply instead of a declared inject).** Rejected: the row would report active while having registered nothing — the exact "enabled but inert" misreading that made this incident invisible for days. A pending row is the honest state and the registry's audit surface already knows how to show it.

**Fix the mount order upstream (registry activates presets after the profile tree settles).** The host is upstream and untouchable from here; and the registry's documented contract already expects late-provided services to activate pending rows, so the one-shot probe was ours to fix. No upstream gap to file.

**Probe with retry/poll.** Rejected: a timer-based re-probe duplicates exactly what cordis inject already is, worse.

## Consequences

The six tools (typesafe_judge, the worktrees/room/datasets/eval/mission tool sets) reappear in preset sessions after the next boot; the catalog's dev-mode face shows them again. A composition naming a tool row without its core now shows an honest pending row instead of a silently inert one. `dsh.compat.notes` and the READMEs were re-worded to match (the probe-based degrade claims are gone).

## Testing

Each package's suite passes unchanged (the mocks call `apply` directly, so the declared inject is transparent to them); `pnpm check:plugins` accepts the six new injector pairs. Live verification on 3080: the probe line (temporarily patched into the installed `typesafe-tool/lib/index.js`, reverted by the deploy) printed `typesafe: ABSENT` before the fix and the dev-mode catalog face listed the tool after it.

## Related

- The deploy-side lesson from the same day: [ankh-guard self-deploys need reconfigure](../process/2026-09-26-ankh-guard-self-deploy-reconfigure.md).
