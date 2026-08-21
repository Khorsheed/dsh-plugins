# @khorsheed/dsh-client-session-title-edit

English | [中文](README.zh.md)

Session title editing for the dsh web GUI chat header. The browser half contributes one `conversation.session.header.actions` entry — a pencil control immediately right of the session title — that swaps in an inline editor: the draft prefills with the current display title and selects it, Enter commits, Escape cancels, a trimmed-empty draft disables save, and a host rejection keeps the editor open with a localized error. The in-place input auto-fits its text between the crumb's original width and the official 220px cap, and a draft that would exceed the host's 80-UTF-8-byte title budget shows a localized warning and blocks saving instead of being silently truncated. The rename verb rides the official `session.rename` RPC (`session.rename` → `sessions.rename` → `ctx.sessionTitle.rename`), so the plugin needs no host half, no new RPC, and no edits to core packages; the accepted user-sourced `session/title` event pins the title against automatic regeneration. Composing this plugin out of cordis.yml removes every surface it adds.

Editing is in place: clicking the pencil hides the official title crumb (a DOM-layer `data-ste-inplace` attribute) and overlays the plugin's own input at the crumb's measured rect, so the title itself reads as an editable field — the input's width is fitted to the draft (measured through a hidden mirror span at the input's font) between the crumb's original width and the crumb's 220px cap, so a long draft grows the box instead of clipping inside the original title's box. The official header exposes no title seat, so the overlay is DOM-layer with probe-based degradation — see Known Limitations.

The `/client` exports are the plugin body (`apply`/`inject`) and the `TitleEditActionProps` type.

## Model Experience

### What the model sees

Nothing changes. The title is a projection-only session property — it never enters the model context, and renaming appends only a `session/title` log event with a user source. The header title flips when the host projection lands.

#### Token effect

None.

#### KV Cache effect

None.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.1`): ✅ full — the rc.8→0.1.1-rc.1 API audit (2026-08-21) confirms every surface this plugin consumes is unchanged or additive (the ProjectionDefinition restructure, cacheHitPercent return-type change, and the credentials/updated event rename do not touch this package); no source change was needed.
- source line (deepseek-harness master): ✅

## Known Limitations and Deferred Work

- **In-place editing is a DOM-layer stopgap.** The official `ConversationSessionHeader` renders the title and exposes no title seat, so "the title becomes an input" is faked by hiding the official crumb via a `data-ste-inplace` attribute and overlaying the plugin's input at the crumb's measured rect (viewport-fixed, re-measured on window resize). When the crumb cannot be located (the official DOM changed), the entry degrades to an inline editor in the actions row. TODO(session-title-edit): deprecate the overlay when the official header opens a title slot (or makes the crumb editable) — the entry then becomes a pure slot consumer.
- **No optimistic update.** The header title refreshes from the session-list projection when the host settles the rename; the control does not rewrite the crumb itself.
- **The title byte budget is host-owned, client-gated.** `session-title` caps the accepted title (`maxTitleBytes`); the editor mirrors the cap client-side (80 UTF-8 bytes by default in the base bundle, `MAX_TITLE_BYTES` in `src/client/title-length.ts`), so an over-limit draft shows a localized warning and blocks save/Enter instead of being silently truncated by the host. The constant must track the host default — a host that raises the cap only widens what the editor permits once the constant follows. The official sidebar rename dialog still truncates silently.
