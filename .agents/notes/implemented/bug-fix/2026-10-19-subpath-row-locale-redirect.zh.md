# Agent Note: 子路径行把 locale 重定向到包根

Status: implemented

## Problem

伴生行折叠(`./tool`、`./agent`)之后,宿主设置清单页把这些行显示成裸模块名(`local-agent-kimi/tool`),而包根行显示本地化标题(文件交付工具)。宿主的 `readPluginMeta` 按 `${specifier}/locale/en.json` 经包的 exports 表解析,且子路径 specifier 不享受 package.json 回退(宿主树 `packages/boot/app-boot/src/package-meta.ts:175-181`),于是子路径行读不到 locale,卡片回退成 specifier 文本。

## Decision

凡行挂载具名子路径导出的包,都加一条 exports 重定向——`"./tool/locale/*.json": "./locale/*.json"`(或 `./agent`)——让宿主的解析落到包根 locale 词典;共十四个包:datasets、eval、library、local-agent-kimi/-codex/-claude-code、mission、room、typesafe、video-studio、worktrees(`./tool` 行),canvas、canvas-novel、game(`./agent` 行)。该约定已钉进 AGENTS.md 的 display-metadata 条款。同一批改动里,四个 local-agent provider 的设置配置卡标题(client `locales.ts`)对齐了插件管理器卡标题(Kimi 委派 / Codex 委派 / Claude 委派 / DSH 委派)。`docs/upstream-proposals/2026-10-19-subpath-specifier-meta-fallback.md`(gitignore 的工作文档)已向上游建议:子路径 specifier 在自身 locale 缺失时回退包根 locale;上游落地后重定向可以退役,留着也无害。

## Alternatives considered

**每个子路径各写一份 locale、各自起标题。** 否决:每行复制一遍词典,用户价值为零——行就是包的工具面,就该挂包的名字。

**把行 id 或模块名改好看。** 否决:id 是承重的身份(组合状态、用户层覆盖、parity spec),美观不值得动它们。

**等宿主修。** 否决:我们不分叉宿主,提案没有落地日期;重定向在今天的宿主线上就能用。

## Consequences

- exports 表每个子路径行多一个惰性 key;运行时加载不受影响(逐包解析探针确认 en/zh 落到包根词典,且 `./tool`/`./agent` 入口照常解析)。
- `local-agent-dsh-headless` 挂 `/startup` 行却根本没有 `locale/` 目录——约定缺口,留给它的负责方:它的 patch 本就不许进交互式 profile(那里的行不会面对清单页)。

## Testing

逐包 `require.resolve` 探针:每条重定向的 `./tool|./agent/locale/{en,zh}.json` 都解析到包根真实文件(此前是 `ERR_PACKAGE_PATH_NOT_EXPORTED`),行入口导出解析无回归。`pnpm check:plugins` 48 包绿。
