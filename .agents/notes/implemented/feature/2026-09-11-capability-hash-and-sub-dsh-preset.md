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

`snapshotFor(presetId?, workdir?)` is the fingerprint verb: it resolves `standingKeyFor(presetId ?? defaultId)`, reads the skill and tool registries at that scope, loads every skill body so the rows carry `bodySha`, and stamps `sha`. `snapshot()` stays the listing verb — the same rows, no body loads, no digest — because the settings card wants a listing and paying one registry load per skill to draw a grid is a cost with no buyer. `list_capabilities` reports the full face's tag as `capabilities` even when the caller filtered its answer to skills or tools: the tag names the instance, not the question asked of it.

Two costs are stated rather than hidden. Fingerprinting loads one skill body per skill. And asking for a preset nothing has composed yet MOUNTS it, because the roster's standing mount is what "that preset's scope" means.

### The sub-dsh's scope directory becomes its capability face

`provisionDshSubProfile(homeDir, { preset })` appends one more patch operation to the sub-profile's `cordis.patch.yml`: an `insert` row mounting `@deepseek-ai/dsh-agent-presets` with `default: <id>`. The headless agent loader joins it inside `setup` (`joinSubDshPreset`), before the agent is published, so the preset's tools and prompt sections exist before the first prompt assembly. Without the layer nothing changes — byte for byte the rosterless behavior, which is the right answer for a composition that has no roster.

Where the preset directories come from needed no new mechanism: the sub-dsh launches with `DSH_HOME` pointed at the scoped home, so the roster's own derived user root is `<scoped home>/.agent-presets`. A scope gets a preset of its own by having a preset directory there.

The generated layer is also a PARSEABLE layer: `readSubProfilePreset(homeDir)` reads the id back out of the file, so "which preset does this scope run" is answerable without booting anything.

### The contract: who may declare a preset, and what must back it

- **`PRESET_CAPABLE_HARNESSES = ['dsh']`.** A preset is a composition this family provisions, and the sub-dsh's sub-profile is the only composition it writes. A `preset` on `codex` / `claude-code` / `kimi` is a validate ERROR (`PRESET_NOT_FOR_HARNESS`), not a warning: it would put a factor into the condition hash that nothing writes and nothing can check. An unknown harness is left alone — degrade, don't explode. Their equivalent, `skills.pack`, is not provisioned by this family either; that stays I6, and the error message says so.
- **The lock gains `provisioned`** (protocol **v1-rev10**): `provisioned.preset` is read back from the sub-profile that was written, and `provisioned.capabilities` carries `{sha, preset?, skills?, tools?}`. `writeConditionLock` owns the file and the shape and nothing else — it provisions no environment and computes no hash — so the lock's contract is testable without a machine, and `conditions provision` (T31) is its caller.
- **Readiness refuses an unbacked claim.** `capabilityRefusal` runs before the probe delegation: a declared preset with no capability record fails the condition (`the capability face was never measured`), and a record taken under a different preset fails it too (`the provisioned environment belongs to another subject`). It costs no tokens — it reads the lock, not the machine — and it runs beside the delegation probe because it answers the same question: is this subject the one the declaration names?

### The orchestrator's own hash is provenance, and only that

`run.meta.orchestrator.capabilities` records the evaluating instance's own face: `{sha, preset?, skills, tools}`. The report's 程序一致 invariant lists it and compares nothing against it. The orchestrator answers none of the dataset's questions, so making its capabilities a pass/fail input would turn "we upgraded the planning agent" into a violated invariant on a run whose subjects never changed. A composition without a catalog records no line, and a catalog that throws costs the run nothing.

### eval computes no capability hash

eval imports no sibling `@khorsheed` package, so it records digests and never recomputes them: the canonical form is the catalog's contract. The `canonicalJson` helper exists byte-identically in both packages, pinned by each side's own tests — the duplication the independence rule buys.

## What pilot D can now say

"One harness under two presets" is now a statement about the sub-dsh: two dsh conditions, two scopes, two sub-profile rosters, everything else identical. Two rosters produce two capability hashes, and two capability hashes are two subjects. That is the only shape of the pilot this decision supports — presets still do not reach the three external CLIs, and saying so in `validate` is how the apparatus stops promising otherwise.

## Testing

- `capability-catalog/tests/capabilities.spec.ts`: the canonical form's field selection per row kind; sorting; `null` for an absent body sha or parameter schema; MCP tool names; the four stability claims (same content in a different registration order hashes alike; a reworded tool description and a touched mtime do not move it; a changed parameter schema and a changed skill body do); idempotence over a snapshot that already carries `sha`; the digest equals sha256 of the canonical JSON verbatim; and `catalogSnapshot`'s two modes, including a skill the registry declines to load.
- `local-agent-dsh/tests/provision.spec.ts`: no layer without a preset; the appended `insert` operation and the bundle's own list surviving ahead of it; two scopes differing only in preset producing two patches; explicit roots and the derived-root switches; a refused preset id; idempotence; the roster symlink; and the layer disappearing when the preset is withdrawn.
- `local-agent-dsh-headless/tests/preset-join.spec.ts`: the join and the id it reports, the two no-op shapes, and a refusing roster propagating rather than degrading.
- `eval/tests/capabilities.spec.ts`: `PRESET_NOT_FOR_HARNESS` for each external CLI and its absence for dsh and for an unknown harness; the lock shapes (hash alone, full `provisioned`, malformed digests refused); the round trip through `resolveConditionReadiness`; both capability warnings; `capabilityRefusal`'s four cases; and `checkReadiness` failing an unmeasured preset with a facade whose `start` throws if called.
- `eval/tests/run.spec.ts`: `run.meta.orchestrator.capabilities` recorded once per run, absent without a catalog, and a throwing catalog costing the run nothing.
- `eval/tests/report.spec.ts`: the caps line under 程序一致, and its absence on a run that recorded none.
- `eval/tests/protocol.spec.ts`: the v1-rev10 lock schema against both protocol editions, plus a second published lock example (a provisioned sub-dsh condition) pinned to its own fixture.

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
- The measurement itself — how a sub-profile's capability hash is actually taken on a real machine — is T31's, and this note's alternatives section records the constraint it must respect.
