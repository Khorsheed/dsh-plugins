# Agent Note: Library — one tool per noun (the model face splits)

Status: implemented

## Problem

The model face was three verbs with a `what` enum, and `library_write` carried the union of every write's payload: 14.6 KB of description + schema (76% of the library's tool budget) where `title`/`toc`/`tocSource` could never be schema-required — they only applied to `what=book` — so missing fields became runtime lessons instead of schema errors, and every call made the model pick the right field subset out of nine operations' union. Live sessions showed the cost (the "满屏报错" onboarding).

## Decision

Split the write verb into one tool per noun — `library_project`, `library_book`, `library_resource`, `library_roadmap`, `library_notes`, `library_page`, `library_cards`, `library_quiz`, `library_binding` — with `library_read` (read-only dispatch is harmless) and `library_assess` unchanged. Each write tool:

- declares its own required fields at the schema line (`library_book` requires `title` / `bookKind` / `toc`; `library_roadmap` requires `nodes`; …) — the dsh-tools DSL compiles a field's `required: true` into the parent schema's `required` array, and it composes with `oneOf` (the JSON-text transport branches stay);
- keeps the transport tolerances that live sessions proved (big payloads as JSON text, `chapterRanges` sugar, cover aliasing, option `{ label }` objects, the axis defaults and shorthands);
- drops the legacy `what`-named wrapper objects (`book: {…}`, `roadmap: {…}`) — the noun is the tool name now, there is no slot left to nest under.

Registration order follows the workflow (read → project → book → resource → roadmap → notes → page → cards → quiz → binding → assess). The prompt, the service's refusal texts, the locale prime strings, the READMEs and the presets' comment all name the new tools; the `./tool` row's registration loop is unchanged (it maps over the definitions).

## Alternatives considered

- **Keep three verbs, shrink the descriptions**: rejected — the missing-field class is structural (a per-`what` required field cannot exist in one shared schema), and the union schema is the cognitive load, not the prose.
- **Split reads too**: rejected — a wrong `what` on a read costs a harmless retry; nine more tools would tax the global tool list for no correctness win.
- **Keep `library_write` as a compat shim**: rejected — no external callers exist (the model reads the fresh tool list every turn); a shim would double the surface we teach.

## Consequences

- The tool budget goes 19.1 KB → 21.8 KB (+14%, ~+900 tokens/turn): slightly UP in total, deliberately — the win is per-call surface (a quiz call presents ~4 KB, not the 14.6 KB union) and schema-line required fields.
- The global per-session tool count grows by 8; the names are self-describing, and `denyTools` masking by name still works (no profile masked the old names).
- Old conversation histories referencing `library_write · x` are inert text; the current tool list carries the new names.
- The v5 model proposal ([proposals/active/2026-10-16-library-v5-model.md](../../../proposals/active/2026-10-16-library-v5-model.md)) keeps these names — `library_quiz` survives the Assessment fold (its 开放项 ② answered: no rename).

## Testing

tool.spec.ts rewritten to the per-noun face (33 tests): the schema line rejects missing required fields (book / quiz), JSON-text transport still parses, the chain (create → register → draft) auto-binds, scope derivation and axis defaults unchanged. boot.spec.ts asserts the registered names against LIBRARY_TOOL_NAMES with the origin tag on each. 130/130 green, `check:panels` clean.
