# Agent Note: filling T32's capability hook — and checking the hash again at run start

Status: implemented

English | [中文](2026-09-12-eval-provision-capability-probe.zh.md)

## Problem

T32 made a condition's `preset` checkable in principle and left the measurement a hook (`ProvisionOptions.capabilities`). Nothing filled it. Every condition declaring a preset therefore locked without a capability record, warned `CAPABILITIES_UNMEASURED`, and was refused by the readiness gate — so the field that pilot D exists to vary could not reach `ready` at all. The mechanism was complete except for the one step that produces a number.

There was also a second, quieter gap T32 did not close. Suppose the hook had been filled: the lock would record a hash, and nothing would ever compare it to anything again. `validate` is offline and cannot measure; the readiness gate checked only that a record EXISTED and that its preset agreed. A preset edited after provision would keep a lock that reads as verified forever — and editing a skill **body** moves no other recorded hash, because `home.sha` hashes config-suffixed files and `SKILL.md` is not one. The capability hash exists precisely to see that edit, and nothing was looking.

## Decision

### The probe measures in the instance, and says what that means

`instanceCapabilityProbe` is what `EvalService.provision` hands to `provisionCondition` when a `capabilityCatalog` service is mounted. Three steps, each of which can decline:

1. **Read the roster back.** `readScopePreset` scans every `profiles/*/cordis.patch.yml` under the scoped home for an insert row mounting `@deepseek-ai/dsh-agent-presets` and takes its `default`. Unreadable means no measurement — copying the declaration into `provisioned.preset` is the single thing that would make that field meaningless, since being a read-back is its whole content.
2. **Confirm both sides mean the same directory.** The catalog resolves a preset id through the EVALUATION INSTANCE's roster roots; the sub-dsh resolves it through the scoped home's. A scope holding its own `<scope>/.agent-presets/<id>` is same-name-different-thing, and the catalog would happily hash the instance's copy. `scopeDefersToInstancePresets` turns that into a refusal naming the fix (point the sub-profile's `roots` at the instance's preset root) instead of a wrong number.
3. **Measure.** `snapshotFor(<the id read back>)`, taking the `sha` the snapshot stamps. T32 made a named preset that will not mount THROW rather than degrade to the global layer, and that refusal is the right answer here too.

**What it measures is stated rather than implied**: that preset's capability face *as this instance composes it*, not as the sub-dsh does (dsh-base plus the headless patch plus the roster). As a factor it is real — two presets give two hashes, and editing a skill body moves one — and that is what pilot D needs. It is not the sub-dsh's whole face, and the README says so in both languages.

### Readiness measures it again

`capabilityRefusal` gains a second argument: the face as it measures NOW. A disagreement fails the condition before any delegation is spent, naming "the preset changed after provision" and the command that fixes it. `run.ts` supplies the re-measure from the same optional catalog face it already resolves for `run.meta.orchestrator`; a composition without a catalog keeps exactly T32's gate (presence and agreement, no freshness).

A re-measure that itself fails leaves the locked record **standing**. An absent measurement is evidence about the catalog, not about the subject, and refusing a run because the catalog hiccuped would fail cells for a reason that has nothing to do with what they are testing.

This is also what keeps the deferred in-scope measurement safe to land later. When the sub-dsh's own composition is finally what gets measured, every lock written by the instance read will disagree with it — and the gate turns that into "re-provision", which is the correct instruction, rather than into a silently mismatched comparison.

### A declining probe now reaches the report

T32's provision logged `capability face NOT measured` when a probe returned `undefined` but pushed no diagnostic, contradicting the probe contract written three paragraphs above it in the same file. It now pushes `CAPABILITIES_UNMEASURED` for a decline exactly as it already did for a throw — otherwise `conditions list` and the slash output show a lock that looks complete, and only the log knows better.

### Reading a sibling's file, deliberately

`sub-profile.ts` reads a file that `@khorsheed/dsh-local-agent-dsh` writes. eval may not import siblings and no service face reports the roster, so what it keys on is chosen to be the stable part: the loader's patch format and the roster PACKAGE name, both public contracts. The generated comment banner and the profile's directory name are explicitly not trusted — the sub-profile's name is configurable, so every profile under the scoped home is scanned, and two profiles rostering two different presets read as ambiguous rather than as the first one found.

The `!!js` tags a real sub-profile patch is full of are parsed to `undefined` through a narrowed js-yaml schema. They are the loader's to evaluate, never this reader's: evaluating one here would run profile text as code inside the orchestrator.

## Testing

- `packages/eval/tests/capability-probe.spec.ts`:
  - `presetFromPatch` against the shape `local-agent-dsh` actually generates, including its `!!js` rows; junk, an empty document and a roster row with no `default` all read as none; a renamed row id and a stripped comment banner still read.
  - `readScopePreset` for a renamed profile directory, a scope with no profiles, one that rosters nothing, and two profiles disagreeing.
  - `scopeDefersToInstancePresets` both ways.
  - The probe: the happy path's digest and counts; measuring what the SCOPE rosters when the declaration disagrees; and the four declines (no roster, the scope's own copy — where the catalog is proven never to be asked — a catalog that throws, a face with no digest), plus the `hashOf` fallback.
  - `capabilityRefusal` freshness: agreement passes, disagreement refuses naming the fix, an absent measurement leaves the record standing.
  - `checkReadiness`: a changed preset fails with no delegation started (the facade throws if `start` is called), a preset-less condition is never re-measured, and a throwing re-measure leaves the condition ready.
  - `EvalService.provision`: the measured face reaches the lock with a catalog mounted; the T32 degrade without one; the catalog is never asked for a preset-less condition; and a scope that rosters nothing warns rather than writing a guess.

## Real-machine verification

A private toolchain (npm `@deepseek-ai/dsh@0.1.5-rc.1` plus this branch's catalog as a local tarball), an instance home whose roster root holds `eval-lean` and `eval-full`, and two scoped homes whose sub-profiles differ in exactly one line — the roster's `default:`. Neither scope keeps a preset directory of its own, so both defer to the instance's root. The catalog, the presets, the sub-profile patches and the locks are real; the local-agent face is a stub, since T32b changes nothing on that path and T31's own machine run covered it.

| Check | Result |
|---|---|
| Two scopes, two hashes | `dsh-lean` → `caps:326eb05ecf89…` (1 skill, 26 tools); `dsh-full` → `caps:3f3b4e781741…` (2 skills, 26 tools) |
| `provisioned.preset` is a read-back | each lock names the preset its scope's sub-profile rosters, not the one the declaration asks for (they agree here — the point is that the value came from the file) |
| validate | both `ready`, no warnings, after the T31 loop resolved `home.sha` into the declarations and provision ran again |
| A skill BODY edited, old lock kept | the readiness gate: **NOT READY** — "the lock records capability face caps:326eb05ecf89… but it now measures caps:92a2c1b0965b… — the preset changed after provision", and `childSessionId: null` (no delegation was started) |
| Re-provisioned after the edit | the hash moves `326eb05ecf89…` → `92a2c1b0965b…`, and the readiness gate passes again |

One result is not what the brief predicted and is worth stating: **`validate` still reports the stale lock `ready`.** It is offline and cannot measure, so the freshness comparison can only live where a catalog does — the readiness gate, which is where a stale record actually has to stop something. A `dsh-eval validate` run and a `conditions list` therefore say "ready" about a lock the run will refuse; closing that would mean giving the read verbs an optional in-instance measurement of their own.

The tools count being 26 in both is the T32 finding restated: `dsh-base` mounts the model-facing tools at the profile root and a preset composes rows rather than filtering them, so two sub-dsh presets differ in what they ADD.

## Alternatives considered

**Hash the preset the condition DECLARES instead of reading the scope back.** Rejected. It would always succeed, always agree with the declaration, and make `provisioned.preset` a copy of the field it is supposed to be the counterpart of. The whole value of the block is that it can disagree.

**Let eval import `readSubProfilePreset` from `@khorsheed/dsh-local-agent-dsh`.** Rejected: community plugins never depend on siblings, and eval's independence is load-bearing (it is consumed by the CLI with no plugin tree at all). Reading the file with the two public contracts as the key is the honest cost of that rule, and the alternative — adding a roster verb to the local-agent face — is a change to two other packages for one reader.

**Regex the generated comment banner (what `local-agent-dsh`'s own `readSubProfilePreset` does).** Rejected here. That function is inside the package that writes the banner, so the banner is its own contract; from outside, keying on a comment is keying on prose. Parsing the YAML costs a few lines and survives a reworded banner, a renamed row id, and a hand-edited patch.

**Refuse when the scope keeps its own preset directory, versus hashing the instance's copy anyway.** Refusing, because the failure mode it prevents is the silent one: same id, different content, a plausible hash, and two conditions that look like two subjects on a number that describes neither. This is also the guard that makes the "measure in the instance" compromise defensible at all.

**Make the readiness re-measure a refusal when the catalog cannot answer.** Rejected. The lock is evidence about the subject; the catalog's availability is not. A run refused because a service hiccuped, with a message about capabilities, would send the operator looking in the wrong place.

**Record a `takenIn: 'orchestrator'` marker in the lock so locks say which composition measured them.** Rejected for this change, though it was drafted. It needs a `dataseek.condition-lock/1` revision and therefore the protocol document, which this branch was scoped out of; and with the freshness re-measure in place a lock from the old measurement no longer passes silently — it reads stale and says "re-provision". If the in-scope measurement later wants to distinguish the two rather than simply invalidate them, that is the change that should add the field.

## Consequences

- A condition declaring a preset can reach `ready` — pilot D is unblocked, which was the point.
- The readiness gate now makes one catalog call per preset-declaring condition at run start. No model, no delegation, and only for conditions that declare a preset.
- The hash recorded is the instance's reading of the preset, not the sub-dsh's whole face. Two presets still produce two hashes and a skill-body edit still moves one, so it works as a factor; a reader who needs to know the difference finds it in the README and in `capability-probe.ts`'s module doc.
- The measurement requires the scope's roster and the instance's roster to resolve a preset id to the SAME directory — in practice, the sub-profile's `roots` pointing at the instance's preset root. A scope with its own preset copy is refused with that fix named, rather than measured wrongly.
- `capability-probe.ts` is where the deferred in-scope measurement replaces the instance read. Nothing else has to change when it does: the lock field, the readiness comparison and the provision wiring all stay as they are.
