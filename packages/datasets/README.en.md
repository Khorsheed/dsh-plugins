# dsh-datasets

English | [中文](README.md)

Generic versioned dataset storage over git repositories: layered items, commit-pinned reads straight from git objects, managed sparse-checkout worktree views for whole-layer consumption, and per-session bindings whose layer whitelist is enforced on every read path.

The plugin exists for the three things a file browser does not have: a **semantic contract** (descriptor shape validation, layer visibility classes, a declared item-metadata schema), **version pinning** (snapshots, git-object reads, commit-deduplicated managed worktrees), and **access governance** (a per-session binding whose layer whitelist is a mechanism, not a convention). It never interprets a dataset's semantics, and it never copies content out of the repository.

## The dataset repository layout

A dataset store is an ordinary git repository. The directory structure is the convention; layer names are arbitrary and declared by the descriptor. A layer directory may exist at **two levels** — dataset-level layers hold content shared across items, item-level layers hold per-item content:

```
<repo>/
  datasets/<dataset-id>/
    dataset.json           # id, name, layers manifest (visibility classes), item metadata schema
    <layer>/...            # dataset-level layer (a top-level directory named by the layers manifest)
    <any other files>      # descriptor passthrough — carried, unread, unreachable by the read paths
    items/<item-id>/
      item.json            # item metadata (fields constrained by the declared schema)
      <layer>/...          # item-level layers
```

Version = git commit. The plugin validates the **shape** of `dataset.json` only: `id`, optional `name`, a non-empty `layers` manifest where each entry declares `name` and may declare `modelFacing: false` (default true), and an optional `itemMetaSchema` object. Everything else passes through verbatim.

The two-level rule is purely name-based: a top-level directory whose name is declared in the `layers` manifest IS a dataset-level layer; every other top-level file or directory is descriptor passthrough and stays outside `list`/`show`/`read`/`worktree_path` exactly as before. `items` is the reserved item container and may not name a layer. All mechanisms apply at both levels uniformly: the session binding's layer whitelist (filtered listings, rejected reads, sparse-checkout patterns covering `datasets/<id>/<layer>/` and `datasets/<id>/items/*/<layer>/` alike) and the `modelFacing` visibility class (the declaration is per layer NAME, so it covers both levels by construction). In evaluation-suite layouts this is where cross-item shared content with visibility requirements goes: `suites/<suite>/verify/helpers/` as a dataset-level layer (mounted only at judging time), and grading rubrics move from loose top-level directories into a declared dataset-level layer so the whitelist actually governs them.

`modelFacing: false` is a data declaration with exactly one meaning: exporting that layer off the machine must pass a human confirmation gate (the gate belongs to the exporter, not this plugin). It is independent of the session binding's layer whitelist — the whitelist governs what the session's agent can see; the export gate governs what may leave the machine.

`modelFacing` defaults to `true` when a layer omits the key. Because descriptor files get copied as templates, shape validation also **warns** (never blocks): in a mixed-sensitivity dataset — one that has any explicit `modelFacing: false` layer — every layer that left the key undeclared produces one warning (`MODELFACING_UNDECLARED`, per layer). Datasets with no hidden layer, and datasets where every layer is explicit in either direction, stay silent. The warnings ride the dataset summary: the CLI prints them to stderr on `list`/`show`/`describe`, the slash command appends them to its output, and the web tab shows them as a quiet line under the dataset row.

Content enters a dataset as plain files in the repository, committed through the normal git flow, or drafted by an agent via `datasets_put_item` into the working tree and committed by a human after review. There is no import verb and no copy-out materialization: single files are read from git objects, whole layers are consumed through managed worktrees.

## Install and load

This package is a dsh plugin with the single identity **`@khorsheed/dsh-datasets`**, developed in the `dsh-plugins` monorepo (`packages/datasets`) and published to npm from there:

```sh
npm install @deepseek-ai/dsh                            # the host (dsh web / dsh CLI)
dsh plugin --profile web add @khorsheed/dsh-datasets    # this plugin
```

The package declares `dsh.bundle`, so the add reconciles its `cordis.patch.yml` row (a bare `datasets` mount) into the profile's bundles layer — no hand-edited cordis.yml. A composition may mount the `datasets` row id only once; `dsh --profile web --dump-config | grep datasets` printing nothing means the add is safe.

Config (all optional): `repo` (default dataset repository when a call has no explicit `repo` and the session has no binding; default none) and `worktreeRoot` (managed worktree root override; default `$DSH_HOME/state/datasets/worktrees`, else `<cwd>/.dsh-datasets/worktrees`).

The plugin provides the `ctx.datasets` service for other plugins to consume optionally, registers the seven `datasets_*` model tools and the `/datasets` slash command, mounts the `datasetsRemote` Typert Remote service (the web session tab's data face), and (when the composition mounts `@khorsheed/dsh-datasets/invariant`) checks the managed worktree root's structural integrity at load.

## The session binding

Each session may bind its own dataset repository, stored as a plugin-owned durable state file — one JSON record per session under the plugin state root (`$DSH_HOME/state/datasets/bindings/`, else `<cwd>/.dsh-datasets/bindings/`):

```ts
{ repoPath: string, datasets?: string[], layers?: string[] }
```

`datasets` restricts which dataset ids are visible; `layers` is the layer whitelist. Absent fields mean "everything". The whitelist is enforced on **every** tool read path — `list`/`show` filter to it, `read` rejects outside it, and `worktree_path` intersects with it (an empty intersection is an error; the sparse-checkout physically omits disallowed layer directories).

**Why not a session event**: the binding was a log-only `datasets/binding` session event in the first cut, but the harness's persistence read path refuses to rebuild a session whose log contains an event type outside its generated known-types set unless the envelope carries `ignorable: true` — a downstream plugin's event types are outside that set by construction (the registration surface is deferred upstream), and `Session.append()` offers no way to set the marker. Any custom-typed event this plugin appended made the session unresumable, so the binding moved to the plugin's own store (read per call, so a CLI write to a live session's binding is race-free). The trade: a forked session starts unbound, and deleting a session leaves an orphan record behind.

Binding **writes** are human operations: `/datasets bind` in a live session, the web tab's binding bar, or `dsh-datasets bind` from a script. Agent tools only resolve the binding — which datasets an agent may use is decided by the human. Tool calls with an explicit `repo` argument do not need a binding (the whitelist still applies when one exists); with neither an explicit repo nor a binding nor a configured default, tools fail loud and say how to bind.

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
dsh-datasets bind --session ID --repo R [--datasets a,b] [--layers x,y] [--state-root DIR]
dsh-datasets unbind --session ID [--state-root DIR]
dsh-datasets binding --session ID [--state-root DIR]
```

`bind`/`unbind` write the plugin-owned binding store (`--state-root` defaults to `$DSH_HOME/state/datasets`; bindings live under its `bindings/` subdirectory). The store is read per call, so binding a session a running instance has open is race-free — the next tool call in that session sees the new binding.

## Slash commands

```
/datasets list [dataset]
/datasets show <dataset> [item]
/datasets bind <repoPath> [--datasets a,b] [--layers x,y]
/datasets unbind
```

## The session tab (web)

<!-- screenshot placeholder: docs/screenshots/…-datasets-tab.png (pending) -->

On web profiles the plugin contributes a **`datasets` tab** to the conversation's view ring (beside chat and trajectory) — the session's dataset binding and browser. The tab is pure navigation: a binding bar on top (the current binding with its dataset/layer whitelists, plus bind / edit-whitelist / unbind gestures — binding writes stay human operations here exactly as on the slash path), a dataset → (shared layers →) item → layer → file tree on the left (dataset-level layers group under a quiet Shared label ahead of the items), and a content preview on the right. The preview is delegated to the official reader primitives — markdown renders through the official `MarkdownText` pipeline (the same renderer the chat uses), every other file through the official `CodeBlock` syntax highlighter; there is no self-rolled renderer in this package.

The tab's data face is a Typert Remote service (`datasetsRemote`, wire namespace `datasets`) over the same service core as the tools: `binding` / `bind` / `unbind` / `list` / `show` / `read`, each resolving the session binding from the calling agent, so the binding's layer whitelist is enforced on the Remote path exactly as on the tool path. The browser half mounts the namespace through the official `ctx.remote.$mount` channel.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.0-rc.6+`): ✅ — every capability works; the contract surface (`ctx.tools`, `ctx.commands`, log-only session events, the Typert Remote channel, `conversation.view`) is stable across the line. The session tab is live-smoke-tested on the rc.8 web profile (bind → tree → preview); earlier release lines share the same gateway conventions but were not smoke-tested.
- source line (deepseek-harness master): ✅.
- ⚠️ degraded (both lines): slash commands need an interactive UI adapter (web/TUI profile); on headless profiles `/datasets` is unavailable while the model tools and the CLI stay fully functional. The session tab is a web surface — TUI has no tab mechanism; headless profiles serve the Remote data face without a browser consumer.

This section mirrors the `dsh.compat` field in package.json; the two move together.

## Known Limitations and Deferred Work

- **Descriptors are JSON, not YAML** — the layout convention calls them `dataset.yml`/`item.yml`, but no YAML parser is available on this package's dependency chain and adding one is deliberately out of scope, so v1 reads `dataset.json`/`item.json`. A future YAML-capable line can accept both.
- **Item metadata is not validated against `itemMetaSchema`** — the schema is declared, shape-checked as an object, and passed through; full JSON-Schema validation of item metadata needs a validator dependency this package does not take.
- **The session tab's preview reads whole files over RPC** — `read` serves full file content with no byte cap (the same semantics as the tool); very large layer files are better consumed through `worktree_path`.
- **A forked session starts unbound** — the binding is filed under the session id in the plugin-owned store and does not follow a fork; deleting a session leaves its binding record behind (harmless, one small JSON file).
- **A worktree a consumer dirtied is rebuilt by `worktree prune`** — the read-only contract is enforced by the consumer's mount (`:ro`), not by the plugin.
- **`worktree prune` needs `--repo`** — the registry is `git worktree list`, which is per-repository; orphaned roots of deleted repositories are removed by hand.
