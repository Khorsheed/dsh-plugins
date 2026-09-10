# Agent Note: TaskPilot detail view becomes a right-sidebar tab

Status: implemented

## Problem

TaskPilot's job detail view was a self-built right-side overlay (`shell.overlay` order 120) with its own store, document-mark push-layout math (`drawer-inset.ts`), and responsive fallback — a whole geometry stack the host 0.1.5 right sidebar now provides natively. The host-0.1.5 adaptation plan ([proposals/active/2026-09-10-host-015-adaptation.md](../../../proposals/active/2026-09-10-host-015-adaptation.md), batch three) assigns taskpilot the migration: composer pills stay put, the drawer moves into an official right-sidebar tab.

## Decision

The detail view is a page-type right-sidebar tab, following the official `ui-sidebar-files` two-stage shape:

- `src/client/definition.ts` registers the type into `ctx.sidebarRightTabs`: `id` = the package name (`@khorsheed/dsh-taskpilot`, also the keyed-seat key), `kind` = `taskpilot`, no `patterns` (a page claims no address), no `priority` (the default `extension` band is correct for a type shipped from outside the product), no `guide` entry — a job detail with no job selected is not a meaningful entry point, so the type stays off the guide page.
- The drawer body moves verbatim into `src/client/JobTab.tsx`, registered into the keyed `sidebar.right.pane.tab` seat under the type id; `src/client/JobTabTitle.tsx` registers into `sidebar.right.pane.tab.title` so the chip shows the selected job id.
- The selection travels as navigation params: the dock pill's detail entry calls `ctx.sidebarRight.openTab('taskpilot', { params: { jobId } })`; `SidebarRightTabParamsMap` is declaration-merged with `taskpilot: { jobId: string }` (the same idiom `ui-sidebar-documentpreview` uses for resource params). Pages deduplicate within a pane, so picking another job re-navigates the one tab — the body follows `useTabInfo().tab.navigation.params` and reloads on `navigation.revision`.
- The drawer stack is deleted, not kept: `drawer-store.ts` (no cross-surface state left — the tab record is the state), `drawer-inset.ts` (the sidebar owns width/fullscreen/docking), the document-mark effect, and the `dsh-client-store` dependency with it.
- `dsh.compat.minHost`/`verifiedHost` move to `0.1.5-rc.1`; READMEs steer older hosts to the `0.2.0` line. The type-only build consumes `@deepseek-ai/dsh-client-ui-sidebar-right@0.1.5-rc.1` (plus `@deepseek-ai/dsh-client-ui-dockkit` for its re-exported tab record types) as devDependencies, and a non-optional peerDependency on the sidebar-right package: the tab surface is the whole feature, so there is no degradation path worth shipping.

## Alternatives considered

- **Keep the overlay as a fallback for older hosts.** Rejected: dual-surface means two geometry stacks to keep honest, and the repo rule for host-line moves is a clean cut with a version-line pointer, not a runtime fork.
- **Register a guide entry so the tab is openable without a pill.** Rejected: the page is meaningless without a job selection; an empty detail page on the guide would read as broken. The guide contract (`guide?:`) explicitly allows staying off it.
- **Address-claiming viewer type (patterns + canOpen) instead of a page type.** Rejected: jobs have no `dsh-resource://` address space to claim; the detail view is a named page with params, exactly what `openTab` models.
- **Wait for the repo baseline to reach 0.1.5 before consuming the new types.** Rejected: the 0.1.5-rc.1 npm packages carry the full type surface, and ui-slots 0.1.2's slot machinery (hookContext, keyed seats) already matches what the 0.1.5 SlotMap rows need — the mixed type baseline compiles clean.

## Consequences

- The bundle sheds the drawer store, the push-layout math, and the store-engine inlining (`dsh-client-store` devDependency removed; `lib/client.js` shrinks accordingly).
- `pnpm-workspace.yaml` gained two `minimumReleaseAgeExclude` entries (`@deepseek-ai/dsh-client-ui-dockkit@0.1.5-rc.1`, `@deepseek-ai/dsh-client-ui-sidebar-right@0.1.5-rc.1`) — pnpm added them mechanically on install; flagged here because the file is mainline-owned baseline.
- The `drawer.*` locale keys keep their names (dictionary stability) with a comment recording that the prefix predates the migration.
- `openTab` aims at the mounted session; the dock pill lives in the mounted session's conversation, so the aim and the pill's session coincide by construction. A pill rendered for a non-mounted session would open the tab in the wrong session — accepted, since `conversation.input.dock` only renders for the active conversation.
- Verified by `pnpm --filter @khorsheed/dsh-taskpilot build` and `pnpm --filter @khorsheed/dsh-taskpilot test` (48 tests) with `DSH_HARNESS` pointing at the 0.1.5-rc.1 checkout; the drawer specs were replaced by `tests/job-tab.spec.tsx` (definition shape, trail folding, re-navigation reload, empty states). Live 3080 acceptance is a separate step through `pnpm deploy:3080`.
