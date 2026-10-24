# Agent Note: Evaluation-family READMEs are user-facing; the design reference lives in docs/

Status: implemented

## Problem

The READMEs of `@khorsheed/dsh-eval` (≈635 lines), `@khorsheed/dsh-datasets` (≈258) and `@khorsheed/dsh-lab` (≈194) had grown into internal design documents: headings carried task codes (`I3·T20`, `T73`, `I5·T35a`…), the eval H1 was the bare `dsh-eval`, and each opened with a dense mechanism paragraph. The three packages debut on npm at 0.2.0, where the README is the package page, so a first-time reader met a design log instead of "what is this and how do I install it".

## Decision

Each README follows the house style of the published READMEs (`packages/message-tools/README.md`): H1 = the npm name, a language toggle, one plain sentence of value, a scenario paragraph (comparing local agent harnesses on a question set), screenshots, 特性 / Features bullets, 安装 / Install leading with `dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-eval-suite` and then the standalone command, Compatibility, 已知限制 / Known limitations, a collapsed 实现原理 / How it works with links to the deep docs, and the development footer. Each lands at roughly 95 lines per language.

The deep content moved, verbatim apart from heading task codes and link depth, into bilingual pairs with their own i18n sidecars:

- `packages/eval/docs/reference(.en).md` — contracts, the run loop, the container path, readiness, provisioning, judging, experiments, the service face, the instance-mounting seam, the report, model tools, run doors, CLI, hash rules, the degraded/absent compatibility list, and the development history (former 「状态」/Status);
- `packages/eval/docs/ui(.en).md` — the Experiments tab and its stage pages, the answer view, the session card, the visual/copy passes, the global panel;
- `packages/datasets/docs/reference(.en).md` and `packages/lab/docs/reference(.en).md` — the whole former body of each README.

Compatibility facts are unchanged. The npm-line and source-line verdict bullets stay in each README verbatim; lab keeps its whole section; for eval and datasets the long degraded-item list moved to the reference doc and the README links to it, still stating that the list mirrors `dsh.compat`. Task codes are stripped from headings only; body text keeps them as references. Screenshots are placeholders under the dsh-basic mirror's raw URL (`eval-*.png`, `datasets-*.png`, `lab-*.png`) until someone captures them into `profiles/basic/docs/screenshots/`.

## Alternatives considered

**Keep the READMEs and only add a short summary on top.** Rejected: npm renders the whole file, and a 600-line page with a summary on top still reads as an internal log; the task-coded headings stay in the npm page's outline.

**Delete the design detail as stale history.** Rejected: the run-loop, provisioning and judging sections are the only written record of why the invariants hold; the docs/ pairs keep them reachable from the README.

**Absolute GitHub URLs for the docs links.** Not taken in this change: every package README in the repo links relatively, and `docs/` is not in the packages' `files`, so on npm those relative links do not resolve. Switching the house style to absolute mirror URLs is a repo-wide decision, recorded here as open.

## Consequences

- The npm page now answers what the package does and how to install it in the first screen; the design reference is one click away on GitHub.
- On npm, links into `docs/` (and `../../docs/…`) do not resolve until the house style moves to absolute URLs or `docs/` ships.
- Source comments that say "see the README's 「工作区接入接缝」" (datasets `src/index.ts`), "lab README «失败恢复循环»" (eval `src/run/unit-lifecycle.ts`) and similar now point at sections that live in the packages' `docs/reference.md`; they were left as they are because this change does not touch source.
- The screenshot placeholders render as broken images until the files are captured and committed with `git add -f`.
