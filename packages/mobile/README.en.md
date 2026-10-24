# @khorsheed/dsh-mobile

English | [中文](README.md)

Your dsh sessions, in your pocket — the Mac still runs the sessions, models, skills and tools; the phone just gets an interface built for it.

The official Web client is desktop-shaped: a sidebar that eats the screen, a dense composer, touch targets made for a mouse. This plugin re-presents the very same client for narrow touch screens — a conversation library with grouping and search, a wrapping composer with reachable controls, a sheet for picking directories on the computer. The phone scans a QR with its camera and opens the link in the browser, and can add it to the home screen; an optional [iOS shell](../../apps/ios/README.md) also exists (build and install it yourself with Xcode). Everything stays removable: uninstalling restores the official desktop UI exactly, and no Host or sibling-plugin state is ever written.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/mobile-library.png" width="640" alt="the mobile conversation library: time and workspace grouping, the bottom search field and the QR pairing entry">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/mobile-conversation.png" width="640" alt="a conversation in mobile layout: the session header with its Members tab, the message flow, and the composer toolbar at the bottom">

## Features

- **Conversation library home** — time/workspace grouping, collapsible workspace sections and bottom search. Grouping stays local to this browser (`dsh.mobile.grouping`); the official chat and your draft remain mounted behind navigation.
- **A real mobile layout, client-local** — full-width right-panel details, mobile settings, and a wrapping composer toolbar with larger touch targets (reading text ≥ 17px, primary controls 16–17px). The official conversation renderer, composer, model/permission selectors, attachments and streaming transport stay in place.
- **Pick a computer directory from your phone** — saved workspaces, one-level folder browsing, parent navigation, a hidden-folder toggle and a validated absolute-path fallback. Workspace adoption and Room member picks share this sheet; desktop clients keep the native chooser.
- **Connect a phone by QR** — an authenticated Web settings section mints the official login link for your deployment's HTTPS origin and shows it as a locally encoded QR; the phone camera scans it and the browser signs in.
- **One-click public entry (no account or domain)** — with no static origin configured, the settings page can enable a Cloudflare Quick Tunnel in one click. A small detached sidecar holds the tunnel, so **host restarts and deploys keep the domain** and signed-in phones need no rescan; when the computer sleeps, reboots or the tunnel drops, it rotates to a fresh domain and hot-binds it — no host restart.
- **Versioned native bridge** — an authenticated `GET /api/mobile/handshake` plus a bridge-version-1 message channel for presentation status and optional native settings/scanning. Foreground recovery rides the official connection service and never replays a send command; brief interruptions and initial connecting states avoid redundant reconnects, while a suspension of 5 s or more still refreshes the stream generation.
- **Plays well with the ecosystem, requires none of it** — no community plugin is a boot dependency. Message action rows retain message-tools' original copy/edit/withdraw, while touch long-press selects text natively; the plus sheet opens Room's original invite form; TaskPilot and Local Agent surfaces keep their owners.

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

The authenticated Web client exposes **Settings → Connect phone** through the public `settings.section` slot — available on desktop without enabling the mobile layout.

### One-click public entry (Quick Tunnel, recommended without a domain)

With no static origin configured, **Connect phone** offers **Enable public entry (temporary domain)**. No Cloudflare account or domain is needed — only cloudflared on this computer (`brew install cloudflared` or an official release; when it is missing the settings page explains the install). The allocated hostname is **hot-bound at runtime** through the host's official `configEditor` — no host restart, no wildcard trust, no credentials in probes. The page shows the QR as soon as the entry is ready; any phone browser (Safari/Chrome) scans and connects.

- **Host restarts keep the domain.** cloudflared is held by a detached sidecar the plugin launches, not by the host process. After a restart the plugin adopts the running tunnel; the domain stays and signed-in phones keep their cookies.
- **When the domain changes and phones must rescan:** the computer sleeps or reboots, or the tunnel drops (Cloudflare promises no Quick Tunnel uptime). The plugin rotates to a fresh domain and hot-binds it without a host restart; after waking, a new QR is ready within about a minute. Back-to-back recoveries are throttled by a 10-minute cooldown; the first recovery after waking is not.
- **Failures keep retrying on their own** (backing off to at most an hour), and the settings page shows the failing stage and cause for diagnosis.
- **Disabling** ends the sidecar and tunnel and prunes the hostname from the trust list. When the host stops or the plugin is uninstalled, the sidecar exits by itself within 10 minutes.
- State files live in `$DSH_HOME/state/`: `mobile-quick-tunnel.json` (enablement and current domain) and `mobile-quick-tunnel.sidecar.json` (sidecar heartbeat).

While managed, the tunnel origin takes precedence over `publicOrigin`/`DSH_MOBILE_PUBLIC_ORIGIN`; disabling falls back to the static configuration. To never rescan, use an owned domain with a named tunnel (below).

### Static configuration (own domain / named tunnel)

Configure the phone-reachable **clean HTTPS origin** as the plugin's `publicOrigin` option, or set `DSH_MOBILE_PUBLIC_ORIGIN` on the **Host process** (the plugin option wins). Add the same hostname to the Host's `--trusted-host` list. The HTTPS entry (a named tunnel, reverse proxy or private network) forwards straight to the Host port on loopback. These are deployment settings, not phone preferences.

```sh
DSH_MOBILE_PUBLIC_ORIGIN=https://dsh.example.com dsh web --no-open --port 3181 --trusted-host dsh.example.com
```

1. Open Web **Settings → Connect phone** and check the displayed host.
2. Click **Show login QR code**.
3. Scan with the phone camera, check the host address, then open the link in the browser; with the iOS App installed, you can scan in the App instead.

`GET /api/mobile/connect` returns configuration status only. An authenticated, same-origin JSON `POST` obtains the official `connection.authenticatedUrl()` for the deployment-owned origin — browser input cannot override the destination. Both routes ride the official Connection registry, preserving its cookie and Host/Origin checks, and answer `no-store`. QR encoding happens locally in the browser: no third-party QR service, no secret logging, no browser persistence. Leaving the section, hiding the page or waiting two minutes conceals the code and aborts pending requests. Missing/invalid origin, an unsupported Host capability or an untrusted destination shows setup guidance instead of generating a login link.

**Concealment is not credential expiry.** The QR carries the official process login token, valid until that Host process restarts — not a short-lived or one-use pairing token. Hiding or regenerating the QR does not revoke a copied link or a logged-in phone. After scanning, the phone holds a Host-issued cookie bound to the current domain with a Host-owned lifetime; while the domain stays the same, it survives host restarts.

Different physical networks need an HTTPS/WSS entry to the loopback Host port, valid official authentication, an awake/online computer and a reachable phone — starting the Host alone does not establish remote access.


### Public entry checks and rescanning

The connection page anonymously probes the configured public root before offering or generating a QR. An unavailable origin returns an actionable state without issuing a login URL. A displayed QR is checked every 15 seconds and hidden if the endpoint fails or changes. This is a computer-side reachability check, not a guarantee about the phone's network.

- **Managed mode (one-click entry)**: a failed tunnel is rotated to a fresh domain and hot-bound by the plugin without a host restart; the page tracks the state live, and the phone rescans once the entry is back. A host restart is not a failure; the domain stays.
- **Static mode**: checks only report connection status — they do not rebuild tunnels, deploy plugins or restart the host. The deployment operator restores a failed public entry manually; changes to host origin or trust bindings that require a restart must be explicitly scheduled first. Once the computer-side address is available, reopen **Connect phone** and scan the new QR on the phone. The phone address is not updated automatically.

## Optional collaboration surfaces

Install message-tools, TaskPilot, Room and the Local Agent family separately; mobile reads their public capabilities and never requires them to boot. Copy/edit/withdraw remain on the original message action rows; touch long-press selects text natively without a second message menu. The plus sheet opens **Room's original invite form** styled as a mobile bottom sheet — provider discovery, authentication, random names, first-task dispatch and removal confirmation all stay with Room; there is no second mobile invite/edit API. Mobile temporarily adapts the public `uiWorkspace.pickDirectory` method in this browser so Room's original form consumes the sheet's result unchanged, and restores it on unload. Room and Local Agent keep their own composers, so not every ordinary-session TaskPilot pill is promised inside a Room. A known Room revision can leave the composer election stale after its first asynchronous cache fill; a declining mobile chain entry refreshes the public slot election without replacing its winner. See the [collaboration acceptance](../../docs/acceptance/mobile-collaboration-2026-09-12.md).

## Compatibility

- host 0.2.x (from `@deepseek-ai/dsh@0.2.0-rc.2`): ⚠️ usable with documented degradations — `dsh.compat.minHost` is `0.2.0-rc.2`; **0.1.x hosts are no longer supported** (stay on this plugin's 0.1.4 there). Full build+test is green against the 0.2.1-rc.1 tree, but no `verifiedHost` is claimed while the real-device/network acceptance matrix is incomplete; the mobile layout and iOS shell are still under validation; **device pairing and push are not provided**.
- one-click public entry: requires a local cloudflared binary; without it, **Connect phone** falls back to the static configuration guidance and every other feature is unaffected. iOS/Android browsers can **add to home screen** after scanning: a credential-free data-URI manifest and Apple meta tags are injected while the mobile layout is active (no service worker, no offline claim).

The library uses the optional official sessions/workspaces/uiWorkspace services, filtering archived sessions and subagent rows while retaining ordinary forks; a missing service falls back to the basic official sidebar. The public frame/slot DOM anchors are checked before the layout enables; an unknown frame keeps the official page — a changed structure can reduce mobile usability without breaking Host execution. Native bridge version changes require an App compatibility decision; compatible Web updates do not automatically require a new IPA. See the [navigation/QR acceptance](../../docs/acceptance/mobile-navigation-2026-09-11.md), the [rc1 acceptance evidence](../../docs/acceptance/mobile-rc1-2026-09-11.md) and the [proposal](../../proposals/active/2026-08-19-mobile-access.md). No upstream or sibling source changes are required.

## Known Limitations

- **Quick Tunnels promise no uptime** — host restarts keep the domain, but after the computer sleeps or reboots, or the tunnel drops, the domain changes and phones must rescan; for a permanent address use an owned domain with a named tunnel.
- **Development baseline** — camera/file picking, sharing/downloads, background recovery and community-plugin combinations are not yet qualified. The iOS scanner accepts existing official HTTPS login links and requires host confirmation; camera acceptance is still pending.
- **No per-device credentials** — one-time device pairing, per-device revocation, Keychain pairing and APNs push are all unimplemented; hiding the QR never revokes anything (above).
- **No hot uninstall qualification** — dependency changes require a controlled Host restart and client reload.
- **Browser-local preferences only** — layout choice (`dsh.mobile.display`) and library grouping (`dsh.mobile.grouping`) never leave this browser; nothing is written to the Host.
- **Library search is shallow** — it filters session titles and workspace paths, not message contents.
- **Foreground recovery has a floor** — healthy brief interruptions skip redundant reconnects, but an already-dead reply subscription does not recover by reconnecting the socket alone.

## Internals

<details>
<summary>Architecture and security boundaries (click to expand)</summary>

**Host face.** Three routes on the official authenticated Connection registry, attached only when `connection` is composed (`ctx.inject(['connection'])`): `GET/POST /api/mobile/connect` (QR login minting — the POST additionally requires a same-origin JSON action and a `ready` destination, so a navigation or form can never reveal a login URL, and provider errors are never echoed back), `GET /api/mobile/directories` (read-only directory names/paths within the operator's existing filesystem access — never file contents, never creates directories; bounded to 1,000 rows / 10,000 scanned entries with a truncation flag) and `GET /api/mobile/handshake` (read-only feature discovery: bridge version, capabilities, `devicePairing: false`, `pushNotifications: false`). All responses are `no-store`.

**Quick Tunnel supervisor (optional).** A fourth route, `GET/POST /api/mobile/tunnel`, rides the same registry: GET is read-only status; POST is an explicit same-origin JSON enable/disable action. When enabled, the plugin launches the bundled zero-dependency sidecar `lib/tunnel-sidecar.js` detached; it holds cloudflared, parses the allocated hostname and writes a heartbeat state file every 10 s. After a host restart the supervisor reads that file and adopts a live sidecar on the same port instead of opening a new tunnel, and skips the profile write when the domain is already trusted. The sidecar exits together with cloudflared on SIGTERM (disable), when cloudflared exits, or when the lease file the supervisor renews goes 10 minutes without renewal (host stopped or plugin uninstalled). A new domain waits for an anonymous edge probe (accepting 401/403/2xx — the domain was just assigned to this very process, so a trust-fence 403 also proves forwarding), then replaces the connection row's `trustedHosts` through the official `configEditor.edit` with "launch and operator authorities plus the live hostname" — only the supervisor's own previous domain is pruned; a static fallback domain from the launch command survives both rotation and disable. The `!!js` launch expression is evaluated through `webStartup`, and untouched keys keep their expressions. A strict post-bind probe (401/2xx) must confirm the trust actually landed before the address is offered. A health loop checks sidecar liveness and probes anonymously every 20 s; three consecutive failures or a vanished sidecar rotate to a fresh domain with a 10-minute recovery cooldown, and an abnormally long gap between checks is read as a wake from sleep, where a single failure recovers immediately. Failed starts retry forever, backing off to at most an hour after three; a trust-write failure keeps the tunnel so the next attempt re-adopts it. Failure details record "stage: error" (URL- and token-shaped text redacted) into the state file and `console.error` them to the host log. The supervisor lives at apply root, not inside `ctx.inject(['connection'])` — otherwise the rebind it triggers would dispose it. The supervisor adds no peer dependency: configEditor/webServer/profileContext/webStartup are probed structurally and re-evaluated lazily (a strict `ctx.get` during composition boot returns undefined for not-yet-ACTIVE fibers, so a one-shot probe would bake a false negative), the persisted enablement is read only once the profile home resolves, and a missing capability yields `unsupported` instead of a boot failure.

**Client face.** One browser-owned `MobilePresentation` toggles `data-dsh-mobile` on the document element, owns the stylesheet, observers and listeners, and activates only when the official frame anchors (`[data-slot="root"]` with main/sidebar) match the expected arrangement — otherwise the official page is kept. Slot contributions all go through `slots.inject` (never a bare register): `settings.section`/`mobile-connect`, `shell.overlay`/`mobile-directory` and `/mobile-navigation`, `conversation.input.dock` + `conversation.session.header.actions`/`mobile-send-focus` (dismisses the empty focused editor on successful admission; rejected submissions and newer drafts keep focus), `conversation.session.header.actions`/`mobile-room-queue`, a welcome mark in `conversation.hero.brand.mark`, `conversation.input.left`/`mobile-input-tools` (the plus menu grouping the official attachment/command/permission triggers), and priority-−100 shadows of the two public `directoryFlow` slots while mobile mode is active. The Room composer-election refresh is a declining `conversation.composer` entry that never replaces the winner. Dictionaries ship in `en`/`zh`. While the mobile layout is active, a credential-free data-URI manifest (Chrome/Android) and Apple meta tags (iOS) enable add-to-home-screen — start_url is origin + pathname only, there is no service worker, desktop documents are untouched, and removal follows the layout.

**Native bridge (version 1).** The shell advertises `window.__DSH_MOBILE_SHELL__`; the client posts `ready`/`unloaded` with layout and anchor diagnostics, and accepts only matching-origin main-frame messages for `chrome`, `settings` and `scan`. New native actions require advertised capabilities; older shells keep their fallback controls. The bridge grants no file or command privileges.

**Unload.** Disposal removes only owned resources — styles, the `data-dsh-mobile` frame markers, observers, listeners, routes and slot contributions — and restores the adapted `pickDirectory` method. Sessions, Host tasks, the shared connection, official cookies and the App/VPN are all left alone. The one-click entry's sidecar does not end on disposal (otherwise every host restart would rotate the domain); it exits by itself 10 minutes after its lease stops being renewed. To close the public entry immediately, click **Disable public entry** before uninstalling.

</details>

## Mobile panels

A panel action sits beside new conversation in the chat header. Mobile panels use full-width content, horizontally scrollable tabs, add and close actions, retaining the host content tree and saved desktop splits. Missing optional sidebar capabilities or checked DOM anchors preserve the official surface. File plugins can share the retained master/detail layout; canvas links and editing remain owned by the original component.

Repository component preview: run `pnpm exec tsx examples/panels/serve.ts` from `packages/mobile`, then open `http://127.0.0.1:8875/`. It uses actual navigation, DockLayout, AdaptiveSplit and LinkView with in-memory sample data; it is not a production instance or phone acceptance test. Preview sources are excluded from the npm package. iPhone keyboard, safe-area and background/resume checks remain pending; a terminal key accessory is not implemented.

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/mobile`). Issues and contributions welcome there.
