# Agent Note: the game panel goes to what changed

Status: implemented

## Problem

After the agent changed an element or published a version, the user had to find the result in the sidebar: open the tab, pick the element, or switch to Play. The user asked for the panel to go there by itself, and to mark what changed. An automatic jump can also take the panel away from someone playing or editing, so it needed rules.

## Decision

- **Where.** `offerFor(report)` decides from a finished turn's report. A failed check or an unchanged turn goes nowhere. A version that came with code or parameter changes goes to Play, and so does a version with nothing else. One changed element opens its page, where 「去试玩 vN」 is offered when the turn also cut a version. Several elements open the grid. A design-only turn opens its chapter. A version the agent publishes mid-turn (`game_publish`) is caught by a throttled `state` read on session activity and announced as it lands. Its turn end does not announce it again, and a version the user published is never announced.
- **When not.** No jump happens while a game runs in Play, within 20 s of any touch in the panel, while another element's page is open, or when the per-viewer switch 「改完自动跳转」 (in the ⋯ menu, on by default) is off. In those cases the panel shows a notice instead, with 去看看 / 不用了. A closed panel is opened only in a window at least 1100 px wide, because on narrower screens it would cover the conversation, and the turn card's 查看 remains. Reports older than two minutes count as history (a reload) and are ignored.
- **Dots.** Elements a turn changed get a dot on their card until their page has been open once, whether it was opened by hand or by a jump. The dots live per viewer in this browser.
- **Segmented controls.** The segmented controls (views, material, pen and recolor) became one framed group with hairlines between segments and a filled, accent-colored chosen segment. The old styles assumed two segments, so the third view button floated loose and the chosen state showed only as a border. 正面 / 侧面 / 背面 show the chosen side until the turntable is dragged by hand. The clip chips mark the clip that plays on its own.

## Alternatives considered

**Jump on every file the agent writes.** The panel would flicker through a turn. Turn ends and publishes are the moments a result exists.

**Always open a closed sidebar.** On a phone or a narrow window it would cover the conversation the user is reading.

**Keep the dots on the server.** Seen-or-not is a viewer's own state. Several viewers of one project would clear each other's dots.

## Consequences

- The mid-turn watcher reads `state` at most every 4 s per active session, so a busy turn costs a few extra reads.
- A user who never wants jumps turns the switch off, and changes still appear as notices.
