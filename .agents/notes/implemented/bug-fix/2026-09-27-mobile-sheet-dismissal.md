# Agent Note: Mobile sheet dismissal and current-title anchors

Status: implemented

## Problem

Room's invite/edit form has an owner-provided mouse backdrop dismissal but no mobile drag dismissal. The mobile sheet handle therefore suggests an unavailable interaction. Separately, the 0.1.7 conversation header renders the current crumb as a span rather than a disabled button; mobile's old anchor no longer hides the duplicate title. This is unrelated to Agent Team visibility.

## Decision

Mobile adds delegated touch handling only for a recognized Room overlay in active mobile mode. A deliberate downward drag from its top 96-pixel title/handle band, with the sheet scrolled to the top, dismisses at 72 pixels. An outside tap also delegates to the existing overlay mousedown close handler. Form scrolling, inputs, model disclosures, horizontal/short gestures, text selections and native nested dialogs retain their behavior. Drag cancellation and disposal restore inline transforms; in-flight form state and all callbacks remain owned by Room. No Room implementation or interface is replaced.

The current-title anchor accepts both the legacy disabled button and the new noninteractive text span immediately before the official lineage slot. Known child-count controls remain available; interactive ancestors and unknown lineage controls are preserved. Desktop styles and actions are unchanged.

## Alternatives considered

A global Escape dispatch can close unrelated menus or dialogs. Removing React nodes directly would bypass owner state. Claiming downward motion throughout the form would interfere with scrolling and editing. Hiding the whole header would remove plugin actions. Instead the adapter uses the existing overlay close action and narrowly recognized noninteractive title anchors.

## Consequences

Only the sheet header supports drag dismissal; the body continues to scroll. The owner currently allows cancellation even during submission, and the adapter follows that policy. Anchor changes require future compatibility review and fail open if the form or title structure is unrecognized. Regression tests cover outside taps, drag thresholds, scrolling/inputs, disposal and the new title shape with and without a child-count entry. Build and package tests pass; physical iPhone gesture acceptance remains to be done after deployment.
