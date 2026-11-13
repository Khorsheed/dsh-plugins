# Agent Note: mobile library separator uses host frame semantics

Status: implemented

English | [中文](2026-11-06-mobile-library-separator.zh.md)

## Problem

The mobile conversation library and the conversation behind it can both have a white background. Their shared edge used the generic translucent control border, so the open drawer did not separate clearly from the conversation, especially around the toolbar and rounded corners. The PC frame instead uses the host's dedicated frame-border token.

## Decision

The open mobile library's main-content and toolbar edges, plus the pinned wide-layout edge, use a 1px `--mobile-divider` border. In light theme it resolves to `--dsw-alias-border-l3` with `--mobile-edge` as the compatibility fallback. Following the 2026-11-09 dark-device feedback, `body[data-ds-dark-theme]` instead resolves it to `--dsw-alias-border-l4` (20% white), with 24% primary-label color as the fallback, because the 16% line was too faint. The open library casts a soft rightward shadow at 12% of the host primary-label color. Following the 2026-11-11 iPad feedback, this applies to the wide pinned layout as well as the narrow drawer because the border alone was imperceptible on the larger white surface; a closed library casts no shadow. Drawer and pinned widths, the breakpoint, corner radii, gestures, and close behavior remain unchanged. The change is confined to the mobile stylesheet; host and iOS-shell sources are untouched.

## Alternatives considered

**Use a thicker or much darker divider.** Rejected: a heavy black edge would dominate the mobile chrome rather than match the PC frame's restrained separation. The narrow drawer needs surface elevation more than extra border weight.

**Change the drawer width or pin both columns on every screen.** Rejected: width and navigation behavior are separate from the reported visual ambiguity. A permanent second column would reduce the conversation on narrow screens and replace the established drawer interaction without evidence that it is wanted.

## Consequences

The separator now follows the same light/dark theme semantics as the PC frame, while the narrow drawer remains legible where two identical surface colors meet. Older hosts without the frame token retain the previous border fallback. No DOM, navigation, storage, or native-signing behavior changes.

The package build and all 168 mobile tests passed. A credential-free Chromium fixture using the actual mobile stylesheet verified 390px light and dark drawers plus a 1024px light pinned layout: the library and main edges met at the same x coordinate, the narrow shadow resolved to 12% of the label color, the wide shadow was `none`, and none of the three states had horizontal overflow. This fixture is stylesheet evidence, not production-session or native-device visual acceptance; native-device appearance still requires device observation.
