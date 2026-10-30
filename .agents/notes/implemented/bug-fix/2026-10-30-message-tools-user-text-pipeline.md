# Agent Note: the shadowed user bubble renders through the official user-text pipeline

Status: implemented

## Problem

message-tools shadows the host's `user` / `steering` chat nodes to add copy, edit and withdraw. Its bubble printed the text through a local projection: session mentions plus `/name` and `@name` tokens. It never called the host's `conversation.user.text` factory, so no registered user-text rule took effect in any session. Quote's after-send card was one of them: a sent quote showed as raw `> …` lines everywhere. The host reported no error, because the pipeline was simply never entered.

## Decision

- **Render the bubble text through `renderFactorySlot('conversation.user.text', …)`** whenever the host declares the factory. The facts are the ones the host's own bubble passes: `sessionLabels` from the node's `referenceLabels`, and `skillNames` from the node, with `interactive: true`. Every rule renders as it would unshadowed: skill, file, session and goal chips, quote cards.
- **Probe through the factory's keyed child seat** (`ctx.slots.spec('conversation.user.text.node')`), per render. A factory has no spec of its own, so probing the factory name would always miss.
- **Fallback**: a host without the factory keeps the old local projection.

## Alternatives considered

**Drop the shadow's text rendering and keep only its action row.** Rejected: the shadow owns the whole node (fold, edited badge, restored rows); splitting text from chrome needs a host seam that does not exist.

## Consequences

- Text recalled to the composer by withdraw or edit is still plain text. A recalled quote shows as its `> ` block in the draft rather than as a chip, but it renders as a card again once sent.
