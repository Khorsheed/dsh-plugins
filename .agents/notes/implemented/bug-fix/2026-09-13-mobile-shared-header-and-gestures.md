# Agent Note: Share mobile header adaptation across conversation kinds

Status: implemented

## Problem

Mobile header adaptation required an ordinary conversation with an empty lineage slot. Rooms and conversations with children therefore retained the preset, computer open-in action, export menu and sidebar toggle beside interactive plugin controls. Renaming reused the Host inline editor, which overlapped the mobile title and shifted the page when the keyboard opened. Drawer dismissal also rejected touches on conversation rows because they are buttons.

## Decision

Apply checked header presentation anchors to every active conversation. Project the existing preset label into the workspace subtitle and hide the recognized computer-only utilities. Only collapse the entire row when all remaining content is accounted for; preserve ancestor/child navigation and unknown plugin actions. This is one adapter, not a Rooms-specific implementation, and removing mobile restores every marked node.

Use a mobile modal for the title draft and the same sessions.binding(id).session.rename command as the Web workspace dialog. Capture the target identity, preserve server refusal and retry, allow confirmation of an unchanged automatic title, and prevent duplicate pending submissions. Do not trigger the Host inline editor or write an optimistic title cache. Keep the composer focus guard armed on opening and closing the dialog.

Allow horizontal gestures on mobile conversation rows, workspace groups and the exposed conversation preview. Claim only intentional horizontal movement, cancel on vertical or multi-touch motion, and consume the following synthetic tap. Editors, selections, unrelated controls and horizontally scrolling content remain untouched. Keep wide pinned layouts stable. The Host workspace sidebar closes left through its existing toggle. An already-open right sidebar can slide right to close through its existing owner toggle; unknown panels retain their controls. Respect reduced motion for settling animations. Add subtle separators between preset options without changing their selection callbacks.

## Alternatives considered

Separate Rooms toolbar code would grow the maintenance split. Hiding all header slots would erase plugin actions and child navigation. Styling the inline input alone would retain its keyboard/layout interference. A second rename API would duplicate Host normalization and title-pinning behavior. Letting all buttons accept navigation swipes would interfere with unrelated controls.

## Consequences

Header recognition remains a checked DOM fallback until the Host exposes presentation metadata; unknown contributions stay visible. Native iOS settings and third-party dialogs keep their own navigation gestures. The historical Remote stream frame report must be diagnosed independently of presentation changes: fresh public WebKit and Chromium loads of the reported Room succeeded, so this change does not claim to repair that unobserved incident.
