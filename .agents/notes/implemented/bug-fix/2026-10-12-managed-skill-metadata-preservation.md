# Agent Note: managed skill delivery preserves the frontmatter metadata block

Status: implemented

## Problem

Adopting a skill into capability-catalog's managed root (preset-scoped delivery) silently dropped every frontmatter `metadata:` key except `presetScope`. The file on disk was fine — adoption copies the bundle verbatim and edits only the `presetScope` line — but the delivery's in-memory projection (`candidateFor`) rebuilt `metadata` as `{ presetScope }` from scratch. A skill that declared `metadata.credentials` (weread-skills declaring `WEREAD_API_KEY`) lost its credential form in the detail modal the moment it was scoped: the catalog read the served definition, found no declaration, and fell back to listing the key as a read-only environment reference.

## Decision

`managedSkillFrom` parses the whole `metadata:` block with js-yaml (the repo's YAML convention — local-agent-dsh and eval carry it the same way, kept in the dist manifest via `dsh.runtimeDependencies`) and carries it on the managed record; `candidateFor` overlays the normalized `presetScope` onto that block instead of rebuilding it. Only the block's own lines are parsed: a malformed block degrades to no-metadata (the skill still delivers) rather than rejecting a file the line-based readers could still serve. `loadSkillDetail`'s managed fallback reads the same projection, so the credential form survives adoption through both read paths.

## Alternatives considered

**Line-based extraction of known keys.** Rejected: `credentials` is a nested list, and the block is open-ended (a plugin may add its own keys); a regex reader per key shape is a parser half-written.

**Full-frontmatter YAML parse for every field.** Rejected: the line readers accept files a strict YAML pass would reject, and a skill the host can still serve should not become undeliverable over one unparsable metadata value.

## Consequences

Scoped delivery no longer edits what a skill declares beyond the scope list itself; declared credentials, and any future metadata keys, ride through adoption unchanged. The cost is one runtime dependency (`js-yaml`). Tests pin the preservation, the malformed-block degrade, and the credential form surviving the managed detail read.
