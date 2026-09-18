# Agent Note: the sub-dsh's preset travels inside the scope directory

Status: proposed

English | [中文](2026-09-18-sub-dsh-preset-in-scope.zh.md)

## Problem

A condition's `preset` became a checkable factor in T32 and got its measurement in T32b, and pilot D — the run that exists to prove "two subjects differing in exactly one factor, and that factor is the capability face" — still cannot execute it. T33c stopped at the readiness gate with no token spent, and the reason is two requirements meeting head-on.

**The measurement wants the preset in the instance root.** `instanceCapabilityProbe` measures through the evaluation instance's own catalog, which resolves a preset id through the *instance's* roster roots. A scope holding its own `<scope>/.agent-presets/<id>` would then be one preset while the hash described another, silently — so `scopeDefersToInstancePresets` refuses to measure whenever the scope keeps a copy of its own. The preset therefore may only live at `<dshHome>/.agent-presets/<id>`.

**The unit only has the scope.** A cell's unit bind-mounts exactly one directory, this condition's scoped home (`dsh@d-lean -> /creds/dsh`), and the plan's `unit` segment is `additionalProperties: false` — there is no field that could mount anything else. A roster whose `roots` name the host's preset root therefore names a path the unit does not have:

```
dsh: agent-presets: preset "eval-lean" not found (available: standard, ptc, minimal, cordis)
```

So the host round resolves the preset and cannot verify its environment fingerprint, the container round verifies the fingerprint and cannot resolve the preset, and pilot D's criterion — *two capability hashes differ **while** the environment is one* — is missing a different half on each path.

The root cause is smaller than it looks, and it is not the roster. `@deepseek-ai/dsh-agent-presets` already derives a user root of `<$DSH_HOME>/.agent-presets`, and the sub-dsh runs with `DSH_HOME` pointed at the scoped home on both paths — `<scope>/.agent-presets` on the host, `/creds/dsh/.agent-presets` in the unit, **one directory, because the unit binds the scope**. `provision.ts`'s own comment says as much: dropping a preset directory there is how a scope gets a preset of its own. What pushed `roots` out to the instance root was the T32b guard, and the guard was protecting against a copy nobody had checked.

Two facts have changed since T33c. Presets are now under version control (`6b8a919a`): the roster on a deployment is synchronized from a git original, so an instance root is a *deployment copy* of something the repository owns. And pilot D's two presets (`eval-lean`, `eval-full` in the dataset's `env/presets/`) each pin `customSkillDirs` to an absolute path under the instance root — which no relocation of the preset can leave true, and which therefore has to be answered before any of this works.

## Proposal

**Give the scope its own copy of the preset, make that copy the subject, and replace "the scope must keep no copy" with "the scope's copy must be byte-identical to the one the catalog measures."**

Four moving parts, none of which touches eval's mounts:

1. **The snapshot.** `<scope>/.agent-presets/<id>` is a byte-for-byte copy of the instance root's `<dshHome>/.agent-presets/<id>` — real files, never a symlink (`hashHome` counts a symlink as denied, and a symlink to a host path is exactly what does not survive a bind mount).
2. **The roster layer writes no `roots`.** With the roster's own derived user root, the host and the unit resolve the same `<$DSH_HOME>/.agent-presets/<id>` — one resolution rule instead of two, which is the whole point.
3. **The guard changes meaning, not strength.** `scopeDefersToInstancePresets` becomes `scopeSnapshotAgrees`: a scope that keeps no copy is accepted exactly as today (T32b's host-only apparatus keeps working, with a warning that it will not resolve inside a unit); a scope that keeps one must match the instance root's copy byte for byte, or the measurement is refused. Drift is still what gets caught — it is now caught by comparison rather than by prohibition.
4. **eval's unit vocabulary is untouched.** One mount, the same environment fingerprint, no new field on the `unit` segment, no plan-contract change.

### Why measuring the instance's copy still answers for the scope's

The catalog has no verb for "fingerprint the preset in this directory", and this proposal does not add one. It does not need one, because **the canonical capability face carries no filesystem path**. `canonicalCapabilities` projects a skill to `{name, source, body-sha}`, a tool to `{name, channel, parameters}`, an MCP server to its tool names, a channel to its name — and `source` is the root's channel label (`custom` for a `customSkillDirs` root), not where that root is. Two byte-identical preset directories in two places therefore hash identically.

That is not a deduction from the code alone; T32's own machine run measured it, for a reason that happened to be adjacent: a third scope carrying `eval-lean`'s content under the id `renamed-lean` hashed byte-identically to the scope holding `eval-lean`. The preset's *name* is not a capability, and neither is its *location*.

So byte-equality is what transfers the measurement from the copy the catalog can read to the copy the sub-dsh actually runs, and proving that equality is precisely what the guard is for. This is a second compromise stacked on T32b's first one — the instance composes the face, not the sub-dsh — and like that one it is stated in the module doc and the README rather than left to be discovered.

### The relocation rule: `customSkillDirs` may not be an absolute path

The route turns on this question, and the answer is that the loader already supports a preset-relative skill root, in the idiom the shipped `cordis` preset uses.

`skill-filesystem` applies `resolve()` to each `customSkillDirs` entry, so an absolute path is taken as written and a bare relative path resolves against `process.cwd()` — neither relocates. But a composition row's config may carry a `!!js` expression, which the loader evaluates as `with (ctx) { eval(expr) }` (`vendor/loader/src/config/utils.ts`), and `Include` sets that context's `baseUrl` to the composition file's own directory (`vendor/include/src/index.ts`; agent-presets' `mount.ts` and `specifier.ts` both rest on it). The shipped preset spells it:

```yaml
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    customSkillDirs:
      - !!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"
```

with the comment *"`baseUrl` is the preset's own directory, so the root resolves wherever the preset is installed"*. One literal string that is correct in the instance root, in the scope, and at `/creds/dsh/.agent-presets/<id>/skills` inside the unit. **No host-line work is required, and the fallback route is not needed on this account.**

The rule this buys is worth writing down as a rule: **a preset used as an evaluation factor may not name an absolute filesystem path in its composition.** An absolute path is the one thing that cannot be true in two places, and a preset carrying one is a subject that changes meaning when it is copied. It is refused at both ends — `local-agent-dsh` refuses to snapshot such a composition and names the idiom, eval's guard refuses to measure one — because the copy and the measurement are where a wrong answer would otherwise be minted. Pilot D's two presets each carry one such line today and must be rewritten; that is a dataset-repository edit, listed under acceptance.

### Who writes what, and the restart landmine that decides it

`provisionDshSubProfile` regenerates `cordis.patch.yml` whole, from the headless patch plus `presetRosterLayer(config.preset)` plus `permissionBoundaryLayer(config.permissions)`, and the local-agent registry runs a scope's `provision` hook **once per (harness, scope) per host process** — on the first call that names the scope. A hand-written roster layer is therefore erased by the next restart, silently, and the next provision reports "the scoped home rosters no readable preset". Pilot D's apparatus is hand-written and survives only because nothing re-materialized those two scopes in between. Any design that leaves the roster hand-written is a design that loses it.

So the preset a scope composes has to be readable **from the scope**, the same way its roster layer and its permission boundary already are — a file in the scope directory, so a scope bind-mounted into a unit carries its own composition with it:

- `<scope>/sub-profile.json` (name open), carrying `{"preset": "<id>"}`. `provisionDshSubProfile` resolves the preset as *explicit argument → scope file → plugin config*, and persists an explicit argument into the file. Restart-proof, idempotent, and readable by a person.
- `LocalAgentHarness.provision` widens to `(homeDir, options?)`, and the registry gains `provisionScope(name, scope, options?)` — re-run one scope's provisioning with per-scope options. The other three harnesses ignore the parameter and are byte-identical.
- `conditions provision` calls `provisionScope(harness, scope, {preset})` for a condition that declares a preset, before it reads the roster back. A facade without the verb degrades to today's behavior — read back whatever is there — so T32b's hand-made apparatus still measures.

This is also the honest fix for pilot D's 缺陷 1. `local-agent-dsh`'s config is instance-global, so "two scopes rostering two presets" was unexpressible and had to be hand-written; with the per-scope file and the verb, the condition document is what decides, which is where an evaluation's factors belong.

**The snapshot is refreshed only by `conditions provision`** (an explicit preset argument re-syncs it from the instance root). The registry's own materialization heals the roster layer and leaves the snapshot alone. Provision is the act that mints a new lock and is therefore the right moment to pick up an edited original; nothing else may move the subject under a run.

`eval` writes nothing into the scope, and does not learn the patch format any better than it already knows it.

### The lock, and the one thing it may not record

`provisioned.capabilities` gains two keys (schema **v1-rev12**, additive inside T31's additive block):

- `snapshot: {sha}` — sha256 over the whole `<scope>/.agent-presets/<id>` subtree, **every** file including `SKILL.md`, in `hashHome`'s stream shape (`<relPath>\0<content>\0`, sorted). `home.sha` deliberately hashes only config-suffixed files, so a skill body edit moves nothing it records; this is what sees it, offline.
- `source: "scope-snapshot" | "instance-root"` — which mode transferred the measurement.

**Not the instance root's path.** The brief asked for it; the lock is reviewed data committed to the dataset repository, and `unit.ts`'s standing rule is that no host path appears in one. The content hash is better provenance anyway: a path says where someone looked, the hash says the two copies agreed. A pack version can join it once a deployment reports one — nothing does today.

One consequence falls out for free: the snapshot's `agent.cordis.yml` and `preset.yml` are `.yml` files inside the scoped home, so **`home.sha` now moves with the preset too**. The two pilot-D conditions were already separated by `home.sha`; they are now separated by it for a sharper reason, and an edited preset re-hashes the condition, which the protocol document should say.

### Readiness, and a gap T32b could not close

- Readiness recomputes the scope snapshot's hash and refuses on disagreement — "the scope's preset snapshot changed after provision, re-provision". Offline, no catalog, no delegation, no tokens.
- The existing catalog re-measure stays exactly as it is. It now answers a slightly different question — whether the instance root still matches what was locked, i.e. whether someone's edit failed to reach the scope — and its instruction is "re-provision" under either reading, so the message needs only a widened explanation.
- `validate` can run the snapshot check too, which closes the gap T32b recorded and could not: *"validate still reports the stale lock ready … it is offline and cannot measure"*. It cannot measure a capability face; it can hash a directory. Proposed as included, because it is a few lines and it stops `conditions list` from disagreeing with the run.

### What does not change

A condition that declares no `preset` reaches none of this: `provisionScope` is called only for a preset-declaring condition, the guard is only consulted for one, and the new lock keys appear only with a snapshot. `presetRosterLayer(undefined)` still returns `''`. The `roots` field stays on the config for deployments that want it. Host-round provisioning of a non-preset condition is byte-identical, and a test pins it.

## Alternatives considered

**Bind-mount the instance's preset root into the unit (the brief's fallback).** The `unit` segment is `additionalProperties: false`, so this is a plan-contract change; the plan is reviewed data and may not carry a host path, so the path has to come from a new facade verb and be injected by eval; `unit.ts`'s "exactly one mount" contract becomes two, and the environment fingerprint has to account for the second mount correctly (shared across conditions, so it belongs in the shared components rather than the per-condition exclusion — one more thing to get right in the one place that must not be wrong). And the roster keeps naming a host path, so the arrangement dies the day the original moves or a deployment's `DSH_HOME` differs. Its single advantage is that an absolute `customSkillDirs` keeps working — which the relocation rule removes, using an idiom the shipped `cordis` preset already proves. Rejected; retained as the fallback if the `!!js` evaluation turns out not to hold on the machine.

**Add a catalog verb that fingerprints a preset at a given directory.** It would measure the scope's copy directly instead of by equality, and it is the honest shape of the question. It costs `capability-catalog`'s service face, its `@Remote` surface, eval's face, and a roster mount path for an ad-hoc root — for a property byte-equality already provides, on a measurement that is itself a stated compromise and is scheduled to be replaced by the in-scope measurement. Rejected now, and named as the thing to build if a factor ever needs a preset that exists only in a scope.

**Teach the roster's `roots` a path that is right on both sides.** The roster expands a leading `~` and nothing else, and the only path that is right on both sides is `$DSH_HOME/.agent-presets` — which is the derived user root. This alternative collapses into the proposal.

**Symlink the scope's copy at the instance root.** `hashHome` skips symlinks and counts them denied, so the subject would stop being hashed; a symlink pointing at a host path resolves to nothing inside the unit. Rejected.

**Let eval write the roster layer itself.** Rejected for the reason T32b already recorded for reading it: the patch format belongs to `local-agent-dsh`, which heals the file on materialization and on every host round. A second writer of a file another package regenerates is a drift generator, and eval would own a format it may not import.

**Express the per-scope preset in the plugin's instance-global config (`presetByScope`).** Rejected: the factor would live in the instance's settings rather than in the dataset, and it would not ride the bind mount. The scope directory has both properties, which is why the roster and the permission boundary already live there.

**Keep the T32b guard and accept that preset conditions are host-only.** This is today, and it is what makes pilot D's criterion unprovable on either path. Rejected by the task.

## Acceptance criteria

- `packages/eval`, `packages/local-agent-dsh` and `packages/local-agent` suites green; `pnpm gate` green.
- A condition declaring no preset provisions byte-identically — pinned by a test over the generated `cordis.patch.yml` and the lock document.
- A preset whose composition names an absolute path is refused at the snapshot and at the measurement, each with the `baseUrl` idiom in the message.
- Dataset side (`i4-pilot-d`): `eval-lean` and `eval-full` rewritten to the `baseUrl` expression. Expected effect, stated in advance so the run can confirm it: **the two `caps` hashes do not move** (the face has no path in it and the skills are unchanged), while **both `home.sha` values do** (the snapshot's `.yml` files are now inside the scoped home), so both condition hashes move once and the write-back records them.
- On 3171, container round: both sub-dsh conditions reach `ready`; the readiness re-measure agrees with the lock; the P0 round's four invariants ✅ and the comparison section opens — the pilot D close-out this task runs itself, not alongside T55's probes.

## Risks

- **The `!!js` expression has never been exercised by these presets.** The shipped `cordis` preset uses it and the loader evaluates with `with (ctx)`, but the first thing to check on the machine is that a sub-dsh mounting a snapshotted preset finds its skills. If it does not, the relocation rule becomes host-line work and the fallback route is the answer.
- **Modes and ownership inside the unit.** The scope is 0700 and the unit runs as user 1000; the snapshot inherits the scope's ownership, and the existing credential-directory check already tolerates Docker Desktop's remap. An unreadable snapshot produces the same "preset not found" message as a missing one, so the acceptance run has to tell them apart.
- **Two writers of the sub-profile.** `local-agent-dsh` heals the patch on materialization and on every host round; provision refreshes the snapshot. A host round in a scope whose file and whose lock disagree would re-roster it. The per-scope file makes them agree; the ordering deserves its own test.
- **Three packages, not two.** The brief scoped this to `eval` and `local-agent-dsh`; the per-scope provisioning verb adds `local-agent`. A reduced variant exists — the per-scope file alone, hand-written, with no facade verb — which keeps the change to two packages at the cost of one manual JSON per scope, an instance restart (or a host round) to apply it, and pilot D's 缺陷 1 left open. The coordinator's call.
- **What is still deferred.** The face measured is the instance's reading of the preset, not the sub-dsh's own composition. `capability-probe.ts` remains the place where the in-scope measurement replaces the instance read, and every lock written before it reads stale against it — which the readiness gate already turns into "re-provision" rather than a silent mismatch.
