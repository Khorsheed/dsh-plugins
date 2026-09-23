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

The topology is not uniform across host lines:

- `packages/bundle/base/cordis.patch.yml` registers a host-level
  `skill-filesystem` row; a host row files into the skill registry's **global
  layer**, which every preset's read merges.
- The Web deployment **disables** that row and the host `tool-skill` row
  (`packages/bundle/web-app/cordis.patch.yml`: "the base host `skill-filesystem`
  row is disabled here (presets own local discovery)"), while the `dsh-skill`
  registry itself stays host-plane.
- So in Web, `standard`, `cordis`, and `ptc` each mount their own
  `skill-filesystem` into **their own layer**, and each of those rows scans the
  same default user root. The skills therefore appear in every preset that mounts
  such a row — by per-preset registration, not by a global row.
- `minimal` has no skill rows at all, so it never sees them today.

Neither topology offers a per-preset exclusion: `dsh-skill`,
`dsh-skill-filesystem` (`customSkillDirs` / `includeDefaultRoots` / `dshHome` and
friends) and `dsh-tool-skill` (only `catalogDescriptionMaxLength`) have no
deny-list, filter, or visibility field anywhere.

### Why a configuration field in this plugin cannot solve it

The plugin is a *consumer* of the registry (`ctx.skills.snapshot()` /
`ctx.skills.get()` through `ctx.get`), not a contributor. The registry is
additive: layers merge, and the nearest layer wins a duplicate name. A field added
to this plugin's settings would change its own tab and nothing the model sees.

The surfaces that decide what a model or user can load are owned by other
packages, and none of them has a filter hook:

| Surface | Owner |
|---|---|
| durable session catalog message (`source.kind === 'skill-catalog'`) | `dsh-tool-skill` pre-step |
| the `skill` tool | `dsh-tool-skill` |
| the user `/name` gesture | `dsh-tool-skill` pre-step |
| the composer `/` menu | `skills/list` Remote, `dsh-api-session-controller` |

### Why this must be solved downstream

This repository tracks the host; it does not fork it. The upstream-change
pipeline is the sanctioned route for host changes, but the precedent recorded in
`docs/upstream-proposals/` is that an upstream feature request can stay
unavailable: the tool-origin proposal only became usable by attaching a
community-owned convention through public APIs. A seam in `dsh-skill` would make
this feature simpler (see Alternatives considered), but the design cannot wait on
it, so the mechanism below is built entirely from APIs the host already exports.

## Proposal

Deliver managed skills from a **plugin-owned root** by registering a provider into
**each target preset's own scope layer**, and keep the per-skill preset list in the
skill's frontmatter.

### How the scope layers make this possible

The skill registry is layered by the scope a registration is made from
(`packages/skill/skill/src/index.ts`: "a scoped context (an agent preset's
standing mount) registers for that scope alone, an unscoped context registers
globally"). A read merges the global layer with the viewing scope's chain,
farthest ancestor first, the nearest scope winning a duplicate name
(`packages/core/scope/src/store.ts`, `ScopedLayers.merge` / `chainLayers`).

```
a read of the skill registry =
    the global layer
  + the layers of every scope in the viewing agent's chain
  └─ merged; within a chain the nearest layer wins a duplicate name

dsh-writing session:  chain = [agent key, dsh-writing standing key]
                      → the plugin's provider lives in that key's layer → skills visible
standard session:     chain = [agent key, standard standing key]
                      → no plugin provider in that layer → skills invisible
```

Visibility is therefore not a filter decision at read time; it is **which layer the
provider was registered into**. Registering into the target preset's layer removes
the need to ask "who is reading?" — a question the provider contract cannot answer
(see "Request-time filtering" in Alternatives considered).

### The delivery scope

Per preset the plugin wants to deliver into:

```ts
const key = await ctx.agentPresets.standingKeyFor(presetId)   // documented roster API
const delivery = createScope(ctx, key)                        // dsh-scope: scope on that key
delivery.ctx.skills.registerProvider(control => ({
  name: 'capability-catalog-scoped',                          // unique per layer, not per process
  list: (options) => managedSkillsFor(presetId, options.cwd), // never reads options.scope
  get: (candidate, options) => loadManaged(candidate, options.cwd),
}))
```

`createScope` mints a context tagged with the key and does not validate that the
key is fresh (`packages/core/scope/src/index.ts`), and `ScopedLayers.effect`
stores one layer per key object, deleting it only when the layer is empty
(`packages/core/scope/src/store.ts`) — so the plugin shares the preset mount's own
layer and its disposal never tears down the preset's registrations. Provider names
are unique per layer, so several layers may carry the same provider name
(`packages/skill/skill/src/index.ts`).

The plugin still provides the skill content: the managed root is the only source,
the provider parses each `SKILL.md`, and it supplies `path` and `resourceBase` so
the detail modal, the `skill` tool's resource resolution, and deletion all keep
working.

Reconciliation with preset generations is load-bearing, not incidental:

- `standingKeyFor` **mounts** the requested preset (composing plugins; starting no
  agent or turn), so the plugin must not pre-resolve every preset in its policy;
- each standing mount has its own key object, and a changed composition file
  starts a new generation with a **new key** while sessions already joined stay on
  the old one;
- so the plugin reconciles against `livePresetMounts()` (exported, carrying
  `presetId` and `key`) plus the `agent-preset/selected(sessionId, agentPreset)`
  event: register for the current key of each referenced preset, keep the old
  key's registration while old mounts live, and dispose a delivery scope once its
  key is gone.

A preset's first session can therefore be one catalog revision behind: the
delivery provider appears when the plugin notices the mount, and the catalog
message is republished on the next pre-step. That lag is acceptable but must be
stated in the UI copy and pinned by a test.

### Configuration and delivery mode

The per-skill list lives in the skill's own frontmatter,
`metadata.presetScope: [<preset-id>, …]` — the plugin already rewrites frontmatter
for installed skills and already owns a `metadata.*` convention
(`metadata.credentials`). Absent/empty means every preset (today's behavior). One
store, not two: the settings namespace stays free of it.

Each skill has exactly one delivery mode:

- **scoped registration** (default for a non-empty `presetScope`) — the managed
  root is the only copy;
- **global root** (empty scope) — installed as today, delivered by the host
  provider, no plugin involvement.

Composition-row automation for user-owned presets (writing a
`skill-filesystem` + `customSkillDirs` row into a `trust: user` preset) is an
optional later convenience, not a fallback: the host deliberately offers only
copy/delete for presets, so such an editor would have to preserve comments,
`!!js` tags, row order and manual edits, use compare-and-swap plus atomic writes,
own exactly one row, and refuse to "fix" a conflicting one. Two delivery paths for
one skill would rebuild the duplicate-name and uninstall-semantics problems this
design removes.

### Freshness

A provider that returns an array is treated as a complete observation and cached
by the registry, and `dsh-tool-skill` publishes nothing from an incomplete
snapshot. "Re-read on every lookup" is therefore not available: the managed root
needs its own watcher, `control.invalidate()` after external changes, and a
synchronous invalidate after every write the plugin performs itself. Watcher
failure returns an incomplete observation as an exceptional state, not as the
normal operating mode.

Inside the provider, cache only scope-independent parse/stat results, or key any
filtered cache by the target preset plus a file revision — a cwd/name-only key
would serve one preset's view to another.

### What the plugin's own views show

`snapshotFor(presetId)` already reads at that preset's standing scope and
`list_capabilities` runs in the caller's agent scope, so the settings grid, the
model catalog, the `skill` tool, the `/` gesture, the `/` menu and the capability
fingerprint all follow from the same delivery. The card must additionally show,
per skill: the configured presets, the ones that currently resolve (distinguishing
missing/broken ids from active ones), and a duplicate-name diagnostic. Browser
surfaces need a Remote DTO for the roster — the client cannot read
`ctx.get('agentPresets')`.

### Scope of enforcement

This is a **discovery and delivery policy for this Harness instance**. It is not
an access-control boundary, and it does not isolate secrets:

- **Not authorization.** `ScopeKey` is `type ScopeKey = object` with no brand,
  `bindScopeParent` is public, and `standingKeyFor` hands out real keys to any
  caller. An in-process plugin can register into another preset's layer or read
  with its scope. Registering into the target layer stops *accidental* identity
  guessing; it does not make membership un-forgeable.
- **Not cross-runtime.** In-process agents, and children that join the parent's
  composition, are covered. Native `codex` / `claude-code` and ACP backends start
  their own runtime, session, and skill discovery in the same working directory;
  they never consult this registry, and once the files live in a private root
  those agents generally cannot see them at all. That is a behavior change to
  document, not an isolation guarantee.
- **Managed names only.** A leftover copy in any default root — the user root, the
  two project roots, `$DSH_AGENTS_HOME/skills`, or a custom root — is delivered by
  the host provider into that preset's layer, and a plugin emitting nothing for a
  non-member preset cannot offset it. Duplicate detection must scan every
  discoverable default root, and a serious duplicate must **refuse to enable**
  scoped delivery rather than merely warn.

### Migration, release, and recovery

`DELETABLE_SOURCES` says which sources the catalog may delete; it does not make a
directory safe to move. Scoping an installed skill moves it into the managed root:
resolve and validate the source; refuse a non-empty target; copy to a temporary
sibling inside the managed root; verify the whole bundle (`SKILL.md` plus
resources); commit with one atomic rename; only then remove the source; and leave
at least one complete copy behind on any failure. When several roots supply the
same name, the user picks the installation.

A scoped skill is delivered by this plugin, so disabling, breaking, or uninstalling
it removes the skill from every preset even though the files survive — and a
"release" action is reachable only while the plugin runs. The managed root
therefore carries a `RECOVERY.md` and a manifest (origin, recommended restore
target, bundle hash, policy) as an *index*, not as the recovery mechanism: each
skill directory stays self-contained, recovery is a documented
`cp` back into a default root that needs no plugin, the manifest can be rebuilt by
scanning for `SKILL.md`, and uninstall never deletes managed files.

### Containment and verification

- `package.json` declares the new optional peers (`@deepseek-ai/dsh-scope`, and
  `@deepseek-ai/dsh-agent-presets` for the roster), and `dsh.compat.notes` records
  the verified host range, that scoping is a discovery policy, that external
  agents are excluded, and the canary's meaning.
- Both READMEs' `Compatibility` sections carry the same statements.
- `src/invariant.ts` currently asserts the catalog is read-only; that becomes
  false. It gains: the managed root is inside no known default root; a delivery
  registration exists only for a live/current preset key; one skill name has
  exactly one delivery mode; no `trust: system` preset is ever written; manifest
  and on-disk skill directories agree.
- A host-contract canary pins the two behaviours this design borrows but that are
  not advertised extension points: that `createScope(ctx, existingKey)` yields a
  context whose registrations file into that key's layer, and that a
  provider-registered array is cached as complete. If either changes, the canary
  fails loudly instead of the feature silently changing meaning.

### First stage: what shipped

The first stage of Track 3B is implemented in `packages/capability-catalog`:
`src/scoped-delivery.ts` (managed-root scan, frontmatter policy, per-preset
scoped registration, generation reconciliation through `livePresetMounts`, a
debounced filesystem watcher with `control.invalidate`, default-root conflict
refusal, and the status surface) and `src/scoped-edits.ts` (line-preserving
`presetScope` rewrite, adopt, release), beside the `presetScopeStatus` /
`presetScopeRoster` / `presetScopeSet` / `presetScopeAdopt` /
`presetScopeRelease` Remotes and the detail-modal editor.

One implementation detail is load-bearing and belongs in this record: a
scope-minted context carries no dependency access of its own, so the provider is
registered through an **injected child** of it — the scope tag survives the extra
level, while registering through the scope context directly fails with "cannot
get property skills without inject".

Still deferred, and therefore still proposal scope: the host-contract canary, the
recovery manifest and `RECOVERY.md`, the `dsh.compat` + README Compatibility
record, and the invariant checks.

## Alternatives considered

**Keep the files in `$DSH_HOME/skills` and add configuration only.** Impossible: a
consumer cannot subtract from the registry, and no deny hook exists in `dsh-skill`,
`dsh-skill-filesystem`, or `dsh-tool-skill`. The result would be a settings tab
that lies about what the model sees.

**Let each user preset own the skills through `customSkillDirs` (the host's own
mechanism, used by the shipped `cordis` preset).** Honest, documented, no plugin
or host change — and the right answer for a preset the author owns. It loses as
the general feature because shipped presets are read-only (visibility in them can
never be granted) and because arbitrary per-skill subsets over many presets turn
into directory combinatorics. It remains the recommended workaround whenever the
target presets are all user-authored.

**Request-time filtering: a global provider that reads the borrowed view scope.**
The registry does pass the same options object, including `scope`, to
`provider.list`, but the declared contract is `{ cwd, signal }` and the registry's
comment says providers read only that. The failure mode is the wrong one: a host
that stops threading scope makes every managed skill visible everywhere, and from
inside the provider a legitimate unscoped read is indistinguishable from that
host change — so the plugin cannot even report the degradation honestly. Kept only
as a documented last resort behind the canary, never as the default.

**Filter in the consumers (`dsh-tool-skill`, `dsh-api-session-controller`).** Both
have the identity they need and no scope plumbing, but this copies one policy into
two host packages, leaves `ctx.skills` unfiltered for every future consumer, and is
a host change this repository cannot make.

**Register each skill as a runtime skill (`ctx.skills.register`) into the preset
layer.** Same layering, but runtime entries rank 250 — above the user filesystem
provider's 400 — so a residual copy in a default root would be shadowed rather
than detected, the body must be pre-read, and every file change needs a
dispose/re-register cycle. The provider keeps discovery honest.

**Store the scope in the settings namespace instead of frontmatter.** A better fit
for a *deployment-local policy* — preset ids are deployment vocabulary, and an
imported skill carries none — but it creates a second mapping to keep consistent
with rename/import/delete and cannot be reviewed with the skill. Frontmatter wins
on one-store simplicity; this stays the fallback if policies must be per
deployment.

**Wait for an upstream seam.** A declared per-provider view context (or
registry-level filtering by declared metadata) would delete the canary dependency
and let every consumer agree without this plugin delivering anything. Worth
recording as a request, but per the precedent above it cannot gate the capability.

## Acceptance criteria

1. Membership is asserted per preset on each of the four Harness surfaces as four
   separate tests — the catalog message and its digest, `skill` tool execution,
   the `/name` gesture, and the `skills/list` Remote DTO — with the managed skill
   present in a member preset and absent in a non-member one.
2. A skill listing several presets is delivered in each of them and nowhere else;
   an empty list behaves exactly as today, including for skills in default roots.
3. The provider's `list`/`get` never read the view scope: a test registers into
   two preset layers and asserts each returns only its own assignment while the
   borrowed options carry no scope information at all.
4. Generation reconciliation: after the preset composition file changes, new
   sessions see the skills under the new key while a session already joined to the
   old generation keeps seeing them; the stale delivery scope is disposed only
   after its mount is gone.
5. First-session lag is bounded: a preset whose delivery provider appears after
   the session's first pre-step republishes the catalog exactly once and does not
   grow the log afterwards.
6. An external edit inside the managed root produces exactly one catalog
   revision; a plugin-performed write invalidates synchronously; a watcher
   failure surfaces as an incomplete observation.
7. Migration: a missing source, a pre-existing target, and an injected failure
   before and after the atomic rename each leave exactly one complete copy; a
   duplicate name in a project, agents-home, or custom root is detected and blocks
   enabling scoped delivery.
8. Recovery: with the plugin disposed, a documented `cp` of a managed skill
   directory into `$DSH_HOME/skills` makes the host provider list and load it;
   uninstall leaves the managed root untouched; the manifest can be rebuilt from
   the directory scan.
9. Invariant and containment: the managed root is rejected inside any default
   root, one skill cannot be delivered two ways at once, `trust: system` presets
   are never written, and `dsh.compat` / README Compatibility state the verified
   host range, the discovery-policy framing, and the external-agent exclusion.
10. Isolated-loader coverage: the package installs, boots, and degrades to an
    empty catalog with `ctx.skills`, `ctx.agentPresets`, or `dsh-scope` absent —
    asserted by a composition test, not by `pnpm gate` alone.

## Risks

**Not an authorization boundary, and it must never be described as one.** Keys
are ordinary objects and real ones are handed out by a public API. The policy
gates discoverability for a well-behaved instance, nothing else.

**The design leans on two unadvertised behaviours.** Scoping a context onto a key
the roster already minted, and the fact that a provider-registered array is cached
as complete, are current source facts rather than declared extension points. The
canary is the containment: they are asserted against the installed host, so a host
upgrade fails a test instead of quietly changing what the feature means. Pinning
`dsh.compat` keeps the blast radius to a supported range.

**Losing the files' home weakens ownership.** The skills stop being plain
filesystem skills: a broken plugin removes them from every preset, and delegated
native agents lose sight of them. The self-contained managed root plus a
plugin-independent `cp` recovery path are the mitigation; delivery from a default
root cannot be made scoped at all, so there is no alternative that keeps both.

**A leftover copy silently defeats scoping.** Duplicate detection across user,
project, agents-home and custom roots is load-bearing, and the rule is to refuse
enabling rather than warn.

**Generation churn is easy to get wrong.** Keys are object identities that change
with the composition file, while old sessions keep the old key. Registering only
for the newest generation makes live sessions lose the skills; disposing
eagerly makes them lose them mid-session. `livePresetMounts()` plus the selection
event is the reconciliation input, and AC 4 pins it.

**Startup ordering is still open.** The plugin cannot pre-resolve every preset in
its policy without mounting them all, and creation does not emit
`agent-preset/selected`; the current answer is to reconcile from live mounts and
accept one catalog revision of lag on a preset's first session. A cleaner trigger
would need either a mount event or a roster query that does not compose.

**Freshness regresses if the watcher is skipped.** The host provider's watcher is
what keeps default roots fresh; the managed root has none until the plugin builds
one.

**Independent installability.** The package must still boot alone and degrade.
Importing `@deepseek-ai/dsh-scope` and the roster types makes them declared,
optional peers and grows the compatibility note; `pnpm check:plugins` must stay
green.

**Session-history effects.** The catalog message is durable and digest-compared. A
stable delivery publishes nothing extra; a fork whose seeded catalog disagrees
with its composition publishes one replacement and then stays quiet. Tests pin the
one-replacement behaviour rather than assuming it.

**Client wiring is not free.** The detail-modal multi-select needs a Remote DTO
with loading and error states; the roster may be unavailable, and a stored preset
id may point at a deleted or broken preset.
