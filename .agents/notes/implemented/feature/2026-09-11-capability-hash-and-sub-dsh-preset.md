# Agent Note: the capability hash — making a condition's `preset` checkable

Status: implemented

English | [中文](2026-09-11-capability-hash-and-sub-dsh-preset.zh.md)

## Problem

A condition document has carried `preset` and `skills.pack` since the contract was written, and both enter the condition hash. Neither was ever checked. Nothing wrote a preset anywhere, so nothing could disagree with one: two conditions differing only in `preset` were two subjects on paper and, in fact, the same subject run twice. The evaluation's whole claim — "these two cells differ in exactly one factor" — rested on a field with no counterpart.

Three things made it unfixable rather than merely unfixed.

**The catalog could only see one preset.** `capability-catalog`'s snapshot resolved its scope through `agentPresets.standingKeyFor(agentPresets.defaultId)` — the deployment default, always. `standingKeyFor` has always taken an id; the catalog simply never passed one. "What can preset X do" was unaskable.

**A listing is not an identity.** Even for the default preset, the snapshot was registration-ordered, carried human-facing descriptions and file mtimes, and had no digest. Two instances with identical capabilities produced different listings; one instance whose tool description was reworded produced a different listing too. Nothing in it could serve as a factor.

**Presets do not reach the subjects.** A preset composes the *evaluation instance's own* planning agent and its in-process children. It reaches none of the four delegated CLIs. And the sub-dsh — the one subject whose composition this family does write — composed no roster at all: the headless bundle's agent loader read the model-facing rows off the global layer (`local-agent-dsh-headless/src/agent-loader.ts`, "This bundle composes no preset roster"). So "one harness under two presets" (pilot D) was not true of any subject under test, not even the one we build ourselves.

## Decision

### The fingerprint lives in the catalog, and it is a projection

`hashOf(snapshot)` is sha256 over the canonical JSON of a canonical form, and the canonical form is a deliberate projection of the snapshot:

| Row | Enters | Does not |
|---|---|---|
| skill | `name`, `source`, sha256 of the SKILL.md body | `description`, `whenToUse`, `provider`, `updatedAt` |
| tool | `name`, `channel`, `parameters` | `description`, `confidence`, `owner` |
| mcpServer | `name`, its tool NAMES | the tool count |
| channel | the names | the counts |

Every list is sorted by name, so registration order cannot move the digest. The exclusions are the substance of the decision: **prose is not a capability.** Rewording a tool description changes what the model reads, not what it can do, and a factor that moves when someone fixes a typo cannot be held still across a run. A skill's BODY is the opposite — it is the procedure the model executes — so it enters as a sha rather than being excluded with the rest of the text. `updatedAt` is a filesystem fact: touching a file must not mint a new subject. An MCP server contributes its tool names rather than its count, because a server that swapped one tool for another keeps the count and changes the face.

The hash is written `caps:<sha256>`. A snapshot's own `sha` field is not part of what it digests, so hashing is idempotent.

### Two verbs, one for listing and one for identity

`snapshotFor(presetId?, workdir?)` is the fingerprint verb: it resolves the preset's standing scope through the roster face the host line offers — `standingKeyFor(presetId ?? defaultId)` on 0.1.5, the leased `acquireScope` on rc.1 (see [the rc.1 leased-scope note](../../implemented/bug-fix/2026-09-24-capability-catalog-rc1-leased-scope.md)) — reads the skill and tool registries at that scope, loads every skill body so the rows carry `bodySha`, and stamps `sha`. `snapshot()` stays the listing verb — the same rows, no body loads, no digest — because the settings card wants a listing and paying one registry load per skill to draw a grid is a cost with no buyer. `list_capabilities` reports the full face's tag as `capabilities` even when the caller filtered its answer to skills or tools: the tag names the instance, not the question asked of it.

**A listing degrades; a fingerprint refuses** (`resolvePresetScope`). When the preset's scope will not resolve — no roster, unknown id, a composition that fails to mount — `snapshot()` falls back to the global layer and carries NO `preset` label, because a settings card must not blank over one bad row and an unlabelled global reading is honest. `snapshotFor()` throws, naming the preset and the reason. The first machine run of this change is why the rule is written down: on a real sub-dsh whose preset carried one invalid persona row, the degrading version handed two scopes rostering two DIFFERENT presets one identical hash, labelled with each scope's own preset name, and nothing said a word. A fingerprint that degrades is not a weaker fingerprint, it is a false one.

Two costs are stated rather than hidden. Fingerprinting loads one skill body per skill. And asking for a preset nothing has composed yet MOUNTS it, because the roster's standing mount is what "that preset's scope" means.

### The sub-dsh's scope directory becomes its capability face

`provisionDshSubProfile(homeDir, { preset })` appends one more patch operation to the sub-profile's `cordis.patch.yml`: an `insert` row mounting `@deepseek-ai/dsh-agent-presets` with `default: <id>`. The headless agent loader joins it inside `setup` (`joinSubDshPreset`), before the agent is published, so the preset's tools and prompt sections exist before the first prompt assembly. Without the layer nothing changes — byte for byte the rosterless behavior, which is the right answer for a composition that has no roster.

Where the preset directories come from needed no new mechanism: the sub-dsh launches with `DSH_HOME` pointed at the scoped home, so the roster's own derived user root is `<scoped home>/.agent-presets`. A scope gets a preset of its own by having a preset directory there.

The generated layer is also a PARSEABLE layer: `readSubProfilePreset(homeDir)` reads the id back out of the file, so "which preset does this scope run" is answerable without booting anything.

### The contract: who may declare a preset, and what must back it

- **`PRESET_CAPABLE_HARNESSES = ['dsh']`.** A preset is a composition this family provisions, and the sub-dsh's sub-profile is the only composition it writes. A `preset` on `codex` / `claude-code` / `kimi` is a validate ERROR (`PRESET_NOT_FOR_HARNESS`), not a warning: it would put a factor into the condition hash that nothing writes and nothing can check. An unknown harness is left alone — degrade, don't explode. Their equivalent, `skills.pack`, is not provisioned by this family either; that stays I6, and the error message says so.
- **The lock's `provisioned` block gains two fields** (protocol **v1-rev10**, additive within T31's additive block): `preset`, read back from what was written, and `capabilities` carrying `{sha, preset?, skills?, tools?}`. `conditions provision` — T31's writer, and still the only one — records them as its step 5. The MEASUREMENT is a hook (`ProvisionOptions.capabilities`), because measuring a sub-dsh's face means booting its sub-profile and asking the catalog mounted inside it, a launch path provision deliberately does not own. With no hook, a condition declaring a preset is still locked (the scope was checked) but carries no capability record and is warned about by name (`CAPABILITIES_UNMEASURED`); the readiness gate then refuses it. Loud at both ends beats a lock that reads as verified.
- **What was measured beats what was declared.** When the probe reports a different preset than the condition declares, the lock records the MEASURED one and provision warns — recording the declaration would erase the only evidence the two disagree.
- **Readiness refuses an unbacked claim.** `capabilityRefusal` runs before the probe delegation: a declared preset with no capability record fails the condition (`the capability face was never measured`), and a record taken under a different preset fails it too (`the provisioned environment belongs to another subject`). It costs no tokens — it reads the lock, not the machine — and it runs beside the delegation probe because it answers the same question: is this subject the one the declaration names?

### The orchestrator's own hash is provenance, and only that

`run.meta.orchestrator.capabilities` records the evaluating instance's own face: `{sha, preset?, skills, tools}`. The report's 程序一致 invariant lists it and compares nothing against it. The orchestrator answers none of the dataset's questions, so making its capabilities a pass/fail input would turn "we upgraded the planning agent" into a violated invariant on a run whose subjects never changed. A composition without a catalog records no line, and a catalog that throws costs the run nothing.

### eval computes no capability hash

eval imports no sibling `@khorsheed` package, so it records digests and never recomputes them: the canonical form is the catalog's contract. The `canonicalJson` helper exists byte-identically in both packages, pinned by each side's own tests — the duplication the independence rule buys.

## Real-machine verification

A private toolchain (npm `@deepseek-ai/dsh@0.1.5-rc.1` plus local tarballs of this repo's two packages, so every module resolves from ONE installation), three sub-dsh scoped homes under a scratch homes root, each provisioned by `provisionDshSubProfile`. The scopes' `cordis.patch.yml` files differ in exactly one line — the roster's `default:`. The catalog was mounted in each sub-profile for the run (identically in all three) and read through a zero-import probe row, so the face comes from the real booted composition and costs no model call.

| Check | Result |
|---|---|
| Two rosters, two faces | `eval-lean` → `caps:b140934bbc4b…` with skills `[eval-planning]`; `eval-full` → `caps:3f3b4e781741…` with `[eval-analysis, eval-planning]` |
| The preset NAME is not a capability | a third scope carrying eval-lean's content under the id `renamed-lean` hashes to `b140934bbc4b…` — byte-identical to scope A |
| Rewording a description does not move it | editing the skill's `description:` in place left `b140934bbc4b…` unchanged |
| Editing the body does | changing one sentence of the SKILL.md body moved it to `4b8346cf27b8…` |
| A fingerprint refuses a broken preset | with one invalid persona row: `snapshotFor` throws `cannot fingerprint preset "renamed-lean": … failed to mount`, while `snapshot()` returns the global-layer listing with `preset: null` |
| The roster resolves from the installation anchor | no `@deepseek-ai` link in any sub-profile; `@deepseek-ai/dsh-agent-presets` loaded from the dsh installation beside `dsh-base` |

Two facts the run established that the unit tests could not. First, the degrade-vs-refuse defect above — found only because two scopes that must differ did not. Second, **a preset cannot take capabilities away from a sub-dsh**: `dsh-base` mounts the whole model-facing tool set at the profile root, and a preset composes rows, it does not filter the root. Both scopes carry the same 26 tools; their faces differ in the skills their presets register. So pilot D's two conditions differ in what their presets ADD — which is a real factor and the one this apparatus can honestly offer, but it is not "the same harness with a smaller tool set".

The delegated round ("ask each sub-dsh what tools it has") was NOT run: this machine has no DeepSeek credential outside the production home, which is out of scope for this task. The probe reads the same capability face that round would have described, from the same booted composition, and more precisely than a model's prose — but it does not prove the model's prompt assembly sees it, so that remains unverified here.

## What pilot D can now say

"One harness under two presets" is now a statement about the sub-dsh: two dsh conditions, two scopes, two sub-profile rosters, everything else identical. Two rosters produce two capability hashes, and two capability hashes are two subjects. That is the only shape of the pilot this decision supports — presets still do not reach the three external CLIs, and saying so in `validate` is how the apparatus stops promising otherwise.

## Testing

- `capability-catalog/tests/capabilities.spec.ts`: the canonical form's field selection per row kind; sorting; `null` for an absent body sha or parameter schema; MCP tool names; the four stability claims (same content in a different registration order hashes alike; a reworded tool description and a touched mtime do not move it; a changed parameter schema and a changed skill body do); idempotence over a snapshot that already carries `sha`; the digest equals sha256 of the canonical JSON verbatim; and `catalogSnapshot`'s two modes, including a skill the registry declines to load. `resolvePresetScope` covers the listing/fingerprint split: the label set only on a resolved scope, all three degrade shapes, all three strict refusals, and a rosterless composition still fingerprinting its default face.
- `local-agent-dsh/tests/provision.spec.ts`: no layer without a preset; the appended `insert` operation and the bundle's own list surviving ahead of it; two scopes differing only in preset producing two patches; explicit roots and the derived-root switches; a refused preset id; idempotence; NO `@deepseek-ai` copy linked into the sub-profile (the roster is an official package and a second copy would bring a second cordis); and the layer disappearing when the preset is withdrawn.
- `local-agent-dsh-headless/tests/preset-join.spec.ts`: the join and the id it reports, the two no-op shapes, and a refusing roster propagating rather than degrading.
- `eval/tests/capabilities.spec.ts`: `PRESET_NOT_FOR_HARNESS` for each external CLI and its absence for dsh and for an unknown harness; `conditions provision` recording a measured face and `resolveConditionReadiness` reading it back; silence (not `preset: null`) for a condition that declares none; `CAPABILITIES_UNMEASURED` with no probe and with a throwing probe; the measured-beats-declared rule; `capabilityRefusal`'s four cases; and `checkReadiness` failing an unmeasured preset with a facade whose `start` throws if called.
- `eval/tests/run.spec.ts`: `run.meta.orchestrator.capabilities` recorded once per run, absent without a catalog, and a throwing catalog costing the run nothing.
- `eval/tests/report.spec.ts`: the caps line under 程序一致, and its absence on a run that recorded none.
- `eval/tests/protocol.spec.ts`: the v1-rev10 lock schema against both protocol editions, plus a second published lock example (a provisioned sub-dsh condition) pinned to its own fixture.

## Landing on top of T31

T31 (`conditions provision`) merged to main while this branch was in flight, and both tasks reach for the lock's `provisioned` block. The reconciliation is the obvious one, recorded because a future reader will find two tasks' fields in one object: T31 owns the WRITER and the block's required fields (`at`, `cliVersion`, `effective` — what the scope answered), and T32 adds two optional fields to it (`preset`, `capabilities` — what the environment composes). This branch's own draft lock-writer (`conditionLockOf` / `writeConditionLock`) was deleted rather than merged: one writer was T31's whole point, and a second one would have let a lock be minted without the credential and effective-settings checks that make the first one worth trusting.

## Alternatives considered

**Put the canonical form in eval and let it hash the catalog's snapshot.** Rejected. eval would then own a projection of a type it does not define, and every catalog row added later would silently enter or miss the digest depending on which package was updated. The face belongs to the package that produces it; eval records the digest it is handed. The cost is a duplicated `canonicalJson`, which is nine lines and pinned by tests on both sides.

**Include tool descriptions in the hash.** Rejected, and it is the decision most likely to be re-litigated. A description IS part of what the model sees, so excluding it means two instances can hash alike while prompting differently. But a factor exists to be held still across a run, and descriptions are edited constantly — by upgrades, by typo fixes, by translation. A hash that changes on a reworded sentence would report a new subject every release, and the honest reading of those reports would be to ignore them. Parameters are where a tool's actual contract lives, and they are in.

**Exclude skill bodies too, for symmetry with descriptions.** Rejected. A skill's body is not prose about a capability, it IS the capability — the procedure the model executes when it loads the skill. Excluding it would let a condition swap a skill's entire content and keep its identity.

**Give `snapshot()` the fingerprint unconditionally, so there is one verb.** Rejected on cost, narrowly. Fingerprinting loads every skill body through the registry; the settings card draws a grid and needs none of them. Two verbs with one shared body keeps the listing path exactly as cheap as it was, and the fingerprint honest about what it pays for.

**Compute the sub-dsh's capability hash by launching it (`dsh --profile <sub> --capabilities`).** Deferred, deliberately. It is the most faithful measurement — the sub-dsh's real composition is dsh-base plus the headless patch plus the roster, which the orchestrating instance does not replicate — but it needs a new headless launch flag, a JSON stdout contract, and `capability-catalog` mounted inside the sub-profile. What this change delivers instead is the seam: `snapshotFor(presetId)` exists, the lock field exists, the readiness check exists, and `conditions provision` (T31) decides how it measures. Anyone wiring that measurement should read this paragraph first: the hash's meaning depends on which composition it was taken in, and a hash taken in the wrong composition is worse than none.

**Make the sub-dsh's preset a plugin config key on `local-agent-dsh`.** Rejected: a plugin config is instance-wide, and the whole point is a per-scope preset. The roster is written through the exported `provisionDshSubProfile`, which a caller with per-condition knowledge invokes; the harness's own `provision` hook keeps calling it without a preset, so the default scope is unchanged.

**Warn instead of erroring on a preset for an external CLI.** Rejected. A warning is the right severity for "not resolved yet"; this is "cannot ever be resolved by this apparatus". The field would still enter the condition hash and still split one subject into two, and the author would have no way to learn that from a line in a warning list they already scroll past.

**Refuse the run (rather than the condition) when a preset is unbacked.** Rejected: the readiness gate already has the right granularity. A failed condition refuses the run by default and is recorded as `cell-skipped` under `--ignore-readiness`, which is the existing escape hatch for an operator who knows what they are doing.

## Consequences

- A condition may now declare a preset that something can disagree with, and pilot D has a shape that is true of a real subject.
- `CatalogSkillRow` gains `bodySha` and `CapabilityCatalogSnapshot` gains `sha` / `preset`; all three are optional, so every existing reader is unaffected.
- The protocol goes to **v1-rev10**. Adding `provisioned` to a lock does not change any condition hash — the lock is not hashed — so no existing condition is re-provisioned by this change alone. A condition that ADDS a `preset` changes its hash, which is the existing "adding a factor re-provisions" rule.
- Any condition already declaring a non-null `preset` on an external CLI now fails validation. Nothing in the dataset repository does; the refusal is what a future author gets instead of a silent fiction.
- The sub-dsh gives up nothing when it rosters no preset, and a rosterless composition is still the default everywhere.
- **A preset cannot take capabilities AWAY from a sub-dsh.** `dsh-base` mounts the model-facing tool set at the profile root, and a preset composes rows rather than filtering the root, so two sub-dsh presets differ in what they ADD. Pilot D's two conditions are therefore "the same tools plus different skills", not "a smaller tool set" — a real factor, and the one this apparatus can honestly offer today. Narrowing a sub-dsh's tool set would mean moving `dsh-base`'s model-facing rows into presets, which is a host-side change.
- The measurement itself — how a sub-profile's capability hash is actually taken on a real machine — is T31's, and this note's alternatives section records the constraint it must respect.
