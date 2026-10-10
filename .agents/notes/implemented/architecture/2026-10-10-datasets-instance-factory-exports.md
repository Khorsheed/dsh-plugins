# Agent Note: datasets exports the service factory and the Remote class for instance mounting

Status: implemented

## Problem

A consumer mounting dataset storage per-instance on an isolated Context needs to build a service over its own roots and mount the native Remote face on the same Context. An earlier source audit concluded "the factory exists, zero changes needed" — but it read the SOURCE, not the ARTIFACT: `createDatasetsService` (`src/service.ts`) and `DatasetsRemoteService` (`src/remote.ts`) were imported by `src/index.ts` for `apply` but never exported, so importing the packed tarball's root resolved `undefined` for both (re-verified against this package's packed 0.2.0-rc.1 artifact before this change). The instance-mounting consumption form was unusable from the public surface.

## Decision

Purely additive public exports from the package root (`src/index.ts`), reusing existing names, moving nothing, changing no behavior; the version stays 0.2.0-rc.1; `apply`, the deployment-default root resolution, and the wire surface are untouched:

- **`createDatasetsService`** — the service factory, with the option/scope types **`DatasetsServiceOptions`** (the four roots: `registryPath` / `bindingsRoot` / `materializedRoot` / `proposalsRoot`, plus the optional `organizing`), **`DatasetsService`**, **`DatasetScope`**, and **`OrganizingSetup`**.
- **`DatasetsRemoteService`** — the native Remote face (wire namespace `datasets`) whose constructor is the mounting entry on an isolated Context, with its config type **`DatasetsRemoteConfig`** (empty since T73).
- **No Remote verb takes an Agent lookup** — verified by reading all 30 verbs and pinned by test: every verb takes a plain request object (a registration id plus dataset/item/path/commit), and the single host probe is `organizingSetup` reading the `agentPresets` registry SLICE (`list` / `readDocument` / `defaultId`, T102) through `ctx.get` — preset documents, not agent instances; a missing or broken slice degrades to `preset: ''` and never throws. There is therefore no agent-carrying verb to document as unadmitted.
- **Tests** (`tests/instance-exports.spec.ts`, 4): two instances built from the public factory over disjoint registry/bindings/materialized/proposals roots leak nothing across (registrations, reads, writes into the authoring checkout, the legacy-bindings import, materialized views, proposal stores); the Remote class mounts on a bare cordis Context over the instance service and serves only that instance's registry; a recording/poisoned `ctx.get` stub proves the browsing and registry verbs probe no host surface at all, that `organizingSetup` probes exactly `agentPresets` (fail-open when it is absent or throwing), and that a configured `organizing.preset` answers without probing anything. The 33 pre-existing spec files pass unmodified (392 tests total, 4 new).
- **Tarball verification**: packed with `scripts/pack-dist.ts` (`--family auto`), unpacked to a scratch dir inside the package, root imported with plain node — the factory and the class resolve, the published `.d.ts` names every exported type, a two-root instance pair constructs, and the face mounts on a bare Context; the scratch dir was removed afterwards.

The generated typert host face's `model.services` catalog now lists `datasets` and `datasetsRemote`: the generator catalogs a cordis-augmented service once its type is publicly exported (the analyzer's `collectServices`), which is exactly the shape eval (`dshEval`) and mission (`mission`, `missionRemote`) already ship. The wire surface proper is byte-identical: `typert.remote-client.{js,d.ts,d.ts.map}` are unchanged, and the host face's `invocations` and `schemas` are JSON-equal across the change — only the introspection catalog grew. The README's new 「工作区接入接缝（按实例挂载）」 section documents the factory, the independent-roots construction, the Remote mount, the no-Agent answer, what stays deployment-default via `apply`, and the rule that two instances must not share one `authoringCheckout`.

## Alternatives considered

- **Extending `apply`'s config to cover all four roots**: the factory is the consumption entry for isolated instances, and the local default root resolution must not move — a config that could reroot the deployment's registry would couple the two consumption forms for no benefit, and every added key would be a new way to misconfigure the local path.
- **Exporting only the factory and leaving the Remote face internal**: the consumer would have to rebuild the wire face or run its own adapter over the service; the class's constructor already IS the mount entry, so keeping it private would just force a copy.
- **Enlarging the export set to the wire payload types** (`ListRequest`, `ShowResult`, …): not needed for the seam — those already ship from the `./types` subpath; the root export stays the minimal construction surface.
- **Consumer-vocabulary names for the new surface** (workspace/cloud-flavored export names or option keys): rejected by the naming rule — the seam is generic; no consumer's vocabulary enters this package's code, types, or comments.

## Consequences

- New public surface, all re-exports of existing declarations: `createDatasetsService`, `DatasetsServiceOptions`, `DatasetsService`, `DatasetScope`, `OrganizingSetup`, `DatasetsRemoteService`, `DatasetsRemoteConfig`. The plugin row, `apply`, the CLI, the slash handler, the tool row, and the tab are untouched; local behavior is byte-identical.
- A consumer can now run several independent instances on one host with disjoint registries and caches, and mount the native Remote face on each — the cross-instance isolation and the no-Agent-lookup property are pinned by the new contract test.
- The host-face introspection catalog grows by two service entries (metadata only); the wire face is unchanged, so old and new halves interoperate exactly as before.
- The write-race caveat is documented, not enforced: two instances pointing at one `authoringCheckout` are two writers on one working tree, and the plugin never commits — keeping the boundary is the consumer's obligation.
