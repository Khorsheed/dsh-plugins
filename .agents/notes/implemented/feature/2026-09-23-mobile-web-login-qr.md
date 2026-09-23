# Agent Note: Web login QR for the existing iOS scanner

Status: implemented

## Problem

The iOS shell already scans official HTTPS login links, but desktop users have no entry that produces them. Temporary tunnel changes strand the phone on its old authority; copying launch links by hand is error-prone. The original proposal still described scanning as unimplemented.

## Decision

Mobile contributes a cross-session Connect phone settings section through the public slot. GET returns deployment configuration status only. An authenticated, same-origin JSON POST triggered by Show calls the public `connection.authenticatedUrl`. The destination comes from `publicOrigin`, falling back to `DSH_MOBILE_PUBLIC_ORIGIN`; it must be a clean, non-loopback HTTPS origin and pass the existing Host trust fence. Browser payloads cannot override it. No private Host fields, signing material, alternate session format or unauthenticated credential endpoint is used.

The browser bundles qrcode-generator and draws a black-on-white SVG with a quiet zone locally in either theme. The credential stays in component/request memory, never in third-party services, storage or navigation. Unmount, page hiding or two minutes of display hide the code and abort pending requests. This is concealment, not expiry or revocation: the official process token remains valid until Host restart; existing cookies retain their Host-owned lifetime.

The native scanner and its host-confirmation step are reused without an IPA rebuild. HTTPS ingress, trusted hostname and public origin remain operator-managed. A zero-connection tunnel must be restored before scanning can help.

## Alternatives considered

- Manual launch-link entry repeats the recovery problem.
- A third-party QR service unnecessarily discloses bearer credentials.
- Browser-chosen destinations or custom cookies introduce a second trust implementation.
- Calling the code one-use or time-limited misrepresents the official token contract. Independent device pairing/revocation remains deferred.

## Consequences

Both clients share official login semantics. Missing configuration/capability degrades to guidance without preventing boot. An optional settings peer contributes only when its slot exists; the encoder adds a small bundled dependency. This does not supervise tunnels, renew iOS signatures, add APNs or Keychain grants, or establish complete device/network qualification.

## Testing

Build and 109 package tests pass, including destination/trust validation, POST origin/content-type checks, provider-error redaction, route disposal, explicit generation, concealment and aborted-response races. Physical camera permissions/scanning remain separate from browser login and rendering verification. Mobile/iOS READMEs and the proposal ledger distinguish shipped basic login from deferred pairing.
