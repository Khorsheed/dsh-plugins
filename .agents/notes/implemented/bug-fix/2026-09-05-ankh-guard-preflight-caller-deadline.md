# Agent Note: ankh-guard preflight caller deadline

Status: implemented

English | [中文](2026-09-05-ankh-guard-preflight-caller-deadline.zh.md)

## Problem

`schedule-exit` gives its composition preflight 120 seconds by default, but a managed agent shell may terminate a command after 60 seconds unless the caller supplies a larger execution deadline. The CLI previously stayed silent until the preflight child settled and wrote the restart marker only afterwards. A valid slow preflight could therefore be killed by its caller with no output, no `exit scheduled` receipt, and no restart. The agent could then mistake an older listener change for its own restart or retry without knowing whether authorization had reached the detached exit agent.

This is a real timing range rather than a hypothetical one: historical successful full-profile preflights include both roughly four-second runs and a 75-second run. The latter succeeded because its tool call explicitly waited 180 seconds. Older near-instant runs sometimes reported that preflight was unavailable and did not boot the full profile, so their latency was not comparable evidence.

## Decision

- Every stop-capable composition gate immediately emits `composition preflight START`, including the selected profile and the guard's internal timeout, before awaiting the runner. PASS or refusal remains the terminal gate verdict; START alone never authorizes a restart and contains no runner path, launch URL, or credential-shaped output.
- The bundled self-restart Skill treats the caller deadline as a separate safety budget. With the default 120-second preflight, a managed Bash/tool call uses `timeoutMs: 180000`. A custom caller deadline stays at least 30 seconds beyond the configured preflight timeout.
- The Skill directs ordinary same-launch restarts straight through the verb's one internal gate. Standalone preflight is reserved for diagnosing an already-observed failure, not run speculatively immediately before the same guarded verb.
- If a caller still interrupts the CLI, `composition preflight START` without a PASS/refusal and `exit scheduled` means the restart was not shown to be authorized. The operator checks durable restart markers and receipts before retrying rather than inferring success from a listener PID change.

## Alternatives considered

**Reduce the guard's default preflight timeout below common 60-second shell limits.** Rejected because a known-good full-profile preflight has taken 75 seconds. Turning a caller integration mismatch into a false composition/infrastructure refusal weakens the safety gate.

**Detach preflight and return from `schedule-exit` before the verdict.** Rejected because the caller would receive no terminal proof that the gate passed and the exit was actually scheduled. The detached boundary remains the exit agent created only after all pre-stop gates pass.

**Rely on agents to infer a suitable timeout from CLI help.** Rejected because the two budgets belong to different layers and use different option surfaces. The shipped Skill is the contract agents consume, so it names the tool metadata and margin explicitly.

**Run standalone preflight first so the later gate is likely warm.** Rejected because the stop-capable verb intentionally owns the authoritative gate and still must run it. Duplication adds side effects and time without removing the caller-deadline requirement.

## Consequences

- Slow preflight remains fail-closed and keeps its full safety budget, while managed agent calls wait long enough to receive the actual gate verdict and scheduling receipt.
- An externally interrupted call is diagnosable from partial stdout without persisting bearer-bearing runner output. Durable marker inspection remains authoritative for deciding whether a retry is safe.
- Unit coverage holds the START line observable while a deliberately slow preflight is still pending, and skill registration coverage pins the 180-second caller contract in the content actually delivered to agents.
