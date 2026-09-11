# DSH Mobile

English | [中文](README.zh.md)

An independently removable mobile presentation for DeepSeek Harness. The Mac continues to own sessions, models, skills, tools and plugin execution. The optional [iOS shell](../../apps/ios/README.md) embeds the same official Web client.

## Features

- Client-local mobile layout, conversation drawer, full-width right-panel details and mobile settings.
- Official conversation renderer, composer, model/permission selectors, attachments and streaming transport stay in place.
- Add a workspace by entering an existing absolute **computer** directory through the public directory-flow slots. The official owner validates and adopts it; no chooser opens on the Mac.
- Authenticated `GET /api/mobile/handshake`; versioned, status-only native bridge. Foreground requests reconnect through the official connection service, never replays a send command.
- No required community plugins. Existing message-tools/member/preview surfaces retain their owners; their mobile combinations still require acceptance.

This is a development baseline, not a released or real-device-qualified app. Camera/file picking, sharing/downloads, background recovery and community combinations are not yet qualified. No QR pairing, per-device credential revocation or APNs is provided.

## Install and remove

Build and pack from a repository worktree first:

```sh
pnpm --filter @khorsheed/dsh-mobile build
pnpm --filter @khorsheed/dsh-mobile test
pnpm exec tsx scripts/pack-dist.ts --package packages/mobile --scope @khorsheed --version 0.1.0 --out packages/mobile/.dev/dist
```

Install the resulting tarball with `dsh plugin --profile web add /path/to/package.tgz`; remove with `dsh plugin --profile web remove @khorsheed/dsh-mobile`. The package self-mounts; do not edit profile YAML. On the tested rc1 instance, dependency changes require a controlled Host restart and client reload; hot uninstall is not qualified. Use an isolated `DSH_HOME` and test port during development. Production 3080 still goes through the repository deployment gate.

A narrow touch screen or the native shell enables the layout automatically. `?mobile=1` explicitly enables it; `?mobile=0` disables it. The mobile settings choice persists only in this browser under `dsh.mobile.display`. After selecting desktop layout, `?mobile=1` restores the settings entry. The login exchange redirects to `/`, so apply a query override after authentication if needed.

Unload removes owned styles, frame markers, observers, listeners, routes and slot contributions. It does not delete sessions, cancel Host tasks, close the shared connection, revoke official cookies or uninstall the App/VPN. Preferences may remain for reinstall. Browser hot-unload and tarball acceptance are recorded separately below.

## Connection and authentication

The App accepts a configured HTTPS origin or official launch-token login URL. It persists the clean origin only; WebKit stores the official browser session cookie. The bridge accepts only matching-origin main-frame messages with bridge version 1, and only reports availability. It does not grant file or command privileges.

Different physical networks need an independently configured HTTPS/WSS ingress to the loopback Host port (3080 in production), valid official authentication, an awake/online Mac and reachable phone. Starting 3080 alone does not establish remote access. The App does not configure networking or credentials on your behalf. Debug simulator builds allow HTTP on loopback only; Release requires HTTPS. Clear local App data and server-side device revocation are different operations.

## Optional Quick Tunnel preview

Networking is deployment configuration, not a plugin dependency. Community users can choose Quick Tunnel for temporary previews, their own HTTPS reverse tunnel/server, or private networking. No personal domain, server or Cloudflare account is embedded in the plugin. A stable managed relay would be a separate service with its own operating costs.

[Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) create a temporary HTTPS address without a Cloudflare account or your own domain. They are for testing, have no uptime guarantee, allow 200 concurrent requests and do not support SSE. The tested rc1 conversation transport uses WebSocket; this does not qualify unrelated plugins that require SSE.

Use an isolated Host profile with the mobile tarball installed. Install `cloudflared` from its official distribution and use Node 22+. From the repository root, start the tunnel first (the origin can be offline while the address is allocated):

```sh
cloudflared tunnel --url http://127.0.0.1:3182 --protocol quic --no-autoupdate
```

The latest isolated preview uses `--protocol quic` after HTTP/2 edge connections timed out. Protocol choice depends on the local network; a registered tunnel alone is not enough evidence. Verify public login and a full WebSocket reply before sharing the preview. Keep these processes running independently of short-lived automation sessions.

Copy its generated hostname in place of `YOUR-HOST.trycloudflare.com` below. Start the standalone example in a second terminal:

```sh
PUBLIC_ORIGIN=https://YOUR-HOST.trycloudflare.com HOST_PORT=3181 INGRESS_PORT=3182 node packages/mobile/examples/https-ingress.mjs
```

Then start the isolated Host with its own `DSH_HOME`, workspace and configured model, adding the exact public authority through the official flag:

```sh
dsh web --no-open --port 3181 --trusted-host YOUR-HOST.trycloudflare.com
```

The example is also included under `examples/` in the package tarball. It binds only to loopback, preserves the public Host and Origin for official authentication, requires an HTTPS forwarded scheme, adds Secure to upstream cookies, and forwards HTTP streams and WebSocket upgrades. It neither reads Host private keys nor adds a pairing or device-revocation system. Run it only behind the HTTPS tunnel; a local header is not proof of an authenticated user. The Host remains responsible for authorization.

For phone login, replace only the origin of the Host's launch URL with the tunnel HTTPS origin, preserving its `?token=...`. Open it in Safari or paste it into the iOS shell. Keep that credential-bearing URL private. Login redirects to a clean `/`; use `?mobile=1` afterwards if the device does not enable mobile layout automatically.

Keep the Mac awake and all three services running. Stop the tunnel process to close this public access path; removing the mobile plugin alone does not stop the tunnel or revoke official sessions. A newly allocated hostname requires updating both `PUBLIC_ORIGIN` and `--trusted-host` and logging in again. This preview does not establish long-term cellular availability. See the [Quick Tunnel acceptance record](../../docs/acceptance/mobile-quick-tunnel-2026-09-11.md).

## Compatibility

| Host line | Verdict |
|---|---|
| Official `0.1.5-rc.1`, `183f08e9c6` | Local browser/Host validation; iOS simulator build passes. Full device/network qualification pending. |
| Other npm RCs / Harness master | Not verified. Audit before adopting. |

`dsh.compat.minHost` is `0.1.5-rc.1`; no `verifiedHost` is claimed while the release matrix is incomplete. The public frame/slot DOM anchors are checked before enabling layout; an unknown frame retains the official page. A changed structure can reduce mobile usability without breaking Host execution. Native bridge version changes require an App compatibility decision; compatible Web updates do not automatically require a new IPA.

See [acceptance evidence](../../docs/acceptance/mobile-rc1-2026-09-11.md) and the [proposal](../../proposals/active/2026-08-19-mobile-access.md). No upstream or sibling source changes are required.
