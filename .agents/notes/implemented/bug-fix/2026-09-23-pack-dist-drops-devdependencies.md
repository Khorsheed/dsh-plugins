# Agent Note: pack-dist drops devDependencies; workspace:* rewrites like workspace:^

Status: implemented

## Problem

Source-mode installs of the web-eval profile (`profiles/web-eval/scripts/install.sh --source`) failed on `main`. e9110d52 added `"@khorsheed/dsh-client-ui-content-preview": "workspace:*"` to the devDependencies of local-files, ui-file-preview and worktrees. Two gaps met there: install.sh built each package's `--family` list from dependencies and peerDependencies only, so the sibling was not a family member; and `rescopePackageJson` rewrote only `workspace:^`, so the non-family `workspace:*` devDependency reached `pnpm pack` verbatim and failed with `ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL`. Two implementers (T73 branch 1, T72) hit it independently and worked around it locally without committing.

## Decision

- `rescopePackageJson` deletes `devDependencies` from the dist manifest. A published tarball is installed, never built, so the section has no consumer; dropping it removes the whole class of failure rather than one spelling of it.
- Non-family `workspace:*` is rewritten exactly like `workspace:^` — a caret on the source version — in peerDependencies and in `dsh.runtimeDependencies` entries kept in dependencies. Family edges were already ranged on the target version and are unchanged.
- `verifyTarball` takes the source manifest's devDependency names (mapped to dist names) as an extra `devDeclared` argument. A source-plane sibling inlined at build time is still declared only as a devDependency, and its emitted `.d.ts` still mention it; without this the verifier would reject such packages once the field left the dist manifest.
- install.sh adds devDependencies' `@khorsheed/` names to `members`, so pack-dist gets their name rewrite and version.

## Testing

`scripts/pack-dist.spec.ts`: a rescope case (devDependencies with `workspace:*` dropped; `workspace:*` in a family dependency, a runtime-kept dependency and a non-family peer all rewritten; no `workspace:` left) and a real-pack case (a package with `workspace:*` devDependencies packs; the tarball manifest has no devDependencies; its family dependency is ranged on the target).

install.sh has no spec; recorded run on 2026-09-23: a detached worktree at the fix commit, `CI=true pnpm install --frozen-lockfile --prefer-offline`, then `DSH_HOME=<realpath mktemp -d> sh profiles/web-eval/scripts/install.sh --source <that worktree> --fresh` with the rc.1 toolchain's `dsh` on PATH. It exited 0 (24 `@khorsheed` members, 177 patch rows); the log shows `packing @khorsheed/dsh-local-files@0.1.0-rc.1 (family @khorsheed/dsh-client-ui-content-preview=0.1.0)`, `tarballs/khorsheed-dsh-local-files-0.1.0-rc.1.tgz` exists, and its manifest carries no devDependencies and no `workspace:` range. No instance was started; the temporary home and worktree were removed.

## Alternatives considered

**Fix only install.sh.** Passing the dev sibling as a family member makes today's three packages pack, but the next `workspace:*` that is not a family member — in any section — fails the same way, and every other pack-dist caller (deploy-3080 with `--family auto` happens to include devDependencies; a hand-written `--family` does not) keeps the trap.

**Keep rewriting devDependencies instead of dropping them.** It preserves a field nobody reads and keeps the rewrite rules for a section that can only cause pack failures.

**Drop devDependencies and stop counting them in the verifier.** Source-plane library packages would then fail their own verifier, because their emitted declarations name the inlined sibling.

## Consequences

Dist manifests are smaller and no longer advertise build-time-only siblings. The verifier's notion of "declared" now spans two sources (the staged manifest and the caller-supplied source devDependencies), which a direct `verifyTarball` caller has to supply itself. The package map (`docs/packages.md`) was already stale on `main` for canvas 0.4.7 at the time of this change and is out of its scope.
