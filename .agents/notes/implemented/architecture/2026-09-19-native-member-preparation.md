# Agent Note: Prepare native members before their first prompt

Status: implemented

## Problem

A newly invited external coordinator had no child identity until a user sent a real prompt. Promotion therefore required an unrelated test conversation, while model controls and native session readiness had no shared preparation boundary.

## Decision

Local-agent core reserves a durable member binding and child transcript before paid execution. The four live providers expose preparation using their native initialization/control surfaces: Codex creates a thread, Kimi creates and configures an ACP session, Claude initializes stream-json controls, and the owned DSH headless process validates its model through a preparation request without creating an agent or sending a prompt.

Preparation is bound to parent, provider, working directory, scope and creation configuration. Matching concurrent requests coalesce; a different identity is rejected. Authentication presence, configuration admission and strict transcript persistence precede readiness. An explicit repeated preparation reconciles a failed pre-execution configuration before retrying. It never replays an identity that has entered execution.

An atomic on-disk phase changes from ready to starting before the first start can yield. The first paid turn consumes the same child identity and its latest admitted configuration. A published run remains tracked even if the final used marker cannot be written; the earlier starting marker still prevents duplicate execution. Prepared model directory reads use their own bound context without borrowing another member's observed model.

Room promotion prepares a newly invited member automatically, without changing the role on failure. Room input and roster edits are blocked during handoff, and both outgoing and incoming configuration state must be idle and converged. Existing member sessions continue through the normal resume path.

## Alternatives considered

**Send a test prompt to establish readiness.** It incurs an unrelated turn and cost and contaminates the coordinator's history. Native initialization supplies the needed identity and control checks without generation.

**Reserve an ID only in room memory.** A restart could lose the binding or accidentally start it twice. Core owns durable identity and the admission barrier shared with the providers.

**Treat native initialization as proof of authenticated generation.** Initialization and model controls can succeed without an end-to-end inference request. Real authenticated acceptance remains separate.

## Consequences

Members can be configured and selected before their first conversation. Preparation failures can be retried explicitly while uncertain first executions stay blocked. Idle native processes may be reclaimed; a first real turn recreates an empty native session if needed, retaining the durable dsh child identity. No host source changes are required.

This completes only the preparation part of the coordinator readiness contract. Full coordinator tools and permissions, the shared message queue, goal orchestration and authenticated browser acceptance remain outstanding. Provider protocol fixtures and core/room tests cover no-prompt preparation, first-turn reuse, authentication and persistence failures, retry, identity conflicts, overlapping first starts and unchanged routing after failed promotion.
