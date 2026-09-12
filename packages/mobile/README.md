# DSH Mobile

English | [中文](README.zh.md)

An independently removable mobile presentation for DeepSeek Harness. The Mac continues to own sessions, models, skills, tools and plugin execution. The optional [iOS shell](../../apps/ios/README.md) embeds the same official Web client.

## Features

- A conversation library with time/workspace grouping, collapsible workspace sections and bottom search. Grouping stays local to this browser; the official chat and draft remain mounted behind navigation.
- Client-local mobile layout, full-width right-panel details, mobile settings and a wrapping composer toolbar with larger touch targets.
- Official conversation renderer, composer, model/permission selectors, attachments and streaming transport stay in place.
- Add a workspace by entering an existing absolute **computer** directory through the public directory-flow slots. The official owner validates and adopts it; no chooser opens on the Mac.
- Authenticated `GET /api/mobile/handshake`; versioned native bridge for presentation status and optional native settings/QR scanning. Foreground requests reconnect through the official connection service, never replays a send command.
- No required community plugins. Existing message-tools/member/preview surfaces retain their owners; their mobile combinations still require acceptance.

This is a development baseline, not a released or real-device-qualified app. Camera/file picking, sharing/downloads, background recovery and community combinations are not yet qualified. The iOS scanner accepts existing official HTTPS login links and requires host confirmation; camera acceptance is still pending. No one-time device pairing, per-device credential revocation or APNs is provided.

## Install and remove

Build and pack from a repository worktree first:

```sh
pnpm --filter @khorsheed/dsh-mobile build
pnpm --filter @khorsheed/dsh-mobile test
pnpm exec tsx scripts/pack-dist.ts --package packages/mobile --scope @khorsheed --version 0.1.0 --out packages/mobile/.dev/dist
```

Install the resulting tarball with `dsh plugin --profile web add /path/to/package.tgz`; remove with `dsh plugin --profile web remove @khorsheed/dsh-mobile`. The package self-mounts; do not edit profile YAML. On the tested rc1 instance, dependency changes require a controlled Host restart and client reload; hot uninstall is not qualified. Use an isolated `DSH_HOME` and test port during development. Production 3080 still goes through the repository deployment gate.

A narrow touch screen or the native shell enables the layout automatically. `?mobile=1` explicitly enables it; `?mobile=0` disables it. The mobile settings choice persists only in this browser under `dsh.mobile.display`; library grouping uses `dsh.mobile.grouping`. After selecting desktop layout, `?mobile=1` restores the settings entry. The login exchange redirects to `/`, so apply a query override after authentication if needed.

Unload removes owned styles, frame markers, observers, listeners, routes and slot contributions. It does not delete sessions, cancel Host tasks, close the shared connection, revoke official cookies or uninstall the App/VPN. Preferences may remain for reinstall. Browser hot-unload and tarball acceptance are recorded separately below.

## Connection and authentication

The App accepts a configured HTTPS origin or official launch-token login URL. It persists the clean origin only; WebKit stores the official browser session cookie. The bridge accepts only matching-origin main-frame messages with bridge version 1, and supports `ready`, `unloaded`, `chrome`, `settings` and `scan`. New native actions require advertised capabilities; older shells keep their fallback controls. It does not grant file or command privileges.

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

Desktop mode keeps a “Return to mobile layout” button even after reload. Mobile entry suppresses automatic composer focus until an explicit input gesture; rc1 DOM-anchor changes fall back to official focus behavior. Ordinary session titles are deduplicated while ancestor/lineage controls remain visible. These Web-only fixes do not require reinstalling the native App.

The polished mobile view retains composer statistics and official message actions, hides the unselected trajectory entry, and contributes its welcome through the public brand seat. Existing session workspace/preset labels are read-only on rc1; only new sessions offer the official pickers. The native settings page now controls layout through the validated `dsh-mobile-display` event. Unknown header geometry preserves the original header and ancestor navigation.

The composer’s plus menu groups the existing attachment, command and permission triggers. The current permission name and available options remain official. Checked rc1 button anchors retain the original callbacks and confirmation flow, with original controls restored if the structure is unknown. Workspace/preset metadata sits below the mobile title; known desktop header controls are hidden, while unknown plugin contributions remain available.

## Optional collaboration surfaces

Install message-tools, TaskPilot, Room and the Local Agent family separately. Mobile reads their public capabilities and does not require them to boot. Long-press recognized user messages for the original copy/edit/withdraw actions; assistant messages use their own turn actions. Confirmations, disabled actions and mutation semantics remain with their owners. Unrecognized renderers retain their original controls.

The plus sheet opens Room's **original invite form**, styled as a mobile bottom sheet. The member shortcut reads the roster and opens existing child sessions; its settings action opens the original Room members view and edit form. Provider discovery, authentication, random names, first-task dispatch, directory picking, changed-field patches, removal confirmation and business errors belong to Room. There is no second mobile invite/edit API implementation. Blank first task means idle invitation; a supplied first task retains Room's dispatch behavior. Missing checked UI anchors retain the original Members tab as fallback.

Room and Local Agent keep their own composers. The Room queue panel uses the official scoped Conversation API and authoritative `row.text` editability, deduplicates admitted/pending request IDs, and closes an edit when its row disappears or becomes immutable. Goal/todo and TaskPilot entries keep their original owners. Room's own composer replaces the ordinary dock on both platforms, so mobile does not promise that every ordinary TaskPilot pill appears inside a Room.

Mobile reading text uses a 17px floor, primary controls 16–17px and captions approximately 14px, derived from host typography without persisting a host preference. Invite/edit controls remain at least 44px high and their sheet uses the visible viewport when the keyboard opens.

The library preserves workspace identity and shows member counts for both room and ordinary sessions. Visible rows fetch optional Room metadata; failures remain unknown rather than displaying a false count. In this Room revision, an asynchronous initial cache fill can leave the composer election stale; a declining mobile chain entry refreshes the public slot election without replacing its winner. Pending interactions still take precedence.

Successful local message admission dismisses the same empty focused editor; rejected submissions and newer drafts retain focus. The context meter stays beside Send. Glass-like surfaces use host light/dark colors with opaque text and a reduced-transparency fallback. See [collaboration acceptance](../../docs/acceptance/mobile-collaboration-2026-09-12.md).


## Safari live-stream compatibility adapter

Host `0.1.5-rc.1` includes a JSON validator that rejects ordinary objects in Safari when restoring an in-progress reply. For this known defect, the bundled HTTPS ingress accepts `MOBILE_SAFARI_COMPAT=1`. Restart the ingress with that environment variable and have the client reload after the adapter is active. Existing dead reply subscriptions do not recover just by reconnecting the socket.

This is opt-in delivery adaptation, not a Host source patch: only WebKit GET requests for `/plugins/` JavaScript are examined. A SHA-256 fingerprint of the complete known validator gates replacement; unknown code and already-fixed code pass unchanged. The adapter compares against the current engine's native constructor formatting without changing `Function.prototype.toString`. Authentication, RPC bodies, WebSocket frames and the Host's execution are preserved. A direct LAN connection or another ingress does not receive this adapter.

Responses remain private/no-store; adapted assets have corrected byte lengths and no stale ETag/digest. Assets above 16 MiB, non-JS responses, authentication failures and upstream responses that ignore the requested identity encoding pass through unchanged. Inspect `x-dsh-mobile-compat` and the ingress's value-only compatibility log when qualifying a Host upgrade. Do not broaden the fingerprint automatically. Remove the flag after an upstream-fixed build passes real WebKit foreground/reconnect acceptance. Run the ingress from an installed tarball's `examples/`, not a development checkout, for a reproducible deployment.

## Compatibility

| Host line | Verdict |
|---|---|
| Official `0.1.5-rc.1`, `183f08e9c6` | Local browser/Host validation; iOS simulator build passes. Full device/network qualification pending. |
| Other npm RCs / Harness master | Not verified. Audit before adopting. |

`dsh.compat.minHost` is `0.1.5-rc.1`; no `verifiedHost` is claimed while the release matrix is incomplete. The library uses the optional official sessions/workspaces/uiWorkspace services; it filters archived sessions and subagent rows while retaining ordinary forks. Missing services fall back to the basic official sidebar. Search here filters titles and workspace paths, not message contents. The public frame/slot DOM anchors are checked before enabling layout; an unknown frame retains the official page. A changed structure can reduce mobile usability without breaking Host execution. Native bridge version changes require an App compatibility decision; compatible Web updates do not automatically require a new IPA.

See [navigation/QR acceptance](../../docs/acceptance/mobile-navigation-2026-09-11.md), [acceptance evidence](../../docs/acceptance/mobile-rc1-2026-09-11.md) and the [proposal](../../proposals/active/2026-08-19-mobile-access.md). No upstream or sibling source changes are required.
