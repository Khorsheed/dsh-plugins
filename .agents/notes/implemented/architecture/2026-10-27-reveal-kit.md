# Agent Note: a shared reveal kit, and the agent's request to show the user something

Status: implemented

## Problem

The game panel had learned to go to what changed (see [the game panel goes to what changed](../feature/2026-10-27-game-autonav.md)): it polled for new versions, kept busy rules, and showed notices. The library plugin had built its own poll to reveal a session's write, and the video studio would need the same. Every panel was reinventing one behavior.

Both versions also guessed. The panel inferred from versions and turn reports what the user should see, while the agent, which knows ("look at the temple door", "compare v5 and v6"), had no way to say it. The host offers no agent-facing UI tool and no server push to the page, so a plugin cannot do it alone without an agreed shape.

## Decision

- **`@khorsheed/dsh-client-ui-reveal-kit`** is a source-plane library, shaped like the panel kit (inlined into each consumer's client bundle, registered nowhere). It provides:
  - `RevealController<T>`: the busy rules (a hold such as a game or video running, a touch in the last 20 s, leaving the item on screen, a closed panel in a window under 820 px), a per-viewer switch, the notice, agent requests acted on once per sequence number (the first seen on a page only when fresh), and a console trace of every decision (`[reveal:<name>] …`).
  - `visiblePoll`: runs while the page is visible and can be nudged by session events.
  - `RevealNoticeBar`: the notice at the top of the panel.

  The checker lists the kit with the panel kit as a sanctioned source-plane edge.
- **The host half is a convention, not shared code.** A plugin's host build compiles only its own `src/`, so each plugin registers its own prefixed tool (`game_show`, later `library_show` and the like), keeps the latest `{ seq, target, note, at }` per project in memory, and returns it on the Remote the page already polls. The kit's README spells this out.
- **Game is the first adopter.** `AutoNav` keeps the game's own decisions (where a turn's result is, the dots, version and binding announcements) and delegates rules, switch, notice and traces to the kit. `game_show({ view, element?, chapter?, note })` validates the place and records the request. `liveVersion` carries it, and the page acts on it before announcing a version, so the agent's choice wins over the automatic jump. The skill, the mode guidance and the persona say: change → `game_publish` → `game_show` → report or ask.
- **Upstream.** Seam S17 (plugin events cannot reach the client) gains this consumer. With a plugin event channel, `visiblePoll` gives way to a push and the tools stay the same.

## Alternatives considered

**One generic tool (`sidebar_show(panel, target)`) owned by a hub plugin.** Every panel's places differ (elements and chapters, books and stations, edits and clips), and a hub would make each plugin depend on another at runtime. Per-plugin tools install and uninstall with their plugin.

**Share the host half as code too.** The plugins' host builds reject sources outside their own `src/`, and the half is about a dozen lines.

**Let the tool force the jump.** A user playing a game, or typing a field, would lose their place. The request is a strong hint that still respects the busy rules.

## Consequences

- Library and video studio can move to the kit; their owners decide when.
- Requests live in host memory: a restart forgets them, which is right for "look at this now".
- Each viewer's console now explains every jump and non-jump.
