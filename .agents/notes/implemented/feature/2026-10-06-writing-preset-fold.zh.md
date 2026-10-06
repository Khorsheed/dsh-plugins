# Agent Note：写作预设合一——bundle-writing 并入写作模式，小说工具由画布绑定决定

Status: implemented

接续[卡片页整理](2026-10-06-canvas-card-page-tidy.zh.md)。

## Problem

用户在正式环境 3080 试小说体裁，新卡全落成提议（「幽灵卡」）。原因是会话用的是 `@khorsheed/dsh-presets` 的写作模式（`preset-dsh-writing`），只挂了 `canvas/agent`：模型用 `canvas_write` 写卡，而它写的是提议。能直接落正式卡的小说工具（`novel_write`）只在 `@khorsheed/dsh-bundle-writing` 的「写作」预设里。部署那个包之后出现两个写作预设并排，用户要求合成一个，小说工具按画布是不是长篇小说来决定。

## Decision

- **一个预设。** `preset-dsh-writing` 在 `canvas-agent` 旁边挂上 `@khorsheed/dsh-canvas-novel/agent`。描述和人设写明：绑定长篇小说画布的会话另有 `novel_*`，卡片走 `novel_write`，直接落成正式卡。
- **开关在绑定，不在预设。** canvas-novel 的 `./agent` 本来就只给绑定了小说画布的会话授予 `novel_read/write/extract`。没绑定的写作模式会话只看到画布工具，合并对非小说写作没有代价。
- **体裁可以接管卡片写入。** `CanvasGenreDefinition.agentCardTool`（小说：`novel_write`）。在该体裁的画布上，`canvas_write op=card` 拒绝并点名该工具，画布自己的提议不会再变成小说账本读不到的幽灵卡。画布技能和小说指针句也写了同一条。
- **bundle-writing 退役。** 它从没发布过，所以直接删包，并登记进 `scripts/retired-packages.ts`；正式环境还带着它时 `deploy:3080` 会提醒。canvas-novel 的 patch 注释和 README 改为推荐写作模式授予；presets 在 `dsh.references` 里声明 canvas-novel（行里只是把它当数据提到）。

## Alternatives considered

- **两个预设都留，改名区分。** 用户否了：写小说本来也要画布工具，第二个预设只是菜单里多一个重复项。
- **让小说画布上的 `canvas_write op=card` 直接落正式卡。** 不采纳：小说账本（故事日志、关系、章节整理）靠 `novel_write` 喂，转过去保持只有一条写入路径。

## Consequences

- 用户正式画布上已有的 53 张提议卡仍是提议；收不收是另一个问题（已提出「全部收下」批量按钮）。
- 正式环境的 profile 要去掉 `@khorsheed/dsh-bundle-writing`，否则旧的「写作」预设还会再挂一份 canvas-novel/agent。
- 测试：画布 `tools.spec`（小说画布上拒绝）、canvas-novel `agent.spec` / `patch.spec`、presets `presets.spec`（新行）。
