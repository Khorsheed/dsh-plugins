# Agent Note: Product roadmap inserts a feature layer between base and domain

Status: implemented

English | [中文](2026-08-28-roadmap-feature-layer.zh.md)

## Problem

Twenty-one active proposals and twenty-three packages exist with no upper-level document saying where a capability belongs or when it happens. Each proposal carries its own scope, so the question "does this package serve eval or dev" is answered per proposal, inconsistently.

The classification in [package-management](../../../../proposals/active/2026-08-21-package-management.md) has three categories — `base`, `domain`, `ops` — with one main label per package and boundary packages taking the base label. That rule mis-files a group: the local-agent family, `mission`, `lab`, `datasets`, `worktrees`, and `room`. They require external dependencies (a CLI on PATH, a docker daemon, filesystem conventions), so they are not "install it and the GUI is nicer" experience packages; and more than one workflow consumes each of them, so no single domain owns them. Filing `mission` under `base` would put a task-management state machine in the pack whose promise is a better chat surface; filing it under `domain` forces a false choice between eval and dev.

## Decision

`docs/roadmap.md` is the upper-level document: a proposal says how a capability is built, the roadmap says which layer it sits in, which domain consumes it, and when it happens. It carries a package ledger (every package with version, release state, one-line capability, and its proposals), a decision list that bounds future proposals, and a priority table.

Package categories become four. `feature` sits between `base` and `domain`. The test is one question — **does every domain install it?** `base` yes, `feature` no. A cross-check: a feature package usually introduces a new work object (mission's work item, lab's experiment unit, worktrees' worktree/branch/diff) that both the user and the agent must learn, while base improves what dsh already has (messages, files, tasks, context) and introduces no new vocabulary. `domain` becomes pure composition: `base` plus selected features plus at most a UI package or two, so a new domain costs no new code. `ops` is unchanged.

Category membership follows *whether the package is installed*, not *what it displays*. `capability-catalog` is installed by every domain while the tools and skills it lists change with the preset — a mirror hangs in every room and reflects something different in each. `worktrees` also displays repo-varying content yet belongs to `feature`, because someone writing a novel has no reason to install it at all.

The two layers carry different lifecycle expectations, which governs how much to invest. `base` covers for an official GUI that is not yet good enough, so it is deliberately thin: when upstream ships the missing piece, AGENTS.md's Compatibility labeling already requires retiring the degraded path, and the proposal closes as 官方吸收. `feature` is domain capability upstream will not build — nobody else is going to write mission, lab, or room — so it is worth depth.

A domain is one profile, and switching work modes means switching profiles through `ankh-guard restart` — the same guarded path `dsh-web-basic` already ships: credential check, then a preflight that boots the target composition in a child process and **refuses to stop the running instance if it cannot come up**, then a watchdog-supervised handover on the same port, then a canary. The browser reloads the original address.

Agent presets do not carry domains. A preset composes tools, prompt sections, and skills; browser UI mounts on the profile's client slots, out of a preset's reach, so a preset-based domain would leave every domain's UI visible while its tools disappeared — visible but unusable. Isolating the UI would mean splitting every feature package into host and client rows. Presets keep the granularity upstream built them for: agent variants inside one profile (`standard`, a read-only `review`), which is exactly what the four shipped presets are.

The cost is that one instance runs one mode. Evaluation therefore gets its own instance (:3082, its own `$DSH_HOME`), which suits it better anyway — environment isolation is a precondition for comparison, not an inconvenience.

The registry mechanics settle why isolation must live at the profile plane: skill and tool registries are host+per-scope layered, so a plugin mounted by the profile's bundles lands in the global layer that every preset sees. What the profile mounts cannot be filtered out downstream.

Working-style text splits by nature across the two planes and a third: a general practice belongs in a preset's prompt section, a repository's own discipline stays in that project's `AGENTS.md`, and a cross-project personal preference stays in `$DSH_HOME/AGENTS.md`. The three stack; none replaces another. Not perceiving a capability needs no suppression mechanism — a preset that does not mount `worktrees` has no worktree prompt section, so the model never sees one.

Three domains are named: `dev` (the software workbench in daily use), `eval` (harness comparison), and `novel`. `dsh-dev` ships first. The two ready domains intersect at the local-agent family and `mission`, so that intersection — not either domain — is the release blocker.

The roadmap also records eight standing decisions that bound future proposals, among them: dsh is the only workbench shell and AgentOS is frozen as a design asset; local and remote are one execution-target dimension of the local-agent family rather than two workbenches; multi-person collaboration tops out at one instance per person over a shared data plane, because the harness trust model treats any connected caller as the local user; and adjudication stays out of the plugins, so `lab`, `mission`, and `datasets` keep recording facts without scoring them.

## Alternatives considered

**Name the layer `capability`.** Rejected after use: the word is already taken three ways in this ecosystem — upstream's capability seams, this repo's `capability-catalog` package, and the everyday sense of "what a plugin provides". A layer name colliding with all three reads ambiguously in every sentence that uses it.

**Keep three categories and file the shared packages under `base`.** Rejected: `dsh-web-basic` is the base pack, and adding the local-agent family to it would mean the entry-level pack requires installing external CLIs and logging into them. The base promise and the capability promise are different promises to a user.

**Keep three categories and group inside `base` in prose only.** Rejected: the category is what a domain pack composes against. A grouping that lives only in a README still forces whoever assembles a pack to pick packages one at a time, which is the work the category exists to remove.

**No upper-level document; let each proposal own its scope.** Rejected: this is the status quo that produced the conflict. Twenty-one proposals already disagree about whether `mission` serves eval or dev, and nothing arbitrates.

**A domain as an agent preset.** Rejected after tracing the mechanics: a preset reaches tools, prompt sections, and skills but not the client UI, so the interface would not follow the mode. Two upstream constraints compound it — a session may switch presets only while it has produced nothing, and a child agent inherits its parent's composition.

**Plugin-row toggles written to the profile user patch layer** (the mode-switcher draft's route). Rejected: it has no preflight equivalent. A bad overlay only fails at the next composition, by which point the instance is already down. The guarded restart validates before it stops, which is the difference that matters.

**Keeping both instances of a mode open at once.** Given up deliberately: it was the main argument for the preset route, and a separate evaluation instance serves it better.

**Ship `dsh-eval` first**, as package-management planned. Deferred rather than rejected: eval's value lands only after a comparison run completes, while dev is the shape already in daily use and returns feedback immediately. The choice does not change the critical path — the shared capability layer blocks both — so it is a sequencing preference, not a structural one.

## Consequences

Domain packs cost no new code, so a fourth domain is a composition exercise. [mode-switcher](../../../../proposals/active/2026-08-26-mode-switcher.md) gains a definite meaning: a mode is a domain's UI expression.

package-management's classification section is now out of date and must gain the `capability` value for `dsh.category`; the roadmap header records the linkage, and the proposal itself is unchanged so far. `dsh-web-basic` currently ships `ankh-guard`, an `ops` package, which the four-layer model makes visible as a contradiction; the roadmap parks it as open rather than resolving it, because changing a published pack's member list has real cost.

The roadmap needs maintenance: a new proposal adds its row to the package ledger, and release-state changes update the markers. Preset distribution is new work: the profile-template form has a precedent in `dsh-web-basic`, shipping presets does not, so `dsh-dev` starts from a minimal preset (a tool subset plus one prompt section) to prove the path. Two official constraints bind any UI over this: a session may switch presets only while it has produced nothing, making a mode a choice at session creation rather than an in-session toggle; and a child agent joins its parent's composition, so a delegated sub-session shares the parent's preset. `capability-catalog` reads the registry at the agent preset's standing scope, which makes it the surface where a domain's tools and skills are visible.

The preset plane carries only tools, prompt sections, and skills; browser UI packages declaring `dsh.client` mount on the profile's client slots and are shared by every domain, which is what makes the base layer basic. Of the eleven base packages only two carry an agent-facing part — `inline-html-render` registers the pull-style `inline-html-card` skill, and `capability-catalog` registers `list_capabilities` — so the `daily` preset is the official `standard` plus those two. Because a preset's skill set changes what the agent can do, an evaluation must pin its preset for conditions to compare.

Routine priority movement lives in the roadmap and is not written back here; this note owns the classification decision only. Two proposals (`capability-catalog`, `mode-switcher`) exist in the main worktree uncommitted, so the roadmap references them without links until they land.
