# Agent Note: Quick Tunnel held by a detached sidecar so host restarts keep the domain

Status: implemented

## Problem

The [self-healing Quick Tunnel](../feature/2026-10-22-mobile-quick-tunnel-supervisor.md) made cloudflared a child of the host process. Every host restart — and 3080 restarts on every deploy, more than 150 times by 2026-10-24 — killed the tunnel, and the restarted supervisor opened a new one on a new random `*.trycloudflare.com` domain. The browser cookie is signed with a persistent secret and lives for days, but it is bound to the request authority, so a new domain logs every phone out: the user experienced it as "the phone connection breaks on every restart".

The same incident exposed two failure-handling gaps. Three failed start cycles parked the state at `error` forever, so a transient cause (on 2026-10-24 the cycles overlapped a running `deploy:3080`) needed a manual click. And the failure detail collapsed every non-coded error to its constructor name, so the state file said only `lastError: "Error"` and the cause was unrecoverable.

## Decision

cloudflared is now held by a detached, zero-dependency sidecar, `lib/tunnel-sidecar.js`, built as a second host entry. The supervisor launches it with `process.execPath`, `detached: true`, `stdio: 'ignore'` and `unref()`, so it sits in its own process group and outlives the host.

- **Adoption.** The sidecar writes `$DSH_HOME/state/mobile-quick-tunnel.sidecar.json` (pid, port, host, heartbeat) every 10 s. On every start the supervisor adopts a sidecar whose heartbeat is younger than 30 s, whose pid is alive and whose port matches the current listener; it launches a new one only otherwise. When the adopted domain is already in the stored `trustedHosts` list, `bind()` skips the `configEditor.edit` call entirely, so a routine restart writes nothing to the profile and does not reload the connection row.
- **Shutdown.** The sidecar exits together with cloudflared on SIGTERM (explicit disable), when cloudflared exits, or when the supervisor's lease — `mobile-quick-tunnel.sidecar.json.lease`, renewed on every health tick while enabled — goes 10 minutes without renewal. `dispose()` no longer touches the tunnel: cordis disposes on both restart and uninstall and the plugin cannot tell them apart, so the lease is what distinguishes "host back in seconds" from "host gone". A stale heartbeat is never SIGTERMed, so a reused pid is safe.
- **Wake detection.** The health tick (20 s) checks sidecar liveness and probes the origin. A gap between ticks larger than three intervals means the timers were frozen by sleep; one failed probe then rotates immediately, bypassing the 10-minute cooldown.
- **No parking.** Failed starts retry forever: cooldown-spaced for the first three, then backing off exponentially to `maxRetryMs` (1 h). A failure in the `bind` or `verify` stage keeps the sidecar, so the retry re-adopts the same domain instead of rotating.
- **Diagnosable failures.** `failureDetail(stage, error)` records `<stage>: <Name>: <message>` with URL- and token-shaped text redacted and a 200-character cap; the stage is one of `port`, `tunnel`, `edge`, `bind`, `verify`. The settings section shows it under the error state.
- **Lazy enablement.** The persisted state loads once `profileContext.home` resolves, instead of being read once at apply time.

The same change raises the mobile host floor to 0.2.0-rc.2 and deletes the 0.1.x paths: the manual HTTPS ingress example and its Safari stream-compat adapter (the 0.2 host fixed the WebKit JSON validator upstream, and the managed tunnel never used the ingress), the 0.1.5 snapshot queue, the list `current` read, the pre-unified composer markup, the open-in-app icon match and the `[data-composer-stats]` CSS. The settings copy leads with the phone camera and browser; the iOS App becomes a one-line aside, because the community cannot install it without building it in Xcode.

## Alternatives considered

**Make `@khorsheed/dsh-ankh-guard` a dependency and let its watchdog hold cloudflared.** Rejected. It breaks the no-inter-plugin-dependency rule that `check:plugins` enforces; ankh-guard has no sidecar-supervision capability (it supervises the host process and gates restarts against the harness checkout's git HEAD); and it is a 9,000-line package with nine official peers — far too heavy for a community user who wants phone access. The sidecar is under 110 lines.

**launchd / systemd unit for cloudflared.** Rejected for the community default: per-OS installation steps, and the supervisor would still need the adoption and lease logic to know which tunnel is live. The sidecar is cross-platform and installs with the package.

**Named tunnel or Tailscale as the default.** Both give a permanent hostname, but need a Cloudflare zone or a Tailscale client on the phone. They remain the documented static path; the managed supervisor still stands aside when a static origin is configured.

**Keep the port-open check as the sidecar's exit rule.** The first draft exited when 127.0.0.1:port stayed closed for the grace window. That misses an uninstall while the host keeps running — the port stays open and the sidecar would live forever. The lease covers host-stopped and plugin-uninstalled alike.

## Consequences

- A host restart or deploy keeps the domain and the phone's login. Rotation — and a rescan — now happens only after sleep, reboot or an edge drop.
- Uninstalling leaves the tunnel up for up to 10 minutes; the README tells operators to disable first when they need it closed at once.
- Once `configEditor` persists a literal `trustedHosts` list in `profiles/web/cordis.patch.yml`, it stays: `deploy:3080` does not rewrite that file, and the supervisor keeps every entry it does not manage. A domain removed from the launch `--trusted-host` flags therefore lingers in the literal until it is deleted from the profile patch by hand (done for 3080's stale static domain on 2026-10-24, together with `deploy:3080 --clear-mobile-origin`).
- The mobile package no longer installs on 0.1.x hosts; 0.1.x stays on mobile 0.1.4.
- Tests drive the supervisor through a fake `SidecarControl` with real state files (adoption, port change, rotation, sidecar death, wake, unbounded retry keeping the tunnel, edge failure, disable), and two real-process tests run the sidecar against a fake cloudflared script for SIGTERM and lease expiry. A live cloudflared run on 3080 is still pending: the auto-mode classifier blocks opening an external tunnel from the agent session.
