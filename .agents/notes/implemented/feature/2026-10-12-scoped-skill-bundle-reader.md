# Agent Note: a scoped read-only reader for managed skill bundle files

Status: implemented

## Problem

A skill's SKILL.md is the entry point; its interface details live in bundle files (weread-skills splits its API docs across `search.md` / `notes.md` / …). The host's `skill` tool returns the SKILL.md content plus a `resourceBase` directory, and the model reads the bundle with fs tools. A mode on a deliberate no-fs diet — see [learning mode's whitelisted skill face](2026-10-12-learning-mode-whitelisted-skills.md) — therefore receives the entry point but can never reach the reference material.

## Decision

The scoped delivery registers a read-only `read_skill_file` tool into each preset layer it serves, alongside the skill provider. The reader answers only for skills that delivery serves the caller's preset (its scoped set plus the unscoped managed set every preset sees through the global layer), lists the bundle when `path` is omitted, and reads one bundle-relative file otherwise: absolute paths, drive letters and `..` are rejected before the filesystem is touched, the resolved path must stay inside the bundle directory through symlinks, and served text caps at 100k characters. A no-fs mode gains exactly the delivered skills' files — nothing else on disk becomes reachable. The `skill` tool's post-execute hint names the reader and lists the bundle files, only when the caller's own scope carries the tool.

## Alternatives considered

**Mount a read-only fs tool in the no-fs preset.** Rejected: any fs reader widens the surface from "the delivered skills' bundles" to "the workspace", which is exactly what the diet excludes.

**Inline bundle files into the served skill content.** Rejected: the split exists for context economy; folding reference material into every load inflates every skill load in every mode.

**An upstream bundle-read verb** (the `skill` tool or the registry serves bundle files natively). The correct long-term home — filed as [an upstream proposal](../../../docs/upstream-proposals/2026-10-12-skill-bundle-file-read.md); the scoped reader retires when the host ships it.

## Consequences

No-fs presets can use document-split skills end to end, and the delivery's security posture is unchanged (the reader widens nothing beyond what the delivery already serves). The reader is a second registration on the scope the reconcile already owns and is disposed with it; a composition without the tools service keeps the skill delivery and drops only the reader. The upstream proposal is the intended retirement path.
