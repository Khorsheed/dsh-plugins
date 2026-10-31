# Agent Note: publishing takes the user to the result

Status: implemented

## Problem

After the agent changed an element or published a version, the user had to find the result in the sidebar: open the tab, then pick the element or switch to Play. On 2026-10-27 the user asked for the panel to go there by itself.

That day saw three shapes, each tried before the one that stands:

- **The page inferred where to go.** It read turn reports, polled for new versions, noticed bindings, and kept dots on changed elements. This works with no agent cooperation, but it guesses, and it moved first: on 2026-10-27 it jumped to Play the moment v13 landed, while the agent was still finishing.
- **A separate `game_show` tool on top.** It added the agent's intent. Two minutes later the agent called it for the element grid, so two sources moved the panel. The same agent had also skipped the tool on an earlier publish.
- **A shared reveal kit** (`client-ui-reveal-kit`). It was written for library and video as well, but only the game consumed it.

The user chose a single source, the agent's publish, with the least code.

## Decision

- **`game_publish` is the only thing that moves the panel.** A passing publish (or a candidate) leaves a 「请用户看这里」 request in host memory: the latest `{ seq, target, note, at }` per project, returned on the page's `liveVersion` poll.
- **The agent may choose; otherwise the version decides.** `show` is one of `play`, `versions`, `elements`, `elements:<id or name>` or `design:<chapter>`, and `note` is a short phrase about what to look at. An unknown place falls back to the default, and the tool's answer says so. The default compares the version with the previous one. Code, assets or a first version open Play. Exactly one changed element opens that element's page. Several open the grid, with a note such as 「v13：改了阿努比斯、托特」. A candidate always opens Play, where it waits for the user's OK.
- **The page only carries requests out** (`src/client/reveal.ts`). It acts on each request once. A request found on a reload (older than 90 s) is history and is ignored. While a game runs or the panel was touched in the last 20 s, the request waits as a notice (去看看 / 不用了). A closed panel in a window under 820 px is left closed. Every decision leaves a `[game:reveal]` console line. The same poll refreshes the tab when the session's bound project changes, for example after a room member's `game_open`, but it never navigates on its own.
- **The element grid lists the newest change first**, ordered by each element file's last modification time.
- Removed: the page's own inference, the 改完自动跳转 switch, the dots on changed elements, `game_show`, and the shared kit.

## Alternatives considered

**The page decides (browser only).** It needs no model cooperation and is deterministic. It cannot know intent, though, and it moves at publish time even when the agent has more to do. The agent publishes when it considers the result ready, so tying the jump to the publish gives better timing.

**A separate `game_show` tool.** It gives the agent the same reach, but it is a step the agent can forget, and room members do not see the dsh persona that asks for it. Folding the choice into `game_publish` means every publish moves the panel, and the agent decides only where.

**A shared kit now.** With one consumer it was premature. When library or video adopts the same flow, extract what they actually share.

**Keep the dots.** They depended on turn reports, which room members' work does not produce, so they showed only part of the changes. Sorting the grid by recency shows what is new without a seen-or-not state.

## Consequences

- An end-of-turn auto-publish (a dsh turn ending without `game_publish`) does not move the panel, and neither does a commit the user makes from the panel.
- The page still polls every 6 s while visible, because the host cannot push (seam S17). The poll reads two small files and the in-memory request.
- Requests live in host memory, so a restart forgets them, which is right for "look at this now".
