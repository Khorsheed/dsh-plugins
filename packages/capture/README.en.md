# @khorsheed/dsh-capture

English | [中文](README.md)

A companion to the reader: it brings back the articles you want to read, with extra handling for pages with complex layouts.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/reader-render-fetch.png" width="560" alt="An article brought back by rendered fetch in the Reader: the bilingual text, with the script-drawn diagram in it intact">

## What it does

- **Try again by hand**: if the article looks incomplete, click "Fetch rendered" in it to fetch it again through the browser.
- **Figures that load on scroll come along**: it scrolls the page top to bottom so lazy-loaded content shows up; interactive figures drawn by scripts are saved as still images.
- **Figure colors come along**: the colors the original page gave its figures and charts come back too, instead of turning black and white.
- **Your logins stay out of it**: every fetch uses a clean browser with no cookies and no saved sign-ins; it never visits local or private-network addresses.
- **No footprint when idle**: the browser is downloaded the first time it's needed and closes itself after a minute of idling.

## Install

In DSH, open Plugins → Add plugin, enter this package name and click Install:

```
@khorsheed/dsh-learning-suite
```

Capture comes with the Learning Suite, together with the reader — it works for the reader, so on its own it has nothing to do. Once installed, just open links in the reader as usual.

## Known limitations

- The first use downloads the browser and is slow; after that each fetch takes about 15–30 seconds.
- Pages behind a login come back as the login page.
- What comes back is a static page: buttons, inputs and expanders no longer work; very long pages are fetched only up to a limit.

## Compatibility

Requires DSH 0.1.5-rc.1 or later; verified on 0.2.1-rc.1.

## For developers

- The interface (`capture.render`), configuration keys, the render pipeline, the address safety checks and threat model, and how to test locally: see the [full reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/capture/docs/reference.en.md).
- You can also install it alone: enter `@khorsheed/dsh-capture` in Add plugin, or run `dsh plugin --profile web add @khorsheed/dsh-capture`; without the reader it has no UI and nothing calls it.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) — file issues and contributions there; changes are in [CHANGELOG.md](CHANGELOG.md).
