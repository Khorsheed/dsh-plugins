# Agent Note: the skill detail modal's metadata block

Status: implemented

## Problem

The skill detail modal printed the skill's frontmatter metadata as raw JSON
whenever it held any key the modal did not render elsewhere. The exemption list
was a single key:

```ts
return Object.keys(parsed).some(key => key !== 'presetScope')
```

Its own comment states the principle — repeating something already rendered is
noise — but `credentials` was not in it. Declaring `metadata.credentials` (the
only way to make the credential form appear at all) therefore grew a second,
raw-JSON copy of the same declaration. For a skill whose metadata exists solely
for that purpose, the block is pure duplication.

Two smaller defects came with it:

- the block was rendered last, immediately below the source browser, where a
  monospace JSON dump reads as part of the source pane rather than as a
  description of the skill;
- it printed values verbatim. Today nothing secret lives there (credential values
  are stored in the credential service, never in the file), so this is not a leak
  — but the panel's own rule elsewhere is that a value the user configured is not
  re-displayed, and a plainly formatted dump is the wrong place to notice the day
  that changes.

## Decision

`hasUnrenderedMetadata` now exempts a named set of keys that have a dedicated
surface — `presetScope` (the scope editor) and `credentials` (the credential
form) — via `RENDERED_METADATA_KEYS`, so the rule is one readable place rather
than an inline comparison.

The block is titled **frontmatter metadata** and moved above the credential form:
it describes the skill, so it belongs with the skill's other attributes, not
against the code pane. Both functions are exported and unit-tested
(`tests/skill-detail-metadata.client.spec.ts`) — the old predicate had no direct
coverage, which is how `credentials` was missed.

`formatMetadata` now redacts values whose KEY matches `key|token|secret|password`
(case-insensitive, recursively, arrays included) to `···`. Matching on the key is
deliberate: a value-shaped heuristic would redact ordinary prose and every long
string in a routing description. The key and its shape still print, so the block
still tells a reader what the frontmatter declares.

## Alternatives considered

**Hide the block whenever every key is exempt (already the behaviour) and do
nothing else.** That leaves the two defects that are not the duplicate: the
placement and the verbatim dump. The placement is what a reader notices first.

**Drop the block entirely and render only keys with a dedicated form.** The block
is the escape hatch for metadata no UI knows about (a plugin's own convention), and
the panel is supposed to be a catalog of what is registered. Keep it, narrow it.

**Redact by value shape (`sk-…`, long high-entropy strings).** Rejected: false
positives on ordinary text, and it would silently mangle exactly the prose a
reader came to read.

**Render the metadata as a table of key/value rows instead of JSON.** Prettier,
but it invents a shape for values that are objects or arrays, and the block exists
for keys nothing else understands — showing them as stored is the point.

## Consequences

- A skill declaring only `credentials` (or only `presetScope`) no longer grows a
  metadata block; a skill with any other key still does.
- The secret-shaped redaction is a display guard, not a policy: values are not
  touched on disk, and the credential flow is unchanged.
- `hasUnrenderedMetadata`, `redactMetadataSecrets` and `formatMetadata` are now
  exported and covered; a future metadata key with its own UI is one entry in
  `RENDERED_METADATA_KEYS`.

## Related

- [the capability catalog's mode view](../feature/2026-09-20-capability-catalog-mode-view.md)
  — the surface this modal belongs to.
