# Agent Note: web-eval install paths — npm ranges stay, source mode rewrites the copy

Status: implemented

English | [中文](2026-09-04-web-eval-install-source-mode.zh.md)

## Problem

Installing the web-eval profile from its own template (the I1 walk; findings G5/G6 in the dataseek-eval i1-walk log) failed two ways. First, the template's package.json references all 22 members by npm range, but 12 of them are not on npm — the README only warned about `datasets` / `mission` / `lab` and the local-agent family, while `capability-catalog`, `inline-html-render`, and `local-files` turned out to be unpublished too (release-status.md had the truth all along) — so `pnpm install` dies on registry 404s. Second, even with correct tarballs, pack-dist rewrites the packed packages' `workspace:*` family edges into `^version` registry ranges (kimi/codex/claude-code → local-agent + tool-subagent; local-agent-dsh → headless), which 404 the same way. T1 had to do the whole dance by hand — build, pack 13 tarballs, rewrite the manifest, write pnpm overrides — while deploy-3080 already automates exactly this pattern for prod. dev's template carries the same disease; this note and the change cover web-eval only.

## Decision

The template's package.json keeps its npm ranges: it is the declaration of what I6 delivers, and it never references a file that does not exist. `install.sh` gains a source mode (`--source <dsh-plugins checkout>`): it builds every unpublished member in the checkout (per-package `pnpm --filter <name> build` with `GEN_TYPERT_ONLY` scoped to the set — the deploy-3080 pattern, so a neighbor's WIP cannot block an install), packs each with `pack-dist --family` into the installed profile's `tarballs/`, rewrites the **installed copy's** manifest (unpublished direct dependencies → `file:tarballs/…`, relative to the profile directory), appends a pnpm `overrides:` block pinning every unpublished name — including `@khorsheed/dsh-local-agent-dsh-headless`, which the profile never depends on directly but local-agent-dsh carries as its own dependency — and then runs the standard `dsh plugin --profile web-eval install`. npm mode (no arguments) is unchanged: same copy, same install, and it starts working the day the last member publishes, with no template edit.

Every `--family` member goes in as `name=version`. pack-dist ranges a family manifest edge on the **target** member's own version, so a bare name there is rewrite-only and an error rather than a silently unsatisfiable range — the installer's bare names stopped source mode dead at `local-agent-tool-subagent` (`peerDependencies entry @khorsheed/dsh-local-agent is a family edge but no version was given for it`). install.sh indexes the checkout's `packages/*/package.json` once into name → that package's own version and looks each member up in the pack loop; a name the checkout has no version for stays bare and prints a warning, which is right for a rewrite-only member and still fails loudly in pack-dist if that name turns out to carry an edge.

The unpublished set lives as an explicit directory list in install.sh, topologically ordered (local-agent → tool-subagent → headless → providers → independents; no member of the set depends on a published @khorsheed sibling, which is what lets published members keep resolving from npm), deferring to release-status.md as the authority: a member ships to npm, its directory leaves the list.

The headless handling keeps G3 off this path: the host's reconcilePlugins only iterates the profile manifest's direct dependencies, and headless enters only as an override-pinned transitive dependency of local-agent-dsh (the prod pattern — the 3080 profile's package.json has no headless row either), so it is never appended to `dsh.profile.bundles`. T6 fixes the reconcile itself.

## Alternatives considered

- **`file:` tarball placeholders in the template package.json** (the brief's other option) — rejected: the referenced tarballs do not exist in a clone, so npm mode fails with a confusing ENOENT instead of an honest 404; the placeholder names must stay in lockstep with whatever versions source mode packs (or be rewritten by it anyway, which erases the placeholder's only job); and I6 still requires a template edit. The npm-range template plus install-time rewrite reaches the same installed state with zero dangling references and zero I6 churn.
- **Deriving the unpublished set by probing the registry at install time** — rejected: a network probe per member makes the installer slow and proxy-flaky and silently packs a drifting subset; the fixed list is deterministic, self-documenting, and emptied deliberately at I6.
- **Making pack-dist emit `file:` family edges** (G6's alternative "pack-dist supports family rewrite to file:") — rejected: scripts/ is the mainline's shared layer, an installer-side override is the pattern deploy-3080 already proved, and baking installer paths into published artifacts would leak machine layout into tarballs that npm consumers fetch.
- **Tarballs in `$DSH_HOME/tarballs/` (the prod layout)** — rejected: prod keeps one prune-managed tarball pool because deploy-3080 redeploys a single shared profile; an eval home is disposable, so profile-scoped `tarballs/` keeps "uninstall = one `rm -rf`" true while staying outside any pnpm workspace (ops.md's rule — a tarball inside the dsh-plugins checkout gets link:-ified by the name+version workspace match).

## Consequences

- A fresh eval instance is one command again: `install.sh --source <checkout>` end to end (the T5 acceptance — a mktemp `$DSH_HOME`, 22 distinct `@khorsheed` members in `--dump-config`), where T1 spent about 20 minutes doing the same by hand.
- The installed profile is self-consistent: every spec it references exists on disk, and the tarballs die with the profile directory.
- `update.sh` clobbers a source-mode install (it overwrites the manifest back to npm ranges) — the README warns and points at re-running source mode until I6.
- The unpublished list is a second place member publication status lives (beside release-status.md); the in-script comment names the authority and the retire condition, but the two can drift between release:status runs — accepted, the same stance as the deploy-3080 flow it mirrors.
- npm mode's summary line now prints the `@khorsheed` member count beside the total loader rows (the README invariant); the install semantics themselves are untouched.

## Related

- [web-eval iterations doc](../../../../profiles/web-eval/docs/iterations.md) — the T5 brief and acceptance bar.
- The dataseek-eval repo's i1-walk log (i1-walk branch), findings G5/G6 — the field observations this note closes.
