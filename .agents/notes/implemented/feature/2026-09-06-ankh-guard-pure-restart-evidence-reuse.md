# Agent Note: ankh-guard pure-restart evidence reuse

Status: implemented

[中文](2026-09-06-ankh-guard-pure-restart-evidence-reuse.zh.md) | English

## Problem

The restart credential combined two different lifetimes. A build/test result was bound to a clean git HEAD, but its ten-minute freshness window also forced a byte-identical, already-running deployment to repeat the complete build and test command before every later operational restart. On the official harness checkout that cost several minutes even though no source, dependency, profile, installed artifact, or launch input had changed. Extending `maxAgeMinutes` would only make the same conflation last longer, while accepting `last-good-boot.json` or HEAD equality alone would miss profile, ignored build output, installed package, link-target, and execution-surface drift.

## Decision

Fresh credentials remain unchanged and remain mandatory for modifications, launch cutovers, legacy state, and the unsupervised `restart` verb. A watchdog-supervised `schedule-exit` gains a second evidence class: `provenDeployment`, written only after the new instance has completed readiness/ownership checks, composition preflight, and post-restart canary under this protocol version.

The proof binds the source credential identity and command digest to a recomputed deployment fingerprint: clean credential-repository and harness revisions, the complete stable launch specification, profile configuration, directly installed package bytes, `file:` source archives, host install metadata, and the explicit source/built preflight runner and install anchor. Symlink targets are followed, legal directory cycles are de-duplicated, and dangling links, special files, missing packages, missing git identity, dirty trees, or missing execution bindings fail closed. No command, file content, bearer URL, or credential value is copied into the proof; only revisions and SHA-256 digests are durable.

`schedule-exit` prefers a fresh credential. If it has expired, the command recomputes the fingerprint and accepts only an exact proof match. It copies the selected evidence SHA and kind into the short-lived restart marker. The successor watchdog validates that exact authorization again during canary, so replacing the state or changing a fingerprinted input between the caller-side check and the restarted process cannot pass. A new `record --run` attempt and `clear` both invalidate the prior proof. A proof-authorized pure restart retains the existing proof; a fresh-credential restart promotes a new one after canary.

Legacy `last-good-boot.json` stamps are deliberately not migrated into proofs. The first rollout therefore performs one full evidence-backed restart and canary before later pure restarts become eligible. Proof persistence failure does not tear down an otherwise healthy, canary-passing host; it logs loudly and makes the next restart require fresh build/test evidence.

## Alternatives considered

**Make the build credential timeless while HEAD stays equal.** Rejected because HEAD does not cover profile manifests, installed tarballs, linked package targets, ignored runtime output, or the actual source/built preflight surface.

**Increase the default freshness window.** Rejected because it preserves the wrong lifetime model, only less frequently, and leaves operators unable to distinguish an unbooted build result from a deployment that already passed a real canary.

**Treat the healthy-boot revision or current HTTP response as reusable proof.** Rejected because old protocol stamps were not tied to a particular credential or complete launch/runtime fingerprint, and a response can come from the wrong listener.

**Let every restart verb reuse the proof.** Rejected for the first implementation. `schedule-exit` has a durable stable launch specification plus authoritative supervisor ownership; the single-shot `restart` path may reconstruct command or listener state and therefore continues to require a fresh credential.

## Consequences

A later pure restart of an unchanged supervised deployment no longer pays the full build/test cost merely because ten minutes elapsed. It still pays the composition preflight, authoritative stop/start, readiness, ownership stability, browser handoff when applicable, and canary costs. Any deployment drift returns to the established full-evidence path.

Fingerprinting direct profile packages and their source archives reads deployed bytes, so the fast path is not free; it is deliberately much cheaper than rebuilding and testing the host. Git-backed harness roots and explicit preflight execution bindings are required. Deployments without those inputs continue to work but cannot use evidence reuse.

Coverage fixes the migration boundary, stale-credential reuse, credential replacement invalidation, profile and installed-package drift, external symlink-target drift, and authorization SHA revalidation. The 3080 acceptance additionally performs a full seed restart followed by a deliberately stale-window same-launch restart.
