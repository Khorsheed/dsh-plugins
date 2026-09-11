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

Use private HTTPS/WSS forwarding to the existing loopback 3080 service. A phone on cellular can reach a Mac on another network through a configured tailnet, provided both are online, the Mac is awake, the host and access service run, and credentials remain valid. Background suspension requires foreground resynchronization; it is not a persistent iOS socket guarantee. APNs is a later increment.

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

The native shell persists a clean origin and WebKit browser cookies, not the launch token in preferences. Release enforces HTTPS; Debug allows loopback HTTP for simulator tests. The bridge reports availability only and checks main frame, same origin and version. Foreground signals official reconnect; no write commands are replayed. Device credentials, QR pairing, sharing and push are still unimplemented.

The [acceptance record](../../../../docs/acceptance/mobile-rc1-2026-09-11.md) covers local streaming, draft-preserving reconnect, authenticated handshake, tarball reinstall, 10 plugin tests and 20 native URL checks. Standard dependency removal did not hot-unload in the tested rc1 process: require controlled Host restart and client reload. Unit disposer coverage is not evidence of full Host HMR. The simulator builds/installs/launches, but native visual automation is blocked by macOS permissions. No main-workspace, upstream or sibling edits and no production deployment are part of this implementation.

## Risks

Slot ownership may limit layout fidelity; private interfaces and DOM anchors may break with a new RC. Device revocation requires a real gateway authorization model, not renamed official cookies. Host sleep or network/authentication failure interrupts access. A native app and the access infrastructure remain separate installations even when the mobile behavior is a plugin. Local runtime and simulator build evidence exists; true-device acceptance is pending.
