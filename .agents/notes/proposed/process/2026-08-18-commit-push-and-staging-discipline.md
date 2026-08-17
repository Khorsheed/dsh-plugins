# Agent Note: 及时 commit、push 前确认——public 仓库的发布节奏与暂存纪律

Status: proposed

English | [中文](2026-08-18-commit-push-and-staging-discipline.zh.md)

## Problem

The repo is public (`github.com:Khorsheed/dsh-plugins`), yet the current concurrency rule is the opposite of a public-repo cadence: "Pull before you start; **push when you finish**. … push the same day. Work that exists only locally does not exist." Every push is user-visible surface — release consumers, other agents, and CI all see it — and the history shows what uncoordinated pushing costs:

1. **Concurrent-revert casualty** (`faaea68 docs(ankh-guard): restore README supervise/restart/kill-model sections (concurrent-revert casualty)`): one agent's pushed README work was swept away by another agent's commit/revert cycle and had to be restored by a third push. Pushes of uncoordinated changes to the same files collide.
2. **Commit → revert → re-commit churn** (`36c2caa` → `1294d71 Revert` → `767adb2`): one fix produced three commits; pushed individually that is three rounds of public noise.
3. **Broad staging swept staged work into the wrong commit** (`022c022`): a concurrent agent's commit carried another agent's staged files (this session's proposed Agent Note) under an unrelated message. In a shared checkout the index is shared mutable state; `git add -A` / `git add .` / `git add -u` are the mechanism for this failure.
4. **Unconfirmed push** (`6de6591`): this session's gate-batch commit was pushed without confirmation. The change was reviewed in intent but the push itself is exactly the user-visible step the rule should gate.

The same-day-push rule exists to protect against lost work ("Work that exists only locally does not exist", and the message-tools 0.2→0.4.7 line lost to `/tmp` development). Committing promptly already provides that protection — a committed-but-unpushed commit lives in git objects and survives checkout rollback and rebase; only *uncommitted* work is genuinely at risk. The letter of the rule ("push the same day") buys nothing beyond what prompt commits already give, while paying the public-noise cost.

## Proposal

Replace the "Pull before you start; push when you finish." bullet in AGENTS.md's "Multi-agent concurrency" section with a commit-prompt / push-confirmed / explicit-staging rule (exact diff in the [appendix](#appendix-agentsmd-diff)):

- **Commit promptly, in small logical units.** Commit each logical change as soon as it is green (existing "Keep `main` green" bullet stays). Committed work exists in git — recoverable; uncommitted work is at risk.
- **Push only after explicit confirmation.** Before pushing, ask the human (or the named approver). The remote is public; a push is user-visible surface.
- **Batch pushes.** Accumulate green commits locally and push once per approved batch — not per commit. This caps public churn and gives the approver one coherent change-set to review. Natural batch boundaries: a feature/line of work complete, a documented batch green, or end of a work session.
- **Never stage broadly.** `git add -A` / `git add .` / `git add -u` are forbidden; always stage explicit paths, review `git status` and `git diff --cached` before committing. In a shared checkout the index is shared state — broad staging captured another agent's staged files into the wrong commit (`022c022`).
- **Pull --rebase before you start and before you push** (existing first half of the bullet stays); after a push, verify `origin/main` advanced as intended.
- **`--no-verify` commits are an emergency exception**: disclose them in the commit message and repair the skipped gate before the push (the `6de6591` commit documented this pattern).

The staging half complements the [per-agent worktree proposal](../proposed/process/2026-08-18-per-agent-worktree-isolation.md) (worktree = isolation, this rule = release cadence); both edit the same AGENTS.md section and must be reconciled when both land.

## Alternatives considered

### Why not keep "push the same day"?

It is the status quo that produced the four incidents above, and it contradicts the public-repo reality: same-day pushes of half-integrated work are exactly what collides and churns. The protection it claims (against lost work) is already delivered by prompt commits, so keeping it pays noise for nothing.

### Why not push-per-commit with confirmation?

Confirming every commit is as noisy as pushing every commit — the approver would review commit-sized pushes all day. Batching gives one review point per line of work and one user-visible event per batch.

### Why not gate pushes by CI instead of confirmation?

This repo has no CI (the gates run in the pre-commit hook), and CI can only verify greenness, not whether a push is *wanted* at this moment. Confirmation is the human gate CI cannot replace; if CI arrives later it can sit on top of this rule, not instead of it.

### Why not forbid `git add -A` only implicitly (review `git status` carefully)?

The incident shows implicit care is not enough: the sweep happened despite the sweeping agent presumably "being careful". A written prohibition with the incident as rationale is the difference between a rule agents follow mechanically and a hope.

## Acceptance criteria

- AGENTS.md states: commit promptly, push only after confirmation, batch pushes, explicit-path staging only, per the appendix diff.
- A week of commits shows: no `git add -A`/`.`/`-u` in any commit; pushes are confirmed and batched (fewer pushes than commits); no new concurrent-revert casualty or wrong-commit sweep occurs.
- Every `--no-verify` commit that appears carries a disclosed reason and the skipped gate is repaired before its push.

## Risks

- Confirmation adds a round-trip per batch; an unattended agent may sit on unconfirmed commits. Mitigation: the human confirms at natural checkpoints (end of session, batch done), and committed work is never lost while waiting.
- Batched pushes make a mistake in one early commit surface later. Mitigation: keep batches small (one line of work), pull --rebase before push, and prefer fixing forward over rewriting a pushed branch.
- The rule contradicts the existing "push the same day" text until the AGENTS.md edit lands — interim agents will follow the letter unless the edit is part of the same change as this note's acceptance.

## Appendix: AGENTS.md diff

In the "Multi-agent concurrency" section, replace the bullet:

```markdown
- **Pull before you start; push when you finish.** `git pull --rebase` first, push the same day. Work that exists only locally does not exist.
```

with:

```markdown
- **Commit promptly; push only after confirmation.** `git pull --rebase` before you start and before you push. Commit each logical change as soon as it is green — committed work exists in git and survives rollback/rebase; only uncommitted work is at risk. The remote is public: every push is user-visible surface, so confirm before pushing and batch pushes (accumulate green commits, push once per approved batch) instead of pushing per commit. Never stage broadly — `git add -A` / `git add .` / `git add -u` are forbidden: the index is shared checkout state and broad staging has swept another agent's staged files into the wrong commit. Stage explicit paths, and review `git status` + `git diff --cached` before committing.
```
