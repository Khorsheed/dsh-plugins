# Agent Note: One shared content pane for the file list and the worktree tab

Status: implemented

## Problem

Two community file surfaces rendered the same thing through two diverging copies. `@khorsheed/dsh-local-files` (the right-Sidebar Files card) was split out of `@khorsheed/dsh-worktrees` on 2026-08-28 (commit `3df30448`, proposal `2026-08-26-local-files-browser`), and after the split only local-files kept moving: scroll memory (`28f8d645`), the official open-in-app gestures (`a274514f`), rendered-content search (`169d3a1c`), while the worktrees detail pane froze at the split (`16d56021`, host-0.1.2 adaptation). The result was four asymmetries a user notices immediately — the worktree pane had no per-file "open folder / open in IDE"; the Files card had no markdown/JSON/CSV source⇄preview toggle; the worktree pane's HTML render was static-only (a scripted page sat inert with no explanation) and it overrode the official markdown sheet with hand-written per-element margins; and its JSON/CSV previews rendered at chat type with no block chrome. The duplication had already produced real debt: a 277-line fork of the Files browser inside worktrees whose only opener had been deleted (`ea531c4b`), carrying two live defects (the selected row never highlighted, a `css.treeEmpty` class that did not exist), a copied HTML pipeline with no tests carried over, plus a fourth copy of the sandbox `srcDoc` builder repo-wide.

## Decision

One client-only package, `@khorsheed/dsh-client-ui-content-preview`, owns the content pane; both plugins consume it at the **source plane** and tsdown inlines it into each one's own `lib/client.js`.

- **Package shape.** `dsh.composition.component: "source-plane-library"` — it registers no slot, service, locale or loader row and ships no client bundle. Each consumer declares it as a workspace dependency and imports `@khorsheed/dsh-client-ui-content-preview/src/client/index.ts` directly, so neither plugin gains a runtime dependency and uninstalling one leaves the other intact. This follows the sanctioned `canvas → inline-html-render` edge shape (compile-time helpers, zero runtime coupling).
- **The kernel owns the contract, the consumer owns the mapping.** `PreviewRead` is the kernel's kind union (`text` with `truncated`/`htmlScripted`, `image`, `binary`, `missing` with a `reason`, `too-large`, `error`). Each plugin keeps exactly one adaptation module — `src/client/preview.ts` — which maps its own wire type in, builds its `StructuredLabels` and its `PreviewTranslator` from its own dictionary, and resolves repo-relative paths to absolute ones. Retiring the kernel is an edit to that file plus one import.
- **The kernel holds no locale namespace.** A consumer keeps registering its own dictionary; the pane prints through `(key, params) => string`, typed against a `PreviewKey` union, and a package-level test asserts every `PREVIEW_KEYS` entry resolves in that consumer's `zh` and `en` dictionaries.
- **Unification means the union, not the intersection.** Both surfaces now have the markdown/JSON/CSV source⇄preview toggle (formerly worktrees-only), the HTML three-tier control with a one-time confirmation, the static "scripts did not run" hint, fullscreen and the stall watchdog (formerly local-files-only), the rendered-content search with its honest raw fallback, and per-file copy-path, copy-content, open-folder and open-in-IDE (the copy rows keep BOTH surfaces' semantics: the file list copied the path, worktrees copied the content).
- **What is not the kernel's business.** The file tree, the data face (Remote, store, root selection), tab registration and mode visibility stay in the plugins; diffs and commit comparison arrive as a `diffView` render prop (so the kernel never learns what git is); the worktrees untracked note arrives through `notice`; the worktrees image lightbox arrives through `imageView`.
- **Markdown policy, mechanically stated.** The kernel overrides only the `--dsw-font-markdown-*` scale tokens, never a per-element margin/padding on the official `.markdown` sheet, and every rendered form (markdown, JSON tree, CSV table) sits inside the same token scope and block chrome. The per-element overrides worktrees had accumulated are deleted, not ported.

## Package topology

The three registry edits live in `scripts/check-plugin-independence.ts`, a mainline-owned shared file, and are registration only — no new checking logic: `'source-plane-library'` joins `COMPOSITION_COMPONENTS` (distinct from the row components, so "no patch" cannot read as "a row another patch mounts"), `ui-content-preview` joins the `NO_OWN_PATCH` cross-check list, and `ALLOWED_EDGES` gains `local-files → content-preview` and `worktrees → content-preview`. `docs/packages.md` is regenerated (`pnpm map:packages`).

Duplication after this change, repo-wide: the sandbox `srcDoc` builder 4 copies → 2 (kernel + `inline-html-render`), the capability bridge 3 → 2, the content pane 3 → 2 (kernel + `ui-file-preview`'s `FilePreviewPane`), the open-in-app probe and its IDE/file-manager candidate tables 2 → 1.

## Retirement path

`@deepseek-ai/dsh-client-ui-sidebar-documentpreview` already owns a document-preview registry plus markdown/code/html/image/pdf renderers, and its HTML renderer packs relative classic `<script>`/`<link>` dependencies through the workspace-files Remote — something no `srcdoc` pane can do under `base-uri 'none'`. Inline reuse is blocked today by two contract facts, not capability: the package exports no reusable component (its entry exports `apply()` only), and `sidebar.right.tab.document` is render-exclusive to its own registrations (ui-slots: *declaring is claiming*), so a plugin-owned pane cannot mount it. When the host exposes a reusable document renderer — or a render-authorized slot for third-party panes — this kernel degenerates to an adapter and is deleted, and the relative-resource capability goes back to the official renderer.

## Alternatives considered

**Let worktrees import local-files' components.** Rejected: cross-package edges outside the sanctioned pairs need a deliberate `ALLOWED_EDGES` entry anyway, and it would put the shared implementation inside one of its consumers — the wrong stewardship, and it makes the second consumer's build depend on the first's internal file layout.

**Reuse the official document renderers inline from the start.** Rejected today for the two contract reasons above; adopting it as-is would have meant jumping to the official document tab and losing the tree-plus-preview same-screen layout the surfaces are built around. Recorded as the retirement trigger rather than dismissed.

**House the kernel in `inline-html-render`, the repo's existing "shared render package".** Rejected: that package owns the agent-authored HTML card protocol, and a document-preview kernel is a different vocabulary with a different minHost floor; the canvas edge that shares its `srcDoc`/bridge helpers is unaffected either way.

**Port the missing features into worktrees and leave the duplication.** Rejected: it creates a third copy of the pane. The repo had already named this as the deferred follow-up — the local-files split proposal wrote "共享预览层抽提是后续可能的优化" — and the canvas note already assumed a shared renderer package existed.

**Keep the unreachable local-files drawer in worktrees as-is.** Rejected: it is dead code with two live defects and a private copy of a browser that now exists as its own plugin; its host-plane Remote methods were left in place (see Deferred) but the surface, its store, its local-root memory and its controller hook are gone.

## Consequences

Bought: one implementation for both surfaces; three user-visible asymmetries closed in a single change; the untracked-file toggle and iframe-height defects disappeared as a side effect of using one pane; the dead drawer, its two bugs and its private browser state deleted; the shared HTML pipeline now has the tests it never had.

Cost: a new package in the workspace (the consumers name it in `devDependencies`, NOT `dependencies` — pack-dist would turn a runtime edge into a registry range the unpublished kernel cannot satisfy, and the deploy flow refuses non-self-mounting packages as targets; a `devDependency` is also the honest field, since tsdown inlines the kernel before anything ships); a deliberate edit to a mainline-owned checker file; the kernel's stylesheet travels inside each consumer's client bundle, so a kernel style change requires rebuilding the consumers rather than republishing the kernel; and the two surfaces must keep their dictionaries in sync with `PREVIEW_KEYS`, which the new key-completeness tests make a failure rather than a silent English string.

## Testing

The kernel carries 48 tests (sandbox `srcDoc` construction and CSP injection, bridge validation, rendered-content search including its fallbacks, structured-preview parsing, the open-in-app probe, and 11 acceptance-level pane tests covering the source toggle, the HTML tiers and confirmation, gesture visibility, non-text placeholders and the diff slot). Each consumer adds a `preview-adapter` spec asserting its dictionary resolves every `PREVIEW_KEYS` entry and that its wire kind union maps without losing the deleted/unreadable cases. `local-files` 26 tests, `worktrees` 77 tests, `pnpm check:plugins` and `pnpm gate` green.

## Deferred

- `ui-file-preview`'s `FilePreviewPane` is the remaining third copy of the pane; migrating it is milestone M4 of the proposal. Its IDE split button (app menu with per-app labels) is stronger than the single-button gesture the kernel ships, so the migration has to fold that capability into the kernel rather than drop it.
- `worktrees`' host-plane local-file browser methods (`listLocalDirectory`/`readLocalFile`/`readLocalImage` and their Remote schema) lost their client caller with the drawer; they are still covered by tests but are now dead weight and should be removed in a host-plane cleanup.
- The relative-resource gap against the official HTML renderer stands: the 2026-08-21 ruling that a `srcdoc` pane does not resolve relative assets is unchanged and now stated in the kernel's README.

## Related

- `proposals/active/2026-09-23-preview-kernel.md` — the capability list (A–H) this shipped against, and the retirement path.
- `proposals/active/2026-08-21-file-view-html-rendering.md` — owns the Tier0/Tier1 HTML renderer this kernel now houses.
- `proposals/closed/2026-08-26-local-files-browser.md` — the split whose deferred "共享预览层抽提" this completes.
- `.agents/notes/implemented/feature/2026-09-18-canvas-html-cards.zh.md` — the note that already assumed a shared render package.
