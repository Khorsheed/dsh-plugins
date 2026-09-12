# Agent Note: Mobile viewport navigation and owned picker presentation

Status: implemented

English | [中文](2026-09-12-mobile-viewport-navigation.zh.md)

## Problem

The mobile shell could scroll as a whole, exposing blank space below the composer. Its session list replaced the chat entirely, desktop menus occupied awkward positions, and the title editor appeared in a separate plugin row. Native safe-area colors could differ from the webpage. A user also reported that replies started on Web appeared on mobile only after completion.

## Decision

Mobile presentation locks the application frame to the visual viewport and measures the original composer with ResizeObserver. Only the transcript scrolls; its bottom clearance follows the composer height. The original editor remains mounted, preserving drafts, queues and plugin seats.

Horizontal touch navigation reveals a session list up to 84% of the screen, capped at 380px, leaving a chat preview. At 960px and above, the list is a fixed 320px column and the chat remains interactive. Controls, text selection, dialogs and horizontally scrolling content keep their own gestures. Other mobile pages share list navigation; this does not introduce a separate history stack or override dialog dismissal.

The title pencil invokes the existing session-title-edit control. Workspace and preset menus retain their original items and selection handlers, while checked hero triggers opt their next menu into a bottom sheet. Workspace filtering keeps the add-workspace action. Unknown plugin controls stay with their owners. The DSH hero wordmark is removed.

The native shell uses the webpage frame background for its safe areas, disables whole-WebView bounce, and yields horizontal navigation to the mobile presenter. Appearance messages retain the native bridge origin checks. Foreground recovery coalesces native resume, hidden-to-visible and persisted pageshow events into the official connection reconnect, only while mobile presentation is active. It never resends a prompt.

## Alternatives considered

**A second mobile editor or transport.** This would duplicate queue, streaming and plugin behavior. The existing composer, session follow and menus remain authoritative.

**Moving foreign React nodes into mobile containers.** This risks ownership and cleanup errors. The presenter uses verified anchors and CSS, removing its geometry and decorations when disabled.

**Declaring the reported stream delay fixed.** Independent foreground clients showed incremental assistant text before completion. That disproves an unconditional completion-only path, but does not reproduce every suspension or network scenario; the original report remains an acceptance gap.

## Consequences

The entire narrow-screen chat preview is one return target, including its header and composer area. A tap closes navigation without forwarding the tap to underlying chat actions, preserves the mounted editor and draft, and arms navigation focus suppression. Drawer transitions take 220 ms, track direct dragging without a transition, and honor reduced-motion preferences. Wide-screen split view does not mount this return target.

Navigation, picker layout and scroll geometry improve without host or sibling-plugin source changes. DOM signatures remain compatibility seams and require browser acceptance after host upgrades. Narrow screens show a preview; only wide screens keep two usable columns. Native safe-area and keyboard behavior still require physical-device acceptance.

## Verification

Mobile build and 64 tests pass, including gesture exclusions, picker callback ownership, composer resize cleanup and coalesced resume. The iOS simulator build passes. A browser against the real service, replacing only the mobile client bundle, verifies unchanged toolbar/composer coordinates after 900px transcript scrolling, window scroll at zero, swipe opening, original rename editor placement, a 320px wide-screen list with an interactive chat, and workspace filtering retaining the add action. Both theme palettes were visually inspected; the light palette was applied locally for inspection without writing account preferences.

Separate browser contexts show three distinct growing assistant-body samples before completion in an ordinary reply. Public-ingress testing also received incremental wire chunks, but does not supply the same complete body comparison. No root cause is assigned to the user's unreproduced delay, and foreground recovery is not presented as proof that every cross-device delay is resolved.
