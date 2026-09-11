# Agent Note: Standalone mobile plugin with a thin iOS shell

Status: proposed

English | [中文](2026-09-11-mobile-plugin-ios-shell.zh.md)

## Problem

The mobile-access proposal predates the current browser authentication and slot contracts. It excludes a native app, while the user now requests an iOS client on official 0.1.5-rc.1, independently installable and removable without changing the host or sibling plugins. Rewriting the official client in Swift would duplicate message semantics, streaming state and every plugin adaptation. Treating a running localhost port as remote availability would also hide the network and authentication requirements.

## Proposal

Update the existing [mobile-access capability proposal](../../../../proposals/active/2026-08-19-mobile-access.md) rather than creating another intent. Implementation has started; the capability proposal is in-progress. Propose one self-mounting `@khorsheed/dsh-mobile` package with Host and browser faces, plus an independently signed iOS shell. Reuse the official Web conversation and composer in one runtime; use native code for host connection and platform functions. The initial implementation now lives in `packages/mobile/` and `apps/ios/`; the complete proposal remains unqualified.

The plugin must run with the official web profile alone. Sibling integrations are optional and use public capabilities or preserve their existing renderers. No host fork, package replacement, private-key access, sibling edits, global profile switching or duplicated message engine is allowed. Mobile presentation is client-local. Every registration and effect has an owner and disposer; uninstall preserves sessions and other plugins. External VPN, gateway and official login lifetimes remain separate and have explicit removal/revocation instructions.

### Evidence and unresolved seams

The source audit uses rc1 commit `183f08e9c6`. BrowserAuth already exchanges a process launch token for an authority-bound signed cookie; that token is not a one-time pairing code. Gateway already carries multiplexed WebSocket streams and reconnect recovery. The root slot permits priority shadowing, but child declarations and render authority remain exclusive. Neither root replacement nor a revocable device gateway has passed a mobile probe. M0 must prove the public composition and teardown contracts before promising a complete layout or device pairing.

### Remote access and versioning

Use independently configured HTTPS/WSS forwarding to the loopback Host service (3080 in production). A phone on cellular can reach a Mac on another network through a configured tailnet, provided both are online, the Mac is awake, the host and access service run, and credentials remain valid. Background suspension requires foreground resynchronization; it is not a persistent iOS socket guarantee. APNs is a later increment.

Start with official browser authentication over HTTPS. A later independent gateway may add short-lived one-time pairing and revocable device credentials, but must preserve upstream authentication without private internals. If that seam cannot be implemented independently, explicitly retain the basic login path and mark enhanced pairing unavailable. Plugin removal is not equivalent to revoking official cookies or removing the VPN.

Qualify each Host/plugin/mobile-Web combination together. Keep a versioned, narrow native bridge so compatible Host upgrades do not require a new IPA. Every RC still needs an audit and mobile regression run. Runtime probes, declared support and delivered functionality remain distinct.

## Alternatives considered

- A complete Swift client duplicates the official composer, message projection, stream recovery and plugin UI contracts.
- The official Electron app bundles its own backend and ties releases together; copying that ownership model does not fit a phone controlling a remote Mac.
- PWA/Web Push/IM bot remain possible future channels, but the user's current priority is iOS. They are no longer part of this proposal's first delivery.
- Globally disabling the official layout or editing siblings can approximate the design but violates simultaneous desktop/mobile use and independent removal.

## Acceptance criteria

- A clean rc1 profile can add, use, disable, remove and reinstall mobile without community dependencies or host/sibling edits.
- Desktop and phone coexist; unloading mobile removes its effects without destroying sessions, shared connections or host tasks. Any required refresh is explicit and preserves drafts.
- A real phone with Wi-Fi disabled completes authenticated streaming, attachments, stop and network-recovery flows; unauthenticated protected requests and WebSocket upgrades fail.
- Optional message-tools/member/preview integrations survive absence and removal; write operations are not blindly replayed after response loss.
- M0 records layout and authentication limitations. Only verified features are advertised; enhanced pairing, if delivered, proves expiration, replay rejection and immediate device revocation.
- Version combinations, uninstall boundaries and deferred notification capabilities are documented before release.

### Implementation boundary (2026-09-11)

Keep the official root and declare no foreign child slots. An owned style element and checked rc1 frame/slot anchors provide mobile layout; unknown frames fall back to the official page. Shadow only the two public directory-flow slots at priority -100 while this client is mobile, accepting a computer path through the official owner callbacks. Restoring desktop mode or disposal removes these registrations. Do not call the Host-native chooser from this flow.

The native shell persists a clean origin and WebKit browser cookies, not the launch token in preferences. Release enforces HTTPS; Debug allows loopback HTTP for simulator tests. The bridge checks main frame, same origin and version; additive native settings/scan capabilities and mounted-chrome reporting now complement availability. Foreground signals official reconnect; no write commands are replayed. Scanning existing HTTPS login links is implemented; one-time device pairing credentials, sharing and push remain unimplemented.

The [acceptance record](../../../../docs/acceptance/mobile-rc1-2026-09-11.md) covers local streaming, draft-preserving reconnect, authenticated handshake, tarball reinstall, 10 plugin tests and 20 native URL checks. Standard dependency removal did not hot-unload in the tested rc1 process: require controlled Host restart and client reload. Unit disposer coverage is not evidence of full Host HMR. The simulator builds/installs/launches, but native visual automation is blocked by macOS permissions. No main-workspace, upstream or sibling edits and no production deployment are part of this implementation.

The optional `packages/mobile/examples/https-ingress.mjs` deployment example supports a temporary Quick Tunnel without a domain or account. It preserves official Host/Origin authentication, adds Secure cookies at the HTTPS boundary and forwards WebSocket traffic; it is not a Cordis dependency or a device gateway. Community distribution remains independent of any personal server or hostname. Stopping the tunnel and uninstalling the plugin are separate actions. The [public-ingress evidence](../../../../docs/acceptance/mobile-quick-tunnel-2026-09-11.md) records authenticated HTTP/WS, a 28-frame public mock reply and history recovery after reconnect; phone and public-stream UI qualification remain pending. The continued preview uses QUIC after HTTP/2 connectivity failures and runs separately from transient tool sessions.

### Mobile library and physical-device probe (2026-09-11)

The mobile-owned library lives in the existing shell overlay. It projects the optional official Session/Workspace stores into recency rows, filters titles/workspace paths locally, and delegates selection/new-session operations to `uiWorkspace`. Ordinary forks remain visible; archived rows and subagent-origin children follow the official visibility rules. It neither declares foreign child slots nor duplicates session transport. Missing optional services restore basic mobile navigation. The official conversation stays mounted; its main region is temporarily inert while the library is open and restored on close or teardown. Composer controls retain their owners with wrapping and larger touch targets.

A signed development App was installed and launched on iPhone Air / iOS 26.5.2 after the user selected an existing free-profile test app for removal and completed developer trust. Personal team/device identities stay outside tracked files. The user initially reported the old desktop presentation despite a ready bridge, so ready alone is not treated as layout success. Same-origin bridge diagnostics now report display mode, checked frame support, optional navigation availability and content-free anchor counts. Debug shows/logs these facts; Release does not display them. The [device acceptance record](../../../../docs/acceptance/mobile-device-2026-09-11.md) separates diagnostic state from user-confirmed visual and interaction results.

The first physical-device screenshot exposed a renderer failure hidden by successful bridge readiness: passing the official workspace feed's prototype methods directly into React detached their receiver. Keep stable callback wrappers that call methods through each feed. A regression uses receiver-dependent feeds and verifies archive updates and subscription disposal. After deploying the fix, device DOM diagnostics report no slot error and one toolbar/library; visual acceptance remains separate. Temporary console-error forwarding was removed after diagnosis; retained diagnostics only contain layout and element metadata.

### Approved navigation revision (2026-09-11)

Replace the promotional library header with time/workspace views and bottom search. Keep full directory identity, sort groups by their most recent session, respect local calendar day boundaries and reveal matching rows in collapsed groups during search. Only the grouping preference is persisted. A native scanner is advertised as an optional bridge capability; browsers and older shells keep their existing entry points. Native Form settings consolidate host/appearance controls. Mounted `chrome` status, separately from plugin `ready`, controls removal of the fallback connection strip.

QR recognition validates an existing official HTTPS login URL and previews only its clean authority. It cannot load or change hosts before explicit confirmation. Denied/unavailable cameras and invalid codes retain manual entry. No Host keys, pairing authority or tunnel changes are introduced. Official composer, messages and plugin action semantics retain their owners; narrowly scoped rc1 menu anchors adapt non-portaled composer/hero menus to bottom panels. Other popovers retain their official implementation.

Continue deployment only to isolated 3181. A 3080 transition is a separate integration step: mobile is not installed there, and tarball installation, trusted-host configuration, authentication and gated restart must be assessed together. See [navigation acceptance](../../../../docs/acceptance/mobile-navigation-2026-09-11.md).

### Phone feedback fixes (2026-09-11)

The user confirmed four regressions: misaligned workspace disclosure, navigation-triggered keyboard, a duplicate ordinary session title and no recovery after closing desktop-mode options. Workspace groups now use aligned grid columns and SVG disclosure icons. A desktop-only return control remains mounted across preference reloads. The checked rc1 ordinary breadcrumb is hidden only while a real mobile session title is present; contributed lineage, ancestors, actions and tabs stay intact. Unknown markup retains the official header.

rc1 InputBar focuses on session mount/switch and exposes no autofocus opt-out. The plugin arms a disposable DOM focus guard before navigation and in the title's layout effect: it blurs automatic composer focus until a composer/message action or keyboard Tab expresses input intent. It does not patch DOM/Lexical methods, selection, drafts or Host state; missing composer anchors leave official behavior intact. WebKit keyboard timing still requires phone confirmation. All fixes ship through the existing Web plugin; no native rebuild or 3080 deployment is needed.

### Approved polish and surface ownership (2026-09-11)

Implement the approved refinement: one restrained icon family for owned controls, round navigation/search actions, pointer focus without an inner rectangle, keyboard-visible container focus, native settings as the only App settings entry, and no conversation-details page. Short connection transitions stay in the title bar; a persistent interruption exposes reconnect after four seconds. Composer statistics remain visible. Unselected trajectory tabs are hidden; a previously selected trajectory retains the official way back, and unrelated view tabs remain available.

The new-session welcome uses the public brand-mark seat. CSS now follows the actual composer chain fallback and flex stack, fixing the former upper-page composer. Existing-session workspace context uses the public input-dock seat. A checked rc1 geometry adapter presents the original header controls alongside it without moving DOM nodes or replacing callbacks; unknown structure or ancestor lineage keeps the official header. Desktop app-launch controls are hidden only when their image route and split-button structure match. Official message actions, their disabled states and plugin contributions remain owned by Web; no mock “more” menu is substituted.

The rc1 source audit corrected the prototype: preset composition is fixed once a conversation starts. Existing workspace/preset context is read-only; only the official new-session flow changes the selection. Native layout choices dispatch a validated document event, and official preferences remain browser-owned. SwiftUI retains native safe-area ownership; the Web frame does not add a second bottom inset in the shell. Debug geometry reports numeric bounds and surface counts, never message text or login URLs. Build/unit checks do not establish device visual acceptance.

Phone dark-mode feedback exposed two CSS errors: mobile palette aliases were resolved on `html` before the official body-scoped tokens existed, and `bg-l1` was not a host token. Resolve aliases on `body` using official floating-surface/module tokens, including the accent. Keep primary foregrounds theme-owned and strengthen search/composer placeholders with the secondary label token. The two rc1 direct command/attachment buttons use transparent, square touch targets; send and contributed controls retain their states. Chromium mobile-viewport captures cover library, chat and new-session light → dark → light transitions; this is CSS rendering evidence, not native WebKit visual acceptance.

## Risks

Slot ownership may limit layout fidelity; private interfaces and DOM anchors may break with a new RC. Device revocation requires a real gateway authorization model, not renamed official cookies. Host sleep or network/authentication failure interrupts access. A native app and the access infrastructure remain separate installations even when the mobile behavior is a plugin. Local runtime and simulator build evidence exists; true-device acceptance is pending.
