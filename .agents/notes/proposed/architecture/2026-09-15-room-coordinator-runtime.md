# Agent Note: room coordinators share participant contracts across harnesses

Status: proposed

English | [中文](2026-09-15-room-coordinator-runtime.zh.md)

## Problem

Room sends unaddressed messages to the native DSH agent, while external members expose a different model, control and transcript surface. Existing streaming mirrors do not make the room stream; a final member reply does not prove task acceptance. Making an external member the default coordinator before resolving these differences would carry them into every ordinary conversation.

## Proposal

The [capability proposal](../../../../proposals/active/2026-09-15-room-coordinator-runtime.md) is the scope and acceptance ledger, pending user review. Treat coordinator as a role over stable participant identity. Adapt native DSH through public host interfaces and external harnesses through the existing local-agent facade. Extend shared model, control, content and replay contracts; keep provider-specific discovery and transport in providers, and routing/task policy in room. Preserve optional package boundaries and the existing session-promotion entry.

Deliver reliable model selection, native generation deltas and direct default routing first; then add task dependencies, durable reports, acceptance and goal continuation. Claude's isolated 2.1.272 initialize/set_model probes support evaluating native control instead of shared settings-file scratch writes, but do not establish authenticated inference or exhaustive model availability. The existing 208 passing tests primarily cover simulated data.

## Alternatives considered

**Replace the host AgentFactory.** Not required for default room routing and expands the compatibility burden beyond this request.

**Keep native DSH as an LLM relay.** Adds a second reasoning/context boundary instead of directly addressing the selected coordinator.

**Centralize provider discovery code or flatten all models to strings.** Loses native aliases, capabilities, environment-specific availability and loading state. Share contracts and cache/subscription mechanisms while preserving provider implementations.

**Simulate streaming from final text.** Cannot expose actual in-flight progress or preserve honest interruption behavior.

## Acceptance criteria

User review precedes implementation. Delivery A requires all four coordinator choices to support direct conversation, truthful controls and verified streaming/replay. Delivery B additionally requires dependent tasks, explicit acceptance, durable reporting and bounded continuation. Detailed matrices and evidence limits live in the linked proposal; this documentation commit does not claim those capabilities shipped.

## Risks

Native protocols and model menus vary with version and account. Shared runtime assumptions can corrupt model selection; duplicate/late events can corrupt content or tasks. The design requires capability probes, stable event identities, scoped authorization, explicit handoff and real output comparison. Missing public host capabilities go through the upstream-change path, never a local host patch.
