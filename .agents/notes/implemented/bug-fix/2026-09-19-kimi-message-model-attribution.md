# Agent Note: Attribute Kimi messages to the native model

Status: implemented

## Problem

The isolated model-control trial switched Kimi from the member's K3 selection to its harness default and back. Native request and usage records confirmed both models, but every mirrored assistant message still claimed `k3`: its message factory hardcoded that value. The control state was correct while the transcript contradicted it.

## Decision

Wire parsing carries the model known at each content line, using native request and usage records. A new prompt or a request without model metadata clears the per-line assumption. Replaying mixed-model history attributes each message independently, rather than applying the transcript's latest model to all earlier messages. Live snapshots use the native session's confirmed model, with the observed round model as fallback. The message factory uses `unobserved` when neither source establishes a model. Round observation also checks the native model record's turn, so an unnamed later turn cannot inherit an earlier observation.

## Alternatives considered

**Use the creation-time model.** Rejected because a resumed member can change models many times.

**Apply the last observed model to the whole transcript.** Rejected because it silently rewrites earlier turns' identity during a cold replay.

**Keep a friendly K3 fallback.** Rejected because an unknown observation must not claim a particular model.

## Consequences

New messages carry truthful model attribution across default, inherited and explicit model choices. Existing persisted messages are not rewritten. This changes message metadata, not credentials, model selection, usage totals or frozen evaluation condition digests. Regression coverage includes two different native model records followed by a turn with no model metadata, plus the existing streaming and transcript suites.
