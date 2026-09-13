# Agent Note: preset-scoped skills in capability-catalog

Status: proposed

## Problem

`@khorsheed/dsh-capability-catalog` is how a user installs and inspects skills in
this deployment: its Add-skill flow writes `<name>/SKILL.md` into a managed root
(`$DSH_HOME/skills` or `.agents/skills`), and its settings tab (工具与技能) lists
what the registries hold. The two writing skills used here — `md-to-wechat` and
`tech-article-polish` — were installed that way and live in `$DSH_HOME/skills`.

They are visible in every preset that mounts a local skill provider. The user
wants the opposite: a per-skill, **multi-select preset scope**, so a managed skill
is effective only in a chosen set of presets — here, a new `dsh-writing` preset —
without editing any shipped preset.

### Where those skills actually come from

The topology matters and is not uniform across host lines:

- `packages/bundle/base/cordis.patch.yml` registers a host-level
  `skill-filesystem` row; a host row files into the skill registry's **global
  layer**, which every preset's read merges.
- The Web deployment **disables** that row and the host `tool-skill` row
  (`packages/bundle/web-app/cordis.patch.yml`: "the base host `skill-filesystem`
  row is disabled here (presets own local discovery)"), while the `dsh-skill`
  registry itself stays host-plane.
- So in Web, `standard`, `cordis`, and `ptc` each mount their own
  `skill-filesystem` into **their own layer**, and each of those rows scans the
  same default user root. The skills therefore appear everywhere any of them
  mounts — but by per-preset registration, not by a global row.
- `minimal` has no skill rows at all, so it never sees them today.

Neither topology offers a per-preset exclusion: `dsh-skill`,
`dsh-skill-filesystem` (`customSkillDirs` / `includeDefaultRoots` / `dshHome` and
friends) and `dsh-tool-skill` (only `catalogDescriptionMaxLength`) have no
deny-list, filter, or visibility field anywhere.

### Why a configuration field in this plugin cannot solve it

The plugin is a *consumer* of the registry (`ctx.skills.snapshot()` /
`ctx.skills.get()` through `ctx.get`), not a contributor. The registry is
additive: layers merge and the nearest layer wins a duplicate name. A field added
to this plugin's settings would change its own tab and nothing the model sees.

The surfaces that decide what a model or user can load are owned by other
packages, and none of them has a filter hook:

| Surface | Owner |
|---|---|
| durable session catalog message (`source.kind === 'skill-catalog'`) | `dsh-tool-skill` pre-step |
| the `skill` tool | `dsh-tool-skill` |
| the user `/name` gesture | `dsh-tool-skill` pre-step |
| the composer `/` menu | `skills/list` Remote, `dsh-api-session-controller` |

## Proposal

Deliver the capability in two tracks, and be explicit about what the plugin-side
track is not.

### Track 1 — the upstream seam is the real answer

The general feature ("any skill, any subset of presets, files stay where the user
installed them") belongs in the host, not in a catalog plugin. The smallest
seam that makes it sound:

- `dsh-skill` gives providers a **declared** view context, so a provider never has
  to guess identity from an opaque `ScopeKey`: either widen the provider signature
  to the already-exported `SkillViewOptions`, or add a read-only view record
  carrying `presetId`.
- `presetId` must be produced by the roster/registry for the real standing
  generation — not by a consumer walking object properties (see "Preset identity"
  below).
- With that identity declared, the filter itself can live either in the provider
  (this plugin) or, better for all consumers, in the registry read, where layers
  already live and where the cache key already includes the scope chain.

A separate `docs/upstream-proposals/` document should carry the concrete API
sketch and be registered in `docs/upstream-seam-registry.md`. Track 1 is the
recommendation; it is not a precondition for the immediate need below.

### Track 2 — the immediate need, with no host change and no new plugin code

For "these two skills load only under a preset I own", the host already has the
documented mechanism, and it is the one the shipped `cordis` preset uses:

1. author the user preset (`$DSH_HOME/.agent-presets/dsh-writing/`) by copying
   `standard`'s composition — copy-only authoring is the roster's own API;
2. move the writing skills into a root that **no default provider scans** (inside
   the preset directory, or a shared sibling both writing presets reference);
3. add a `skill-filesystem` row to that preset with
   `customSkillDirs: [<that root>]`, keeping `includeDefaultRoots` at its default
   so the preset keeps standard's view of every other skill.

Multi-select over presets the author owns is then a shared directory referenced by
several compositions. This is honest, versioned, and needs no plugin or host
change. What it cannot do is grant the skills to a **shipped** preset
(`standard`/`cordis`/`ptc`/`minimal` are read-only and an upgrade overwrites
them), and a per-skill arbitrary subset over many presets degenerates into one
directory per subset.

### Track 3 — the plugin-side route, explicitly experimental

If the user wants the capability inside this plugin before the seam lands, it is
implementable, but only as a **best-effort visibility filter**:

1. **Managed root.** Managed skills live in a plugin-owned directory outside every
   default skill root (`$DSH_HOME/capability-catalog/skills/`), so no host
   provider discovers them. Only then can the plugin's own decision be
   authoritative for those names.
2. **Provider.** `ctx.inject(['skills'], c => c.skills.registerProvider(…))`,
   following the package's existing deferred-inject pattern. Registered
   host-side, it files into the **global layer**, which every preset's read
   merges — including presets that mount `tool-skill` behind their own layer.
3. **Filter by the viewing preset** in `list(options)` and `get(candidate, options)`.
   `scope` is the viewing agent for live reads, so the preset is recovered by
   walking `scopeChainOf(scope)` for a string `agentPreset` property (the roster
   mints standing keys as `{ agentPreset: preset.id }` and binds each live agent
   key directly beneath one).
4. **Semantics.** Absent/empty preset list = every preset (today's behavior);
   a non-empty list delivers the skill only when the resolved preset id is a
   member. A read with no `scope` keeps today's behavior.
5. **Storage: the skill's own frontmatter**, `metadata.presetScope: [<id>, …]`,
   read and written through the path the plugin already owns
   (`src/import.ts` already rewrites `disable-model-invocation`, and
   `metadata.credentials` is already a plugin-owned convention). One store, not
   two: the settings namespace stays free of it.
6. **Watcher is mandatory, not optional.** A provider returning an array is
   normalized `complete: true` and cached by the registry, and `tool-skill`
   publishes nothing from an incomplete snapshot — so "re-read on every lookup" is
   not a design option. The provider must watch its root and call
   `control.invalidate()` after external edits and after every write it performs
   itself.
7. **The plugin's own reads follow.** `snapshotFor(presetId)` already reads at
   that preset's standing scope and `list_capabilities` runs in the caller's
   agent scope, so the plugin's listing, the model catalog, the tool, the `/`
   menu, and the capability fingerprint all follow from one implementation.
8. **Migration and release** need a real protocol (below), because this route
   moves files out of the root the user installed them into.

### Scope of enforcement

This is a **discovery and delivery policy for this Harness instance**. It is not
an access-control boundary, and it does not isolate secrets:

- **Not authorization.** `ScopeKey` is `type ScopeKey = object` with no brand,
  and `bindScopeParent` is public API. Any in-process plugin or caller can pass
  `{ agentPreset: 'dsh-writing' }` as a lookup scope, or bind its own key beneath
  one, and appear to be a member. A trusted filter needs an authenticated
  identity from the roster, which is exactly Track 1's job.
- **Not cross-runtime.** In-process agents and children that join the parent's
  composition are covered. Native `codex` / `claude-code` and ACP backends start
  their own runtime, session, and skill discovery in the same working directory;
  they never consult this registry. Once the skills live in a private root they
  are generally invisible to those agents — a behavior change worth stating, not
  an isolation guarantee.
- **Only for managed names.** A leftover copy in any default root — user, the two
  project roots, or a custom root — is delivered by the host provider in that
  preset's layer, and the plugin emitting nothing for a non-member preset cannot
  offset it (no arbitration happens when there is nothing to arbitrate). Duplicate
  detection must scan project and custom roots, not just `$DSH_HOME/skills`.
- **Degradation is fail-open and not reliably detectable.** The provider contract
  is `{ cwd, signal }`, and the registry's own comment says providers read only
  that contract; reading `scope` from the borrowed object is an undeclared
  dependency on current behavior. If a host stops threading it, every managed
  skill becomes visible everywhere. A global unscoped read and a
  stopped-threading host look identical from inside the provider, so the UI can
  neither claim enforcement nor honestly report its absence: it must label the
  feature best-effort, pin the verified host range in `dsh.compat`, and the seam
  is what retires the cast.

### Caching

The registry's collect cache key already includes the scope chain, so a
scope-filtered provider is cache-correct. Inside the provider, cache only
scope-independent file parse/stat results, or key any filtered cache by scope
identity plus a file revision — a key of cwd/name alone would serve one preset's
filtered view to another.

### Migration and recovery

`DELETABLE_SOURCES` says which sources the catalog may delete; it does not make a
directory safe to move. Moving one into the managed root needs, at minimum:
resolve and validate the source; refuse a non-empty target; copy to a temporary
sibling inside the target root; verify the whole bundle (`SKILL.md` plus
resources); commit with one atomic rename; only then remove the source; and leave
at least one complete copy behind on any failure. When several roots supply the
same name, the user picks the installation rather than the plugin guessing.

Because a scoped skill is delivered by this plugin, disabling, breaking, or
uninstalling it removes the skill from every preset even though the files survive
— and a "release" button is only reachable while the plugin runs. The managed
root therefore carries a manifest recording each skill's origin and its recovery
target, the plugin documents a manual recovery path that does not require the
plugin, and it never deletes managed files on uninstall.

## Alternatives considered

**Keep the files in `$DSH_HOME/skills` and add configuration only.** Impossible:
a consumer cannot subtract from the registry, and no deny hook exists in
`dsh-skill`, `dsh-skill-filesystem`, or `dsh-tool-skill`. The result would be a
settings tab that lies about what the model sees.

**Deliver scoping by editing preset compositions (Track 2).** Documented and
reliable, which is why it is the recommendation for the immediate need: the
`cordis` preset already carries its own skills this way. It loses as the general
feature because shipped presets are read-only — visibility in them can never be
granted — and because arbitrary per-skill subsets over many presets turn into
directory combinatorics.

**Filter in the consumers (`dsh-tool-skill`, `dsh-api-session-controller`).**
Both have the identity they need (the agent, or the `agentPreset` projection) and
need no scope plumbing, but this copies one policy into two host packages, leaves
`ctx.skills` unfiltered for every future consumer, and is still a host change. If
the host is changing, Track 1's seam is the better place.

**Store the scope in the settings namespace instead of frontmatter.** A better fit
for a *deployment-local policy* — preset ids are deployment vocabulary, and a
skill imported from elsewhere carries none — but it creates a second mapping that
must stay consistent with rename/import/delete, and it cannot be reviewed with the
skill. Frontmatter wins on one-store simplicity; this remains the fallback if
policies must be per-deployment rather than per-skill.

**Ship Track 3 first and delete the cast when the seam lands.** That is the
staging above; it is acceptable only with the best-effort labeling, the mandatory
watcher, the migration protocol, and a pinned verified host range.

## Acceptance criteria

1. Membership is asserted per preset for each of the four Harness surfaces, as
   four separate tests: the catalog message and its digest, `skill` tool
   execution, the `/name` gesture, and the `skills/list` Remote DTO — with the
   managed skill present in the member preset and absent in a non-member one.
2. `list_capabilities` in a non-member preset omits the skill; in a member preset
   it includes it.
3. An absent or empty `presetScope` keeps today's behavior everywhere, including
   skills installed to a default root.
4. With a lookup carrying no `scope`, the provider serves every managed skill, and
   no surface claims enforcement it cannot verify.
5. Given a fixture where two scopes differ only by the managed skill, the skill's
   presence changes the capability face and `hashOf`; `sha === hashOf(snapshot)`
   holds; and the comparison is made per skill row, not asserted as a general
   if-and-only-if over the whole snapshot.
6. Migration: a missing source, a pre-existing target, and a failure injected
   before and after the atomic rename each leave exactly one complete copy, and a
   duplicate name in a project or custom root is detected and surfaced.
7. Release: after disposing the plugin's provider, the host provider still lists
   and loads the released skill from its global root.
8. A file edited in the managed root outside the plugin produces exactly one
   catalog revision; a write the plugin performs itself invalidates
   synchronously.
9. The package still installs, boots, and degrades to an empty catalog with
   `ctx.skills` absent, verified by an isolated loader-composition test rather
   than by `pnpm gate` alone.

## Risks

**The undeclared `scope` read is the central risk, and it fails leaky.** The
contract says providers read `{ cwd, signal }`; reading `scope` violates it, and
the failure mode is not "feature off" but "feature off *and* skills visible
everywhere" — indistinguishable from a legitimate global read. Best-effort
labeling plus a pinned host range are the containment; Track 1 is the fix.

**Identity by structure is spoofable.** A key shaped `{ agentPreset: … }` is
ordinary data. Any in-process caller can claim membership. The filter must never
be described as authorization or used to gate a secret.

**Losing the files' home weakens ownership.** The skills stop being plain
filesystem skills: a broken plugin removes them from every preset, and delegated
native agents lose sight of them. The manifest plus a plugin-independent recovery
path are the mitigation; the seam removes the problem by leaving files in place.

**A leftover copy silently defeats scoping.** Duplicate detection across user,
project, and custom roots is load-bearing, and the UI must warn rather than
assume a move succeeded.

**Watcher gaps regress today's behavior.** The host provider's watcher is what
keeps `$DSH_HOME/skills` fresh; the managed root has none until the plugin builds
one, so an implementation that forgets it is a silent staleness regression.

**Independent-installability gates.** The package must still boot alone and
degrade with `ctx.skills` absent. If the scope-chain walk imports
`@deepseek-ai/dsh-scope`, that becomes a declared (optional) peer dependency and
the `dsh.compat` note grows; a structural walk avoids the dependency but is more
fragile — either way `pnpm check:plugins` must stay green.

**Session-history effects.** The catalog message is durable and digest-compared.
A stable scope publishes nothing extra; a blank-session preset switch has usually
published no catalog yet; a fork whose seeded catalog disagrees with its new
composition publishes one replacement and then stays quiet. Tests should pin the
one-replacement behavior rather than assume it.

**Client wiring is not free.** The detail-modal multi-select cannot read
`ctx.get('agentPresets')` in the browser: it needs a Remote DTO with its own
loading and error states, and the roster may be unavailable.
