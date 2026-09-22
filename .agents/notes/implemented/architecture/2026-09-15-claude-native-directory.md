# Agent Note: Claude native model directory and bounded controls

Status: implemented

## Problem

Claude's member picker could offer only configured and historical identifiers. Its stream-json interrupt handler also treated every correlated response as success and left unanswered controls pending indefinitely. The CLI has no models command, but its initialize control exposes native picker metadata.

## Decision

A scoped, bounded initialize probe feeds the core directory cache. It retains native selection aliases, display names, resolved model names and explicitly supplied effort levels. Missing native directory support is distinct from an empty successful result or a failed probe. Native candidates and historical suggestions keep separate provenance. Member reads and transcript backstops use that member's actual scope and cwd.

Discovery submits no user prompt, disables hooks and MCP loading, requests no session persistence, and neither copies credentials nor writes model settings. Protocol discovery and the live runtime share correlated controls with deadlines, error acknowledgements, cancellation and process-death cleanup. The live interrupt uses this checked control path.

An isolated local Claude 2.1.272 initialize probe returned native aliases, resolved names and supportedEffortLevels without a user task. This proves the metadata shape, not authenticated inference or exhaustive account entitlement. The production adapter follows the CLI resolved by the instance PATH; the acceptance instance must identify its binary explicitly because multiple local versions coexist.

## Alternatives considered

**A vendor HTTP request with a copied OAuth token.** Not used: the native CLI resolves its own endpoint, settings and authentication, and already supplies the picker vocabulary.

**Replace aliases with their resolved model names.** Rejected because a dynamic alias is a selection intent; resolving it for display must not pin a version.

**Remove the live settings workaround after an initialize ack.** Deferred until native model controls are integrated and actual subsequent fresh/resume rounds verify the applied model. This commit does not change that runtime selection path.

## Consequences

Claude now participates in the rich directory and refresh subscription contract. Old CLIs degrade visibly when discovery is unsupported or fails. Shared UI and durable model/effort selection remain subsequent proposal work. Directory metadata does not make an effort control executable by itself.

## Testing

Tests cover native labels, aliases, resolved names, reasoning values, unsupported/malformed responses, scoped no-prompt discovery, process closure, stale data after a rejected request, control correlation, timeout and process death. The complete Claude package suite passes, including live streaming and interruption regressions.
