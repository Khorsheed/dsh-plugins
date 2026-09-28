# @khorsheed/dsh-mobile

English | [中文](README.md)

Your dsh sessions, in your pocket — the Mac still runs the sessions, models, skills and tools; the phone just gets an interface built for it.

The official Web client is desktop-shaped: a sidebar that eats the screen, a dense composer, touch targets made for a mouse. This plugin re-presents the very same client for narrow touch screens — a conversation library with grouping and search, a wrapping composer with reachable controls, a sheet for picking directories on the computer — and adds an optional [iOS shell](../../apps/ios/README.md) that embeds that same official Web client and pairs to it over a QR login link. Everything stays removable: uninstalling restores the official desktop UI exactly, and no Host or sibling-plugin state is ever written.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/mobile-library.png" width="640" alt="the mobile conversation library: time and workspace grouping, the bottom search field and the QR pairing entry">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/mobile-conversation.png" width="640" alt="a conversation in mobile layout: the session header with its Members tab, the message flow, and the composer toolbar at the bottom">

## Features

- **Conversation library home** — time/workspace grouping, collapsible workspace sections and bottom search. Grouping stays local to this browser (`dsh.mobile.grouping`); the official chat and your draft remain mounted behind navigation.
- **A real mobile layout, client-local** — full-width right-panel details, mobile settings, and a wrapping composer toolbar with larger touch targets (reading text ≥ 17px, primary controls 16–17px). The official conversation renderer, composer, model/permission selectors, attachments and streaming transport stay in place.
- **Pick a computer directory from your phone** — saved workspaces, one-level folder browsing, parent navigation, a hidden-folder toggle and a validated absolute-path fallback. Workspace adoption and Room member picks share this sheet; desktop clients keep the native chooser.
- **Connect a phone by QR** — an authenticated Web settings section mints the official login link for your deployment's HTTPS origin and shows it as a locally encoded QR; the iOS shell scans, confirms the host, and is in.
- **Versioned native bridge** — an authenticated `GET /api/mobile/handshake` plus a bridge-version-1 message channel for presentation status and optional native settings/scanning. Foreground recovery rides the official connection service and never replays a send command; brief interruptions and initial connecting states avoid redundant reconnects, while a suspension of 5 s or more still refreshes the stream generation.
- **Plays well with the ecosystem, requires none of it** — no community plugin is a boot dependency. Long-press recognized user messages for message-tools' original copy/edit/withdraw; the plus sheet opens Room's original invite form; TaskPilot and Local Agent surfaces keep their owners.

This is a development baseline, not a released or real-device-qualified app — see Known Limitations.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-mobile
```

The package self-mounts its own row — do not edit profile YAML. Restart the web instance and reload the client to activate.

```sh
dsh plugin --profile web remove @khorsheed/dsh-mobile
```

Unload removes owned styles, frame markers, observers, listeners, routes and slot contributions. It does not delete sessions, cancel Host tasks, close the shared connection, revoke official cookies or uninstall the App/VPN. Preferences may remain for reinstall.

A narrow touch screen (`max-width: 760px` with a coarse pointer) or the native shell enables the layout automatically. `?mobile=1` explicitly enables it; `?mobile=0` disables it. The mobile settings choice persists only in this browser under `dsh.mobile.display`; after selecting desktop layout, `?mobile=1` restores the settings entry. The login exchange redirects to `/`, so apply a query override after authentication if needed.

## Connect a phone from Web settings

The authenticated Web client exposes **Settings → Connect phone** through the public `settings.section` slot — available on desktop without enabling the mobile layout. Configure the phone-reachable **clean HTTPS origin** as the plugin's `publicOrigin` option, or set `DSH_MOBILE_PUBLIC_ORIGIN` on the **Host process** (the plugin option wins). Add the same hostname to the Host's `--trusted-host` list; the ingress `PUBLIC_ORIGIN` must also match. These are deployment settings, not phone preferences.

```sh
DSH_MOBILE_PUBLIC_ORIGIN=https://YOUR-HOST.trycloudflare.com dsh web --no-open --port 3181 --trusted-host YOUR-HOST.trycloudflare.com
```

1. Open Web **Settings → Connect phone** and check the displayed host.
2. Click **Show login QR code**.
3. In the iOS App, open **Connection Settings → Scan to connect**, scan and confirm the host.

`GET /api/mobile/connect` returns configuration status only. An authenticated, same-origin JSON `POST` obtains the official `connection.authenticatedUrl()` for the deployment-owned origin — browser input cannot override the destination. Both routes ride the official Connection registry, preserving its cookie and Host/Origin checks, and answer `no-store`. QR encoding happens locally in the browser: no third-party QR service, no secret logging, no browser persistence. Leaving the section, hiding the page or waiting two minutes conceals the code and aborts pending requests. Missing/invalid origin, an unsupported Host capability or an untrusted destination shows setup guidance instead of generating a login link.

**Concealment is not credential expiry.** The QR carries the official process login token, valid until that Host process restarts — not a short-lived or one-use pairing token. Hiding or regenerating the QR does not revoke a copied link or a logged-in phone, and existing cookies keep their Host-owned lifetime.

Different physical networks need an independently configured HTTPS/WSS ingress to the loopback Host port, valid official authentication, an awake/online Mac and a reachable phone — starting the Host alone does not establish remote access, and the App does not configure networking or credentials for you. Debug simulator builds allow HTTP on loopback only; Release requires HTTPS.


### Public entry checks and rescanning

The connection page anonymously probes the configured public root before offering or generating a QR. An unavailable origin returns an actionable state without issuing a login URL. A displayed QR is checked every 15 seconds and hidden if the endpoint fails or changes. This is a computer-side reachability check, not a guarantee about the phone's network.

Checks only report connection status: they do not rebuild tunnels, deploy plugins or restart the host. The deployment operator restores a failed public entry manually; changes to host origin or trust bindings that require a restart must be explicitly scheduled first. Once the computer-side address is available, reopen **Connect phone** and scan the new QR on the phone. The phone address is not updated automatically.

## Optional: a Quick Tunnel preview

Networking is deployment configuration, not a plugin dependency — bring your own HTTPS reverse tunnel/server or private networking; the plugin embeds no domain, server or Cloudflare account. For temporary previews, [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) mint a temporary HTTPS address without an account or domain: no uptime guarantee, 200 concurrent requests, no SSE (the tested conversation transport uses WebSocket).

```sh
cloudflared tunnel --url http://127.0.0.1:3182 --protocol quic --no-autoupdate
PUBLIC_ORIGIN=https://YOUR-HOST.trycloudflare.com HOST_PORT=3181 INGRESS_PORT=3182 node packages/mobile/examples/https-ingress.mjs
dsh web --no-open --port 3181 --trusted-host YOUR-HOST.trycloudflare.com   # own DSH_HOME, workspace, model
```

The bundled `examples/https-ingress.mjs` binds loopback only, preserves the public Host/Origin for official authentication, requires the HTTPS forwarded scheme, adds `Secure` to upstream cookies and forwards HTTP streams plus WebSocket upgrades. It reads no Host private keys and adds no pairing or device-revocation system — run it only behind the HTTPS tunnel; authorization stays with the Host. For phone login, replace only the origin of the Host's launch URL with the tunnel origin, preserving `?token=...`; keep that credential-bearing URL private. A new tunnel allocates a new hostname: update ingress origin, Host trusted-host and mobile public origin together, then log in again — old cookies are bound to their old authority. Stopping the tunnel closes this public path; removing the plugin alone does not. See the [Quick Tunnel acceptance record](../../docs/acceptance/mobile-quick-tunnel-2026-09-11.md).

## Optional collaboration surfaces

Install message-tools, TaskPilot, Room and the Local Agent family separately; mobile reads their public capabilities and never requires them to boot. Long-press recognized user messages for the original copy/edit/withdraw actions; unrecognized renderers keep their original controls. The plus sheet opens **Room's original invite form** styled as a mobile bottom sheet — provider discovery, authentication, random names, first-task dispatch and removal confirmation all stay with Room; there is no second mobile invite/edit API. Mobile temporarily adapts the public `uiWorkspace.pickDirectory` method in this browser so Room's original form consumes the sheet's result unchanged, and restores it on unload. Room and Local Agent keep their own composers, so not every ordinary-session TaskPilot pill is promised inside a Room. A known Room revision can leave the composer election stale after its first asynchronous cache fill; a declining mobile chain entry refreshes the public slot election without replacing its winner. See the [collaboration acceptance](../../docs/acceptance/mobile-collaboration-2026-09-12.md).

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ⚠️ usable with documented degradations — `dsh.compat.minHost` is `0.1.5-rc.1`. Local browser/Host validation and the iOS simulator build pass on `0.1.5-rc.1` (`183f08e9c6`), but the mobile layout and iOS shell are still under validation; **Safari live-reply resume on 0.1.5-rc.1 requires the opt-in bundled ingress adapter** (`MOBILE_SAFARI_COMPAT=1`, see Internals); **device pairing and push are not provided**. Older hosts: stay below `minHost` at your own risk — none are supported.
- source line (deepseek-harness master): build+test green against the pinned `0.1.7-rc.2` surface (2026-09-27), but per `dsh.compat` no `verifiedHost` is claimed while the real-device/network acceptance matrix is incomplete — audit before adopting other hosts.

The library uses the optional official sessions/workspaces/uiWorkspace services, filtering archived sessions and subagent rows while retaining ordinary forks; a missing service falls back to the basic official sidebar. The public frame/slot DOM anchors are checked before the layout enables; an unknown frame keeps the official page — a changed structure can reduce mobile usability without breaking Host execution. Native bridge version changes require an App compatibility decision; compatible Web updates do not automatically require a new IPA. See the [navigation/QR acceptance](../../docs/acceptance/mobile-navigation-2026-09-11.md), the [rc1 acceptance evidence](../../docs/acceptance/mobile-rc1-2026-09-11.md) and the [proposal](../../proposals/active/2026-08-19-mobile-access.md). No upstream or sibling source changes are required.

## Known Limitations

- **Development baseline** — camera/file picking, sharing/downloads, background recovery and community-plugin combinations are not yet qualified. The iOS scanner accepts existing official HTTPS login links and requires host confirmation; camera acceptance is still pending.
- **No per-device credentials** — one-time device pairing, per-device revocation, Keychain pairing and APNs push are all unimplemented; hiding the QR never revokes anything (above).
- **No hot uninstall qualification** — dependency changes require a controlled Host restart and client reload.
- **Browser-local preferences only** — layout choice (`dsh.mobile.display`) and library grouping (`dsh.mobile.grouping`) never leave this browser; nothing is written to the Host.
- **Library search is shallow** — it filters session titles and workspace paths, not message contents.
- **Foreground recovery has a floor** — healthy brief interruptions skip redundant reconnects, but an already-dead reply subscription does not recover by reconnecting the socket alone.

## Internals

<details>
<summary>Architecture, security boundaries and the Safari adapter (click to expand)</summary>

**Host face.** Three routes on the official authenticated Connection registry, attached only when `connection` is composed (`ctx.inject(['connection'])`): `GET/POST /api/mobile/connect` (QR login minting — the POST additionally requires a same-origin JSON action and a `ready` destination, so a navigation or form can never reveal a login URL, and provider errors are never echoed back), `GET /api/mobile/directories` (read-only directory names/paths within the operator's existing filesystem access — never file contents, never creates directories; bounded to 1,000 rows / 10,000 scanned entries with a truncation flag) and `GET /api/mobile/handshake` (read-only feature discovery: bridge version, capabilities, `devicePairing: false`, `pushNotifications: false`). All responses are `no-store`.

**Client face.** One browser-owned `MobilePresentation` toggles `data-dsh-mobile` on the document element, owns the stylesheet, observers and listeners, and activates only when the official frame anchors (`[data-slot="root"]` with main/sidebar) match the expected arrangement — otherwise the official page is kept. Slot contributions all go through `slots.inject` (never a bare register): `settings.section`/`mobile-connect`, `shell.overlay`/`mobile-directory` and `/mobile-navigation`, `conversation.input.dock` + `conversation.session.header.actions`/`mobile-send-focus` (dismisses the empty focused editor on successful admission; rejected submissions and newer drafts keep focus), `conversation.session.header.actions`/`mobile-room-queue`, a welcome mark in `conversation.hero.brand.mark`, `conversation.input.left`/`mobile-input-tools` (the plus menu grouping the official attachment/command/permission triggers), and priority-−100 shadows of the two public `directoryFlow` slots while mobile mode is active. The Room composer-election refresh is a declining `conversation.composer` entry that never replaces the winner. Dictionaries ship in `en`/`zh`.

**Native bridge (version 1).** The shell advertises `window.__DSH_MOBILE_SHELL__`; the client posts `ready`/`unloaded` with layout and anchor diagnostics, and accepts only matching-origin main-frame messages for `chrome`, `settings` and `scan`. New native actions require advertised capabilities; older shells keep their fallback controls. The bridge grants no file or command privileges.

**Safari live-stream compatibility adapter.** Host `0.1.5-rc.1` ships a JSON validator that rejects ordinary objects in Safari when restoring an in-progress reply. The bundled ingress accepts `MOBILE_SAFARI_COMPAT=1` as an opt-in, delivery-layer adaptation — not a Host source patch: only WebKit `GET` requests for `/plugins/` JavaScript are examined, a SHA-256 fingerprint of the complete known validator gates replacement, and unknown or already-fixed code passes through unchanged. Authentication, RPC bodies, WebSocket frames and Host execution are untouched; a direct LAN connection or another ingress receives no adaptation. Bounded JavaScript is gzip-compressed for gzip-accepting clients (assets above 16 MiB, non-JS, auth failures and identity-encoding mismatches pass through); adapted assets carry corrected lengths and no stale ETag/digest under `private/no-store`. Inspect the `x-dsh-mobile-compat` header and the ingress's value-only compatibility log when qualifying a Host upgrade, do not broaden the fingerprint automatically, and remove the flag once an upstream-fixed build passes real WebKit foreground/reconnect acceptance. Run the ingress from an installed tarball's `examples/`, not a development checkout.

**Unload.** Disposal removes only owned resources — styles, the `data-dsh-mobile` frame markers, observers, listeners, routes and slot contributions — and restores the adapted `pickDirectory` method. Sessions, Host tasks, the shared connection, official cookies and the App/VPN are all left alone.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/mobile`). Issues and contributions welcome there.
