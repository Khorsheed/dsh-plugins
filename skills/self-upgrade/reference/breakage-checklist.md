# Breakage inventory checklist

This checklist is deliberately version-agnostic: it teaches the METHOD, and
every concrete example is just the instance we met it on. Multi-hop upgrades
(e.g. 0.1.0-rc.6 → 0.1.2) need no hop-by-hop planning — diffing the two
endpoints directly covers the union of every intermediate break. Over time,
distill each version pair you have personally verified into a case file under
`reference/cases/<from>-to-<to>.md` (and feedback-board entries about unknown
breaks belong there too) so the knowledge compounds instead of resetting per
release.

How to build the complete list of what a new host version breaks, before
touching code. Read the changelog range (`old-tag...new-tag`) commit by commit,
and for every host package your plugins depend on diff the public export
surface (the package's entry `.d.ts`) between the two lines. Then walk the
checklist below per installed plugin.

## The surface checklist

1. **Externalized value imports (the load-time killer).** Browser plugin
   bundles do not bundle the host's shared packages; the bundler externalizes
   them and the host answers the `require` from a frozen module table at load.
   If the new host REMOVED a package from that table — with or without a
   compat alias — every bundle still requiring it throws at load time, and the
   plugin vanishes from the instance. Enumerate your bundler's externalization
   list and check each entry against the new host's module table.
2. **Type-only imports of a deleted package** are erased at build — pure
   compile-time migration, safe to redirect mechanically per the migration map.
3. **Slots** — every slot key you mount or inject into, plus the owner-prop
   shape the host passes. Slot keys tend to be stable; the DATA feeding them
   moves (see item 8).
4. **Remote / RPC namespaces** — remote mounting, namespace names, method
   signatures, and the auth transport (a host may switch browser auth to
   one-time-token cookies; standard remote clients ride it transparently, but
   hand-rolled fetchers break).
5. **Settings registration** — the registration API and your namespace's key
   schema.
6. **Skills registry** — the `register` signature; `source` values are
   validated at load, so a value the new registry rejects turns your skill
   into a boot-time error.
7. **Command execution signatures** — parameter lists can grow (a new optional
   field is usually compatible; a reordered or narrowed one is not).
8. **Where chat/session data lives** — a host can split a snapshot slice into
   its own package (e.g. chat data moving out of the session snapshot into a
   chat-package snapshot, a member list becoming a singular pending item).
   These crash at RENDER time, not load time.
9. **DOM anchors** — `data-*` attributes are the stable contract; class names
   and banner shapes churn (hashed wrappers). Re-verify every anchor, including
   menu/listbox restructuring.
10. **Prompt-ordering anchors** — numeric `order` values for system-prompt
    contributions get re-spread between releases, and equal orders may gain a
    name tiebreak. If you picked an order to land between two official
    contributions, eyeball the rendered prompt on the new host.
11. **Capability literal types** — a newly REQUIRED field in a host capability
    type breaks inline literals at compile time (constants you export are
    unaffected at runtime).
12. **Boot mechanics** — check how the new host itself must be launched. A host
    whose vendored packages use `const enum` cannot be booted by a
    source-loader that cannot inline the enum cross-package; the built CLI
    plus prebuilt frontend dist may become the only boot path. Your restart
    command from Phase 0 may need to change, not just your code.
13. **Browser asset URL shape** — how plugin client bundles are SERVED is host
    contract, and it changes across lines (one line serves a single-file
    `/plugins/<id>/client.js`; the next serves only the boot-manifest batch
    form `/plugins/??<id>/client.js,...&rev=...`). Verifiers and health checks
    that hardcode the old URL report 404 on a perfectly healthy plugin. Always
    take the URL from the page's boot manifest (`window.__DSH_BOOT__` graph),
    never from memory. The same release may also gate the whole UI behind a
    one-time `?token=` login (bare `GET /` answers 401) — that is host
    behavior, not a plugin regression; health checks must treat any HTTP
    answer as alive.

## Compile-time blind spots — the standing warning

Dev-time type resolution usually points at the OLD line's published type
packages. Two consequences:

- A **deleted named export still compiles** — the old types still declare it.
  The first environment that knows the truth is a live boot of the new host,
  where the static import is a `SyntaxError` at module load.
- A deleted runtime member (`obj.member` gone) typechecks against the old
  types and throws at apply or render time only on the live host.

Mitigations, in increasing strength: typecheck against the new host's SOURCE
tree; run the test suite with source-plane resolution against the new host;
and always finish at a live acceptance boot (Phase 4 rung 3). Treat "build
passed" against old-line types as a weak signal.

## Deleted host packages — sweep the whole repo

When the host deletes a package outright, grep every plugin repository for the
package name — sources, tests, `package.json` peer/dev dependencies, bundler
externalization lists, and docs. One leftover value import is a load-time
crash; one leftover peer dependency is an install-time lie.
