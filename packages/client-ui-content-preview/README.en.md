# @khorsheed/dsh-client-ui-content-preview

English | [中文](README.md)

The file-content panel inside Local Files, Worktrees, and Session Artifacts. You never install it yourself: it is built into those three plugins, so installing any of them brings it along.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/content-preview-1.png" width="560" alt="the shared content pane as it appears inside the local-files plugin: rendered markdown, content search, and the preview/source toggle">

## What it is

A shared source library used only at build time (unpublished, `private: true`): all three plugins preview files with the same implementation, so a fix lands everywhere at once. It registers nothing and owns no browser bundle; each plugin imports its source directly and inlines it into its own `lib/client.js`.

It offers:

- `ContentPane`: the whole content panel — markdown, a JSON tree, CSV tables, code highlighting, images — with header actions, a preview/source toggle, and scroll memory.
- `buildSrcDoc` / `attachBridge`: the tiered HTML sandbox and its guarded outward capability bridge.
- `structuredPreview`, `useRenderedSearch`: structured previews, and content search that highlights matches right on the rendered document.

```ts
import { ContentPane, buildSrcDoc, attachBridge, structuredPreview, useRenderedSearch } from '@khorsheed/dsh-client-ui-content-preview/src/client/index.ts'
```

All strings come from the caller's own dictionary; the package owns no locale.

## Compatibility

Needs DSH 0.1.5-rc.1 or later; verified on 0.2.1-rc.1.

## For developers

- Capability details, the HTML sandbox and bridge, the contract surface, known limits, and the retirement path are in the [full reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/client-ui-content-preview/docs/reference.en.md).
- The list/detail layout `AdaptiveSplit` lives in `@khorsheed/dsh-client-ui-panel-kit`.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
