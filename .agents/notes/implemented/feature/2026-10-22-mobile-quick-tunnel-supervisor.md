# Agent Note: Self-healing Quick Tunnel via runtime trust hot-rebind

Status: implemented

## Problem

3080's mobile public entry (a Cloudflare Quick Tunnel) kept dying suddenly: the cloudflared process stays alive while its edge registration and DNS disappear, and every recovery required a new random domain. Rebinding that domain meant editing `DSH_MOBILE_PUBLIC_ORIGIN` plus `--trusted-host` in the launch command — i.e. a host restart. The automatic manager built for exactly this ([public-entry recovery](2026-09-27-mobile-public-entry-recovery.md)) was removed a day later ([removal note](2026-09-28-remove-mobile-tunnel-manager.md)) because treating network failures as permission to restart the host unattended crossed an explicit boundary. Since then, rotations were manual runbooks ([2026-09-30 manual rebind](../process/2026-09-30-mobile-quick-tunnel-rotation-manual-rebind.md)) and the phone entry spent days dead. Community users without a domain had no workable path at all.

## Decision

The mobile plugin now optionally owns the whole Quick Tunnel lifecycle and rebinds domains **at runtime through the official `configEditor` service** (host ≥ 0.1.7) — zero upstream changes, zero host restarts, zero wildcard trust:

- `GET/POST /api/mobile/tunnel` rides the official authenticated Connection registry next to `connect`. GET is read-only status; POST is an explicit same-origin JSON enable/disable action, guarded exactly like QR minting.
- When enabled, the plugin spawns one cloudflared child (`--protocol http2 --no-autoupdate`), parses the allocated `*.trycloudflare.com` hostname from its output, waits for an anonymous edge probe (401/403/2xx — the domain was just assigned to this very process, so a fence 403 also proves forwarding), then calls `configEditor.edit` on the `connection` row, replacing `trustedHosts` with "launch and operator authorities plus the live hostname". Every stale trycloudflare grant is pruned on each edit; the bundle row's `!!js ctx.webStartup.trustedHosts` expression is evaluated via the `webStartup` service; untouched config keys keep their expressions (`...current`). A strict post-bind probe (401/2xx) must pass before the origin is advertised.
- A health loop re-probes every 45 s; three consecutive failures or a child exit rotate to a fresh domain with a ≥ 10-minute recovery cooldown (domain churn = full WebSocket reconnect for every client plus a phone rescan, so it is deliberately throttled). Three consecutive failed starts park at `error` for an operator.
- Enablement and the current origin persist in `$DSH_HOME/state/mobile-quick-tunnel.json`; on plugin apply a persisted `enabled: true` restarts the tunnel immediately, so the public entry self-heals across host restarts and across `deploy:3080` profile regenerations (the edit persists a literal list into `profiles/web/cordis.patch.yml`; when a deploy regenerates the profile back to the bundle expression, the boot-time re-bind corrects it within seconds).
- The advertised origin is read through a per-request getter with precedence managed > `publicOrigin` > `DSH_MOBILE_PUBLIC_ORIGIN`; statically configured deployments see no behavior change and no new chrome.
- The supervisor adds no peer dependency: `configEditor`/`webServer`/`profileContext`/`webStartup` are probed structurally, and any missing capability (plus a non-`http:` listener or a missing cloudflared binary) degrades to an `unsupported` status with a reason code — never a boot failure. Probing is **lazy** (re-evaluated on every status/enable/start): a strict `ctx.get` during composition boot returns undefined for a fiber that is provided but not yet ACTIVE, so a one-shot probe at apply time baked a false `no-config-editor` on the first shipped build (caught by the live repro below). A persisted enablement retries through the boot window (5 s × 24) instead of giving up. The Connect phone settings section surfaces enable/disable, live starting/recovering states, and reason-specific guidance (e.g. install cloudflared).
- The supervisor lives at apply root, outside `ctx.inject(['connection'])`: a hot-rebind re-applies the connection row, which disposes and re-runs dependent inject callbacks — anything registered inside would be destroyed by its own rebind.

Also in this change: while the mobile layout is active the client injects a credential-free data-URI manifest and Apple meta tags (add-to-home-screen, no service worker) so community users need no iOS app download at all — the phone browser is the default client.

Why this no longer violates the 2026-09-28 removal: the removed manager's failure mode was *unattended host restarts* triggered by network state. The new mechanism never restarts the host — the configEditor seam applies a validated config edit in-process (serialized by hmr, rolled back on failure, live when awaited) — and enablement is an explicit authenticated operator action, not an ambient default.

## Alternatives considered

**Revive the deploy-gated rotation manager (2026-09-27 design).** Rejected for the same reason it was removed: recovery through `deploy:3080` restarts the host, and no retry-cooldown tuning changes that.

**Named tunnel for everyone.** Ends rotation entirely but needs a Cloudflare account and a domain zone — the community explicitly may have neither. Supported as the static path; the supervisor simply stands down when a static origin is configured.

**Supervise cloudflared with launchd and keep restarts.** A process supervisor only covers process death, not the dominant alive-but-unregistered failure, and every recovery still required a host restart for the trust rebind. The runtime seam is what makes supervision meaningful.

**Route the tunnel through the bundled ingress (for `MOBILE_SAFARI_COMPAT`).** Rejected for v1 scope: the supervisor points cloudflared directly at the host port (matching the existing prod topology). The Safari in-flight-reply resume limitation is documented as applying on the managed path; re-pinning the adapter fingerprint per host bundle and ingress orchestration remain follow-ups.

## Consequences

- One-click public entry costs a WebSocket drop-and-reconnect for all clients per rotation (no re-authentication; cookies are authority-bound so each new domain needs one token exchange, which the rescan performs naturally). Quick Tunnels still promise no uptime — recovery is automatic, but the phone must rescan after every rotation; only a named tunnel removes that ritual.
- `configEditor.edit` persists a literal `trustedHosts` into `profiles/web/cordis.patch.yml`, masking the bundle expression until the next deploy or boot re-bind. Operators of deploy-managed profiles (3080) must know the runtime writes this file — documented in [docs/ops.md](../../../docs/ops.md) — and a dead grant left after uninstall is inert (the domain is unguessable and gone) and pruned on the next bind.
- The iOS shell stays an optional enhancement; the App-Store-less community story is "scan with the phone camera, use the browser, add to home screen". Real-WebKit resume acceptance on 0.2.x hosts remains an open manual item.
- Tests cover the trust-list rotation (prune/keep/dedupe), enable→ready, crash and probe-failure recovery, cooldown throttling, error parking, disable pruning, persistence-driven auto-start, late service activation through the boot window, endpoint guards, and the settings UI states. Before the production cutover the full flow was also exercised live against a scratch web-profile instance with a real cloudflared binary: enable → edge 401 → login-URL mint → killed-tunnel auto-rotation (new domain live in ~13 s, no host restart) → disable pruning (grant removed, edge 530).
