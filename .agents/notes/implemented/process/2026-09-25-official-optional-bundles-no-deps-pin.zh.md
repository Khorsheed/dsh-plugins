# Agent Note: 官方 optional bundle 不钉进 prod profile 的依赖列表

Status: implemented

## 问题

宿主 installation 自带两个供用户开关的 bundle —— `packages/boot/app-boot/src/profile.ts`
里的 `OPTIONAL_BUNDLES`(`@deepseek-ai/dsh-experimental-agent-team-profile` 和
`@deepseek-ai/dsh-experimental-voice-input-bundle`)，都是 `apps/cli` installation
的运行时依赖。Web 插件页按 `optional && !installed` 分组：optional bundle 只有在
profile 的 `dependencies` **没有**点名它时才出现在顶部「官方」区；一旦被钉进
依赖，卡片就掉进已安装列表。

0.1.7-rc.1 升线时，prod profile 里两个 agent-team 包都还是 0.1.5 时代的依赖钉。
上游删掉了 `dsh-experimental-agent-team-web-profile`（并入 `-profile`，一个 bundle
同时开工具和 Web UI)，那枚钉必须移除；而把 `-profile` 重钉到 `0.1.7-rc.1` 虽然
保住了插件运行，却悄悄把它的卡片移出了官方区，还会给以后每次宿主升线添一步
重钉杂务，钉的版本一落后就吃版本兼容拒绝。

## 决定

官方 optional bundle 只写进 prod profile 的 `dsh.profile.bundles` 名单 —— 永远
不进 `dependencies`。组合与清单都从 install anchor 解析它们
(`apps/cli/package.json` 以 `workspace:*` 携带），运行副本因此永远和宿主检出
精确一致。2026-09-25 已在 3080 `web` profile 执行：移除 `0.1.7-rc.1` 依赖钉
(deps 31 → 30),`pnpm install` 剪掉 profile 本地副本，`--dump-config` 探针
确认三行（`agent-team`、`tool-agent-team`、`ui-agent-team`）从 anchor 组入，
watchdog 重启 canary 在宿主 HEAD `46a7f68b09` 记下部署证明 `ec8c9087aee44da6`。

## 曾考虑的替代方案

- **每次宿主升线都重钉**(0.1.7-rc.1 升线最初的做法）：功能上可行，但会把
  bundle 锁死在所钉版本，多一步手工操作，清单漏一项就变成版本兼容拒绝，
  还会让卡片丢掉官方区的位置。
- **连名单也去掉、让用户按 profile 自行开启**:prod profile 是刻意默认开启
  智能体团队的，这个决定早于本 note 且不变 —— 这次只改了解析来源。

## 影响

- 宿主升线对这两个 bundle 不再需要重钉步骤；升线清单里如有该项应删掉。
- 智能体团队卡片保留「官方」标，版本自动跟宿主检出走。
- 若上游再删某个 optional bundle（如 `agent-team-web-profile` 之例）,`bundles`
  名单和依赖列表都要同步移除 —— 光留名单仍要求包可解析。
- profile `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 里指名旧
  `0.1.5-rc.1` agent-team 钉的条目是 npm 钉时代的惰性残留；不再有任何东西从
  registry 解析这些版本后，它们什么也不闸。
