# @deepseek-ai/dsh-client-session-title-edit

English | [中文](README.zh.md)

Session title editing for the dsh web GUI chat header. The browser half contributes one `conversation.session.header.actions` entry — a pencil control immediately right of the session title — that swaps in an inline editor: the draft prefills with the current display title and selects it, Enter commits, Escape cancels, a trimmed-empty draft disables save, and a host rejection keeps the editor open with a localized error. The rename verb rides the official `session.rename` RPC (`session.rename` → `sessions.rename` → `ctx.sessionTitle.rename`), so the plugin needs no host half, no new RPC, and no edits to core packages; the accepted user-sourced `session/title` event pins the title against automatic regeneration. Composing this plugin out of cordis.yml removes every surface it adds.

Editing is in place: clicking the pencil hides the official title crumb (a DOM-layer `data-ste-inplace` attribute) and overlays the plugin's own input at the crumb's measured rect, so the title itself reads as an editable field. The official header exposes no title seat, so the overlay is DOM-layer with probe-based degradation — see Known Limitations.

The `/client` exports are the plugin body (`apply`/`inject`) and the `TitleEditActionProps` type.

## Model Experience

### What the model sees

Nothing changes. The title is a projection-only session property — it never enters the model context, and renaming appends only a `session/title` log event with a user source. The header title flips when the host projection lands.

#### Token effect

None.

#### KV Cache effect

None.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.0-rc.6`): ✅ full — the runtime touches only the official public stable surface (slots, core services, core events, cordis 4.x, schemastery).
- source line (deepseek-harness master): ✅

## Known Limitations and Deferred Work

- **In-place editing is a DOM-layer stopgap.** The official `ConversationSessionHeader` renders the title and exposes no title seat, so "the title becomes an input" is faked by hiding the official crumb via a `data-ste-inplace` attribute and overlaying the plugin's input at the crumb's measured rect (viewport-fixed, re-measured on window resize). When the crumb cannot be located (the official DOM changed), the entry degrades to an inline editor in the actions row. TODO(session-title-edit): deprecate the overlay when the official header opens a title slot (or makes the crumb editable) — the entry then becomes a pure slot consumer.
- **No optimistic update.** The header title refreshes from the session-list projection when the host settles the rename; the control does not rewrite the crumb itself.
- **The title byte budget is host-owned.** `session-title` caps the accepted title (`maxTitleBytes`); the editor imposes no client-side length limit, so an overlong title is silently truncated by the host. The sidebar rename dialog behaves the same way.
