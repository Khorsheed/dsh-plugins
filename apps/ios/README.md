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

## Connect

Install the plugin on your Host, then enter an official login URL using the reachable HTTPS authority. WebKit exchanges the token through official browser authentication. Only the clean origin is stored in UserDefaults. The App keeps browser cookies locally; it does not implement device pairing, Keychain device credentials or server-side revocation.

The connection sheet can change hosts, disconnect or clear this App's cookies/cache. Clearing does not delete Host sessions or revoke another device. External user-activated links open outside the configured WebView. The native message handler checks main frame, matching origin and bridge version; its only messages are `ready` and `unloaded`. Returning foreground signals the mobile plugin to use official reconnect without repeating write commands.

For cellular access, provision HTTPS/WSS forwarding separately and retain upstream Host/Origin checks. The Mac must stay awake and online. Network provisioning, cookie Secure hardening at ingress, device signing and cellular acceptance are not performed by this project.

## Current limits

Simulator build/install/launch and signed installation/launch on iPhone Air (iOS 26.5.2) are verified; native visual automation was blocked by macOS computer-use permissions. Real-device keyboard/safe-area, attachments, background/network recovery, file export/share and community plugin combinations remain pending. There is no APNs or guaranteed background socket. The Xcode project has no release App icon or distribution signing; it is a development build, not App Store-ready.

The [physical-device record](../../docs/acceptance/mobile-device-2026-09-11.md) and [initial acceptance record](../../docs/acceptance/mobile-rc1-2026-09-11.md) distinguish browser evidence, native build evidence and unverified flows.
