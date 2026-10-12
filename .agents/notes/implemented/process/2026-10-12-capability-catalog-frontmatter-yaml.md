# Agent Note: capability-catalog frontmatter — one real-YAML parse

Status: implemented

## Problem

Every SKILL.md frontmatter reader in `@khorsheed/dsh-capability-catalog` derived its own answer from line-based regexes. `scoped-delivery.ts` carried four (a split regex, `parsePresetScopeFrontmatter`, `parseMetadataFrontmatter`, and the `frontmatterFlag`/`frontmatterScalar` pair) and `import.ts` two more (its own split regex — not even CRLF-tolerant — plus line scans for name/description and `disable-model-invocation`). The scans matched at any indentation, so a `name:` nested under `metadata:` could shadow the real one and a `presetScope` nested under an unrelated key still declared a scope; the flag reader accepted only `true`/`false` where the host's skill loader (`skill-filesystem`, `frontmatterBoolean`) takes `1/0/yes/no/on/off` too; and folded multi-line descriptions read as the literal `>`.

## Decision

`src/frontmatter.ts` owns the single parse: `splitFrontmatter` (one CRLF-tolerant splitter, shared with the two deliberate TEXT-editing paths — `withPresetScope` and `finalizeSkillText` edit lines, they do not parse) and `parseSkillFrontmatter`, which runs the block through js-yaml once (js-yaml is the repo's YAML convention and already a shipped runtime dependency) and returns a typed `SkillFrontmatter` — name, description, whenToUse, the two invocation booleans, presetScope, the verbatim metadata map, and the body. `managedSkillFrom`, `resolveSkillNameFromContent`, and `inferModelInvocable` derive from it; the four line-based readers and both regexes are gone, and `parsePresetScopeFrontmatter` left the package-root export surface.

Scalar semantics mirror the host loader: `frontmatterBoolean` accepts booleans, `1`/`0` (number or string), and `yes/no/on/off` case-insensitively — js-yaml 4 leaves those as strings (the YAML 1.1 bool set is a js-yaml 3 behavior; verified empirically), so the string branch carries them — and string fields must be non-empty strings. One deliberate divergence from the host: an out-of-variant flag reads as ABSENT (the default applies) instead of rejecting the whole file, because the catalog is a management/delivery surface, not the loader of record.

The pinned degradation survives the whole-block parse: a malformed `metadata:` value usually poisons the entire YAML parse, so on a parse failure the block is retried once with the top-level `metadata:` section stripped — the skill still delivers, minus metadata. Only a top-level strip is attempted; a block that is unusable YAML for any other reason rejects the file.

`presetScope` reads at exactly two positions now: the canonical `metadata.presetScope` (what the writer writes and `candidateFor` overlays; it wins when both exist) and a legacy top-level `presetScope` (hand-edited files may still carry it). A `presetScope` nested under any other key no longer declares a scope — the any-indent leniency was an accident of line scanning, not a form any real file uses.

## Alternatives considered

**Parse the metadata block separately (the old containment shape).** Rejected: two parses where one answers; the strip-and-retry rescue keeps the pinned degradation for the one failure mode that produced it (a top-level malformed metadata value) without a permanent second parser.

**Keep accepting a `presetScope` at any nesting depth.** Rejected: no writer produces it, no spec named it, and "a scope key under an unrelated key counts" is precisely the class of accident the migration exists to remove. Tightening recorded here as the one deliberate semantic narrowing.

**Throw on an out-of-variant flag, like the host.** Rejected for this surface: the host loader can warn-and-ignore a file it scans; the catalog dropping a managed skill would silently undeliver it. An invalid flag degrades to the default and the skill stays visible and editable.

**Round-trip the frontmatter through YAML in the write paths too.** Rejected: `withPresetScope`/`finalizeSkillText` edit one key while preserving comments, quoting, and key order — a re-serialization would rewrite the whole block for no reader's benefit.

## Consequences

Behavior changes, each pinned fail-first (the spec was watched red against the line-based code, then went green on migration): invocation flags accept the host's full variant set; quoted names, CRLF blocks, and folded descriptions parse; scalars read top-level only; `presetScope` reads at two positions only. Tests went 262 → 284 (a new `frontmatter.spec.ts` owns the module's contract; the `parsePresetScopeFrontmatter` describe moved there re-pointed at `parseSkillFrontmatter`). The exported-surface loss (`parsePresetScopeFrontmatter`, and `isKebabId`/`splitFrontmatter` moving to `./frontmatter.ts` inside the package) had no in-repo consumers. Real YAML parsing is strictly stricter about garbage in the block — a file whose frontmatter is not a mapping no longer yields a line-scanned identity — which matches the host loader's posture.
