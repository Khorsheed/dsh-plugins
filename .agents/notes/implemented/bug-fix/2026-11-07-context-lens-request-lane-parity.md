# Agent Note: Context Lens compares one canonical message view across capture lanes

Status: implemented

## Problem

A resumed writing session compared log-reconstructed request #122 with live-captured request #123 and reported three changes that never happened: an empty historical system message at wire position 084 disappeared, the system prompt broke at character 49, and a user message was replaced with a `-40 +202` edit. The actual log contained only an ordinary model/user tail append. The shared diff was not itself wrong: its two inputs did not describe the same message view. The log lane retained empty system nodes that the host projects to no message, discarded attachment names, and kept the system prompt as one block; the live lane omitted empty nodes, retained attachment names, and attributed the same prompt to multiple assemble sections. Prefix comparison then compared presentation rows rather than whole wire messages.

## Decision

- The log lane keeps empty system, developer, and assistant nodes on the surface so later replacements can resolve their seqs, but omits them when constructing model input, matching the host's derived-history contract. Materialized and bodiless requests share this filtered baseline.
- Log-read file and image blocks retain a nonempty attachment name as their display ref, exactly as request-captured blocks do. This is attachment-label parity, not a general message-projection replay.
- Prefix comparison and the change list consume the same rebuilt whole-message view. System sections are joined back into their wire message before the first content difference is located; assembly attribution remains presentation only.
- A one-for-one replacement whose wire position changed shows both indexes, so the old and new coordinates cannot be mistaken for one stable message identity.

## Alternatives considered

**Suppress the three displayed symptoms.** Filtering the 084 label, the 48-character break, or the exact character counts would hide this example while leaving every other mixed-lane comparison wrong.

**Compare display rows but special-case system sections.** That would fix only the false system break. Empty nodes and attachment labels would still produce false edits, and a second message reconstruction could drift again.

**Replay every host message projection in the log lane.** The observed image difference needs only the attachment's existing name, not a projection engine. A broader replay is a separate contract and is not introduced by this fix.

## Consequences

The #122 → #123 example reports only its genuine model/user tail append. Real prompt edits, replacements, pruning, and cache usage remain visible; the fix does not explain away or alter provider-reported cache misses. Requests rebuilt entirely from logs keep their existing system-section-free presentation, while cross-lane comparison now compares equivalent content.

## Testing

Regression coverage pins empty-node filtering with replacement addressability, log/request attachment serialization parity, identical whole versus sectioned system prompts, and a mixed log/live request whose only real change is its tail. The original session log is replayed read-only to check the reported coordinates and character delta are gone.
