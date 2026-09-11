# Host Major-Version Migration Playbook

> A field record of the 2026-09-10/11 migration from 0.1.2 to 0.1.5-rc.1, distilled into a reusable checklist. Follow it on every host line switch; append new traps when the next migration ends.

## Phase 0: Recon (no code)

1. **Pin a read-only checkout**: clone the target host tag to `~/code/deepseek-harness-<version>` (pinned tag, deps installed, libs built). The main `~/code/deepseek-harness` checkout is prod 3080's and stays untouched during the migration — it is watchdog-guarded and its credential binds to HEAD.
2. **Read the delta, build the disposition matrix**: the host's changelog → per package four outcomes — **integrate** (adopt new host capabilities), **unblock** (features the host finally supports), **re-seat** (move self-drawn UI onto official slots/APIs), **retire** (the host covers it natively). UI placement decisions (what moves to the right sidebar, what stays conversation-scoped) are made here, not during implementation.
3. **Keep the seam ledger**: `docs/upstream-seam-registry.md` records every "we want it, the host has no seam" point; re-audit at the end of the migration for retirements.

## Phase 1: Baseline and per-package adaptation

1. **Baseline commit first**: peer/devDeps onto the new host line, cordis override, `minHost` moves — one isolated commit (see bb04c84). Every package adapts on top of it.
2. **Adapt package by package**, one commit per break, `!` marks breaking.
3. **Host face before client face**: gen-typert → tsc → tsdown, never reorder (the client tsc consumes the generated remote types).
4. `DSH_HARNESS` points at the pinned checkout for the whole wave, never the main one.

### Adaptation traps (all hit for real this wave, by likelihood)

| Trap | Symptom | Fix |
|---|---|---|
| cordis inject ancestor chain | `sub.slots` in a nested plugin throws "without inject"; cordis rolls back the whole fiber, taking a completed registration with it (bfd6a87) | A nested plugin reaches only its own inject ∪ its ancestors' inject; declare it on the parent or register linearly |
| `ctx.get` vs property access | `ctx.remote.xxx` is inject-guarded; probing fails silently (fd1059d) | Probe optional services via `ctx.get('remote.xxx')`, or a nested plugin with inject |
| notify wakes only inject declarers | An optional service arriving late never activates the consumer | Probe-then-register must use the nested `ctx.plugin({inject: [...]})` form |
| Adding an optional parameter to a Typert Remote is breaking | The client validates arity against the declared count; a one-arg call throws on the spot (195982e — four provider auth cards all read "logged out") | Update every caller when a Remote signature grows; pin the arity in a regression test |
| Session records are a released format | Extension members a plugin wrote into `source` are refused by the next strict migrator (34e88d4) | Never write out-of-spec members; repair polluted history with `scripts/repair-session-source-op.ts` |

## Phase 2: Integration instance (link: full mount)

1. mktemp HOME + the official npm toolchain (a throwaway global-style dir) + a hand-written profile skeleton (empty-deps package.json with the bundles list, cordis.patch.yml, pnpm-workspace.yaml carrying every `@khorsheed/*` → link: override).
2. Credential injection: copy `.credentials.yaml` and the llm sections of settings.yaml from the real HOME so nobody re-logs-in.
3. Drive it live with Playwright MCP — screenshots land in `.playwright-mcp/` (gitignored) and get deleted when the session ends.
4. **Acceptance is the fix loop**: user feedback lands here; only green changes may proceed to 3080.

## Phase 3: 3080 (tarballs + the gate)

1. **Baseline switch**: `git reset --hard dsh-v<new version>` on the main checkout + pnpm install + build. From this moment 3080 runs an old in-memory process over a new on-disk profile — pages break. That is the flow's inherent window, not a failure; the watchdog supervises process health and rightly sees none.
2. **New packages get `plugin add` first** (into bundles); dep-only family members (e.g. dsh-headless) get added to deps deliberately — the deploy script's guard refuses non-dependencies by design.
3. `pnpm deploy:3080 --package …(everything)`. Known traps:
   - **GEN_TYPERT_ONLY without the family core TS2307s** — the deploy list must include the family core (e.g. local-agent).
   - Packages whose source layout changed need `rm -rf lib` first, or pack-dist's stale-types gate stops you.
   - The first restart after a host-version jump is refused with "the bound dsh install anchor changed" — **rebind with `configure-launch` first** (the install anchor is the sha256 of `apps/cli/package.json`), then run the standard gate. The green credential has a 10-minute freshness window; re-record when it lapses.
4. Post-gate acceptance: check-env, canary, `dsh plugin add` smoke, and one live pass by the user.

## Phase 4: Release and teardown

1. **CI moves with prod** (this wave's lesson: a gate pinned to the old line proves yesterday's world; the forward lane tracks `dist-tags.next`, not the `alpha` tag that rots).
2. npm publish per [publishing.md](publishing.md): only lines already on npm (unpublished packages ride the meta-pack wave), `tar -tzf` every pack, and **family/pair peer edges are rewritten by pack-dist from the member's version — the lines must move together** (the file-preview/ui-file-preview ^0.3.0 lesson).
3. git tag `<short>-v<version>` + GitHub Releases + `pnpm release:status` regen + push (coordinated by the human).
4. Teardown: throwaway HOMEs/toolchain instances, worktrees whose missions are done, scratch screenshots; after an ankh-guard release, run the mirror sync.
5. Re-audit the seam ledger and upstream proposals (docs/upstream-proposals/): which seams the host shipped, which defect reports should go out.

## Data-safety red lines

- Sessions and credentials live in `DSH_HOME`; tarball deploys never touch them — but **any direct data repair backs up first and writes atomically** (write tmp + rename).
- Session logs are concatenated-Zstandard containers whose FIRST frame must be exactly the header line; a whole-file single-frame rewrite is structurally corrupt. Follow `scripts/repair-session-source-op.ts`'s shape (frame scan + the host's own validators + backups).
- The watchdog can roll a checkout back to its last proven boot — never leave uncommitted work in a guarded checkout.
