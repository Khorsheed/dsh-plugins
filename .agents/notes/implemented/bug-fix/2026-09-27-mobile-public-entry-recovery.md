# Agent Note: Recover the desktop mobile public entry

Status: implemented

## Problem

A Quick Tunnel process can remain alive while its remote registration and DNS disappear. The Web connection page only checked configured authority and host trust, so it continued issuing QR codes for a dead address. Host deploy restarts and network failures were indistinguishable to the user.

## Decision

The mobile host probes the configured public root anonymously with a six-second bound and no redirects before advertising readiness or issuing an official login URL. The client hides a displayed QR on a failed fifteen-second recheck or changed authority. No tokens travel in probes.

An opt-in desktop manager in scripts/mobile-tunnel.mts owns new cloudflared and loopback ingress processes independently of the host. Three failed public checks with a healthy local host trigger recovery; host outages wait, and attempts back off for ten minutes. The candidate ingress accepts only its assigned HTTPS authority. The manager calls deploy:3080 with a validated mobile-origin option: exact existing origin and trusted-host bindings rotate through guarded reconfigure, including the config probe's origin. The existing build/test, profile lock, preflight, rollback and authenticated canary remain authoritative. Uncommitted mobile/deployment files block automated recovery deploys. A candidate committed by an uncertain deployment stays alive rather than being killed on the error path.

The manager is installed separately as a desktop service; the mobile plugin does not spawn services or provision Cloudflare accounts. Phones still rescan after a domain change. No wildcard trust or new discovery service is introduced.

## Alternatives considered

**Restart only cloudflared** changes the domain without updating host trust and QR configuration, leaving the phone broken. **Restart on every failed request** churns domains on transient outages or ordinary host restarts. **Always show a configured QR** confuses configuration validity with reachability.

**Dynamic wildcard trust or a phone discovery service** expands the security and product scope. The chosen explicit-domain guarded cutover reuses deployment ownership, at the cost of restarting the host on a real rotation.

## Consequences

Computer-side checks cannot guarantee phone-side network reachability. Quick Tunnel remains temporary infrastructure, so the manager offers bounded recovery rather than an uptime promise. Logs and state contain public origins and lifecycle state, never login URLs. Tests cover anonymous probes, QR withdrawal, exact authority rotation, guard routing, candidate ownership, failed-deploy cleanup, local outages and retry cooldown. A launchd service keeps the deployed desktop owner running across host restarts.
