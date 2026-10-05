# Agent Note: local-files filename search is a host walk rendered as a force-expanded filtered tree

Status: implemented

## Problem

The local-files browser (the right-sidebar `files` tab) loads its tree one directory level at a time. Locating a file by name in a deep tree meant clicking folder by folder, and the tree's laziness is exactly why a filename search cannot be a client-side filter: the client only ever holds the levels it has expanded, so filtering loaded rows would miss the common case — the hit sits inside a folder nobody opened. The requested behavior was explicit: search file AND folder names, and when a hit is nested in folders the ancestors must auto-expand to reveal it.

## Decision

### The search is one host-side walk behind a new Remote method

`LocalFilesService.searchLocalDirectory(path, query, includeHidden)` (service.ts) runs a single iterative DFS over the tree, matching a case-insensitive substring against entry basenames, and answers root-relative hit paths (`docs/guide/intro.md`). It is exposed as `localFiles/search` on the existing Remote face (remote.ts), wired into the view through the injected `searchFiles` face (contract.ts, client/index.ts) — the same absolute-path, no-lookup discipline as `listDirectory`/`readFile`.

The walk is deliberately hostile-tree-safe rather than ignore-list-smart: bounded by `SEARCH_MAX_RESULTS` (200), `SEARCH_MAX_VISITED` (50,000) and `SEARCH_MAX_DEPTH` (16) with a `truncated` flag on any cap hit; it never descends into `node_modules` or `.git` (dependency and VCS internals dwarf everything else and never hold a user document); it never follows symlinks (`readdir` with `withFileTypes` reports the link itself, so cycles are impossible by construction); unreadable directories degrade to zero hits. Hidden (dot-prefixed) entries follow the caller's `includeHidden`, which the view binds to the tree's eye toggle, so a hit never names a row the tree would not render.

### Search mode is a tree presentation, not a separate results list

WorkspaceView owns the query, a 200ms debounce, and a sequence guard that drops answers arriving after the query moved on; a root/session switch drops an in-flight search, and `rev` (refresh) or the hidden toggle re-runs an open one. While the query is non-empty the view swaps the tree's `groups` for the hit list; FileTree's trie builder turns each root-relative hit path back into its ancestor chain, and search mode force-expands every ancestor that has hit-chain children. Those ancestors render ONLY the hit chain — the lazy cache holds full listings, which would defeat the filter — while a matched directory without hit children keeps the plain toggle + lazy-load behavior (click to see its contents). Expand/collapse-all hides in search mode (a whole-tree gesture is meaningless against a filtered list); Escape in the input clears the query, then closes the row; truncation and no-match states get their own lines (`tree.searchTruncated`, `tree.searchNoMatch`).

### icons.tsx carries one hand-written glyph — the generator is broken against the current harness

`IconSearchOutlineMedium` was added to `packages/local-files/src/client/icons.tsx` by hand, artwork copied verbatim from the harness (`client/ui-primitives` icons/index.tsx), because `scripts/sync-icon-artwork.mts` currently crashes on ANY package: upstream added artworks with a `({ size = 14, ...rest }: WeightedIconProps)` signature (e.g. `IconQueueOutlineArtwork`) that the script's artwork regex does not parse. This predates the search change and blocks every future icon sync until the parser learns the new shape — the generated header's "never hand-edit" rule is suspended, not repealed.

## Alternatives considered

**Client-side recursive walk over the existing `listDirectory`.** No new Remote method, but a deep tree costs one round-trip per directory (hundreds on a real checkout), the caps become distributed state, and the walk cannot be cancelled or bounded atomically. One host walk is one call with server-side bounds.

**A flat results list under the input.** Simpler rendering, but it forks the surface's mental model (two ways to see files) and duplicates selection/expansion behavior; the filtered-trie answer reuses the tree's rows, selection and lazy expansion unchanged, and matches the requested "auto-expand the containing folders" verbatim.

**Honor gitignore / a configurable skip list.** A gitignore parser is a dependency and a semantics (git-bound roots only) this git-agnostic browser deliberately lacks; the hard `node_modules`/`.git` skip plus walk caps cover the pathological cases without either.

**Filter only already-loaded nodes.** Misses the motivating case — the file nobody expanded to yet — and makes the result set depend on interaction history.

## Consequences

- Search works on ANY browsable absolute root, not just workspaces, and costs one Remote call per debounced keystroke. A search over a genuinely huge root (a home directory) may truncate; the tree says so instead of pretending completeness.
- The local-files FileTree is this package's own copy (worktrees forked its own long ago), so the search chrome lands on exactly one surface; the worktrees tree is untouched apart from the shared tooltip wording fix (separate commit).
- `sync-icon-artwork.mts` is broken against the current harness checkout for every package (pre-existing, now load-bearing knowledge). Fixing the artwork parser is the follow-up; until then `--check` cannot gate and new icons are hand-copied like this one.
- Tests pin the behavior at both planes: `tests/service.spec.ts` walks real tmp fixtures (case-insensitivity, hidden policy, the node_modules/.git carve-out, traversal rejection), and `tests/workspace-view.client.spec.tsx` asserts the force-expanded ancestor rendering, the no-match state, and the restore-on-clear round trip.

## Related

- The narrow-desktop `预览/源码` proportion fix (same day, commit c29b77f7) gates the mobile 40px switch bump behind `@media (pointer: coarse)` in ui-content-preview's ContentPane — a separate, purely local CSS decision that rides the same deploy wave.
