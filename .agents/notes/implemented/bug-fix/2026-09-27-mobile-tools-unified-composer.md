# Agent Note: Mobile tools on the unified composer

Status: implemented

## Problem

Host 0.1.7 folds the attachment button into its command menu. Mobile expected two adjacent buttons before the hidden file input, so its tools sheet disappeared and the host plus button focused the editor and opened a desktop command list above the keyboard.

## Decision

Recognize both verified composer structures. For the unified structure, invoke the retained host file input synchronously; its change callback still owns validation, limits and upload. Disable the attachment action when the host command button or file input is disabled or the composer is not editable, matching the live/unlocked/not-committing and non-child gates. Unknown structures retain host controls. Permission lookup also accepts the named permission slot.

Opening the mobile sheet blurs the editor and focuses the launcher before showModal, so native focus restoration returns to the launcher, not the keyboard. An explicit Commands choice opens the owner combobox. The [command and header follow-up](2026-09-27-mobile-command-header-followup.md) uses the public source controller without editor focus when available; older hosts retain their button behavior. The sheet uses themed solid surfaces, larger tiles, readable headings and row separators. Touch dismissal supports its title/handle band and backdrop through native dialog.close; form scrolling and controls remain untouched.

## Alternatives considered

Directly opening the host plus button would preserve the unwanted editor focus. Reimplementing the command catalog or upload pipeline would fork host behavior. The public session input action face has no file-picker verb; the narrowly checked DOM bridge reuses the mounted input and original callbacks instead. It does not call private hub or keyboard methods.

## Consequences

This remains a version-sensitive presentation adapter, with fail-open behavior on unknown structure. Existing legacy button callbacks and permission confirmation remain intact. Tests cover both structures, attachment admission, synchronous file selection, draft preservation, focus restoration and native sheet dismissal. Mobile build and 125 tests pass; WebKit fixtures check narrow-screen light/dark surfaces and native dialog focus. Physical iPhone keyboard and file-picker acceptance still needs deployment. No 3080 deployment is part of this change.
