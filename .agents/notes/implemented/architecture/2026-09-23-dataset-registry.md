# Agent Note: Dataset registry and read-only materialization

Status: implemented

## Problem

Until T73 a dataset repository reached an agent through a per-session binding (`bindings/<session>.json`, written by `/datasets bind`, the tab's binding bar, or the CLI). Three things went wrong with that shape:

- **An agent could not tell «can be found» from «may be used».** In a session with no binding the tools answered truthfully "have the human bind one"; the agent did not stop — it globbed the disk, found the dataset checkout several agents share, and wrote three files on someone else's branch. Any path argument the tools accepted was one more invitation to do that.
- **«Latest» meant a checkout's HEAD.** The shared checkout's HEAD belongs to whoever is working in it at the moment, so what an experiment read depended on which branch another agent had checked out.
- **Materialization wrote shared state.** `worktree_path` ran `git worktree add` + `git worktree lock` in the repository's shared `.git`: every whole-layer view added a locked entry to the worktree list of a checkout other people work in. The dataseek-eval checkout's list reached 38 lines, 25 of them locked managed views.

A registration is also a deployment fact, not a session fact: the same repository was bound again in every new session, and 3171 carried three bindings for one repository plus one pointing at a directory that no longer exists.

## Decision

**The registry.** One JSON file under the state root, `$DSH_HOME/state/datasets/registry.json` (`packages/datasets/src/registry.ts`), one record per repository: `{id, commonDir, trackedRef, registeredAt, registeredCommit, sets: {<set>: {layers}}, authoringCheckout}`.

- Identity is the realpath of the git common dir, so a checkout, its `.git`, and its linked worktrees are one registration; a second registration of the same repository, or a taken `id`, is refused (`ALREADY_REGISTERED`).
- «Latest» is `git rev-parse <trackedRef>` — never HEAD. A missing branch is refused (`REF_NOT_FOUND`); the tab keeps the registration visible with that sentence, and `datasets_list` skips it. `registeredCommit` is audit only.
- `sets` stores only what a person chose; an omitted set is stored as nothing and gets the `modelFacing` floor at read time, so a set added to the branch later is covered without re-registration. Naming an undeclared layer is refused (`LAYER_UNDECLARED`).
- `authoringCheckout` is the only tree `datasets_put_item` writes; none → `NO_AUTHORING_CHECKOUT`. Reads come from the tracked branch's objects, writes go to the authoring checkout; committing and merging stay human.
- Only humans write it: the tab's register form (path + native chooser + live preview, per-set layer chips defaulting to model-facing, tracked-branch dropdown defaulting to `main`), the one-click «从旧绑定登记», and the CLI (`register` / `update` / `unregister` / `import-bindings`). The Remote verbs are `registry`, `previewRepo`, `register`, `updateRegistration`, `unregister`, `importBindings`; every read request carries the registry `id` as `repo`.

**Agents speak references only.** Every tool's `dataset` argument is `<id>/<set>`. The three wrong shapes each refuse with a sentence the agent can act on: a path (`PATH_NOT_REF`, naming the reference when the path is registered), an ambiguous name (`AMBIGUOUS_DATASET`, listing candidates and saying to use `ask_user_question`), and an unregistered repository or name (`NOT_REGISTERED`: "is not registered in this deployment … Do not read that directory yourself"). `datasets_list(query?)` returns `{datasets: [{ref, title, trackedRef, latest: {commit, date}, layers}]}` and no string in it starts with `/` or `~/`. The layer whitelist of every agent read comes from the registration; the operator view (tab, CLI) is unfiltered, as before.

**Materialization** (`src/materialize.ts`) replaces the managed worktree: `git archive <sha> -- <layer paths>` untarred into a private staging dir, made read-only, renamed atomically into `$DSH_HOME/state/datasets/materialized/<repoKey>/<sha>/<set>/<layers-key>/`. `repoKey` hashes the common dir, the sha must be a full id the repository knows, and every pathspec must stay inside `datasets/<set>/`. The key fully determines the content, so a present directory is a cache hit. The return shape `{path, commit, layers, reused}` is unchanged, which is what eval's `run.ts` consumes.

**The legacy binding stays readable.** Eval still reads a session's binding through `DatasetsBindingFace.binding()` and resolves the repository through the binding read path; the three "no dataset repository" sentences in `resolveScope` are unchanged. Moving eval to references is branch 2 of T73. So binding files are never deleted automatically, `binding` / `unbind` stay on the CLI, and every door that WROTE a binding is retired: `/datasets bind` and CLI `bind` answer with directions to register, and the tab's binding bar and the composer's `BindingChip` are gone. `importBindings` folds bindings of one repository into one registration, marks dangling ones and skips them, and leaves the binding files byte-identical.

### What this change does not touch

- Eval and eval-tool (branch 2), the SKILL and presets (branch 3), the protocol files (rev13 rides with branch 2), and the dataset repository itself. The code only runs `git show` / `archive` / `rev-parse` against the shared checkout: no worktree, no HEAD move.
- **The 25 legacy managed worktrees are not removed by this change.** Removing them writes the shared `.git`, so a human runs the commands in [Cleanup of the legacy managed worktrees](#cleanup-of-the-legacy-managed-worktrees).

### Cleanup of the legacy managed worktrees

The managed views are the entries whose path ends in `worktrees/<16-hex repo key>/<key>`, all locked. Human worktrees in the same list do not have that shape and are not matched. The shape does not say whose state root a view lives under, though: a view under the state root of an instance that still runs the pre-registry code (a person's everyday instance, say) is still in use by it. Run this only after every instance that consumes these views has moved to the registry build, and exclude any state root that has not. With `REPO` set to the shared dataset checkout and `KEEP` to a state root to leave alone:

```sh
git -C "$REPO" worktree list --porcelain \
  | awk '/^worktree /{print $2}' \
  | grep -E '/worktrees/[0-9a-f]{16}/[^/]+$' \
  | grep -vF "$KEEP/" > /tmp/managed-worktrees.txt
wc -l /tmp/managed-worktrees.txt          # review the list before going on
while read -r p; do
  git -C "$REPO" worktree unlock "$p" || true
  git -C "$REPO" worktree remove --force "$p" || true
done < /tmp/managed-worktrees.txt
git -C "$REPO" worktree prune
```

The directories that used to hold them (`$DSH_HOME/state/datasets/worktrees/`, `<cwd>/.dsh-datasets/worktrees/`) can be removed afterwards; nothing reads them now.

## Alternatives considered

**Keep the binding and harden the `repo` argument (the T58 shape).** T58 already made `repo` restate only the binding. It did not stop the incident: the refusal told the agent to find a human, and the agent found a directory instead. As long as a tool accepts a path, the agent has a reason to go looking for one. A registry reference names nothing on disk.

**Resolve «latest» from the authoring checkout's HEAD.** That is simpler and matches what a person sees in their editor. But the checkout is shared: its HEAD is whatever branch another agent checked out last, so an experiment's input would depend on who else is working. A tracked branch is a statement the person made at registration and can change on purpose.

**Key the registry by the path the person typed.** Two spellings of one repository (the checkout and a linked worktree, `~` and its expansion) would become two registrations with two ids, and dedup would depend on how someone typed a path. The git common dir is the one thing every checkout of a repository agrees on.

**Keep managed worktrees and clean them up better.** The problem is not the leftovers but the writes: every `worktree add` / `lock` changes the shared `.git` and shows up in `git worktree list` for everyone. `git archive` reads objects only. The cost is a full copy per (commit, set, layers) instead of a checkout, which is small for dataset layers and is served from cache after the first time.

**Write default layers into every set at registration.** Then a set added to the branch after registration would have no entry and would need a rule anyway. Storing only what the person chose and applying the floor at read time gives one rule for both cases.

**Delete binding files once imported.** Eval still reads them until branch 2 lands, and a binding file is the only record of which session used which repository. Import is read-only on bindings, so it can be re-run and undone by removing the registration.

**Clean the 25 managed worktrees in this branch.** That writes the shared `.git` of a checkout other agents are using right now, which the brief rules out, and some of the views still serve instances on the old code. The commands are recorded here; the coordinator schedules the run once the lab instance carries branch 2.

## Consequences

- An agent can no longer reach a dataset the deployment did not register, and the refusal says what to do instead: ask the person, via `ask_user_question` when the name is ambiguous.
- «Latest» is stable against other agents' checkouts; moving it is a deliberate merge to the tracked branch.
- Whole-layer views no longer add entries to the shared worktree list. The materialization cache is never collected: each move of a tracked branch may add a directory, and reclaiming space means deleting the `materialized/` subtree (after `chmod -R u+w`).
- There are two sources of repository identity until branch 2: eval's binding read path and the registry. `importBindings` bridges them one way.
- The CLI's read verbs still take `--repo` by path: it is the human's face, and the registry governs agents.
- Branch 2 of T73 also carries a read-only `experimentArtifact({experimentId, path})` Remote verb for viewing analysis drafts. It is planned there and not built here.
