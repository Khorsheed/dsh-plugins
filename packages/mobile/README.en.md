# @khorsheed/dsh-mobile

English | [中文](README.md)

Keep the conversation going away from your desk: scan a code with your phone and carry on your DSH sessions in the browser.

The DSH web page is built for a computer screen — on a phone the sidebar eats half the view and the buttons are too small to hit, and reaching your home computer from outside means wrestling with domains and forwarding. With Mobile, open "Settings → Connect phone" on the computer and one click gives you an address reachable from anywhere; scan the QR code with your phone camera, open it in the browser, and you get a layout made for the phone. The computer still does the work; the phone is where you read and talk.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/mobile-library.png" width="640" alt="the mobile session home: time and workspace groups, a bottom search box and a scan entry">

## What it does

- **Scan and you're in**: camera scan → open in the browser → "Add to Home Screen", then open it like an app. The iOS app is optional.
- **No domain to buy**: click "Enable public entry (temporary domain)" and you get an address your phone can reach from outside — no Cloudflare account needed.
- **No rescanning after a restart**: the address survives DSH restarts and updates, so a signed-in phone keeps working.
- **Quick to recover after sleep**: the address changes when the computer sleeps; on waking it picks a new one by itself and shows a new QR code within about a minute — scan once more.
- **Clear about what went wrong**: when it can't connect it keeps retrying on its own, and the settings page says which step failed and why.
- **A layout rebuilt for the phone**: the session home groups by time or workspace and searches titles; composer buttons are bigger and within reach; you can even pick a folder on the computer from the phone.
- **Plays well with other plugins**: copy / edit / withdraw on messages, inviting members to a room and the like keep working.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/mobile-conversation.png" width="640" alt="the session page in the mobile layout: session header with member tabs, the message stream, the bottom composer toolbar">

## Install

In DSH, open Plugins → Add plugin, enter the package name below and click Install:

```
@khorsheed/dsh-basic
```

Mobile comes with Basic Essentials. Once installed, open "Settings → Connect phone" on the computer and follow the steps on the page. The one-click public entry needs cloudflared on the computer (for example `brew install cloudflared`); the page tells you what to do if it's missing.

## Known limitations

- The computer has to stay on and online; after it sleeps or reboots the address changes and the phone has to scan again. For an address that never changes you need your own domain (see the full reference under "For developers").
- The QR code works as this computer's sign-in — don't share it. Hiding the code does not sign out a phone that is already in.
- Per-device sign-in management and push notifications are not there yet; on-device validation is still in progress.

## Compatibility

Requires DSH 0.2.0-rc.2 or later (0.1.x hosts stay on this plugin's 0.1.4); no verified version is listed until on-device validation is done.

## For developers

- Static configuration with your own domain / named tunnel, how the public-entry sidecar works, the security boundaries of each endpoint and what uninstalling leaves behind: see the [full reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/mobile/docs/reference.en.md); the optional iOS shell is in [apps/ios](https://github.com/Khorsheed/dsh-plugins/blob/main/apps/ios/README.md) (build and install it yourself with Xcode).
- You can also install it alone: enter `@khorsheed/dsh-mobile` in Add plugin, or run `dsh plugin --profile web add @khorsheed/dsh-mobile`, then restart and refresh the client; `?mobile=1` / `?mobile=0` turns the mobile layout on or off by hand.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) — file issues and contributions there; changes are in [CHANGELOG.md](CHANGELOG.md).
