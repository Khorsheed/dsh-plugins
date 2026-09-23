# DSH Mobile for iOS

English | [中文](README.zh.md)

SwiftUI connection screen plus WKWebView, iOS 17+. The [mobile plugin](../../packages/mobile/README.md) owns the mobile Web presentation. This project contains no Host runtime, model key or npm installer.

## Build

Open `DSHMobile.xcodeproj` in Xcode, select the DSHMobile scheme and an iPhone simulator. Command-line build from the repository root:

```sh
xcodebuild -project apps/ios/DSHMobile.xcodeproj -scheme DSHMobile -configuration Debug -sdk iphonesimulator -derivedDataPath apps/ios/.build CODE_SIGNING_ALLOWED=NO build
mkdir -p apps/ios/.build
xcrun swiftc apps/ios/DSHMobile/HostAddress.swift apps/ios/Tests/main.swift -o apps/ios/.build/host-address-tests
apps/ios/.build/host-address-tests
```

A physical phone needs your Apple development team/signing configuration. Release accepts HTTPS only; Debug permits localhost HTTP for simulator testing. `DSH_MOBILE_TEST_URL` is a Debug-only launch environment variable for an isolated test host; do not commit authenticated URLs or launch settings. The simulator can reach the Mac loopback; a physical phone cannot use the Mac's `127.0.0.1` address.

## Physical-device development

Select your own development team in Xcode, or pass `DEVELOPMENT_TEAM=YOUR_TEAM_ID` to a device build. Keep personal team/device identifiers out of the project. Use `apps/ios/.build-device` for ignored signed development products. Install with `xcrun devicectl device install app --device DEVICE_ID PATH_TO_APP`.

If iOS reports that the free development-profile app limit has been reached, the device owner must choose which existing test app to remove, preserving its data first. Never uninstall an unrelated app automatically. If installation succeeds but launch is refused, check the signing profile and device inclusion, then check developer trust under Settings → General → VPN & Device Management on the iPhone. The current test profile expires seven days after issue; this is a development install, not a distribution build.

Debug connection settings display the mobile plugin's layout status and non-content DOM anchor counts to diagnose a loaded plugin that retains desktop layout. Diagnostic output contains no login token or conversation content. Release does not display these diagnostics.

## App icon

The bundled `DSHMobile/Assets.xcassets/AppIcon.appiconset` supplies an opaque 1024px blue-and-white D/chat-bubble icon in Debug and Release. Xcode generates device sizes and iOS applies the outer mask. This is static glass-style artwork; it does not require a network connection or change with the Host theme. The production PNG is deliberately tracked as an app build input.

## Connect

Install the plugin on your Host, then enter an official login URL using the reachable HTTPS authority. WebKit exchanges the token through official browser authentication. Only the clean origin is stored in UserDefaults. The App keeps browser cookies locally; it does not implement device pairing, Keychain device credentials or server-side revocation.

The connection sheet can change hosts, disconnect or clear this App's cookies/cache. Clearing does not delete Host sessions or revoke another device. External user-activated links open outside the configured WebView. The native message handler checks main frame, matching origin and bridge version; it handles `ready`, `unloaded`, mounted `chrome` status, and capability-gated `settings`/`scan` requests. The fallback connection strip hides only when mobile navigation mounts and returns when it is removed. Returning foreground signals the mobile plugin to use official reconnect without repeating write commands.

For cellular access, provision HTTPS/WSS forwarding separately and retain upstream Host/Origin checks. The Mac must stay awake and online. Network provisioning, cookie Secure hardening at ingress, device signing and cellular acceptance are not performed by this project.

Native navigation has a 30-second load deadline with Reload and Connection Settings recovery. A validated same-origin mobile `ready` signal cancels the deadline and clears an earlier load error, even while WebKit waits for slow subresources; an explicit login rejection remains an error. Each new navigation resets the previous loading error. Reloading an uncommitted or blank WebView explicitly requests the configured login URL; reloading a committed same-origin page keeps its current navigation. A rejected HTTP 401 retains the login-expired explanation when WebKit subsequently reports its policy cancellation. Debug navigation diagnostics contain only lifecycle events, origin-match flags and numeric status/error codes, never authenticated URLs or cookies.

## QR login and native settings

The Web plugin now provides **Settings → Connect phone → Show login QR code** for an authenticated operator. Configure its public HTTPS origin and matching Host trusted hostname first; see the [Web connection setup](../../packages/mobile/README.md#connect-a-phone-from-web-settings). The App scanner is already native and requires no rebuild for this Web addition. The QR is an official login link, not a one-use pairing grant; a broken tunnel or expired App signature must be repaired separately.

Native grouped settings contain the current host, connection actions and a device-only appearance preference. QR scanning uses VisionKit with camera permission, stops when the view closes or the App backgrounds, validates the same HTTPS root/login URL contract, and previews the clean authority before an explicit Connect. The scanned login URL stays in memory; it is never saved to preferences or printed. Invalid codes, denied/unavailable cameras and unsupported devices retain manual entry. Main-frame HTTP 401 opens a recoverable login error. This consumes an existing official login link; it does not issue pairing credentials or configure a tunnel. Physical camera/permission and scan-to-login acceptance remains pending.

## Current limits

Simulator build/install/launch and signed installation/launch on iPhone Air (iOS 26.5.2) are verified; physical navigation and read-only screenshots are also verified through device developer services; full touch automation remains unverified. Real-device keyboard/safe-area, attachments, background/network recovery, file export/share and community plugin combinations remain pending. There is no APNs or guaranteed background socket. The Xcode project has an App icon but no distribution signing; it is a development build, not App Store-ready.

The [physical-device record](../../docs/acceptance/mobile-device-2026-09-11.md) and [initial acceptance record](../../docs/acceptance/mobile-rc1-2026-09-11.md) distinguish browser evidence, native build evidence and unverified flows.

The settings Form includes a layout picker (automatic/mobile/desktop). It sends the known mode through `dsh-mobile-display`; the browser plugin owns persistence and reports the mode back through the existing versioned ready bridge. SwiftUI owns native safe areas, while the plugin removes its duplicate bottom inset inside this shell. Debug render diagnostics include numeric composer/frame/context bounds for physical-device layout checks.
