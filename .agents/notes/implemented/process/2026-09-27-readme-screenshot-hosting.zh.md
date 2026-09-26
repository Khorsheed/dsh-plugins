# Agent Note:包 README 截图的生死由 profiles/web-basic 决定——镜像同步会抹掉此外的一切

Status: implemented

## 问题

包 README 用绝对 URL(`https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/<name>`)嵌截图——npm 页面无法加载相对路径,而 dsh-plugins 自己没有公开 raw 托管。2026-09-27 落位 owner 提供的十五张新截图时,发现这套托管在两个方向上都漏:

- **图会事后消失。** 镜像仓 9/10 的 `fe88b92`("sync from dsh-plugins")删掉了 `docs/screenshots/08-local-agent.png`,尽管有四个包 README 引用它。原因:`scripts/sync-mirror.mts`(`sync-mirror profile web-basic`)会把镜像仓里 keep 集之外的一切抹掉,只从本仓 `profiles/web-basic/` 下 git 跟踪的文件拷回。镜像的 `docs/screenshots/` 因此恰好等于 *profile* README 引用的那 19–20 张;任何直接提交进镜像仓「给 README 当图床」的图,下一次 sync 就被删。
- **有引用、没有图。** 十几个 README 引用着两个仓库里都从未存在过的截图(README 重写波留下的愿景引用)——npm 页面上全是破图。

## 决定

包 README 截图的持久归宿是本仓的 **`profiles/web-basic/docs/screenshots/`,用 `git add -f` 跟踪**(图片扩展名被 gitignore)。镜像同步会从那里把它带进 dsh-web-basic,raw URL 在 sync 之后依然存活。直接拷进镜像仓照做(让 URL 在下一次 sync 前就能用),但它不再是事实源。仓库根的 `docs/screenshots/` 继续为本地引用图片的文档页和 Agent Note 保留自己的副本。

owner 提供的十五张截图(Desktop `截图/`)已映射到现有 README 引用——README 规划的文件名与源图不一致时做了改名(`local-agent-chat.png` → `local-agent-member.png`、`local-agent-member.png` → `room-2.png`、`room.png` → `room-invite.png` 等);凡是截图不存在的 README `img` 行一律**删除,不留 404**(capability-catalog 的详情弹窗图与 MCP 图、reader-3、inline-html-card-2、codex 委派镜像图、kimi sessions、local-agent-dsh 设置卡、bundle-conversation-toolbox 卡、ui-content-preview 两张、mobile 两张、typesafe-tool 凭据图,以及 datasets 的 HTML 注释占位)。与实图不符的 alt(capability-catalog 的「三列」、inline-html 的「设计 token 对照卡片」、quote-2 的 composer 说法)已按真实图像重写。哪个被删的槽位要紧,补拍后把那一行加回来即可——引用样式是每处一行 `<img width="640">`。

两个漂移顺带修了:`packages/quote` 曾是全仓唯一没有 `README.i18n.yaml` sidecar 的双语 README 包(已补;配对校验按已有 sidecar glob,quote 的中英漂移此前对它不可见);老图 `m4-room-dev-session.png` 保留在 `docs/screenshots/`,因为有两篇 Agent Note 把它作证据引用,尽管 room README 已不再引用它。

## 备选

**用专门的图床仓或 CDN。** 分野更干净,但平白多一个活动部件——镜像仓本来就是公开且带版本的;该修的是让 sync 不再丢图,而不是换托管。

**把 sync-mirror.mts 改成并集而非清场。** 暂不采纳:清场正是让镜像成为 `profiles/web-basic/` 精确投影的机制(陈文件绝无可能在镜像里存活)。把图跟踪进 profile 之下,保住了单一机制与单一事实源。

## 影响

- `profiles/web-basic/docs/screenshots/` 现在跟踪 38 张图(20 张 profile README 的 + 18 张包 README 的);镜像仓在 `8c63764` 之后持有同样 38 张,下一次 `sync-mirror` 无 diff、无删除。
- 任何 agent 加 README 截图都必须落在 `profiles/web-basic/docs/screenshots/`(本仓)——只提交进镜像仓的图,寿命等于一次 sync。
- README 的图引用现在全部可解析:`packages/*/README{,.en}.md` 共 38 个唯一 `docs/screenshots/` 引用,两仓全部存在(机械校验)。

## 验证

`pnpm check:hygiene` 对全部暂存文件 0 finding;`verify-translation-pairing` 报 478 对同步(含 quote 新 sidecar);两种语言 × 两个仓库的引用存在性扫描零缺失。运行时无任何变化——当天那笔配套的代码修复(capability-catalog 默认模式芯片染色)另在 `17d3191e`。

## 相关

- 当天六工具伴生包的 README 措辞同步:[preset 组合的工具行以 inject 声明 core](../bug-fix/2026-09-27-preset-tool-rows-declared-core-inject.zh.md)。
