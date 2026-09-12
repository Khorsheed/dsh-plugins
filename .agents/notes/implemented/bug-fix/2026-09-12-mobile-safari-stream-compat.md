# Agent Note: Bound Safari stream compatibility to mobile ingress delivery

Status: implemented

## Problem

An iPhone conversation stopped publishing reply events after reconnect while its statistics continued. The Host's JSON-value validator compared intrinsic constructor source against a V8-only string, rejecting ordinary Safari objects. A plain TypeError then ended journal consumption without changing the Session's open state. The [upstream report](../../../../docs/upstream-proposals/2026-09-12-safari-assistant-stream-resume.md) records the preserved scene and the two separate defects.

## Decision

The user authorized a temporary compatibility layer owned by mobile. Keep the Host checkout unchanged. The optional HTTPS ingress shipped with mobile accepts `MOBILE_SAFARI_COMPAT=1` and adapts WebKit GET requests for official `/plugins/` JavaScript before evaluation. Match the whole known published intrinsic-constructor function using SHA-256 after indentation/name-suffix normalization; replace only its V8-specific string with the current realm's native constructor string. Name, constructor/prototype identity and JSON validation remain intact.

Known copies in combined bundles are all adapted. A changed candidate makes the adaptation pass through unchanged; already-fixed code is a no-op. No broad search/replace, runtime global monkey patch, Session-private access or separate conversation protocol enters production. The ingress is opt-in and should run from its installed tarball, not a mutable checkout.

Only successful identity-encoded JavaScript is buffered, with a 16 MiB bound. Request identity encoding and suppress range/conditional asset requests; correct changed content lengths and remove stale validators. Keep private/no-store responses. Delivery verification found a 12 MB unchanged UI bundle slow on the public tunnel: gzip accepted responses after inspection, including unchanged bundles, with negotiated encoding, corrected byte lengths, Vary and removed stale representation validators. Gzip refusal keeps identity; auth and application streams bypass compression. Auth failures, application streams and WebSockets retain their existing forwarding. Compatibility status is observable through a response header and bounded metadata-only logs, never through tokens or conversation contents.

## Alternatives considered

- **Wait only for the upstream release.** This leaves the user's real iPhone experience broken. An upstream fix remains the retirement path, but the user explicitly authorized a temporary downstream delivery adapter.
- **Modify `Function.prototype.toString`.** This changes global behavior for every loaded plugin and hides the problem from unrelated consumers. A targeted script edit has a narrower behavioral scope.
- **Patch the Host checkout or private Session objects.** This violates the Host ownership boundary and couples mobile to internal service lifetime. The adapter neither changes server execution nor reconstructs reply streams itself.
- **Refresh or poll snapshots.** It does not fix Safari's deterministic validation failure and can lose stream continuity. The original Host subscription remains the sole owner.

## Consequences

The adapter only covers clients traversing this ingress; direct LAN access and other reverse proxies remain unaffected. A page whose subscription already died must reload after the adapter is activated. Unknown/minified builds, encoded upstream assets and oversized bundles pass through unmodified and require qualification; code fingerprints must not be broadened automatically.

This removes the known trigger but does not implement upstream Session failure-state hardening. Upstream still needs error publication, cleanup/retry and coherent cursor publication. Remove the opt-in flag after an upstream-fixed release passes actual WebKit reconnect and in-progress reply checks. Chromium mobile emulation alone is insufficient. Unit coverage includes exact/mixed fingerprints, cross-realm prototype checks, byte lengths, cache conditions, auth failures, oversized assets and streaming preservation.
