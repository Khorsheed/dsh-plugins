# Agent Note: datasets — 核对并登记 from the organizing Turn, a review page that paints first, and the 添加题集 dialog as a form

Status: implemented

## Problem

T90 made a filed registration proposal wait behind a banner on the 题集 tab. After an organizing session filed one, the person had to switch tabs, find the banner and open the review. The review itself took five to six seconds to show anything on a 164-item repository. Two smaller faults sat around it. 「返回题集列表」 was a bare text link. In the 添加题集 dialog, 新仓库位置 was a line of prose with a link-styled 「恢复默认位置」, so it read as a sentence rather than a field. It and 新建实验 both sat at the Modal default of 380 px, too narrow for a form.

## Decision

### The entry: a card in the organizing Turn's tail

When a Turn's `datasets_propose_registration` call files a proposal (a non-`dryRun` call that answers `filed`), a card appears in that Turn's tail. The card sits beneath the closing prose and outside the tool group. It names the proposal and carries one action, 「核对并登记」. One click leaves the proposal id on a plugin-lifetime focus channel (`createReviewFocus`) and selects the same session's 题集 tab. The datasets view takes the request when it mounts, or immediately if it is already mounted, and opens that proposal's review directly. There is no list and no banner in between. A proposal that was already handled offers 「查看」 as an outline button instead.

- **Mechanism.** `src/client/review-turn.ts` holds a structural `uiConversation` Definition (`kind: 'datasets-proposed'`). It pairs each `tool/call` head with its append-surface `tool/result`, keeps only the results that `proposeCardOf` reads as `filed`, and publishes them as Turn data. `ReviewTurnTail` is an entry in ui-chat's `conversation.chat.turnTail` list. It reads that data, bounded by the Turn's end sequence, and renders one `ReviewCard` per proposal. This is the route ui-schedule's created-task card takes. The propose call's own row stays with ui-tool's generic tool view.
- **Registration.** The Definition and the entry both register inside the inject on `conversation.chat.turnTail`. ui-chat declares that slot and composes ui-conversation, so `uiConversation` is read (`ctx.get`) only once it can exist. Both are optional peers of this package and are never imported at runtime. Without them nothing registers, and the proposal waits behind the banner as in T90.
- **Tab switch.** The host has no public call that switches a conversation's tab: `openView` reaches only the frame and the tab header. The card therefore clicks the tab strip's `role="tab"` button labelled with the tab's own label, under `[data-conversation-tabs]`. This is a DOM anchor with a fallback. If no strip is found, or the tab is still unselected 150 ms later, the card says in one line where to click. The request is already on the channel, so that click opens the review.
- **The skill and the tool definition** close with 「点下面的按钮核对并登记」.

### The review page: compute at proposal time, paint the head first

Measured on the temporary 0.2.0-rc.2 instance, using a 164-item HumanEval repository with 658 dataset files:

| phase (per open, before) | time |
|---|---|
| protocol validate (≈500 git spawns) | 4.7–5.9 s |
| snapshot (tree + zone classes) | 75–98 ms |
| tip + dirty check | ~50 ms |
| version number and date | ~30 ms |
| mapping check | ~3 ms |
| source directory walk | 2–4 ms |
| **`proposalReview` total** | **4.9–6.1 s** |
| `reviewFiles` | 5.6 s (it ran validate too) |

Validate dominated, and its answer depends only on the commit. The proposal store now keeps commit-keyed facts: the validate verdict, the error count, the version number and the date. They live in memory and under `<proposals root>/cache/<commit>.json`, written atomically. `propose` runs the same check, so the cost moves to proposal time (about 5.3 s inside a tool call the agent is already waiting on). Every later open is a cache hit. A validate that could not run is reported but never cached. A new `proposalHead` call answers the page head and the four fact cards from the stored proposal and the cache, without the snapshot.

| after | time |
|---|---|
| `proposalHead` | 22 ms |
| `proposalReview` (cache hit) | 45–54 ms; 115 ms in a fresh process |
| `reviewFiles` | 46 ms |
| `reviewItem` | 80 ms (98 before) |
| `propose` | 5.3 s (the moved cost) |

In the browser, clicking 「核对并登记」 on a cached proposal produced the first review frame at 67 ms, the head at 124 ms and the full page at 190 ms. A cold restart with the cache file deleted produced the head at 0.9 s and the full page at 23.7 s. That is the fallback path: the first Remote calls in a newly booted process recompute validate, so it measures a lost cache, not the normal case.

The page renders in two steps. `ReviewSkeleton` lays out the loaded page's column: the back button, the title, and the four fact cards, filled from `proposalHead` as soon as it answers. Below them are bars in the comparison's two-column grid, the layer list and the name field, so nothing jumps when the full review lands.

### The back button

「返回题集列表」 is a primitives `Button` (`size="sm"`, `variant="ghost"`) with a left chevron icon. Ghost keeps it a secondary navigation affordance next to the page title, so it does not compete with the page's primary 确认登记. `IconChevronLeftOutlineMedium` is added to `src/client/icons.tsx` by hand, because the artwork generator is broken (see Consequences).

### The 添加题集 dialog

- **Width.** Both dialogs started at the primitives Modal default, `width: min(380px, 100%)`. Measured before the change, 添加题集 was 380×739 and 新建实验 was 380×482. The same width was not alignment: 380 is what made both read as cramped forms. Host form dialogs widen through `className` (FeedbackDialog `min(488px, 100%)`, OnboardingModal `min(600px, 100%)`, PresetGuideDialog `min(640px, 100%)`), so both dialogs now pass one: `.addDialog` in datasets and `.newDialog` in eval, each `width: min(560px, 100%)` with the doubled selector the host uses to override the Modal card geometry. Measured after: 添加题集 560×674 and 新建实验 560×464 at 1440. At a 390 viewport the 100% term wins and the dialog is 342 px wide, filling the screen as before. The form keeps the host form-dialog rhythm: a 12 px gap between rows, 12/18 secondary labels and the required mark at 11 px.
- **新仓库位置 is a field.** It has a label and a read-only, single-line path box (`role="textbox"`, `aria-readonly`) with 「更改…」 on its right. The path is split by `splitPathTail` into a head that ellipsizes and the last two segments, which stay visible. That makes it a middle ellipsis. The full path is the box's `title`, and `user-select: all` makes a click select the whole path for copying.
- **Buttons on the right of their boxes.** 「选择目录…」 (数据在哪) and 「更改…」 sit on the same row as their box, in the same 88 px column (at 1440 both span 888–976 px at 88×28). The path box grows from 236 px to 416 px, so a 47-character path shows whole at 1440 with no ellipsis; at 390 it is 198 px and the middle gives way.
- **「恢复默认」 is a link in the help line.** After a pick, the help line reads 「放在你选的目录下。 恢复默认」, where 「恢复默认」 is a text button in the primary label color with an underline. It no longer takes a third outline button and a row of its own next to the help text. The git note is shortened.
## Alternatives considered

**Keep the card on the tool row (`tool.call.toolview`).** This was the first implementation. On the live instance a finished Turn folds its tool calls into one collapsed 「已完成，用时 1 秒」 group. The card's flow item measured 0 px high, so the button was hidden exactly when the closing summary said 「点下面的按钮」. The turn tail is the host's sanctioned seat for Turn-level artifacts. Keeping both would show the card twice while a Turn runs, so the tool row returns to the generic view.

**Switch to the review automatically when the proposal is filed.** That would pull the person out of the conversation while they may still be reading the summary. In a session they are not looking at, it would also open a review they did not ask for. One click keeps the person in control.

**A public tab-switch API.** None exists on 0.2.0. Asking upstream for one is the right long-term fix, and the DOM anchor is the documented last resort until then. If the anchor breaks, the person needs one more click; the plugin does not crash.

**Speed up validate instead of caching it.** Validate's cost is roughly one git spawn per file. Batching it into `git cat-file --batch` would help every caller, but it would change the protocol checker's internals, which are out of scope. A commit's verdict also never changes, so caching it is both correct and much faster.

**Keep the 380 default because both dialogs share it (the first round).** The first round treated equal widths as aligned. The user's complaint was the 380 default itself, so both dialogs are widened together instead.

**「恢复默认」 as a second outline button beside 「更改…」.** It would sit neatly, but at 390 two 88 px buttons would leave the path box about 100 px. As a link in the help line it costs no width and still reads as clickable.

**A text input for the repository path.** An editable input invites typing a path that the picker flow does not validate. A read-only box with 「更改…」 keeps one way to change it.

## Consequences

- Clicking the card goes straight to the review. A cached proposal paints its first screen in about 0.1–0.2 s, against 5–6 s before. The cost now sits inside `datasets_propose_registration`, which the agent already waits on.
- The entry depends on three host surfaces: ui-chat's `conversation.chat.turnTail`, `uiConversation.events` and the tab strip's DOM. The first two degrade to "no card". The third degrades to one line telling the person where to click.
- The card's warning line now says what it counts: 「申请有 1 条提醒。」 ("The proposal has 1 warning(s)."). It counts the proposal's mapping warnings; the review's 校验 card counts validate warnings, which on the test repository is 2. The card names its source rather than adopting the validate number, because the card renders from the tool result and has no validate verdict to show.
- At 390 px the path box's tail can itself be truncated. The full path stays in `title` and in a copy.
- `scripts/sync-icon-artwork.mts --check` fails against every harness checkout at `IconQueueOutlineArtwork`, so the chevron icon was added by hand. The generator needs a fix before the next icon sync.
- Verification on a temporary instance used two test doubles. A stub model at a loopback port issued the agent's tool calls. The real `datasets_propose_registration` tool executed them, and the real Turn, Definition, card and review rendered the result. On `PATH`, a fake `osascript` stood in for the macOS folder chooser. One early headless click on 「更改…」 reached the real chooser before the fake was in place. No osascript process remained afterwards.
