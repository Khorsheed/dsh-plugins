# Agent Note: One ModalShell for every capability-catalog dialog; MCP tool schemas open the shared tool detail modal

Status: implemented

English | [中文](2026-08-30-shared-modal-chrome.zh.md)

This note records the modal-chrome unification in `@khorsheed/dsh-capability-catalog`'s client.

## Problem

The section grew five dialogs across iterations with two different chromes: the tool/skill detail and the two add forms hand-rolled the `.overlay`/`.modal` classes (inconsistently — only the tool detail had Esc/mask-click close), while the MCP manage modal used the host `Modal` primitive, which looks visibly different (title size, close button, width). Worse, the MCP manage modal embedded each tool's parameter schema inline as a compact `SchemaView` inside the tool card, so schema rendering existed in two contexts and the compact variant looked cramped beside the real detail modal.

## Decision

**One `ModalShell` component owns the chrome of all five dialogs** (tool detail, skill detail, MCP manage, add-skill, add-MCP): centered overlay, fixed head (title + ×), scrolling body. Esc and mask-click close it — but only when it is the topmost `[role="dialog"][aria-modal="true"]` in the DOM, so stacked modals never collapse together. Form dialogs (the two add modals) pass `closeOnMask={false}` so a misclick cannot drop a half-filled form; simple confirm dialogs (delete-skill, overwrite) stay on the host `Modal`, which the host owns.

**The MCP manage modal is server-level only.** Clicking a tool row opens the shared `ToolDetailModal` stacked on top (rendered after the manage modal so DOM order puts it on top); managed `CatalogMcpTool`s are synthesized into `CatalogToolRow`s with `channel: 'mcp'` + the server name. The inline compact `SchemaView`, its `schemaFor` accordion state, the `compact` prop, and the `.mcpToolSchemaBody`/`.schemaTreeCompact`/`.toolParamsHeadCompact` CSS are gone — a tool's schema now has exactly one rendering context, and a change to it ships everywhere at once.

## Alternatives considered

- **Unify on the host `Modal` primitive instead.** Rejected: the detail dialogs need the wide 880px shell, fixed head, and clamped-description layout the host Modal does not offer; the hand-rolled chrome was already the richer and more-used of the two.
- **Keep the inline compact schema in MCP tool cards.** Rejected: two schema contexts meant every display fix landed twice, and the compact tree inside a narrow card was the odd-looking view that motivated this change.
- **Esc closes only via per-modal listeners without a topmost check.** Rejected: with the tool detail stacked over the manage modal, one Esc would close both.

## Consequences

- Chrome fixes (head, close behavior, overlay) now land once in `ModalShell`; the skill detail modal gained Esc/mask-close parity it previously lacked.
- Known quirk, pre-existing and out of scope: the host settings dialog closes itself on Esc at the window level, so Esc inside any inner dialog also closes the settings dialog. Fixing that belongs to the host.
- The MCP manage modal widened from 600px (host Modal) to the shared 880px shell; its bounded tool-list scroll (`min(34vh, 360px)`) is unchanged.
- Verified visually on the 3090 instance: stacked detail-over-manage, topmost-only × close, add-skill form chrome, flat and nested schema trees.
