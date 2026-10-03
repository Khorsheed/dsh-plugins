# Agent Note: Preserve Claude host keychain identity on macOS

Status: implemented

## Problem

A fresh Claude OAuth login succeeded, but the delegated Opus member immediately reported an expired session. On Claude Code 2.1.284, the same scoped home reports authenticated with USER present and unauthenticated with USER removed; restoring LOGNAME alone does not help. The family environment deliberately omits USER because of an older CLI workaround. The saved credential is current and agrees between the file and the usable keychain entry, so repeating login does not fix the launch mismatch.

## Decision

The Claude provider explicitly restores USER on macOS through its private process environment helper. The value follows the host USER, falling back to the OS username for service launches. Login argv, version probing, native model discovery, one-shot fresh/resume execution and the resident driver share this identity. Failure to read the OS identity degrades without inventing a username. The family allowlist still scrubs unrelated variables and ambient credentials.

Container execution retains the family environment and never forwards this macOS host identity. Other providers and non-macOS launches are unchanged. No keychain entry is deleted or migrated, and no token is copied into argv. Deployment restart replaces resident children so they read the corrected environment; native session history remains available for resume.

## Alternatives considered

**Ask the user to log in again or delete historical keychain items.** The current grant already authenticates under the correct identity. Credential mutation hides the launch defect and risks unrelated consumers.

**Restore USER globally in the local-agent allowlist.** Only Claude's macOS credential read requires this exception. Broadening every provider or forwarding a host username into a container is unnecessary.

**Continue relying on the credential file mirror.** Current macOS Claude resolves its own keychain account. A current file does not repair an incorrect process identity.

## Consequences

Unit coverage pins macOS identity retention, OS fallback, failure degradation, unchanged non-macOS behavior and continued credential scrubbing. Existing driver, discovery, login and container tests cover the affected entry points. Native auth-status comparisons provide a credential-safe reproduction without inference. A real authenticated turn and deployment canary remain operational acceptance rather than unit-test claims.
