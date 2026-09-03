# Agent Note: ankh-guard reversible state quarantine

Status: implemented

English | [中文](2026-09-03-ankh-guard-state-transition.zh.md)

## Problem

The [launch-cutover protocol](2026-09-01-ankh-guard-launch-cutover.md) could atomically select and recover a complete launch specification, but it assumed that previous and target could both boot against the same dsh home bytes. A host upgrade invalidated that assumption: the target rejected a reconstructible projection cache written in an older format before it could listen. Deleting the cache by hand would let this target boot, but it would not prove that preflight saw the same remediation, that the deletion happened only after previous stopped, or that previous would receive its exact bytes back if target failed.

## Decision

- `reconfigure` accepts an optional schema-v1 transition plan. The plan contains a canonical home and one or more non-overlapping home-relative `quarantine` operations. It lists both old inputs the target must not see and target output paths the previous host must not see after recovery, including paths absent when the plan is prepared. Every operation declares `expect: present|absent`; both isolated preflight and live apply must observe the declared state, so a path appearing or disappearing during preparation refuses instead of changing rollback meaning. The executor also rejects traversal, symbolic links, non-directory ancestors, guard-state overlap, cross-filesystem sources, duplicate paths, unknown fields, and unknown operation kinds. The plan is normalized, persisted under the cutover id, hashed, and referenced by the launch state; later execution verifies the exact bytes and operation count.
- Before cutover preparation, the guard copies the live home into a private temporary directory, preferring filesystem copy-on-write, applies the same transition there, and runs the target composition preflight with that copy as `DSH_HOME`. Failure removes the copy and leaves previous and the live home untouched. This is a boot-acceptance check, not authority to quarantine user data: callers may use it only for state proved reconstructible. Content-transforming migrations remain a separate mechanism.
- After the successor owns supervision and has stopped the captured previous child/listener identities, the watchdog invokes the internal transition executor. Each entry uses a same-filesystem rename into a cutover-scoped `previous/` tree. A per-entry journal records intent before and completion after every rename, so a new watchdog can distinguish an interrupted rename from an unstarted operation and resume idempotently.
- Target cannot receive a `child-started` or terminal `ready` receipt until the transition is applied. Recovery first stops every proven target identity, then rolls the transition back in reverse order. A target-created replacement at an affected path is renamed into `rejected-target/` before the exact previous bytes are restored. Previous cannot receive `restoring`, `child-started`, or `ready` until the receipt says the rollback completed. An apply or rollback failure is recorded and parks the watchdog instead of starting either host against ambiguous state.
- Successful target cutover retains quarantined previous bytes under the cutover directory. The guard does not delete material state automatically; later retention policy is an operator concern.

## Why quarantine is the first operation

The guard needs a small executor whose safety properties do not depend on a particular host release. Moving a reconstructible cache out of the candidate's namespace is reversible with atomic rename and requires no knowledge of its encoding. A generic JSON patch, arbitrary command, or embedded JavaScript transformer would execute release-specific code inside the most sensitive stop/start interval and could not provide a standard inverse. If a future upgrade requires content conversion, it should add an operation with explicit validation, journaling, and inverse semantics rather than weakening `quarantine`.

## Alternatives considered

**Delete or move state in the target start command.** Rejected because a wrapper has no authoritative previous/target process ordering, durable per-path journal, standard inverse, or receipt gate. It can strand previous state after a target failure.

**Stop previous and preflight against the live transitioned home.** Rejected because a slow build or composition error would turn a read-only candidate check into avoidable downtime. The isolated copy keeps acceptance work before takeover.

**Teach the guard the Alpha.4 cache filename or record schema.** Rejected because ankh-guard is supervision infrastructure, not a host migration catalog. The upgrade agent derives paths and reconstructibility from the two codebases; the guard validates and executes only generic filesystem semantics.

**Allow an arbitrary migration program with a rollback command.** Rejected because command text does not establish deterministic inputs, crash recovery, an inverse for partially completed work, or exclusion of authoritative data. New content-transforming operations need purpose-built validation and journal semantics.

## Consequences

- Preflight can cost a full home copy on filesystems without copy-on-write. The healthy previous host remains available during that work, and failure still occurs before takeover.
- The live transition requires the guard state directory and every present source to share a filesystem so each mutation is one rename. Deployments that place them on separate filesystems fail before previous stops.
- The durable receipt exposes only the plan digest, operation count, phase, and failure detail. Paths remain in the mode-0600 launch state and cutover plan; commands, browser capabilities, and bearer URLs remain excluded from the receipt.
- Unit coverage includes hostile paths, plan tampering, interrupted-rename reconciliation, absent sources, target replacement retention, exact-byte restoration, and isolated preflight. A real watchdog lifecycle covers previous serving old state, transitioned target retries after writing incompatible replacement state, rollback, and previous recovery. A separate npm-host exercise moved a live isolated endpoint from 0.1.1-rc.2 to 0.1.2-alpha.4 with an old-schema v3 projection record: the untransitioned control failed after producing a partial per-record document, while the guarded cutover preflighted on a copy, applied once, reached authenticated readiness and canary at retry zero, and retained the original whole-unit file byte-for-byte.
