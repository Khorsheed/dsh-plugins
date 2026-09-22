# Agent Note: The room invite dialog is a character-creation card with a live preview and a name dice

Status: implemented

English | [中文](2026-08-30-invite-dialog-character-creation.zh.md)

This note records the reshape of `@khorsheed/dsh-room`'s invite/edit dialog from a vertical form into a character-creation card.

## Problem

The invite dialog collected provider, display name, cwd, role instructions, and first task as one flat vertical form. The two most game-like decisions — who this member is and what it looks like in the roster — were invisible until after the invite landed, and the flat order buried the primary field (the first task) below two advanced ones (role instructions, cwd).

## Decision

**The dialog is a character-creation card with a live `MemberCard` preview.** `MemberCard` was extracted from `MembersView.tsx` into `MemberCard.tsx` with a `preview` flag (no action foot, always idle); the dialog renders it from the current form values on every keystroke — name (empty falls back to a 新成员/new-member placeholder), provider display name, role instructions — and the avatar color follows automatically because it is a name hash (`member-color.ts`).

**A 🎲 dice rolls a random addressing name** from a small game-flavored pool (`name-pool.ts`, 25 names). `rollName(taken, current)` never rolls a roster name or the currently displayed one. The roster reaches the dialog through a new `existingNames` prop; the members tab and the fresh-room dock capsule pass their store state, and the session-header action (which has no store in its inject face) reads a new `listNames()` on `RoomInviteInjected`, served from the store cache at call time. A cache miss degrades to an empty list — the host's duplicate check stays the backstop.

**Field order is primary-first:** provider → 称呼(+🎲) → first task → ▸ 高级设置 (a native `<details>` holding role instructions and cwd). Invite keeps the drawer folded; edit opens it, because editing IS changing those fields. The invite submit button reads 邀请入队/Invite to the team.

**Layout: a wide (560px) two-column card, form left, preview right.** Both candidate layouts were built and screenshotted on a scratch instance (light and dark, empty and filled); the stacked-narrow variant pushed the preview out of view once the advanced drawer opened and made a very tall card, while the two-column split keeps the preview beside the form like a character sheet and uses vertical space better. Viewports under 640px stack with the preview on top via a media query.

## Alternatives considered

- **Narrow (380px) card with the preview stacked above the form.** Rejected after side-by-side screenshots: with the advanced drawer open the card grows past the viewport and scrolls, and the preview reads as a banner rather than the thing being created.
- **A bespoke preview widget instead of reusing `MemberCard`.** Rejected: two renderings of "a member card" would drift; the extracted component with a `preview` flag keeps one rendering and one stylesheet (`MembersView.module.css`).

## Consequences

- Every existing behavior is preserved: logged-out providers grey with login guidance, the facade-missing degradation, the name precheck plus host structured errors on the inline error line, the 浏览… cwd pick (read-only display, empty = inherit), and the edit-mode diff submit (empty cwd/instructions clear to null). 176 client/host tests stay green (172 prior + 4 new: live preview, dice dedup, drawer default states, `rollName` exhaustion).
- `tsconfig.client.json`'s explicit file list gained `MemberCard.tsx` and `name-pool.ts`.
- Pre-existing quirk, out of scope: the card's `onKeyDown` stopPropagation means Esc closes the dialog only when focus is outside the card; the 取消 button always works.
- Verified on a scratch instance (port 3199, profile linking the workspace packages): screenshots under `scratch-screenshots/` (gitignored, never committed) cover both layouts and the final light/dark × initial/dice/filled matrix.
