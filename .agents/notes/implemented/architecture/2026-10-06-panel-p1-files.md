# Agent Note: panel spec P1 — compact file preview and file list; AdaptiveSplit moves to panel-kit

Status: implemented

## Problem

On a phone the file preview spent five rows before its body (the list's breadcrumb, a "back to files" row, file name plus four icons, the full path, a boxed preview/source switch, a search box), and wrapped markdown in a card labelled "markdown"; the file list had two header rows (breadcrumb and tree title) with six icons, and file names in the secondary grey. The master/detail layout `AdaptiveSplit` lived in the preview kernel `ui-content-preview`, though it is panel layout.

## Decision

- **AdaptiveSplit moves into ui-panel-kit** (styles, test and standalone example included), with no forwarder left in ui-content-preview; its only users, local-files and worktrees, change their import. The narrow test becomes `≤ 560` instead of `< 560`, matching `PANEL_COMPACT_MAX` and the CSS `max-width: 560px`. New `backInDetail`: when the detail has its own title bar, the split stops drawing a full-width back row and the detail draws the back control in its own bar via `useAdaptiveSplitBack()`; the split still moves focus to it.
- **ContentPane's title bar becomes `PanelHeader`.** Wide panes keep two rows: the title bar (back, file name + language tag, up to four icons) and the path row (path on the left, one underline tab row on the right). Compact panes (the enclosing `PanelRoot`'s width, else the pane's own, ≤ 560) spend two rows: the title bar (search and reload inline; the full path as the ⋯ menu's first, informational row, then copy, show in folder and IDE) and the tab row. The change/content, preview/source and HTML tier switches share one `UnderlineTabs` row; the script tier still goes through its confirm bar. With several IDEs, each IDE is a ⋯ menu row and the split button is gone. Compact search folds behind an icon, stays open while a query is set, and Escape clears before closing; structured documents drop their format-banner frame and take the full width.
- **The reading area reads the panel tokens.** `.structuredBody`'s markdown body now uses `var(--dsh-panel-text-reading, 14px)` / `var(--dsh-panel-reading-line-height, 1.65)`; touch-compact headings are 22/19/17. Mobile's `styles.ts` overrides `--dsw-font-markdown-base*` on `html[data-dsh-mobile]`, but `.structuredBody` redefined those properties locally and so pinned the preview back at 14px (one reason the phone preview read small). The local definition now reads the panel tokens, so mobile's touch values take effect and the two no longer fight; mobile's lines stay as they are (they still serve the chat).
- **File list (local-files).** The root becomes `PanelRoot` (the `dsh-panel` container replaces `file-workspace`). Wide: the title bar's title is the existing breadcrumb, with the four workspace actions on the right. Compact: one title bar whose title is a tappable breadcrumb (home folded into one `~` segment, ancestors secondary, the current folder bold, scrolling sideways and parked at its end when long; it replaced the folder-name + parent-note + up-arrow header after the user's 10-06 walkthrough); search inline; choose workspace, back to the original workspace, show in folder, refresh and show/hide hidden files in ⋯. The tree's own title strip is hidden (`FileTree headerless`) while its search row still opens; opening a file hands the only header row to the preview's title bar (with back). File names are always the primary tone at `--dsh-panel-text-body`; compact selection is the accent tint; touch rows are 44px.
- **worktrees** wraps its root in `PanelRoot`, so ContentPane picks compact chrome from the whole tab's width rather than its detail column's.
- New copy keys: preview kernel `action.more`, `detail.views` (added to all three consumers, zh and en); local-files `local.showHiddenFiles`, `local.hideHiddenFiles`. `action.chooseIDE`, `preview.htmlToggle` and `preview.htmlScriptStop` are no longer rendered but stay in the key list for now, so the three consumers need no change for them.

## Alternatives considered

- **Judge compact from ContentPane's own width only.** Rejected: in a wide desktop panel the detail column is often under 560, which would fold the path away on desktop too — a regression. With an enclosing `PanelRoot` the panel's width decides.
- **Fold search behind an icon on wide panes too.** Rejected: one more click on desktop hides an action deeper.
- **Keep the tree's expand/collapse-all in compact.** Not done: it is the tree's internal state and moving it into the title bar means lifting that state; on a phone search covers the need. Revisit if asked.

## Consequences

- Screenshot self-check (390 light and dark, desktop 960) is listed in the report, not committed.
- ContentPane changes look in all three consumers at once (file-preview's session-products page included); their tests now find the controls as tabs / ⋯ menu rows.
