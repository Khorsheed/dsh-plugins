# Agent Note: the sub-dsh's preset travels inside the scope directory

Status: implemented

English | [中文](2026-09-18-sub-dsh-preset-in-scope.zh.md)

## Problem

A condition's `preset` became a checkable factor in T32 and got its measurement in T32b, and pilot D — the run that exists to prove "two subjects differing in exactly one factor, and that factor is the capability face" — still could not execute it. T33c stopped at the readiness gate with no token spent, because two requirements met head-on.

**The measurement wanted the preset in the deployment's preset root.** `instanceCapabilityProbe` measures through the evaluation instance's own capability catalog, which resolves a preset id through the *instance's* roster roots. A scope holding its own `<scope>/.agent-presets/<id>` would then be one preset while the hash described another, silently — so `scopeDefersToInstancePresets` refused to measure whenever the scope kept a copy of its own.

**The unit only has the scope.** A cell's unit bind-mounts exactly one directory, this condition's scoped home (`dsh@d-lean -> /creds/dsh`), and the plan's `unit` segment is `additionalProperties: false`. A roster whose `roots` named the host's preset root therefore named a path the unit did not have:

```
dsh: agent-presets: preset "eval-lean" not found (available: standard, ptc, minimal, cordis)
```

So the host round resolved the preset and could not verify its environment fingerprint, the container round verified the fingerprint and could not resolve the preset, and pilot D's criterion — *two capability hashes differ **while** the environment is one* — was missing a different half on each path.

The root cause was smaller than it looked, and it was not the roster. `@deepseek-ai/dsh-agent-presets` already derives a user root of `<$DSH_HOME>/.agent-presets`, and the sub-dsh runs with `DSH_HOME` pointed at the scoped home — `<scope>/.agent-presets` on the host, `/creds/dsh/.agent-presets` in the unit, **one directory, because the unit binds the scope**. What pushed `roots` out to the deployment's root was the T32b guard, and the guard was protecting against a copy nobody had checked.

Two facts had changed since T33c. Presets are under version control (`6b8a919a`): a deployment's roster is synchronized from a git original, so an instance's preset root is a *deployment copy*. And pilot D's two presets pinned `customSkillDirs` to an absolute path under that root — which no relocation of the preset can leave true.

## Decision

**The scope carries its own copy of the preset, that copy is the subject, and "the scope must keep no copy" is replaced by "the scope's copy must be byte-identical to the one the catalog measures."**

1. **The snapshot.** `<scope>/.agent-presets/<id>` is a byte-for-byte copy of `<deployment preset root>/<id>` — real files, never a symlink (`hashPresetTree` and `hashHome` both refuse one, and a symlink to a host path is exactly what does not survive a bind mount).
2. **The roster layer writes no `roots`.** With the roster's own derived user root, the host and the unit resolve the same `<$DSH_HOME>/.agent-presets/<id>` — one resolution rule instead of two.
3. **The guard changed meaning, not strength.** `scopeDefersToInstancePresets` is now `scopeKeepsOwnPreset`. A scope that keeps no copy is measured exactly as T32b measured it (`source: "instance-root"`), with the probe logging that a unit will not resolve it; a scope that keeps one is measured only when the provisioning that made it reports it byte-identical (`source: "scope-snapshot"`).
4. **eval's unit vocabulary is untouched.** One mount, the same environment fingerprint, no new field on the `unit` segment, no plan-contract change.

### Why measuring the deployment's copy still answers for the scope's

The catalog has no verb for "fingerprint the preset in this directory", and this change does not add one. It does not need one, because **the canonical capability face carries no filesystem path**: `canonicalCapabilities` projects a skill to `{name, source, body-sha}` — `source` being the root's channel label (`custom`), not where that root is — a tool to `{name, channel, parameters}`, an MCP server to its tool names, a channel to its name. Two byte-identical preset directories in two places hash identically.

That is not a deduction from the code alone. T32's own machine run measured it from the other side, for an adjacent reason: a third scope carrying `eval-lean`'s content under the id `renamed-lean` hashed byte-identically to the scope holding `eval-lean`. The preset's *name* is not a capability, and neither is its *location*.

So byte-equality is what transfers the measurement from the copy the catalog can read to the copy the sub-dsh runs, and proving that equality is the guard's job. This is a second compromise stacked on T32b's first one — the instance composes the face, not the sub-dsh — and like that one it is stated in the module doc and both READMEs.

### The relocation rule: `customSkillDirs` may not be an absolute path

`skill-filesystem` applies `resolve()` to each `customSkillDirs` entry, so an absolute path is taken as written and a bare relative path resolves against `process.cwd()` — neither relocates. A composition row's config may instead carry a `!!js` expression, which the loader evaluates as `with (ctx) { eval(expr) }` (`vendor/loader/src/config/utils.ts`) while `Include` sets that context's `baseUrl` to the composition file's own directory (`vendor/include/src/index.ts`). The shipped `cordis` preset spells it:

```yaml
customSkillDirs:
  - !!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"
```

One literal string that is correct in the deployment's root, in the scope, and at `/creds/dsh/.agent-presets/<id>/skills` inside the unit.

The rule is therefore written down as a rule: **a preset used as an evaluation factor may not name an absolute filesystem path in its composition.** It is refused at both ends — `snapshotScopePreset` will not copy such a composition, `scopePresetProblem` will not let one be measured — because the copy and the measurement are the two places a wrong answer would be minted, and either end alone leaves one way in (a copy placed by hand; a deployment preset edited after it was copied). Both scans parse the YAML keeping `!!js` expressions as source text (evaluating one would run preset text as code in the host process) and report nothing for a composition they cannot parse: the loader owns that verdict.

### Who writes what, and the restart landmine that decided it

`provisionDshSubProfile` regenerates `cordis.patch.yml` whole, and the local-agent registry runs a scope's `provision` hook **once per (harness, scope) per host process**. A hand-written roster layer is therefore erased by the next restart, silently, and the next provision reports "the scoped home rosters no readable preset". Pilot D's apparatus was hand-written and survived only because nothing re-materialized those two scopes in between.

So the preset a scope composes is readable **from the scope**, the same way its roster layer and its permission boundary already are:

- **`<scope>/sub-profile.json`** carries `{"preset": "<id>"}`. `provisionDshScope` resolves the preset as *explicit argument → scope file → plugin config*, and persists an explicit argument into the file. A declaration that is unreadable — absent, malformed, an id that is not a directory name — falls back to the deployment's answer rather than failing the provisioning.
- **`LocalAgentHarness.provision` takes `(homeDir, options?)`** and may return a read-back; the registry gained `provisionScope(name, scope?, options?)`. The other three harnesses take the parameter and ignore it, so their provisioning is byte-identical. `provisionScope` differs from materialization in three ways that are the reason it exists: it awaits (including the materialization it may have just started, since both writers write the same files), it propagates the failure, and it returns what the scope now holds.
- **`conditions provision` calls it** for a condition that declares a preset, as step 3b — *before* the home hash, because the scope's copy of the preset is inside the scoped home. A facade without the verb degrades to reading back whatever is there, which is what every preset condition did before. A call that throws is a `SCOPE_NOT_PROVISIONED` warning, not a stopped provision: the read-back, not the call's outcome, decides whether this condition has a subject.

This is also the fix for pilot D's first recorded defect. `local-agent-dsh`'s config is instance-global, so "two scopes rostering two presets" was unexpressible; with the per-scope file and the verb, the condition document decides, which is where an evaluation's factors belong.

**The snapshot is refreshed only by an explicit `preset` request** — in practice `conditions provision`, the act that mints a new lock and therefore the right moment to pick up an edited original. Every other provisioning copies only when the directory is absent, and otherwise leaves it alone and reports whether it still matches. Nothing may move the subject under a run.

`eval` writes nothing into the scope.

### The lock, and the one thing it does not record

`provisioned.capabilities` carries two more keys (protocol **v1-rev12**, additive inside T31's additive block):

- `snapshot: {sha}` — sha256 over the whole `<scope>/.agent-presets/<id>` subtree, **every** file including `SKILL.md`, in `hashHome`'s stream shape. `home.sha` hashes only config-suffixed files, so a skill body edit moves nothing it records; this is what sees it, offline.
- `source: "scope-snapshot" | "instance-root"` — which mode transferred the measurement.

**Not the deployment root's path.** The lock is reviewed data committed to the dataset repository, and `unit.ts`'s standing rule is that no host path appears in one. The content hash is better provenance anyway: a path says where someone looked, the hash says the two copies agreed.

One consequence falls out: the snapshot's `agent.cordis.yml` and `preset.yml` are `.yml` files inside the scoped home, so **`home.sha` now moves with the preset too**. Two conditions differing in preset are separated by `home.sha` for a sharper reason than before, and an edited preset re-hashes the condition.

### Readiness and validate, and a gap T32b could not close

The readiness gate re-hashes the scope's copy and refuses a disagreement — "the preset this scope runs changed after provision" — with no catalog, no delegation and no tokens. The existing catalog re-measure is unchanged and still answers its own question. An absent re-hash leaves the locked record standing, exactly as an absent re-measure does.

`resolveConditionReadiness` takes an optional `scopeHomeDir` resolver and does the same check offline, which `EvalService` supplies from the mounted local-agent facade for `validatePlan` and `listConditions`. That closes what T32b recorded and could not close — *"validate still reports the stale lock ready … it is offline and cannot measure"* — for the skill-body edit: validate cannot measure a capability face, but it can hash a directory. Without a resolver (the pure CLI) it behaves byte-identically to before.

### What does not change

A condition that declares no `preset` reaches none of this: `provisionScope` is called only for a preset-declaring condition, the guard is consulted only for one, and the new lock keys appear only with a snapshot. `presetRosterLayer(undefined)` still returns `''`, and a scope that composes no preset gets no copy, no declaration file and no roster layer — pinned by a test over the generated patch.

## Alternatives considered

**Bind-mount the deployment's preset root into the unit (the brief's fallback).** The `unit` segment is `additionalProperties: false`, so this is a plan-contract change; the plan is reviewed data and may not carry a host path, so the path would have to come from a new facade verb and be injected by eval; `unit.ts`'s "exactly one mount" contract becomes two and the environment fingerprint has to account for the second mount correctly. And the roster keeps naming a host path, so the arrangement dies the day the original moves or a deployment's `DSH_HOME` differs. Its single advantage — an absolute `customSkillDirs` keeps working — is removed by the relocation rule, using an idiom the shipped `cordis` preset already proves. Rejected; it remains the answer only if the `!!js` evaluation turns out not to hold.

**A catalog verb that fingerprints a preset at a given directory.** It would measure the scope's copy directly instead of by equality, and it is the honest shape of the question. It costs `capability-catalog`'s service face, its `@Remote` surface, eval's face, and a roster mount path for an ad-hoc root — for a property byte-equality already provides, on a measurement that is itself a stated compromise and is scheduled to be replaced by the in-scope measurement. It is the thing to build if a factor ever needs a preset that exists only in a scope.

**Teach the roster's `roots` a path that is right on both sides.** The roster expands a leading `~` and nothing else, and the only path that is right on both sides is `$DSH_HOME/.agent-presets` — the derived user root. This alternative collapses into the decision.

**Symlink the scope's copy at the deployment's root.** `hashHome` skips symlinks and counts them denied, so the subject would stop being hashed; a symlink pointing at a host path resolves to nothing inside the unit.

**Let eval write the roster layer itself.** Rejected for the reason T32b recorded for reading it: the patch format belongs to `local-agent-dsh`, which regenerates the file on materialization and on every host round. A second writer of a file another package heals is a drift generator.

**Express the per-scope preset in the plugin's instance-global config (`presetByScope`).** The factor would live in the instance's settings rather than in the dataset, and it would not ride the bind mount. The scope directory has both properties, which is why the roster and the permission boundary already live there.

**Heal a drifted copy silently instead of reporting it.** Rejected: a scope whose copy has drifted from the deployment's is a fact the measurement has to see. Healing it would make the subject move under a run, and the drift would never reach a lock or a readiness refusal.

**Keep the T32b guard and accept that preset conditions are host-only.** This was the state pilot D stopped in, and it makes the pilot's criterion unprovable on either path.

## Testing

- `packages/local-agent/tests/scoped-home.spec.ts`: `provisionScope` waits for the materialization it may have started (both calls are observed, in order, the first with no options), returns the harness's read-back, propagates the harness failure, and is a no-op that still resolves the directory for a harness with no hook.
- `packages/local-agent-dsh/tests/scope-preset.spec.ts`: the scope declaration round-trips and is idempotent, and every unreadable shape falls back; `compositionAbsolutePaths` passes the `baseUrl` idiom, catches a plain absolute string and one hidden inside an expression, and reports nothing for unparsable YAML; `snapshotScopePreset` copies byte for byte, leaves an existing copy alone while REPORTING a disagreement, re-syncs on refresh, writes nothing when a refresh changes nothing, and refuses an absolute path, a missing source and a tree containing a symlink; `provisionDshScope` rosters with no `roots`, reproduces the preset with no options at all (the restart path), honours the three-level resolution order, and leaves a preset-less scope byte-identical.
- `packages/eval/tests/preset-snapshot.spec.ts`: the digest is content-addressed (same bytes, two places, two names, one hash), moves on a skill-body edit, counts every file, and refuses a symlinked or absent tree; the composition scan and `scopePresetProblem` both ways.
- `packages/eval/tests/capability-probe.spec.ts`: `scopeKeepsOwnPreset` both ways; the probe measures `instance-root` for a deferring scope, refuses a copy nothing vouched for and one reported as not matching (the catalog is proven never to be asked), refuses a vouched-for copy naming an absolute path, and records the tree digest and `source` for a vouched-for one; provision composes the condition's preset before hashing the home (and the write-back records the home hash that includes it), never composes for a preset-less condition, reports a failed composition as `SCOPE_NOT_PROVISIONED` and still provisions from what the scope holds, and degrades against a facade with no verb; `capabilityRefusal` on the snapshot digest three ways; `checkReadiness` fails a condition whose scope copy changed with no delegation and no catalog at all.
- `packages/eval/tests/capabilities.spec.ts`: the offline read-back — ready while unchanged, `CAPABILITIES_SNAPSHOT_STALE` after a skill-body edit, and silent without a resolver.
- `packages/eval/tests/protocol.spec.ts` pins the published lock schema and its example against the code.

## Consequences

- A condition declaring a preset is runnable on the container path, which is what pilot D needed and what nothing in the repository could offer.
- The preset a scope composes is a property of the condition document, not of the deployment's plugin settings, and it survives a restart of the instance. Pilot D's first recorded defect is closed.
- A preset used as a factor must be relocatable. Pilot D's two presets each carried an absolute `customSkillDirs` and were rewritten to the `baseUrl` expression in the dataset repository; the two `caps` hashes do not move (the face has no path in it and the skills are unchanged) while both `home.sha` values do, because the copy now lives inside the scoped home.
- `validate` and `conditions list` can disagree with a stale lock for the first time, when they run somewhere with a local-agent facade. The pure CLI is unchanged, and the capability face still needs a live catalog.
- `local-agent-dsh` gained a `js-yaml` dependency for the composition scan, matching `local-agent-dsh-headless` and `eval`.
- Two packages now hold a preset-composition scanner and a directory hash apiece. eval imports no sibling, so the duplication is the price of that rule, and each side is pinned by its own tests — the same arrangement `canonicalJson` already has.
- Still deferred: the face measured is the instance's reading of the preset, not the sub-dsh's own composition. `capability-probe.ts` remains where the in-scope measurement replaces the instance read, and every lock written before it reads stale against it — which the readiness gate turns into "re-provision" rather than a silent mismatch.
