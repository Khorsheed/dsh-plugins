# Agent Note: Mirror sync ships only git-tracked files

Status: implemented

## Problem

The standalone mirrors are **public**; the monorepo is not. `scripts/sync-mirror.mts` chose what to copy by walking the artifact directory on disk (`readdirSync` + recursive `cpSync`), minus a three-entry skip set. Every gitignored file that happens to live in that directory therefore crossed into a public repository: build tarballs (`*.tgz`), `*.tsbuildinfo`, `*.log`, and debug screenshots.

The repo hygiene gate cannot cover this path. `check-repo-hygiene` scans git's view — the staged set, or every tracked file — so a gitignored file is simultaneously invisible to the gate and eligible for publication. The two mechanisms disagreed about what "in the repo" means.

Not hypothetical: `packages/ankh-guard/khorsheed-dsh-ankh-guard-0.1.2.tgz` (untracked, ignored by `*.tgz`) sat in the pending sync set for `Khorsheed/dsh-ankh-guard`, and `packages/file-preview/` holds a second one.

## Decision

`mirrorFiles(kind, name)` enumerates `git ls-files` under `<kind>s/<name>`, strips the artifact prefix, and drops paths whose top-level entry is in the kind's skip set. The sync copies exactly that list, creating parent directories as it goes. Untracked files need no skip entry — the selector never sees them.

Two guards ride with the change:

- **An empty selection aborts.** Copying nothing into a wiped mirror would otherwise read as a successful sync.
- **Push mode refuses a dirty artifact directory.** Content is read from the working tree while the sync commit records `sync from dsh-plugins @ <sha>`; a dirty tree makes that message a false claim. `--check` and `--dry-run` still run against the working tree, because inspecting uncommitted work is their purpose.

The script exports `main(argv)` and self-invokes only when it is the entry module. The per-kind wrappers (`sync-profile-mirror.mts`, `sync-ankh-guard-mirror.mts`) call `main()` with a composed argv instead of mutating `process.argv` and re-importing, which is also what lets `scripts/sync-mirror.spec.ts` import `mirrorFiles` without triggering a clone.

## Alternatives considered

**Teach the skip set the gitignore patterns.** Keeps the disk walk and enumerates what must not escape. Rejected for its failure mode: a newly ignored pattern leaks until a human notices a public commit. Tracked-only inverts the direction — the failure mode becomes a *missing* file in the mirror, which is loud and immediately visible in the `--check` diff. Same reasoning the profile template used when it chose an explicit copy whitelist over "copy all minus exclusions".

**Copy from `git archive HEAD`.** Content would equal the recorded sha by construction and no dirty guard would be needed. Rejected because it discards working-tree edits silently: a sync run after editing but before committing would report "already up to date" while shipping the previous content. The explicit refusal names the problem instead of hiding it.

**Keep the disk walk and widen hygiene to untracked files.** Rejected: hygiene's contract is git's view, and scanning the whole tree would flag every developer's local scratch state on every commit — a gate that cries wolf gets bypassed.

## Consequences

- A file can reach a public mirror only if it is tracked, which means it already passed the hygiene gate. The two mechanisms now share one definition of "in the repo".
- Syncing requires committing first. This matches the publishing discipline already in force (`docs/publishing.md`: 发布源只认仓库).
- The `node_modules` / `lib` entries in the skip sets are now redundant — those paths are untracked. They stay as a statement of intent; only `tests` (the skill's e2e rig) does load-bearing work.
- Force-added screenshots (`git add -f` past the image gitignore) still cross over: they are tracked, which is exactly the distinction the mirrors need.

## Testing

`scripts/sync-mirror.spec.ts` runs against the real tree, like the other checker specs. It pins the boundary directly — every emitted path must be tracked (`git ls-files --error-unmatch`), `lib/`, `node_modules/` and `*.tgz` never appear, the skill's `tests/` stays home, and `profiles/basic`'s force-added screenshots still ship. A regression to a disk walk fails the first assertion immediately, because `lib/` is untracked.
