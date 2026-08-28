# Agent Note: Product roadmap inserts a capability layer between base and domain

Status: implemented

English | [中文](2026-08-28-roadmap-capability-layer.zh.md)

## Problem

Twenty-one active proposals and twenty-three packages exist with no upper-level document saying where a capability belongs or when it happens. Each proposal carries its own scope, so the question "does this package serve eval or dev" is answered per proposal, inconsistently.

The classification in [package-management](../../../../proposals/active/2026-08-21-package-management.md) has three categories — `base`, `domain`, `ops` — with one main label per package and boundary packages taking the base label. That rule mis-files a group: the local-agent family, `mission`, `lab`, `datasets`, `worktrees`, and `room`. They require external dependencies (a CLI on PATH, a docker daemon, filesystem conventions), so they are not "install it and the GUI is nicer" experience packages; and more than one workflow consumes each of them, so no single domain owns them. Filing `mission` under `base` would put a task-management state machine in the pack whose promise is a better chat surface; filing it under `domain` forces a false choice between eval and dev.

## Decision

`docs/roadmap.md` is the upper-level document: a proposal says how a capability is built, the roadmap says which layer it sits in, which domain consumes it, and when it happens. It carries a package ledger (every package with version, release state, one-line capability, and its proposals), a decision list that bounds future proposals, and a priority table.

Package categories become four. `capability` sits between `base` and `domain` and holds reusable primitives that carry external dependencies. `base` keeps its original promise — install it and the GUI is nicer, no external setup. `domain` becomes pure composition: `base` plus selected capabilities plus at most a UI package or two, so a new domain costs no new code. `ops` is unchanged.

Three domains are named: `dev` (the software workbench in daily use), `eval` (harness comparison), and `novel`. `dsh-dev` ships first. The two ready domains intersect at the local-agent family and `mission`, so that intersection — not either domain — is the release blocker.

The roadmap also records eight standing decisions that bound future proposals, among them: dsh is the only workbench shell and AgentOS is frozen as a design asset; local and remote are one execution-target dimension of the local-agent family rather than two workbenches; multi-person collaboration tops out at one instance per person over a shared data plane, because the harness trust model treats any connected caller as the local user; and adjudication stays out of the plugins, so `lab`, `mission`, and `datasets` keep recording facts without scoring them.

## Alternatives considered

**Keep three categories and file the shared packages under `base`.** Rejected: `dsh-web-basic` is the base pack, and adding the local-agent family to it would mean the entry-level pack requires installing external CLIs and logging into them. The base promise and the capability promise are different promises to a user.

**Keep three categories and group inside `base` in prose only.** Rejected: the category is what a domain pack composes against. A grouping that lives only in a README still forces whoever assembles a pack to pick packages one at a time, which is the work the category exists to remove.

**No upper-level document; let each proposal own its scope.** Rejected: this is the status quo that produced the conflict. Twenty-one proposals already disagree about whether `mission` serves eval or dev, and nothing arbitrates.

**Ship `dsh-eval` first**, as package-management planned. Deferred rather than rejected: eval's value lands only after a comparison run completes, while dev is the shape already in daily use and returns feedback immediately. The choice does not change the critical path — the shared capability layer blocks both — so it is a sequencing preference, not a structural one.

## Consequences

Domain packs cost no new code, so a fourth domain is a composition exercise. [mode-switcher](../../../../proposals/active/2026-08-26-mode-switcher.md) gains a definite meaning: a mode is a domain's UI expression.

package-management's classification section is now out of date and must gain the `capability` value for `dsh.category`; the roadmap header records the linkage, and the proposal itself is unchanged so far. `dsh-web-basic` currently ships `ankh-guard`, an `ops` package, which the four-layer model makes visible as a contradiction; the roadmap parks it as open rather than resolving it, because changing a published pack's member list has real cost.

The roadmap needs maintenance: a new proposal adds its row to the package ledger, and release-state changes update the markers. Routine priority movement lives in the roadmap and is not written back here; this note owns the classification decision only. Two proposals (`capability-catalog`, `mode-switcher`) exist in the main worktree uncommitted, so the roadmap references them without links until they land.
