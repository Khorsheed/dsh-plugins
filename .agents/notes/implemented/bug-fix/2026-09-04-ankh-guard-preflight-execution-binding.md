# Agent Note: ankh-guard preflight execution binding

Status: implemented

English | [中文](2026-09-04-ankh-guard-preflight-execution-binding.zh.md)

## Problem

A launch cutover used one command to start the successor but chose the composition-preflight module graph from the guard process and target checkout. A built official npm CLI could therefore be preflighted against checkout TypeScript merely because the guard runner used tsx. The resulting export errors described neither the candidate that would start nor its installed dependencies. Conversely, an independent composition preflight did not parse the final launch argv, so a misplaced launcher option survived until the previous host stopped.

Recovery evidence also reused one top-level canary field. When the target canary failed and the previous host recovered without a previous-scoped fresh credential, the terminal receipt paired previous readiness with an unqualified canary failure from the rejected target.

## Decision

- New launch configuration records an explicit composition-preflight contract: `source` or `built`, runner executable/runtime arguments/path/content SHA-256, the actual dsh installation manifest used as module-resolution anchor, and the full target-command SHA-256. Source imports come only from checkout source. Built imports resolve only through the named npm installation. Runner mode is never inferred from `process.execArgv`.
- `reconfigure` requires a one-shot candidate probe command in addition to composition preflight. The probe and target command digests are committed in the same target spec. Both checks run against an isolated copy of the target home before the previous supervisor is asked to yield. The durable receipt records only redacted bindings, digests, and PASS outcomes; it does not copy either command.
- The candidate probe remains caller-supplied. The guard proves that the submitted probe and target command did not drift after binding, not that arbitrary shell text was semantically derived from the target argv. The bundled Skill constructs the official DSH probe from the same executable and launcher argv using its one-shot `--dump-config` form.
- The isolated-home copier never reproduces a source symlink. It follows each link only as a read source, materializes independent files/directories with copy-on-write preference, then audits that no link or special file remains. Dangling links, directory cycles, unsupported entries, and copy/read failures abort before the candidate runs, the cutover is created, or previous is stopped.
- Candidate and composition diagnostics redact bearer-like `token` and `grant` query values before they reach CLI output.
- Target readiness and canary evidence lives under `targetValidation` and survives restoration. Previous readiness and its canary classification live under `recovery.validation`. If only the rejected target's singleton credential is available, recovery canary is explicitly `skipped` while stable child/listener ownership remains mandatory. An ownership change is a recovery failure, never a skip.
- Fresh launchd/systemd initialization requires the operator to provide the execution surface and installation anchor. Existing `--if-absent` state remains untouched without revalidating installer-time defaults.

## Alternatives considered

**Infer source versus built from `process.execArgv`, file extensions, or `DSH_HARNESS`.** Rejected because those describe the guard process or checkout, not necessarily the successor. The production failure was exactly a built npm successor paired with a tsx-started runner.

**Keep composition preflight independent and inspect the launch command heuristically.** Rejected because shell commands are not safely or generically parseable, and plugin hosts may have different probe modes. A first-class caller-supplied candidate probe preserves the host-specific validation while the target-command digest prevents later launch drift.

**Run the candidate directly against the live home.** Rejected because even nominally read-only launcher modes may heal links or rewrite generated profile roots. Both pre-stop checks use the isolated-home boundary.

**Preserve source symlinks in the snapshot.** Rejected because Node's non-verbatim recursive copy rewrites relative targets to absolute paths in the source tree, while verbatim links may themselves escape the copied root. A candidate write through either form can mutate live or external bytes. Independent materialization gives the snapshot a checkable no-link postcondition; inputs that cannot meet it fail closed.

**Treat a failed target credential check as a failed previous canary.** Rejected because the credential has the wrong repository provenance. Recovery reports the unavailable credential proof as skipped, separately from mandatory runtime ownership proof.

## Consequences

- Cutover callers must identify the successor's real toolchain and construct a one-shot candidate command from the same executable and launcher argv. This caller trust boundary is explicit: an unrelated command can be hash-bound but is not equivalent evidence. The bundled Skill supplies the safe DSH construction. A malformed final command now fails while the old host remains available.
- Older durable launch specs remain readable. A new `configure-launch` or target `reconfigure` establishes the explicit binding; once selected, same-launch preflight reuses it.
- The runner file is content-bound. Rebuilding or replacing it after configuration requires an intentional reconfiguration instead of silently changing the gate implementation.
- Tests cover pre-stop candidate rejection, bearer redaction, binding persistence, target-versus-recovery receipt semantics, byte-stable live and external symlink targets, cycle refusal before any candidate/cutover mutation, and the existing complete watchdog lifecycle. A real built preflight is also exercised against an official npm toolchain rather than checkout source.
