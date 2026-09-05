# Agent Note: headless bundle carries no dsh.bundle declaration

Status: implemented

English | [中文](2026-09-05-headless-no-dsh-bundle-declaration.zh.md)

## Problem

`@khorsheed/dsh-local-agent-dsh-headless` is a sub-dsh composition: its patch rows (persona override, `hmr` off, `tools` mode, the `code-runtime` insert, the member-bridge MCP row) exist only for the provisioned `headless-local-agent-dsh` profile under the family scoped home. The package nonetheless declared `dsh.bundle` in its manifest, and that declaration is the host's mount trigger: `dsh plugin` reconcilePlugins appends every `dsh.bundle`-declaring *direct* profile dependency to the layer stack. Installing the package as a direct dependency — the handiest way to satisfy its unpublished transitive range without a pnpm override — therefore mounted the sub-dsh composition into the interactive profile. The i1-walk G3 incident (2026-09-03) was the recurrence of the 2026-08-23 P0: duplicate `code-runtime` entry id, whole instance failing to boot. The interim discipline ("install as a dependency, delete the bundles row by hand", transitive-only installs) held only as long as every operator remembered it.

Two root-cause questions needed explicit answers before touching anything:

1. **Should headless be a direct profile dependency?** No. It is family-internal: the parent `@khorsheed/dsh-local-agent-dsh` carries it as a `workspace:*` dependency, and provision resolves the bundle by path from that installation closure. In tarball flows the family edges are registry ranges (`^0.1.0-rc.6`) that cannot resolve while the package is unpublished, so the pnpm `overrides` pin (the prod-3080 pattern) keeps it a pure transitive dependency. But direct-dependency installs cannot be prevented by discipline — they are the natural workaround an installer reaches for — so relying on "nobody installs it directly" was not a fix.
2. **Should the `dsh.bundle` declaration exist?** No. Nothing in the family consumed it: provision resolves the headless directory via `require.resolve('@khorsheed/dsh-local-agent-dsh-headless/package.json')` and never reads the field. The declaration's only legitimate consumer was the sub-profile boot — `loadProfile` fails loud when a bundle listed in the manifest declares no patch — and that requirement can be met without the declaration. Its remaining consumer was reconcilePlugins, i.e. the bug itself.

## Decision

- The headless package declares **no `dsh.bundle`** (the `dsh.compat` block and the shipped `cordis.patch.yml` stay). Reconcile can never mount it again; as a bonus, a profile already carrying a stale bundles row from the old scheme loses it automatically on the next reconcile, because `exportsPatch` now returns false for the installed version.
- The provisioner (`packages/local-agent-dsh/src/provision.ts`) owns the composition placement: the sub-profile manifest lists only `@deepseek-ai/dsh-base`, and the headless patch is copied verbatim from the bundle directory's `cordis.patch.yml` (known filename) into the sub-profile's own patch layer. That layer applies after every bundle layer — the same position the headless bundle row used to occupy. The copy rewrites on content mismatch, which heals profiles provisioned by the old scheme (their manifest listed headless as a layer, which would now fail `loadProfile`) and carries patch upgrades into existing scoped homes; steady-state runs stay no-ops. The `node_modules` symlink stays: the loader resolves the patch's insert rows through it.
- `check-plugin-independence` lists the headless package in `NO_OWN_PATCH`: it is a family-internal composition whose patch is mounted on its behalf by the provisioner, like tool-subagent's provider-mounted rows.
- Defense layers stay: the `webStartup` invariant companion and the patch spec pinning the `code-runtime` insert row id still fail loud if the composition is ever hand-wired into a web profile.

Verified on a one-shot home against the npm 0.1.1-rc.2 toolchain: fresh `web` profile, `dsh plugin add` of the local-agent-dsh tarball (headless transitive via overrides) plus a deliberate direct `dsh plugin add` of the headless tarball — reconcile emits the plain-dependency warning and mounts nothing; `--dump-config` composes with exactly one `code-runtime` row and zero headless rows; the instance boots; the provisioned sub-profile boots and a real one-shot sub-dsh round answers and exits 0.

## Alternatives considered

**Keep the declaration and rely on overrides + discipline (the pre-fix workaround).** Rejected: it is exactly the arrangement that produced two production incidents. The trigger stays armed for every future install surface, and the reconciliation between the README's "never a direct dependency" and the installer's least-surprising action is left to memory.

**Carry headless so it never needs an explicit install: `pack-dist --family` rewriting intra-family edges to `file:` tarball specs.** Rejected for this task: it changes the shared packaging script (mainline territory per docs/development.md), bakes build-machine paths into publishable tarballs unless carefully spec'd, and still leaves the declaration armed for the registry/npm path. The overrides pin is the documented equivalent for profile flows.

**Wait for the upstream split (`dsh.bundle.autoMount: false` per docs/upstream-seam-registry.md S9).** Rejected as the primary fix: the harness is tracked, not modified, and the seam's retirement cadence is upstream's. Our side no longer needs the declaration at all, so S9 is closed for this package rather than parked; the entry notes the upstream split remains the general remedy for any future family-internal bundle.

**Keep headless in the sub-profile bundles list and ship the patch some other way.** Not viable without a harness change: `loadProfile` fails loud on a listed bundle whose manifest declares no patch, which is precisely the declaration we are removing.

## Consequences

- `--dump-default-config` on the sub-profile (the bundles-only diagnostic) no longer includes the headless rows, because they now live in the user patch layer; `--dump-config` and real boots read it and see the full composition.
- Profiles provisioned before this change self-heal on the next provision pass (the parent re-provisions before every round and at toggle-on): the stale bundles row and empty patch layer are rewritten, so no manual scoped-home surgery is needed.
- Any future package whose patch is meant for a nested composition must follow this pattern — no `dsh.bundle` declaration, and a provisioner or parent patch that places the rows — and must be added to `NO_OWN_PATCH` with the reasoning recorded here.
- The Reconcile-removal side effect means a profile that legitimately wanted headless mounted (none is known) would silently lose the row on upgrade; that loss is the intended behavior of this fix.
