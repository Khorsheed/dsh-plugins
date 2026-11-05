# Agent Note: Inline cards keep CSP in the head and show their mounting state

Status: implemented

## Problem

A card fragment that begins with the skill's recommended CSP meta rendered correctly but Chromium reported that a CSP delivered outside the document head was ignored. The fragment wrapper placed the authored meta in the body while its own injected policy in the head continued to protect the frame. Separately, React rebuilding a settled markdown block replaced the card iframe with no intermediate UI, leaving an empty region until the new document loaded.

## Decision

`buildCardSrcDoc` extracts authored CSP meta tags before wrapping or annotating the source and places them in the final document head. It retains authored policies, including multiple policies, and adds the strict card policy only when none was authored. The transformation remains string-based so parsing an untrusted card cannot preload subresources in the host document.

The conversation renderer mounts each frame in an owned container with a parent-side loading state. The state appears immediately, and the frame becomes visible only when the injected bridge in the loaded srcdoc posts `ready`. A ten-second stall changes the state to an error with a retry action. Retrying reloads the same generated srcdoc. Disposal and orphan reconciliation remove the whole container, timer, and listeners.

## Alternatives considered

- **Leave the authored CSP meta in place.** Rejected: browser enforcement requires a meta policy in the head, and the ignored duplicate will keep producing a warning even when the injected policy already protects the frame.
- **Parse the card with the parent's DOMParser.** Rejected: an inert parsed document can still initiate subresource loads. The builder must not give untrusted HTML a host-side network path in order to fix metadata placement.
- **Use the iframe's load event as readiness.** Rejected in Chromium acceptance: the initial about:blank also fires load and cannot be distinguished reliably from the opaque-origin srcdoc load in the parent. The explicit in-document `ready` message names the real boundary; the timer is only a stalled-render fallback.
- **Hide the blank interval with a fixed delay.** Rejected: there is no reliable delay for small inline documents and larger scripted cards.
- **Inject loading markup into the card document.** Rejected: an inline script can run before the frame's first paint, so an in-document indicator does not cover the blank interval. Parent-side UI also stays independent of authored styles and scripts.

## Consequences

- Skill-compliant fragment cards no longer emit the outside-head CSP warning, and custom CSP documents retain their policy semantics.
- A remount shows an explicit loading state instead of blank space. A stalled frame now offers retry rather than leaving an unexplained empty region.
- The fallback does not preserve card state across React remounts; that existing limitation remains.
- The container, rather than the bare iframe, is the renderer-owned sibling paired with the processed code block.

## Testing

The srcdoc suite pins head-only CSP placement for fragments and full documents without dropping authored content. Renderer tests pin the ignored initial load, explicit readiness, timeout, retry, and disposal. Chromium acceptance with the original session fragment verified no outside-head CSP warning or page error, working chapter/list interaction, a 729px reported height, one owned container across remounts, and successful retry after a real ten-second stall.
