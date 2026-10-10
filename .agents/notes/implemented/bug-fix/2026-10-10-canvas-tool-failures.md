# Agent Note: Canvas declared failures carry the host error flag

Status: implemented

## Problem

Canvas returned successful strings beginning with a failure label for rejected writes and missing resources. The host consequently persisted `isError: false`, so timing diagnostics undercounted failures.

## Decision

Explicit failure branches throw `CanvasToolError` with the existing actionable text. The host tool dispatcher catches it and produces the canonical `isError` outcome. Success output shapes and ordinary no-target guidance remain unchanged. No generic response-text scan is introduced; content containing a failure word is not itself an error.

## Alternatives considered

**Classify strings in Context Lens.** Rejected because response prose is not a reliable error contract, and every consumer needs the correct flag.

**Change the host dispatcher.** Unnecessary: its existing exception path already persists the right outcome.

## Consequences

Direct callers now receive a rejected promise for declared failures; host-dispatched calls keep the helpful model-facing text with an error status. Existing text assertions catch only the typed Canvas error, and a separate test verifies the rejection contract and unchanged no-target guidance.
