# Agent Note: datasets store M1 — service core, git-object reads, managed sparse-checkout worktrees, session binding

Status: implemented

English | [中文](2026-08-19-datasets-store-m1.zh.md)

## Problem

The [datasets proposal](../../../proposals/active/2026-08-19-datasets-store.md) splits a generic versioned dataset store out of the datasets-mission merger: datasets are git-repository content with a semantic contract (descriptor shape, layer visibility classes), version pinning, and per-session access governance. M1 delivers the whole host face — repository layout convention, the `ctx.datasets` service core, the seven model tools, the CLI, the slash command, the session binding, managed worktrees, and tests — with zero official code changes and no dependency on the mission/lab sibling proposals.

## Decision

Shipped as `packages/datasets` (`@khorsheed/dsh-datasets`), loader entry id `datasets` (identity triangle: `cordis.patch.yml` row, tsdown entry set, `src/invariant.ts` PACKAGE_NAME). One service core (`src/service.ts`, `createDatasetsService`) backs all three faces; the model tools (`src/index.ts`), the `dsh-datasets` CLI (`src/cli.ts`), and the `/datasets` slash command are adapters over it.

- **Layout + shape validation** (`src/dataset.ts`): `datasets/<id>/dataset.json` + `items/<item-id>/item.json` + `<layer>/…`. Only the shape is validated (non-empty layers manifest, `modelFacing` boolean defaulting true, `itemMetaSchema` present-as-object); all other descriptor fields and files pass through. **JSON, not YAML**: no YAML parser sits on this package's dependency chain and the task forbids adding one, so v1 reads `dataset.json`/`item.json`; the README's Known Limitations says so.
- **Single storage**: every read comes from git objects (`git show`/`git ls-tree` at a resolved commit, `src/git.ts`). There is no file-by-file spawn-git materialization verb and no copy-out.
- **Whitelist as mechanism**: the scope (`{repo, datasets?, layers?}`) travels into the service; `list`/`show` filter to it, `read` rejects outside it (`LAYER_NOT_ALLOWED`), and `worktree_path` intersects requested layers with it — an empty intersection fails loud. `put_item` also refuses whitelisted-out or descriptor-undeclared layers: writing content the agent cannot read back would be asymmetric. The binding whitelist applies whenever a binding exists, even alongside an explicit `repo` (the binding human owns the session's visibility).
- **Managed worktrees** (`src/worktree.ts`): cache key (realpath(repo), commit, sorted layers) → `<root>/<repoHash>/<commit>-<layersHash>/`; `git worktree add --detach` then `sparse-checkout set --no-cone /datasets/<id>/items/*/<layer>/` (the pattern covers every item directory of exactly the allowed layers — disallowed layers are physically absent, verified by test), then `git worktree lock`. Same-key creation serializes on a `<dir>.lock` mkdir lock with stale-breaking; both cache-key sides are realpath-canonicalized (macOS `/var` vs `/private/var` must not fork the cache). The registry is `git worktree list`; `prune` unlocks + removes only managed entries of one repository. The invariant companion (`src/invariant.ts`) checks the managed root's structural integrity at load.
- **Session binding** (`src/binding.ts`): per-session durable binding with human-only writes (slash, web tab, CLI). **Storage superseded**: it shipped as a log-only `datasets/binding` session event (the `goal/change` precedent) — a downstream custom event type is unresumable by construction (no known-types registration, no `ignorable` channel on `Session.append`), so the binding moved to a plugin-owned store (`<stateRoot>/bindings/*.json`); [the resume-poisoning bug-fix note](../bug-fix/2026-08-20-downstream-session-events-unresumable.md) owns that decision and removed `src/session-log.ts`.
- **Tools** (`src/index.ts`): `datasets_list / show / describe / read / snapshot / worktree_path / put_item` via `defineTool`, handlers resolving the session through `exec.agent.session`; explicit `repo` wins over the binding, no repo source at all fails loud with how-to-bind. A `systemPrompt` guidance section is probed via `ctx.get` (absent in minimal compositions — degrade, don't explode). `inject: ['commands', 'tools']` per the proposal (the base bundle always mounts both).

## Alternatives considered

- **YAML descriptors with a new dependency** — rejected: the proposal itself names the JSON fallback and forbids growing the dependency chain for it; `dataset.json` keeps v1 honest and a later YAML-capable line can accept both.
- **CLI bind through a host RPC** — rejected: no such seam exists in the host CLI (`dsh` exposes only `web`/`plugin`); appending to the JSONL log is adapter-local but real, and the zstd frame layout is reproduced structurally (magic + header + block walk) rather than guessed.
- **Whole-layer reads by per-file `git show`** — rejected by the proposal (dozens of spawned git processes per view); the managed worktree is the only whole-layer path.
- **Sparse-checkout via `--no-checkout` add then materialize** — rejected on reliability grounds: the index state after `--no-checkout` is version-dependent, while add-then-`sparse-checkout set` deterministically prunes the working tree (the transient full checkout costs some IO on creation only).
- **Applying the binding whitelist only when reading the binding's own repo** — rejected as less conservative: the whitelist's strength is the binder's decision, and an explicit `repo` is a selector, not an authorization upgrade.

## Consequences

- Mission/lab siblings can consume `ctx.datasets` (snapshot references, layer visibility metadata, `worktree_path` views) with zero coupling; their absence is invisible to this package.
- `put_item` writes the working tree only; nothing in the package ever commits. Worktrees are shared read-only caches: a consumer that dirties one gets it rebuilt by `prune`, not defended by the plugin.
- Descriptor semantics (rubric/stages/schemas in evaluation layouts) stay with dataset authors; the plugin's only opinion is the shape.

## Testing

`packages/datasets/tests/` — 39 tests over 6 files, fixtures are runtime temp-dir git repositories (`os.tmpdir()` + `mkdtemp`, no machine paths). Coverage maps to the proposal's acceptance criteria: whitelist enforcement including a worktree physically lacking the disallowed layer directory, same-key dedup (in-process and across two spawned CLI processes), pin stability under repo evolution, `prune` unlocking and removing only managed entries, binding store write/read/unbind round-trips and restart persistence (the session-event fold and the offline zstd append left with the storage move), `read` producing no out-of-repo copy, `put_item` writing the working tree without moving HEAD, CLI exit-code semantics, and the bundle-patch identity row.

## Cross-references

- [datasets proposal](../../../proposals/active/2026-08-19-datasets-store.md) — the design this implements (M1).
