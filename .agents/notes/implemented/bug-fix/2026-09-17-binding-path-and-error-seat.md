# Agent Note: a bound path is canonical, and a failure is three sentences (I5 · T62)

Status: implemented

English | [中文](2026-09-17-binding-path-and-error-seat.zh.md)

## Problem

A user opened the two tabs on a live instance. Neither one worked, and neither one said anything a user could act on.

The 题集 tab: `~/.dsh/scratch/dataseek-eval-i5 is not a git repository: GitError: git rev-parse --show-toplevel failed`. The 实验室 › 条件 page: `not a dataset repository (no datasets/ directory)`. Both about a repository that exists, is a git repository, and holds datasets.

**The cause (I5 walkthrough gap G5).** The binding store recorded `repoPath` exactly as it arrived. `~` is a *shell* convenience; nothing downstream of the store expands it — not `git -C`, not `readdir(<repo>/datasets)`, not the containment checks that compare a repository against a session's realpath cwd. And no shell is in the loop when the web tab writes a binding, nor when `/datasets bind ~/x` runs inside a composer. So the store held a path naming a directory literally called `~`, and every reader failed on it, each in its own words.

**The second failure is the one the user actually saw.** Both messages above are host diagnostics: written in English for whoever debugs the host, carrying `GitError: git rev-parse --show-toplevel failed`, quoting an absolute path. The tabs printed them verbatim — 22 sites across the lab tab alone did `{t('x.error')}: {message}`. A reader learned neither what broke nor what to do about it, on the first screen of both tabs.

## Decision

**One normalization function, on the way in and on the way out.** `normalizeRepoPath` trims, expands a leading `~` (and only the `~` / `~/…` shorthand — a directory whose *name* starts with `~` is a directory), resolves to an absolute path, and resolves symlinks when the directory is there. A path that is not there keeps its absolute form: normalizing is not the existence check, `assertRepository` is, and a binding to an unmounted volume must still round-trip.

It runs inside `validateBinding`, which every write AND every read already goes through, so no consumer has to remember. `resolveScope` normalizes whichever of the three sources wins (explicit `repo`, binding, configured default), because those three must not disagree about what one path means.

**An old record is migrated in place on read.** `readBinding` compares the stored spelling with the canonical one and, when they differ, writes the record back. A user who bound before this fix does not have to rebind, and the file stops being a trap for the next reader — the CLI, `git`, and `readdir` all see the same path. The write-back is best effort: a store we may not write to still answers the read correctly.

**The eval side normalizes what it reads, too.** `resolveRepoScope` puts the binding's `repoPath` through eval's own `normalizeRepoPath`, not just the explicit `repo` argument it already expanded. The datasets plugin now canonicalizes what it stores, so this is belt and braces — but an old binding should not be the reader's problem, and eval reads bindings written by a plugin it deliberately does not import.

**Failures render as three parts** (ui-spec §九): one human sentence on what happened, one on how to fix it (with the command when there is one), and the raw exception plus the path folded under «详情». The page never renders `error.message` and never exposes an absolute path. The raw text still has a reader — whoever debugs the host — so it is folded away, not dropped.

**The cause is recovered from the message text, and a test pins that.** A Remote failure crosses the wire under one of the gateway's three TRANSPORT codes (`gateway/bad-request`, `gateway/cancelled`, `gateway/internal`); the domain code does not survive. `classifyError` therefore matches markers in the message — and `tests/error-state.client.spec.tsx` in each package drives the REAL service into each refusal and hands the REAL message to the real classifier. Reword a host message and a test goes red, rather than the tab silently degrading to its unknown-cause copy in front of a user.

**Two copies of one component, by rule.** `ErrorState.tsx` exists in both `packages/datasets/src/client/` and `packages/eval/src/client/`, identical but for the dictionary-key type it is generic over. A client bundle never imports a sibling plugin (ui-spec §八), so the two tabs share an implementation by being copies of it.

**Evidence is not an error.** A readiness refusal (`review.refusal`) and a run's job log stay verbatim in a `<pre>`: a refusal is the mechanism working, and the refusal text is the only place a readiness verdict is written. To keep the two apart the lab store grew `approveError` beside `approveRefusal` and `noticeError` beside `notice` — one seat, two renderers, each clearing the other. Before this, one field held both a sentence this tab wrote for a human and a sentence the host wrote for a debugger, which is why they were rendered the same way.

## Alternatives considered

**Expand `~` at each read site instead of at the store.** This is what the code already half-did: eval expanded the explicit `repo` argument and not the binding, `datasets` expanded neither. The bug IS that shape — a normalization each caller must remember is a normalization some caller forgets, and the forgetting surfaces as a whole page reporting the wrong thing. One function on the store's own boundary is the only version with no site left to forget.

**Refuse a `~` at bind time instead of expanding it.** Honest, and it would have made the walkthrough fail earlier and louder. Rejected because `~/…` is what a person types and what the CLI's own usage line shows; refusing it makes the tool worse at the thing the user was right to expect.

**Declare domain error codes on the Remote wire** (`RemoteErrorDetailsMap` is merge-extensible, so a plugin may add `datasets/not-a-repo` and throw a `RemoteError`) **and classify by code.** This is the principled fix and it survives rewording. Rejected for this change: no plugin in this repo has declared a domain code yet, so it means introducing a mechanism across every Remote method of two packages, in a hotfix whose point is that two tabs do not open. The message-marker classifier is the contained version, and the host-message tests are what keep it honest. The wire-code version remains available later; `classifyError` is the only thing that would change.

**Let `ErrorState` live in one package and import it from the other.** Half the work. Forbidden by ui-spec §八 and for a real reason: a client bundle that imports a sibling plugin cannot be installed without it. Duplication with a comment in both files naming the other copy is the cheaper failure.

**Normalize without resolving symlinks.** Enough for the `~` bug. Rejected because two spellings of one repository then compare unequal — `/tmp` vs `/private/tmp` on macOS is the case that already cost a session an afternoon in T47, where a workspace record's path failed a strict comparison against a session's realpath cwd.

## Consequences

A bound path is now canonical wherever it is read, and the two tabs open. A record written by an older build repairs itself the first time it is read, so nothing asks the user to rebind.

**Fixtures had to become canonical too.** `makeFixtureRepo` (datasets) and `tmpTree` (eval) now return `realpathSync(mkdtempSync(…))`. On macOS the runtime temp root is a symlink, so every assertion comparing a fixture path against a path the code answered with was comparing two spellings of one directory; eleven of them failed the moment normalization landed. The fixtures were the thing that was wrong — `git rev-parse --show-toplevel` has always answered with a realpath.

**The classifier is coupled to host wording.** That is the price of the contained fix, and the coupling is pinned by tests in both packages rather than left to a comment. An unrecognized cause is not a failure mode: the seat falls back to the caller's own sentence («题集列表加载失败») plus a generic fix line, which is still better than an exception.

**T63 inherits the rest of the copy.** This change touched error and failure copy only. The status vocabulary, the matrix page's factor sprawl, and the report page's remaining absolute paths are that task's, and the component this one adds is what those pages' error seats will use.
