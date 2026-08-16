# Agent Note: Delegation endpoint observability and custom-endpoint documentation

Status: implemented

English | [中文](2026-08-16-delegation-endpoint-observability.zh.md)

## Problem

A 3080 delegation failure (claude reporting an unavailable model) was traced to the long-running dsh host **implicitly inheriting a stale `ANTHROPIC_BASE_URL`** from its startup shell — the host's environment is a boot-time snapshot, and the effective endpoint had no way to be inspected. Community users also routinely want to route delegations through self-hosted model routers.

## Decision

Endpoint handling stays as-is (no new configuration surface): claude uses its cordis `baseUrl` config or the host `ANTHROPIC_BASE_URL` environment; kimi and codex route via their scoped `config.toml`, edited manually and respected untouched by provisioning. What this change adds is **observability and documentation**:

- Each harness provider resolves the effective endpoint once per run and logs it at info level (`subagent-<h>: delegating via <endpoint>`), without the key. A failed run's error text names the endpoint it used — so a misrouted delegation is diagnosable from the log and the error, the exact gap the 3080 incident exposed.
- The three bundle READMEs gain a "Custom endpoint" section stating the path (config vs environment vs scoped config.toml), the **startup-snapshot pitfall** of a long-running host, the OAuth/credential-exposure warning (a custom endpoint receives the scoped token), and — for codex specifically — that built-in providers cannot be overridden and `OPENAI_BASE_URL` is not honored, so a custom `[model_providers.<name>]` entry with a `model_provider` selection is required.

## Alternatives considered

- **A settings-driven custom-endpoint UI for all three harnesses.** Rejected for this batch after measurement: codex refuses to override built-in providers (must add a custom provider + model selection), kimi's credential binding is path-sensitive, and a full provider editor (endpoint + model + auth key) is a separate, larger task. Documentation of the manual paths serves the current need.
- **Whitelisting the delegation env to drop inherited `ANTHROPIC_*` names.** Reconsidered and rejected: community "export in the terminal and it just works" is a reasonable expectation, and tombstoning would break it; the fix is observability (log the effective endpoint) rather than hiding the inheritance.

## Consequences

- A misrouted delegation now names its endpoint in the info log and the failure error, closing the 3080-class diagnostic gap.
- The environment-snapshot pitfall and the credential-exposure risk of custom endpoints are documented in all three READMEs (bilingual).
- kimi's effective endpoint is read from the scoped `config.toml` `[providers."managed:kimi-code"].base_url`; codex's from the `model_providers` entry selected by `model_provider`. Both reads are diagnostic-only and tolerate a missing/malformed config.

## Verification

- Provider unit suites pass with the added endpoint reads/logging (claude 17, kimi 37, codex 19 tests).
- Translation pairing: 25 pairs in sync after re-recording the three README edits.
