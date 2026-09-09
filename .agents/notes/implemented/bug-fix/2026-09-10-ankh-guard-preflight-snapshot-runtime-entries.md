# Agent Note: preflight snapshot skips runtime entries and scratch

Status: implemented

English | [中文](2026-09-10-ankh-guard-preflight-snapshot-runtime-entries.zh.md)

## Problem

The reconfigure cutover preflights the target composition on a byte-copied isolated `$DSH_HOME`, and the copy hard-refused any special filesystem entry. A live deployment's own runtime endpoints — prod's `local-agent/member-bridge.sock`, a unix socket held by the running instance — made every member-channel deployment's reconfigure fail before anything was stopped (`preflight snapshot refused a special filesystem entry …`). The only workaround was unlinking the live socket first, which is strictly more dangerous than the skip: the bridge goes down mid-service, while the socket has no copyable content and the next boot recreates it.

The same copy also included everything else, however large. On the 0.1.2-rc.1 flip a 24 GB `scratch/` tree pushed prepare+canary past the credential's ten-minute freshness window; the target became ready, the canary's credential revalidation failed, and the cutover restored previous.

## Decision

`createPreflightSnapshot` now skips entries without copyable semantics instead of refusing: sockets and FIFOs are dropped (and counted), and a symbolic link whose target is a socket/FIFO is dropped with it — otherwise a linked runtime endpoint would still hit the refusal. Device nodes and anything more exotic still fail closed; the writable-escape, dangling-link, cycle, and containment checks are untouched. The top-level `scratch/` tree is excluded from the copy (ephemeral by definition; it dominates home size). The skipped-entry count is returned for observability.

In the `reconfigure` verb the snapshot step is timed; when the copy exceeds half the credential freshness window, the CLI prints an early warning naming the coupling and the remedy (re-record immediately before reconfigure; keep the home slim).

## Alternatives considered

**Keep refusing and document the unlink workaround.** Rejected: destroying live runtime state to satisfy a safety mechanism inverts the mechanism's intent, and the skip weakens none of the snapshot's protections.

**A caller-configurable exclude list.** Rejected as surface without a consumer — the one known oversized tree is the conventional top-level `scratch/`. A list can be added when a second need appears.

**Skip device nodes too.** Rejected: a device node in a dsh home is genuinely anomalous, and fail-closed is the right default for the exotic case. (Untestable without root; the refusal branch is unchanged code.)

## Consequences

- Member-channel deployments can reconfigure without touching the live socket; the unlink workaround is obsolete.
- Homes with large scratch trees no longer race the credential window; slow remaining copies surface an early, actionable warning.
- Tests describe the new behavior: the former fifo-refusal case became the skip coverage (socket + fifo + socket-link + scratch).
