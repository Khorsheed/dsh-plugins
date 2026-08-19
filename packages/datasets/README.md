# dsh-datasets

English | [中文](README.zh.md)

Generic versioned dataset storage over git repositories: layered items, commit-pinned reads straight from git objects, managed sparse-checkout worktree views for whole-layer consumption, and per-session bindings whose layer whitelist is enforced on every read path.

The plugin exists for the three things a file browser does not have: a **semantic contract** (descriptor shape validation, layer visibility classes, a declared item-metadata schema), **version pinning** (snapshots, git-object reads, commit-deduplicated managed worktrees), and **access governance** (a per-session binding whose layer whitelist is a mechanism, not a convention). It never interprets a dataset's semantics, and it never copies content out of the repository.

## The dataset repository layout

A dataset store is an ordinary git repository. The directory structure is the convention; layer names are arbitrary and declared by the descriptor:

```
<repo>/
  datasets/<dataset-id>/
    dataset.json           # id, name, layers manifest (visibility classes), item metadata schema
    <any other files>      # descriptor passthrough — the plugin carries them, unread
    items/<item-id>/
      item.json            # item metadata (fields constrained by the declared schema)
      <layer>/...          # arbitrarily named layers
```

Version = git commit. The plugin validates the **shape** of `dataset.json` only: `id`, optional `name`, a non-empty `layers` manifest where each entry declares `name` and may declare `modelFacing: false` (default true), and an optional `itemMetaSchema` object. Everything else passes through verbatim.

`modelFacing: false` is a data declaration with exactly one meaning: exporting that layer off the machine must pass a human confirmation gate (the gate belongs to the exporter, not this plugin). It is independent of the session binding's layer whitelist — the whitelist governs what the session's agent can see; the export gate governs what may leave the machine.

Content enters a dataset as plain files in the repository, committed through the normal git flow, or drafted by an agent via `datasets_put_item` into the working tree and committed by a human after review. There is no import verb and no copy-out materialization: single files are read from git objects, whole layers are consumed through managed worktrees.

## Install and load

This package is a dsh plugin with the single identity **`@khorsheed/dsh-datasets`**, developed in the `dsh-plugins` monorepo (`packages/datasets`) and published to npm from there:

```sh
npm install @deepseek-ai/dsh                            # the host (dsh web / dsh CLI)
dsh plugin --profile web add @khorsheed/dsh-datasets    # this plugin
```

The package declares `dsh.bundle`, so the add reconciles its `cordis.patch.yml` row (a bare `datasets` mount) into the profile's bundles layer — no hand-edited cordis.yml. A composition may mount the `datasets` row id only once; `dsh --profile web --dump-config | grep datasets` printing nothing means the add is safe.

Config (all optional): `repo` (default dataset repository when a call has no explicit `repo` and the session has no binding; default none) and `worktreeRoot` (managed worktree root override; default `$DSH_HOME/state/datasets/worktrees`, else `<cwd>/.dsh-datasets/worktrees`).

The plugin provides the `ctx.datasets` service for other plugins to consume optionally, registers the seven `datasets_*` model tools and the `/datasets` slash command, and (when the composition mounts `@khorsheed/dsh-datasets/invariant`) checks the managed worktree root's structural integrity at load.

## The session binding

Each session may bind its own dataset repository, stored as a log-only session event (`datasets/binding`, the `goal/change` precedent) — it persists with the session and is auditable in its log:

```ts
{ repoPath: string, datasets?: string[], layers?: string[] }
```

`datasets` restricts which dataset ids are visible; `layers` is the layer whitelist. Absent fields mean "everything". The whitelist is enforced on **every** tool read path — `list`/`show` filter to it, `read` rejects outside it, and `worktree_path` intersects with it (an empty intersection is an error; the sparse-checkout physically omits disallowed layer directories).

Binding **writes** are human operations: `/datasets bind` in a live session, or `dsh-datasets bind` for an offline one. Agent tools only resolve the binding — which datasets an agent may use is decided by the human. Tool calls with an explicit `repo` argument do not need a binding (the whitelist still applies when one exists); with neither an explicit repo nor a binding nor a configured default, tools fail loud and say how to bind.

The whitelist is a session-level constraint, not a security boundary: a same-machine human can rebind, and an agent with shell access can read the original repository. It prevents accidental fetches and workflow cross-contamination, not malice.

## Model tools

| Tool | Writes? | Purpose |
|---|---|---|
| `datasets_list` | | List datasets in scope, or one dataset's items with metadata |
| `datasets_show` | | Dataset/item detail: summary, descriptor passthrough, layer-file listing |
| `datasets_describe` | | The raw `dataset.json` descriptor, verbatim |
| `datasets_read` | | One file of one item layer, from the git object at the pinned commit — no copy |
| `datasets_snapshot` | | Pin `{repoPath, commit, datasetId}` for stable reads while the repo evolves |
| `datasets_worktree_path` | creates a managed worktree | Whole-layer read-only view path (sparse-checkout-limited, deduplicated) |
| `datasets_put_item` | writes the working tree | Create/update an item's metadata and layer files; `git commit` stays with the human |

`worktree_path` returns an ordinary directory under the managed root, keyed by (repo, commit, sorted layers) and shared machine-wide per key: `git worktree add --detach <commit>` + sparse-checkout limited to the layer directories + `git worktree lock`. Consumers mount it read-only or read it directly, and never modify or delete it — it is a cross-consumer cache. Same-key concurrent creators serialize on a lock directory under the managed root; the second one reuses the finished worktree. Cleanup is the CLI's `worktree prune`.

## CLI

The `dsh-datasets` bin mirrors the tools' read verbs (same semantics, same parameters) and adds the maintenance verbs. Repository resolution: `--repo`, else `$DSH_DATASETS_REPO`. Exit codes: 0 ok, 1 operational failure, 2 usage error.

```sh
dsh-datasets list [--repo R] [--dataset D] [--commit C]
dsh-datasets show --dataset D [--item I]
dsh-datasets describe --dataset D
dsh-datasets read --dataset D --item I --layer L --path P [--commit C]
dsh-datasets snapshot --dataset D
dsh-datasets worktree path --dataset D [--layers a,b] [--worktree-root DIR]
dsh-datasets worktree prune --repo R [--worktree-root DIR]
dsh-datasets bind --session ID --repo R [--datasets a,b] [--layers x,y] [--sessions-root DIR]
dsh-datasets unbind --session ID [--sessions-root DIR]
dsh-datasets binding --session ID [--sessions-root DIR]
```

`bind`/`unbind` append the binding event directly to the session's JSONL log (plain and zstd-frame layouts both supported; the root defaults to `$DSH_HOME/sessions`). **Safety**: appending to a session a running instance has open races the backend's in-memory sequence counter — only bind sessions that are not live; the live path is `/datasets bind`.

## Slash commands

```
/datasets list [dataset]
/datasets show <dataset> [item]
/datasets bind <repoPath> [--datasets a,b] [--layers x,y]
/datasets unbind
```

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.0-rc.6+`): ✅ — every capability works; the contract surface (`ctx.tools`, `ctx.commands`, log-only session events) is stable across the line.
- source line (deepseek-harness master): ✅.
- ⚠️ degraded (both lines): slash commands need an interactive UI adapter (web/TUI profile); on headless profiles `/datasets` is unavailable while the model tools and the CLI stay fully functional.

This section mirrors the `dsh.compat` field in package.json; the two move together.

## Known Limitations and Deferred Work

- **Descriptors are JSON, not YAML** — the layout convention calls them `dataset.yml`/`item.yml`, but no YAML parser is available on this package's dependency chain and adding one is deliberately out of scope, so v1 reads `dataset.json`/`item.json`. A future YAML-capable line can accept both.
- **Item metadata is not validated against `itemMetaSchema`** — the schema is declared, shape-checked as an object, and passed through; full JSON-Schema validation of item metadata needs a validator dependency this package does not take.
- **The session tab is M2** — browsing UI on `conversation.view`, with previews delegated to the official file reader, is designed but not in this line; TUI has no tab mechanism either way.
- **CLI `bind` is offline-only by design** — it appends to the session log directly (see the safety note above); binding a live session goes through the slash command.
- **A worktree a consumer dirtied is rebuilt by `worktree prune`** — the read-only contract is enforced by the consumer's mount (`:ro`), not by the plugin.
- **`worktree prune` needs `--repo`** — the registry is `git worktree list`, which is per-repository; orphaned roots of deleted repositories are removed by hand.
