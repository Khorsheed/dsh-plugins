# Agent Note: the model a delegation asks for

Status: implemented

English | [中文](2026-09-10-delegation-model.zh.md)

## Problem

A condition document declares a model. Until now that declaration was only ever
COMPARED against what the harness happened to run — never requested. The
delegation facade had no model at all (`DelegationCallOptions` carried label,
signal, onProgress, reattach, cwd, exec, scope), so the orchestrator built its
call options without one and then checked the read-back afterwards.

T30a narrowed the gap from the other side: three harnesses gained a `model`
plugin-config key. But a plugin-config key is HARNESS-WIDE. Two conditions of
the same harness running two models cannot both be expressed by one key, and
the evaluation's whole shape is "same harness, one factor different".

T22 step 5 is what that costs. The judge condition declared dsh v4-pro; the
sub-dsh inherited the host instance's default, v4-flash; the readiness probe
read back v4-flash, saw the mismatch, and refused. Re-declaring the judge as
v4-flash then made it collide with the dsh PLAYER on `(harness, model)` —
JUDGE_IS_PLAYER. Neither declaration could be run, because neither could be
requested. Pilot B/C's "same harness, two models" conditions were unbuildable
for the same reason.

dsh was short one more piece: the headless sub-dsh had no place to name a model
per launch (`--session-id` / `--resume` / `--serve` only), so its model came
from `agentDefaultModel.currentSelection()` and nothing below the host instance
could move it.

## Decision

### `DelegationCallOptions.model` — per delegation, `start` only

The facade takes a model for ONE delegation. It rides the staged fresh intent
the way `cwd`, `exec` and `scope` already do, and the provider RECORDS it.

**`resume` refuses it.** A model belongs to the delegation, not to one of its
rounds: the first round records what it requested and every later round
re-requests exactly that (none, when the first named none). Passing one to
`resume` throws before anything is staged. This is the one place the design
could have gone quiet instead — accept and ignore — and quiet is worse: the CLI
WOULD honour a mid-conversation model switch, and the transcript would not show
it. The caller learns; the conversation stays one model.

**A round with a model is exec-only**, enforced by `assertModelExecOnly`, the
twin of T29's `assertScopeExecOnly` and refused for the same reason: a resident
runtime binds its model when the PROCESS starts and then serves many rounds of
one member, so a per-delegation model would either be ignored or would silently
change what every other round of that runtime runs. The plugin-config key is
NOT restricted this way — it is harness-wide, so a runtime bound to it is
running what the instance asked for.

### One resolution order, in one place

`resolveRoundModel(requested, configured)` lives in the family core and every
provider spreads its result into the run spec, so the order is stated once:

1. the delegation's own `model` (fresh: the intent; resume: the record)
2. the harness's `model` plugin-config key (T30a)
3. the harness's scoped configuration file
4. the CLI's own default

All four absent means NO model flag on the argv — byte for byte the shape that
shipped before either layer existed. Blank at any layer reads as absent, so a
cleared settings field cannot produce an empty flag value.

`effectiveSettings.model` deliberately still answers from layer 2 down: it says
what a round with no model of its own would run, which is the harness-wide fact
the condition snapshot is asking about, not a per-delegation one.

### dsh: `--model` on the headless launch, and the key T30a skipped

`dsh --profile headless-local-agent-dsh --model <provider/model>` overrides the
sub-instance's default selection — through the startup provider, the patch's
runner row, and `applyModelRequest` in the agent loader, which feeds both
`agentOptions` and the `installModelSelection` ref so the waterfall agrees with
the agent.

The value splits at the FIRST slash, so a model id containing one survives; a
bare id names the model and keeps the instance's provider; a leading or
trailing slash is not a split point (it would produce an empty half the agent
cannot route). Everything else on the selection — the reasoning effort in
particular — is carried through: a model swap is not a config reset.

Under `--serve` it binds EVERY session the resident process hosts. That is not
a limitation to work around; it is the same fact that makes a per-delegation
model exec-only, stated on the other side of the wire.

With a launch path in place, dsh gains the `model` plugin-config key T30a could
not give it, plus the settings card row the other three already have, and its
`effectiveSettings.model` now reads the key before the host selection.

### eval: declared becomes requested

The player rounds (`run.ts`), the judge delegations (`judge.ts`) and the
readiness probe (`readiness.ts`) all pass a non-null `model.declared` as the
delegation's `model`; a null declaration passes nothing, exactly as before. The
resume rounds pass none — the family re-issues the recorded request.

The comparison is untouched: request X, read back Y, and it is still a
`MisattributedRun`. What changed is that the probe now proves what the cells
will actually do, instead of proving what the instance default happens to be.
`run.meta.readiness` and each delegation annotation gain `requestedModel`
beside the observed one, so a reader can tell "asked for X, got X" from "asked
for nothing, got X".

The condition contract's SHAPE is unchanged. `model.declared` went from "only
compared" to "requested, then compared"; the protocol records that as a
description change, v1-rev9.

## Real-machine verification

Each round drove the SHIPPED provider against the real CLI, with a
delegation-level model deliberately different from the plugin-config one, then
resumed the same delegation with no model at all:

| harness | round | plugin-config `model` | delegation `model` | flag on the argv | recorded | read back |
|---|---|---|---|---|---|---|
| codex | fresh | `gpt-5.6-terra` | `gpt-5.6-luna` | `-m gpt-5.6-luna` | `gpt-5.6-luna` | `gpt-5.6-luna` |
| codex | resume (no model) | `gpt-5.6-terra` | — | `-m gpt-5.6-luna` | — | `gpt-5.6-luna` |
| claude-code | fresh | `claude-sonnet-5` | `claude-haiku-4-5-20251001` | `--model claude-haiku-4-5-20251001` | `claude-haiku-4-5-20251001` | `claude-haiku-4-5-20251001` |
| claude-code | resume (no model) | `claude-sonnet-5` | — | `--model claude-haiku-4-5-20251001` | — | `claude-haiku-4-5-20251001` |

Both fresh rounds prove the order (the delegation beat the plugin key) and both
resume rounds prove the record (the same model, with the caller naming none).

dsh, against a real sub-dsh (the instance credential, the 0.1.2-rc.1 toolchain
entry, a throwaway scoped home):

| round | plugin-config `model` | delegation `model` | flag on the argv | read back |
|---|---|---|---|---|
| baseline | — | — | none | `deepseek-official/deepseek-v4-flash` (the instance default) |
| plugin key only | `…/deepseek-v4-pro` | — | `--model …/deepseek-v4-pro` | `deepseek-official/deepseek-v4-pro` |
| delegation | `…/deepseek-v4-flash` | `…/deepseek-v4-pro` | `--model …/deepseek-v4-pro` | `deepseek-official/deepseek-v4-pro` |

All three settled `completed`, so layers 1, 2 and 4 are each pinned on real
hardware for dsh.

And the case this whole task exists for — a plan whose JUDGE is dsh v4-pro
while its PLAYER is dsh v4-flash — run through the real `checkReadiness` over
real sub-dsh delegations:

```
readiness p0-dsh-flash: ready (2.2s, model deepseek-official/deepseek-v4-flash)
readiness p0-judge-dsh-pro: ready (2.9s, model deepseek-official/deepseek-v4-pro)
```

```json
{"condition":"p0-dsh-flash","role":"player","ok":true,"declaredModel":"deepseek-official/deepseek-v4-flash","requestedModel":"deepseek-official/deepseek-v4-flash","observedModel":"deepseek-official/deepseek-v4-flash"}
{"condition":"p0-judge-dsh-pro","role":"judge","ok":true,"declaredModel":"deepseek-official/deepseek-v4-pro","requestedModel":"deepseek-official/deepseek-v4-pro","observedModel":"deepseek-official/deepseek-v4-pro"}
```

Both READY, each reading back the model it declared — the T22 step-5 shape,
now passing. The two conditions differ on `(harness, model)`, so
JUDGE_IS_PLAYER does not fire; whether that rule should relax further is T31's.

## Alternatives considered

**Let `resume` take a model and apply it.** Rejected: the CLI would honour a
mid-conversation switch and the transcript would not record it, so a run could
change subject halfway and still look consistent. Recording the first round's
request and re-issuing it makes "one delegation, one model" a property rather
than a convention.

**Let `resume` take a model and ignore it.** Rejected for the same reason in a
quieter form: a caller that passes one believes something the system does not
do. A throw is information.

**Silently downgrade a model-carrying round from live to exec.** Rejected —
T29 rejected it for scopes on the same grounds. The caller asked for a model
under a live driver; answering a different question quietly is worse than
refusing, and the refusal names the two ways out (turn live off, or drop the
model).

**Put the model on the `SubagentStartRequest` seam instead of the staged
intent.** Rejected: that seam is the host's, shared with every provider, and
the family has kept its own start facts (cwd, exec, scope) on the staged intent
for exactly this reason. A model is one more family-private start fact.

**Keep `effectiveSettings.model` reporting the delegation's model when one is
in flight.** Rejected: the field answers a harness-wide question for the
condition snapshot, and a value that changed per delegation would make two
snapshots of one harness disagree for reasons the condition hash cannot see.

**Give dsh a `model` key without `--model`, mapping it onto the host
instance's default selection.** Rejected: that would make one delegation's
setting change what the whole host instance runs — including rounds of other
harnesses' conditions and the user's own foreground agent.

**Let the eval keep comparing only, and fix T22 step 5 by re-declaring the
judge.** Rejected: that is what was tried, and it produced the
JUDGE_IS_PLAYER collision. The declaration has to be executable for the
constraint to be about the evaluation rather than about the instance.

## Consequences

A condition that declares a model now CHANGES what runs, where before it only
described it. A run whose declaration was wrong used to fail at the read-back;
it now runs the declared model instead — which is the point, but it does mean a
mis-declared condition silently gets what it asked for rather than failing
loudly. The read-back still catches the case that matters (the harness ran
something else).

`resume` gained a throw. A caller that passed `model` to `resume` before could
not have meant anything by it (the option did not exist), so nothing in tree
breaks; a caller written against the new option will meet the error the first
time it tries.

dsh's `--model` binds a whole `--serve` process. The parent never asks it to do
otherwise — a delegation model is refused on the live path — but a person
running the headless bundle by hand should know that flag is process-wide in
serve mode.

The four harnesses' model plumbing is now uniform: same call option, same
resolution order, same record field, same exec-only rule. The remaining
asymmetry is vocabulary — dsh spells its model `provider/model` while the three
CLI harnesses take whatever their own CLI takes — and that is deliberate: each
CLI's own names, never normalized.
