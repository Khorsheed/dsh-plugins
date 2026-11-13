# Agent Note: Remove duplicated agent-facing install guides from READMEs

Status: implemented

English | [中文](2026-11-13-remove-agent-install-guides.zh.md)

## Problem

Eight suite README pairs and the root README pair carried a second, agent-facing installation guide. These sections repeated installation instructions owned by the ordinary user sections and the collection data, with version-specific details that were easy to stale. The maintainer no longer wants README to serve as an agent-facing install manual. Deleting only the headings would leave the duplicated instructions and the collection generator would recreate some of them.

## Decision

Remove the complete agent-guide sections from the basic, dev-suite, bundle-local-agent, eval-suite, gamedev-suite, learning-suite, video-suite and writing-suite README pairs, and remove the root pair's collapsed install-and-development guide. Ordinary installation, uninstall, feature, compatibility and collection instructions remain. `docs/readme-style.md` no longer requires a trailing agent guide.

The collection generator now treats a mode suite's marked command block as optional: it does not recreate a deleted block, but still validates one that remains. The root README's collection block stays required. A focused fixture proves that regeneration leaves an absent suite block absent and still rejects a missing root block.

The earlier catalog decision remains as the record of why the collapsed guides were introduced; this decision supersedes only that presentation choice, not the catalog or user-facing installation model.

## Alternatives considered

**Keep the guides collapsed.** Rejected: hiding duplicated instructions does not remove their maintenance cost or the maintainer's unwanted second audience.

**Remove only the Chinese sections.** Rejected: the English and Chinese documents must remain paired. Both are removed in each affected README.

**Leave the generator unchanged.** Rejected: it would require and recreate the deleted mode-suite command blocks. Optional suite blocks preserve the new documentation structure without weakening validation of the root collection.

## Consequences

READMEs stay focused on what users do and what each plugin provides. Agent-facing operational knowledge remains in the repository's contributor documentation and Agent Notes rather than a second README installation manual. No plugin runtime, installation, composition or compatibility behavior changes.

## Testing

The collection-generator fixture covers optional absence and required root presence. The full script suite, collection consistency check, bilingual-pair verification, repository hygiene and the affected suite build/test runs gate this change.

## Related

- [Public README catalog layer](../process/2026-09-27-public-readme-catalog-layer.md)
