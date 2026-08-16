# Agent Note: Escape pause goes global with a three-part yield rule

Status: implemented

English | [中文](2026-08-16-ui-shortcuts-global-escape-pause.zh.md)

## Problem

Escape pause shipped composer-scoped: the key paused only while the event target was the composer textarea, so a user who never clicked into the chat box could not pause a running turn. The original limitation note deferred a global Escape because "a shared overlay-consumer registry does not exist" — modals, menus, and popupSelect all close on Escape, and a global pause that ignores them would fire alongside every overlay close.

## Decision

Escape is now a global pause (document bubble listener, as before) gated by a three-part yield rule instead of the composer-target gate:

1. `event.defaultPrevented` — a component handler already consumed the key (slash menu arbitration, popupSelect). Component handlers run before document bubble listeners, so the flag is always visible.
2. `document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')` — an overlay is open. These layers (Modal, Menu, Settings panel, lightbox, slash menu) close on Escape without `preventDefault`, and their DOM is still present during dispatch because their state-driven unmount lands after it.
3. A non-composer editable target (input/textarea/contenteditable outside `[data-composer-card]`) — inline rename and search fields keep their own Escape semantics.

No overlay registry was built; the role query plus the event flag covers every overlay in the current host without one.

## Alternatives considered

**Keep the composer scope.** Rejected by the product owner: pausing must work regardless of where the pointer last clicked.

**Build the shared overlay-consumer registry first.** Rejected as disproportionate: the registry is a host-level project, while the role query plus `defaultPrevented` already distinguishes every open layer the host ships today. If a future overlay renders without a dialog/menu/listbox role, the yield rule degrades to pausing alongside its close — visible, not destructive.

**Stand down on any editable focus, composer included.** Rejected: the composer textarea is the primary pause surface; combobox-style popups there already yield via rule 1/2.

## Consequences

`pauseCurrentTask`'s own guards (no current session, not running, one-shot subagent) stay as the last line — a leaked Escape pauses only a genuinely running turn. The composer-textarea helper survives as the exclusion inside the editable rule. The Known Limitations entry about composer-scoped pause is removed from both READMEs; the layering section documents the yield rule.
