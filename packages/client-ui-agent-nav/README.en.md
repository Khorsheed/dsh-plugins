# @khorsheed/dsh-client-ui-agent-nav

English | [中文](README.md)

Lets every mode plugin take you to what the model just wrote, the same way. You don't install it yourself: canvas, the novel genre and other plugins already have it built in.

## What it is

A build-time shared source library (not published, `private: true`). It registers nothing; plugins depend on it with `workspace:*`, import its source directly, and inline it into their own `lib/client.js`.

It provides:

- **The destination line**: a write tool ends its answer with one `⟦dsh-nav⟧{…}` line naming the panel and place its result lives in (say "canvas · chapters · chapter 3 · on its plan"). `readDestinations` reads it; `stripDestinations` hides it on cards.
- **The one follow rule** `decideFollow`: the sidebar moves by itself only when you are on that session, watched the call land, have not touched a panel in 20 seconds, the window is wide enough, and nothing moved it earlier in the turn; otherwise it shows a dot and the card waits for your click.
- **The follower** `startNavFollower`: watches the on-screen session's live events and opens or marks by that rule, logging one `[nav] dest=… decision=… reason=…` line per decision.
- **`interactionHandlers`**: spread onto a panel root so "you are working here" reaches the follower.

```ts
import { followerHostOf, startNavFollower, interactionHandlers } from '@khorsheed/dsh-client-ui-agent-nav/src/client/index.ts'
```

## Compatibility

Needs DSH 0.2.0-rc.1 or later; verified on 0.2.1-rc.3. On a host without the right sidebar's `mounted` or the session event window, the follower does not start and plugins keep only their conversation cards.

## For developers

The contract lives in [docs/agent-nav.md](https://github.com/Khorsheed/dsh-plugins/blob/main/docs/agent-nav.md).
