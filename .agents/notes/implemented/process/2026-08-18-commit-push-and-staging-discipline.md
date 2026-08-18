# Agent Note: 及时 commit、push 统一安排——public 仓库的发布节奏与暂存纪律

Status: implemented

English | [中文](2026-08-18-commit-push-and-staging-discipline.zh.md)

## Problem

The repo is public (`github.com:Khorsheed/dsh-plugins`), yet the concurrency rule inherited from the repo's first days was the opposite of a public-repo cadence: "Pull before you start; **push when you finish**. … push the same day. Work that exists only locally does not exist." Every push is user-visible surface — release consumers, other agents, and CI all see it — and history shows what uncoordinated pushing costs:

1. **Concurrent-revert casualty** (`faaea68 docs(ankh-guard): restore README supervise/restart/kill-model sections (concurrent-revert casualty)`): one agent's pushed README work was swept away by another agent's commit/revert cycle and had to be restored by a third push.
2. **Commit → revert → re-commit churn** (`36c2caa` → `1294d71 Revert` → `767adb2`): one fix produced three commits; pushed individually that is three rounds of public noise.
3. **Broad staging swept staged work into the wrong commit** (`022c022`): a concurrent agent's commit carried another agent's staged files (this session's proposed Agent Note) under an unrelated message. In a shared checkout the index is shared mutable state; `git add -A` / `git add .` / `git add -u` are the mechanism for this failure.

The same-day-push rule existed to protect against lost work ("Work that exists only locally does not exist"; the message-tools 0.2→0.4.7 line was lost to `/tmp` development). Committing promptly already provides that protection — committed-but-unpushed work lives in git objects and survives rollback and rebase; only *uncommitted* work is genuinely at risk. Same-day push paid the public-noise cost for nothing beyond that.

## Decision

AGENTS.md's first "Multi-agent concurrency" bullet now reads (shipped verbatim):

> **Pull before you start; push when arranged.** `git pull --rebase` before you start; commit each logical change as soon as it is green (committed work exists in git). **Pushes are coordinated by the human, not a same-day obligation** — never push unilaterally. Stage explicit paths only (`git add -A` / `git add .` / `git add -u` are forbidden: the index is shared checkout state, and broad staging has swept another agent's staged files into the wrong commit); review `git status` + `git diff --cached` before committing.

The decision, in four parts:

- **Commit promptly**: each logical change is committed as soon as it is green; committed work exists in git and is safe while waiting for a push.
- **Push is coordinated**: the human arranges when a batch goes out; "same day" is gone — never a same-day obligation, never an agent's unilateral push.
- **Explicit-path staging only**: `git add -A` / `git add .` / `git add -u` are forbidden; review `git status` and `git diff --cached` before committing.
- `git pull --rebase` still happens before starting work (and before any push).

## Alternatives considered

### Why not keep "push the same day"?

It was the status quo that produced the three incidents above, and it contradicted the public-repo reality: same-day pushes of half-integrated work are exactly what collides and churns. The protection it claimed (against lost work) is already delivered by prompt commits, so keeping it paid noise for nothing.

### Why not push-per-commit with confirmation?

Confirming every commit is as noisy as pushing every commit — the approver would review commit-sized pushes all day. Coordinated batches give one review point per line of work and one user-visible event per batch.

### Why not gate pushes by CI instead of coordination?

This repo has no CI (the gates run in the pre-commit hook), and CI can only verify greenness, not whether a push is *wanted* at this moment. Coordination with the human is the gate CI cannot replace; if CI arrives later it sits on top of this rule, not instead of it.

### Why not forbid `git add -A` only implicitly?

The `022c022` sweep shows implicit care is not enough. A written prohibition with the incident as rationale is the difference between a rule agents follow mechanically and a hope.

## Consequences

- The repo no longer instructs same-day pushes: agents commit promptly and wait for the human's arrangement; public churn drops to arranged batches.
- The staging rule closes the shared-index hazard that swept another agent's staged files into the wrong commit (`022c022`).
- The old rule's first half ("Pull before you start") is preserved; "Work that exists only locally does not exist" is gone — its protective intent is carried by prompt commits, not by pushing.
- The [per-agent worktree proposal](../../proposed/process/2026-08-18-per-agent-worktree-isolation.md) remains proposed and also edits this section; when both land, the wording is reconciled there.
- This batch's earlier commits (`6de6591`, `b9ecc41`) were pushed before the rule landed — they are the last unilateral pushes.

## Testing

- The staging rule matches the hygiene gate's staged-set behavior and the pre-commit hook; no code change.
- The moved note passes `verify-agent-note-format` / `verify-agent-note-classification`; `verify-translation-pairing` re-recorded for the new path; `check:hygiene` reports 0 findings on the touched files.
