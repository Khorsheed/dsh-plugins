# Agent Note: ui-shortcuts rides the official rc.2 shortcuts service when resident (three same-name collisions resolved)

Status: implemented

## Problem

Host 0.1.7-rc.2 ships its own shortcut system — the `shortcuts` service (`dsh-client-shortcuts`) plus the `dsh-client-ui-shortcuts` panel bundle — and ui-shortcuts collided with it on three independent name planes, each with a different failure mode:

1. **cordis service key.** This package historically provided `ctx.provide('shortcuts', registry)`. cordis throws on a duplicate provide, so on rc.2 compositions one of the two providers must not provide.
2. **Loader row id.** The patch layer mounted the package at row id `ui-shortcuts` — the same row id the official web-app bundle gives the panel. Loader composition collapses same-id rows (last layer wins), so our row shadowed the official panel outright (this masked collision 3 on early boots: the panel never applied, so its locale registration never ran).
3. **Locale namespace.** Both packages registered the `shortcuts` locale namespace, and `locale.register` throws on a duplicate (ns, locale) pair. Once the row id was fixed and both bundles mounted, this throw surfaced as the client entry stuck in `loading` — apply began, the register effect threw, and the loader never settled the entry.

## Decision

The package runs **two paths selected at apply time** by probing `ctx.get('shortcuts')` for the official face (a `register` verb plus `catalog.getSnapshot` — the catalog marker distinguishes it from this package's own legacy registry):

- **rc.2+ (official resident): contribute, never provide.** The local registry, settings card, key/mouse dispatch, and preference wiring all stand down. The package registers exactly the two commands the official catalog lacks — `ui-shortcuts.steerSend` and `ui-shortcuts.compact` — through the official command contract (label/aliases/defaults/regions/modals/resolve). Pause, new-session, and the right-sidebar toggle are official natives there (`response.stop` Esc Esc, `session.new`, `sidebar.right.toggle`), and rebinding rides the official panel. Each `register` call is individually guarded: the official registry throws on keybinding-policy violations (web refuses bare `primary+Key`, web:linux admits only an allowlist, Linux WM reserves primary+shift+X), and a policy change must cost one command, not the whole plugin.
- **0.1.5 / rc.1 (no official service):** the full local implementation runs unchanged — registry provided under `shortcuts`, settings card, keyboard and mouse bindings.

The two renames that make coexistence possible: the patch row id is now `khorsheed-ui-shortcuts` (identity-triangle exception: the package name and `PACKAGE_NAME` stay `ui-shortcuts`/`@khorsheed/dsh-ui-shortcuts`; only the loader row id moves), and the locale namespace is now `ui-shortcuts` (see `src/client/locales.ts`).

## Alternatives considered

**Keep the local registry and disable the official service in our profiles.** Rejected: forked shortcut UX forever (two panels, two binding stores), and every future official command would need a shadow copy. The official system is strictly better on the keyboard plane (per-profile defaults, modal scoping, a searchable rebind panel).

**Full retirement of the package.** On the table at note time, with one evidence caveat: the official rc.2 catalog has **no compact command and no steer-send command** (verified across every official `shortcuts.register` call site — ui-layout, ui-workspace, ui-sidebar-*, ui-settings-general, ui-open-in-app; `/compact` exists only as a slash command, steer only as the composer's configurable ⌘Enter complement). Retiring the package retires those two keyboard gestures with it. The dual-path build is the hedge: it already delivers "official owns the system" while keeping the two commands alive.

**Rename nothing, register our dictionaries under the official `shortcuts` namespace via the untyped overload.** Rejected: the throw is by design (single owner per namespace), and riding the official namespace would break the moment official adds a colliding key.

## Consequences

Bought: zero console errors on a real rc.2 full-composition boot, both bundles coexist, our two commands appear in the official panel with localized labels and are rebindable there, and the 0.1.5/rc.1 behavior is untouched (55 tests green on both baselines).

Lost on the rc.2 path, honestly recorded: **mouse-button bindings have no representation** in the official keyboard-only protocol (the middle-click sidebar toggle cannot survive), and the steer-send default moved from `primary+S` to `primary+shift+S` on web (official policy). Both land in the README's known-limitations; a mouse-gesture upstream proposal is the retirement path if anyone misses them.

## Testing

`tests/official.client.spec.ts` pins the official path: detection face, both commands registered with policy-conformant defaults, per-command guard (a refusing registry costs one command, never the boot), resolve gating on a main-view session, and no `provide` attempt. The legacy suite runs unchanged against the 0.1.5-shaped bench. Live verification on the rc.2 proof instance (port 31417): clean console, ⌘/ opens the official panel listing 插队发送 ⇧⌘S and 压缩上下文 ⇧⌘X, and ⇧⌘S submitted a draft end-to-end (turn failed only on the instance's missing API key, proving the dispatch).

## Related

- [client bundles inline the rc.1 icon artwork](../bug-fix/2026-09-26-icon-artwork-self-owned.md) — the other rc-line collision class (exports that exist on one host line only); same lesson, different plane: a shared name is a contract someone else may already occupy.
