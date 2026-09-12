# Agent Note: deployment registration, diagnostics and truthful receipts

Status: implemented

English | [中文](2026-09-12-deployment-install-and-diagnostics.zh.md)

## Problem

The first mobile deployment exposed three gaps in shared tooling: refresh-only runs claimed restart/canary success, a new plugin could be installed as a dependency without a registered bundle, and stale generated links were discovered only after expensive work or during isolated snapshot preparation.

## Decision

The user assigned this shared-script repair explicitly. `deploy-3080.mts` owns the change; ankh-guard and plugin runtime behavior stay unchanged.

For requested self-mounting packages, deployment detects missing dependency or bundle registration and invokes the built official CLI's `plugin add` with packed tarballs. It does not synthesize bundle entries. Existing registrations use the update path. New bundle-less companions are refused; existing dependency-only packages retain their update path. After installation, package identity/version, bundle registration and patch existence are checked before recording a credential. Old tarballs are pruned only after the requested flow succeeds; failure exits unwind the deployment lock.

A read-only physical-tree link diagnostic runs before deployment writes and after installation. `deploy:check-links` exposes the same check separately. It reports path, link target and system error code, excludes git metadata and top-level home scratch, and validates rather than recursively follows link aliases. Missing roots and unreadable entries fail closed. External dependency graph traversal, isolation and composition remain ankh-guard responsibilities.

Refresh-only receipts explicitly state that restart, loading the new build in the running instance and canary verification have not occurred. Restart success remains conditional on the existing guarded restart/canary path; a failed step produces no success receipt.

## Alternatives considered

**Keep first installation as a manual prerequisite.** Rejected because dependency presence alone did not prove bundle registration, and the same mistake would recur. The official CLI already owns reconciliation.

**Automatically delete broken links inside guard.** Rejected because a missing target can mean an essential dependency needs reinstalling. Diagnosis cannot decide that deletion is appropriate. Owners inspect and back up confirmed obsolete generated links before cleanup.

**Duplicate snapshot semantics in the diagnostic.** Rejected: a fast physical-tree check catches the observed stale links without maintaining a second isolation implementation. The diagnostic explicitly does not certify the complete external graph or replace guard.

## Consequences

First install and update share an entry point and truthful reporting. Additional read-only scans cost filesystem work and may expose unrelated stale files early; they never silently repair or weaken guard. A later installation failure can leave the profile partially updated, as before; automatic profile rollback is not claimed, and old tarballs remain available on failure. Isolated command-boundary tests cover installation, failed registration/patches, dependency damage, refresh-only output, guarded failure and lock cleanup without contacting production.
