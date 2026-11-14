# Agent Note: card and manuscript pages share their detail UI

Status: implemented

## Problem

Cards and manuscripts already shared low-level breadcrumb, Markdown and textarea primitives, but their headers and raw-markdown editing layouts were assembled independently. The manuscript page repeated its full title in the breadcrumb and heading, mixed primary actions with metadata, and left long source ledgers competing with the reading column. Unifying them by replacing the card's block editor would have risked drawings, fields and comments; leaving the duplication would keep visual fixes split across two pages.

## Decision

- `DetailHeader` owns the common breadcrumb, optional single title row, stable action area and metadata row for card drafts, card details, manuscript details and their loading states.
- `MarkdownEditor` owns the common uncontrolled raw-markdown textarea, save hint, optional explicit actions and optional live preview. Card source mode and manuscript split editing use it. The card's block editor, HTML renderer and genre sections remain separate by design.
- `DetailModeSeg` shares the view switch. Manuscripts offer read, source-only edit and split; read hides the editor without discarding the in-flight draft and marks it unsaved, while explicit cancel, save and load-latest finish or discard it. Returning to either edit mode restores the same words and base version.
- A manuscript's breadcrumb names the canvas and 成稿, while its full title appears once in the title row. 编辑 and 让 Agent 改 stay in the action area instead of wrapping among status metadata.
- Reading, conflict banners and the source ledger use consistent centered measures. The title and body use panel reading tokens. Narrow containers wrap actions and collapse split editing through the existing container query, not a separate mobile implementation.
- The canvas switcher portals its menu to `document.body` and computes viewport-fixed placement with edge flipping. A parent stacking context can no longer put the conversation over the menu. The dismissal hook accepts the portalled surface as a second inside root, so create-form clicks stay open while outside clicks and Escape still close it.
- Source ledgers with at most six entries remain open; longer ones use a native details disclosure and retain every entry. Manuscript cancel-button and Escape semantics remain distinct.

## Alternatives considered

- **Replace every editor with one component.** Rejected: card block editing, drawings, typed fields and manuscript version conflicts are domain capabilities, not duplicated chrome. The shared component covers their common raw-Markdown path only.
- **Merge cards and manuscripts into one data model.** Rejected: manuscripts have independent bodies, versions, exports and source ledgers. Shared presentation does not justify changing persistence.
- **Keep duplicate titles and metadata actions.** Rejected: they make the hierarchy unclear and cause unstable wrapping, especially in narrow panels.

## Consequences

- Visual changes affect the detail frame, not canvas data, bindings, tools or version guards.
- New client files are explicitly registered in `tsconfig.client.json`; optional props follow the repo's `exactOptionalPropertyTypes` convention.
- The canvas package build and all 37 test files pass, including title de-duplication, long-source disclosure and dirty-edit cancellation.
