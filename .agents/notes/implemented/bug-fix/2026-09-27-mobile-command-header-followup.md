# Agent Note: Mobile command and header compatibility

Status: implemented

## Problem

The mobile tools sheet avoided keyboard focus at its first level, but choosing Commands still focused the host editor. The host command overlay was translucent. Updated preset glyphs and directory-button markup also bypassed mobile adapters, while the presence of a tools launcher incorrectly hid agent invitations without a replacement member shortcut.

## Decision

Invoke the public inputTriggers session controller with the official command source and the captured insertion span, including its draft revision. This preserves host discovery, command picks and permissions without focusing the editor. Missing optional controllers fall back to the existing host button. The mobile trigger menu uses an opaque themed surface and larger touch rows.

Recognize both checked preset glyph structures and move their existing localized text to the mobile subtitle. Hide directory open-target controls using the host data attribute, retaining the older icon matcher. Hide the host invitation only when an enabled mobile member shortcut exists. Right-sidebar visibility is unchanged at the user's request.

The workspace picker keeps its heading and add action outside a bounded scrolling list. Folder rows no longer overflow onto the footer divider; the add action shares their row padding and height, with eight pixels of spacing on each side of the separator.

## Alternatives considered

**Clicking the host plus button** reintroduces editor focus. Rebuilding the command catalog forks host behavior; the public controller preserves it. On old hosts lacking this controller, keeping the original button is preferable to a dead command entry.

**Hiding invitations whenever the tools launcher exists** loses the entry on ordinary sessions without a roster shortcut. A concrete enabled replacement is required.

## Consequences

Only the mobile presentation changes; disabled plugins remain disabled. Header glyph recognition is still version-sensitive and keeps both verified forms. Tests cover public command invocation with draft revision, the two-level tools flow without editor focus, invitation replacement, preset extraction and directory-control cleanup. Physical iOS keyboard acceptance remains a device check; DOM tests cannot prove it.
