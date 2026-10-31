# Agent Note: a Codex member's effort passes when the directory cannot list its model

Status: implemented

## Problem

After the user switched the Codex endpoint to openproxy's codex route, room 5d4f0d41's 游戏策划大师 failed at once with "Codex has not advertised this reasoning effort for the selected model; refresh its native directory". The route serves `/responses` for `gpt-6.1-sol` with `reasoning.effort: high` fine. Its `GET /v1/models`, however, answers 403. The model directory was therefore `unsupported` and empty. The broker refused any explicit effort whose model had no directory entry, so the member never reached its turn.

## Decision

The Codex configuration adapter refuses an explicit effort only when the directory lists the model's reasoning options and the effort is not among them. This is the Kimi broker's existing rule. A missing entry or missing reasoning metadata passes the effort through, and the endpoint stays the judge.

## Alternatives considered

- **Probe the model list through another path.** The relay decides what `/models` answers, and an empty directory must not block a working endpoint.

## Consequences

A wrong effort on an unlisted model now fails at the endpoint with its own message, instead of before the turn. The Claude and DSH brokers keep the stricter rule, because their directories are local.

## Testing

`local-agent-codex` (263): a configuration spec resolves `gpt-6.1-sol` with `high` against an empty `unsupported` directory.
