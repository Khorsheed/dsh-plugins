# @khorsheed/dsh-client-ui-panel-kit

English | [中文](README.md)

The shared base that makes plugin panels work on both desktop and phone. You never install it yourself: Idea Canvas, Library, Reader, Studio, Game Development, Context Lens, Local Files, Worktrees, Session Artifacts and others already have it built in.

## What it is

A shared source library used only at build time (unpublished, `private: true`). The goal is for each plugin to write **one interface** that adapts to the panel width it gets — a narrowed desktop sidebar, a floating window, and a phone all run the same code. It registers nothing; plugins depend on it via `workspace:*`, import its source directly, and inline it into their own `lib/client.js`.

It offers:

- **Type-size variables**: `--dsh-panel-*`, always read with a desktop fallback; with `@khorsheed/dsh-mobile` installed they grow on touch screens, and plugins never depend on mobile.
- **`PanelRoot` / `usePanelCompact`**: declare the panel size container; `@container dsh-panel (max-width: 560px)` switches to the compact layout.
- **Everyday controls**: `PanelHeader` (actions that don't fit go into "…"), `UnderlineTabs`, `ChipRow`, `ListRow`, and the list/detail layout `AdaptiveSplit`.
- **`browserOnHost()`**: tells whether the page is open on the host machine itself, so actions that make no sense remotely can be hidden.

```ts
import { PanelRoot, PanelHeader, UnderlineTabs, ChipRow, ListRow, panelVar } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
```

Every visible string and accessible name comes from the caller; colors use only the host's `--dsw-alias-*` variables, so light and dark themes follow automatically.

## Compatibility

Needs DSH 0.1.5-rc.1 or later; verified on 0.2.1-rc.1.

## For developers

- Default values of the type-size variables and each component's behavior and props are in the [full reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/client-ui-panel-kit/docs/reference.en.md); the panel design rules are in [docs/panel-design.md](https://github.com/Khorsheed/dsh-plugins/blob/main/docs/panel-design.md).
- From the repo root, `node packages/client-ui-panel-kit/examples/adaptive-split/serve.mjs` serves a standalone preview of `AdaptiveSplit`.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
