# Agent Note: Room invite dialog restyled on the official design tokens

Status: implemented

English | [中文](2026-09-10-room-invite-dialog-official-tokens.zh.md)

## Problem

User feedback on the room 邀请成员 dialog: the design read as off-brand — a light-blue filled submit button (`--dsw-alias-bg-accent` with a static `#3370ff` fallback, a token the official theme does not even define), a blue focus ring on every field, and a light-blue hashed avatar tile in the live preview, while the official Agent Teams surfaces run a restrained black/white/grey scale where hierarchy comes from weight and spacing, not color blocks.

## Decision

Re-skin the dialog (and only the dialog — no behavior, DOM structure, or locale changes) on the official tokens, taken from the harness sources: `packages/client/ui-theme/src/styles/design-platform.css` (the `--dsw-alias-*` definitions), `packages/client/ui-primitives/src/Button.module.css` (primary = `button-primary-fill` + `label-primary-foreground`, hover = `button-primary-hover`, capsule geometry; Cancel = the bordered outline), `packages/client/ui-primitives/src/Modal.module.css` (title 16/24 weight 500, 24px content rhythm), and `packages/client/ui-message-feedback/src/client/FeedbackDialog.module.css` (neutral focus ring, caption placeholders, 18px dialog radius). Concretely in `packages/room/src/client/InviteDialog.module.css`: the submit button is the one filled action — `button-primary-fill`, which is brand-primary (neutral-bluish-1000 on light, neutral-bluish-50 on dark), so dark theme inverts to near-white automatically; Cancel is `border-l3` on transparent; the field focus cue is the FeedbackDialog neutral ring (`border-l4` + 1px halo), never the accent; placeholders drop to `label-caption`; labels match the official panel section header (12px / 500 / secondary, the client-ui-agent-team `TeamAction` h3); the advanced summary quiets to 12px tertiary; the error line moves to the real `state-error-primary` alias. The dialog preview's avatar tile stays neutral: `MemberCard` omits the inline `--member-color` in preview mode and the tile's fallback is now the tertiary ink — the name-hash palette still owns identity everywhere a seated member appears.

## Alternatives considered

**Recoloring with static hex values.** Rejected: the whole point is theme-following — the alias tokens flip dark theme for free, and a hardcoded near-black would glare on dark surfaces.

**Keeping the name-hash color in the preview avatar.** Rejected per the user ask (neutral avatar in the dialog); the preview stays an honest layout/identity preview — only the tile tint differs from the seated card.

**Adopting the official Modal mask (dimmed + blurred overlay).** Rejected: the transparent overlay is a deliberate standing decision (the conversation stays readable behind the dialog), restated in the stylesheet header; this change is tone, not chrome behavior.

## Consequences

The dialog reads on the official black/white/grey scale in both themes with zero per-theme code, and the accent blue no longer appears anywhere in it. Tests: `tests/invite-dialog-style.spec.ts` pins the primary-button token trio and the absence of the accent tokens; `tests/members.client.spec.tsx` now asserts the preview tile carries no inline `--member-color` (neutral) and that the submit button keeps the `primary` class hook. The roster/speech/composer member-color identity system is untouched, as is every locale string and the README's functional description of the dialog.
