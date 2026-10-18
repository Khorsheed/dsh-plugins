# Agent Note: preset ids unify on the dsh- prefix

Status: implemented

## Problem

`@khorsheed/dsh-presets` declared six agent presets under mixed conventions: the four created or remigrated in the rc line carry the `dsh-` prefix (`dsh-eval`, `dsh-writing`, `dsh-gamedev`, `dsh-video`), while the two oldest kept bare ids — `dev` (migrated from the 0.1.5 directory preset) and `learning` (folded from the retired bundle-learning with its id deliberately unchanged at the time). Preset ids live in one global host registry shared with the official presets (`standard`, `minimal`) and any third-party bundle; a bare word like `dev` stakes a claim in that shared namespace that any other bundle could collide with, and the mixed spelling read as an accident rather than a choice (raised by the maintainer on 2026-10-18).

## Decision

Rename forward to the prefix, the convention the four newer presets already follow: `dev` → `dsh-dev`, `learning` → `dsh-learning`, loader row ids `preset-dev` → `preset-dsh-dev`, `preset-learning` → `preset-dsh-learning`, `PRESET_IDS` updated in row order. One presets release carries the rename; no composition content changes.

The rename is breaking by mechanism, not by choice of spelling: the registry answers an unknown preset id with a hard `agent-preset/not-found` RemoteError (packages/preset/agent-preset-registry `resolve`/`retain`) — there is no fallback-to-default for a session whose stored preset vanished. Per-session selections are `agent-preset/selected` events in the session event log (`$DSH_HOME/sessions/<project>/<session>/session.v*.jsonl.zstd`), so existing sessions pinned to `dev`/`learning` would fail to open their agent until the user re-selects a mode. Two mitigations ship with the change:

1. The deployment's own default moves with the rename: `agent-preset-registry` config `selectedDefault: dev` → `dsh-dev` (3080's profile patch), so new sessions never notice.
2. 3080 gets a one-time migration (`scripts/migrate-preset-selections.ts`) that rewrites `agentPreset: "dev"` → `"dsh-dev"` and `"learning"` → `"dsh-learning"` in BOTH places the id persists: `agent-preset/selected` events and the session header line (the `agentPreset` projection initializes from the header — header-only sessions were caught by the second pass, which also fixed the frame parser's FCS flag-1 size for recompressed header frames). Exact value match only, string-level, full `sessions/` backup first, atomic per-file replace, idempotent. Sessions that never stored a selection need nothing.

## Alternatives considered

**Strip the prefix instead (eval/writing/gamedev/video → bare words).** Rejected. It renames four presets instead of two, throws away the namespace guard exactly where collision risk lives (the registry is global and the official presets are bare words — a community `writing` is indistinguishable from a future official one), and breaks the sessions the maintainer actively uses (dsh-writing, dsh-video) rather than the two older ids.

**Keep both ids per preset for a deprecation window.** Rejected: a preset row is its id — mounting `dev` and `dsh-dev` side by side shows the same mode twice in the selector, and the mechanism has no hidden/deprecated flag to soften that.

## Consequences

- Out-of-repo compositions, profile patches (`selectedDefault`), skill frontmatter scopes (`presets: [dev]`) and docs that name the bare ids must follow; in-repo references are updated in the same commit (presets package, the datasets organizing spec that reads the real patch, the conversation-view-restore upstream proposal).
- capability-catalog scoped delivery keyed on preset ids (e.g. a skill scoped to `learning`) silently stops delivering after the rename — the deploy checklist greps the managed skill roots and rewrites the frontmatter scopes.
- The npm-facing story is one CHANGELOG entry marked breaking under 0.3.2; the rename rides the same release wave, no extra version.
- `profiles/dev/presets/dev/` (the dsh-dev distribution's 0.1.5-era directory preset) still names the bare id, but that install branch is dead since the host stopped scanning `.agent-presets` — its cleanup is part of the per-mode distribution work, not this rename.

## Testing

`packages/presets` 16/16 (row ids, config ids, the no-eval-rows-outside-dsh-eval pin), `packages/datasets` 417/417 (the organizing-preset spec reads the real patch by id), `pnpm check:plugins` 42 packages 0 findings, `pnpm test:scripts` 362 passed. 3080 acceptance: post-deploy the mode selector shows `dsh-dev`/`dsh-learning`, a pre-rename dev session opens without `agent-preset/not-found`, and a new session defaults to 开发模式.
