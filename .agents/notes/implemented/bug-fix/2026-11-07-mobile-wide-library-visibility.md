# Agent Note: wide mobile library yields to chat and panels

Status: implemented

English | [中文](2026-11-07-mobile-wide-library-visibility.zh.md)

## Problem

On iPad-class wide viewports, the mobile conversation library could not be collapsed. The menu always set `library=true`, the aside ignored that state with `hidden={!library && !wide}`, and CSS forced the hidden aside back to `display:block`. The same forced library covered the left side of managed panels such as Context Lens and game surfaces. On narrow phones the library is a dismissible drawer and did not have this failure.

## Decision

The wide library follows the same `library` state as the narrow drawer. At and above the existing 960px breakpoint, the menu toggles that state; below it, the existing open-drawer behavior remains. The aside's `hidden` property and the library's metadata-read visibility both follow `library` directly. The 320px frame offset, toolbar offset, and separator exist only while `data-mobile-library-open` is present. A collapsed wide conversation uses the full viewport with no leftover divider.

An open managed panel always hides the library and removes the frame's left offset, including when the panel was opened through a host capability rather than the mobile button. Closing the panel restores whichever library state was present. The host's saved dock layout and panel content remain in place. The narrow drawer, 960px breakpoint, 320px/380px widths, gestures, and the earlier host-border/shadow treatment are unchanged.

## Alternatives considered

**Keep the wide library pinned and shift panels right.** Rejected: this preserves the non-functional collapse expectation and permanently reduces every panel's usable width. Panel-first presentation matches the existing full-width mobile panel contract.

**Change only the menu handler.** Rejected: CSS would still force the closed aside visible, and panels opened outside the mobile button would continue to be covered. State, element hiddenness, frame geometry, and panel visibility must agree.

**Create a separate iPad layout.** Rejected: the defect is one visibility rule, not a need for another component tree. One adaptive surface keeps phone and tablet behavior consistent.

## Consequences

Wide users can collapse and reopen the conversation list without replacing the official editor or losing drafts. Context Lens, games, and other managed panels receive the full content viewport while open, so their left navigation and data cannot be occluded by the session library. Hidden libraries no longer perform visible-row metadata enrichment. The host and iOS shell require no source changes.

Coverage includes a 1024px collapse/reopen component test that checks `hidden`, `aria-expanded`, the root visibility attribute, and editor identity/draft retention, plus a managed-panel CSS test that checks the library disappears and the frame offset is removed and restored. Browser rendering covers the narrow drawer and wide open/closed/panel states; native-device visual and touch acceptance remains a separate observation.
