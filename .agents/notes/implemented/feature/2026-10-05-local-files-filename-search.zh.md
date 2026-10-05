# Agent Note: local-files 文件名搜索 = host 端一次遍历 + 强制展开的过滤树

Status: implemented

## Problem

local-files 浏览器（右侧栏 `files` 页签）的文件树按目录层级懒加载。在深层目录里按名字找文件只能一层层点文件夹；而树的懒加载恰恰决定了文件名搜索不能做成客户端过滤：客户端只持有已展开的层级，过滤已加载行会漏掉最常见的情形——命中的文件藏在没人打开过的文件夹里。需求是明确的：按文件名搜索文件和文件夹，命中项嵌在文件夹里时祖先链必须自动展开把它露出来。

## Decision

### 搜索是新的 Remote 方法背后的一次 host 端遍历

`LocalFilesService.searchLocalDirectory(path, query, includeHidden)`（service.ts）对整棵树跑一次迭代式 DFS，用大小写不敏感的子串匹配每个条目的相对根路径——不只是 basename，这样文件夹名命中会连它的内容一起列出（搜 `web-eval` 就是为了点到 `web-eval/` 里面的文件）——命中项以相对根路径返回（`docs/guide/intro.md`）。它作为 `localFiles/search` 挂在现有 Remote 面上（remote.ts），经注入的 `searchFiles` 接进视图（contract.ts、client/index.ts）——与 `listDirectory`/`readFile` 同一套绝对路径、无调用方查找的纪律。

遍历刻意做成"对恶劣树安全"而不是"忽略列表聪明"：由 `SEARCH_MAX_RESULTS`（200）、`SEARCH_MAX_VISITED`（50,000）、`SEARCH_MAX_DEPTH`（16）限界，触顶即置 `truncated`；永不进入 `node_modules` 和 `.git`（依赖与 VCS 内部比一切其他内容都大，且绝不会放着用户文档）；永不跟随符号链接（`readdir` 配 `withFileTypes` 报告的是链接本身，环在构造上不可能）；不可读目录降级为零命中而非报错。隐藏（点号前缀）条目跟随调用方的 `includeHidden`，视图把它绑定到树的眼睛开关上，因此命中项永远不会是树不会渲染的行。

### 搜索态是树的一种呈现，不是独立的结果列表

WorkspaceView 持有查询词、200ms 防抖，以及一个序号守卫——落在查询词之后到达的回答一律丢弃；root/会话切换丢弃进行中的搜索，`rev`（刷新）或隐藏开关变化会重跑已打开的搜索。查询非空时，视图把树的 `groups` 换成命中列表（已 memoize——FileTree 依据 groups 的身份播种展开集，若每次渲染都是新数组，用户的折叠会被反复冲掉）。FileTree 的 trie 构建把每条相对根路径还原出祖先链。搜索态随后按每批新结果播种默认展开集，依据是线上的 `nameMatch` 标记：一个目录仅当其子树里（自身之下）有名字命中时才默认展开——查询词点名的文件经祖先链露出，而查询词点名的文件夹默认折叠（其内容只是路径带出的命中，点开再看）——此后每行都可自由开合，骑行在搜索专用的展开集上，搜索关闭即重置。命中链上的祖先只渲染命中链——懒缓存里是完整清单，渲染它会击穿过滤——无 trie 子项的命中目录点击时懒加载。展开/收起全部在搜索态隐藏（整树手势对过滤列表无意义）；输入框里 Escape 先清空查询、再关闭搜索行；截断与无匹配各有独立文案（`tree.searchTruncated`、`tree.searchNoMatch`）。

### icons.tsx 里有一个手写 glyph——生成器对当前 harness 已失效

`IconSearchOutlineMedium` 是手工加进 `packages/local-files/src/client/icons.tsx` 的，artwork 逐字抄自 harness（`client/ui-primitives` 的 icons/index.tsx），因为 `scripts/sync-icon-artwork.mts` 目前对任何包都会崩溃：上游新增了 `({ size = 14, ...rest }: WeightedIconProps)` 签名的 artwork（如 `IconQueueOutlineArtwork`），脚本的 artwork 正则解析不了。这个问题先于本次搜索改动存在，并且会挡住之后所有的图标同步，直到解析器学会新形状——生成文件头里的"禁止手改"规则是暂停，不是废除。

## Alternatives considered

**复用现有 `listDirectory` 做客户端递归遍历。** 不用加 Remote 方法，但深树意味着每个目录一次往返（真实仓库上是数百次），限界变成分布式状态，遍历也无法原子地取消或收敛。host 端一次遍历就是一次调用，界限在服务端。

**输入框下的扁平结果列表。** 渲染更简单，但让界面出现两套心智模型（两种看文件的方式），并且选中/展开行为要复制一份；过滤 trie 方案原样复用树的行、选中与懒展开，也逐字符合"自动展开所在文件夹"的要求。

**尊重 gitignore / 可配置跳过列表。** gitignore 解析器是一个依赖加一套语义（只适用于 git 根目录），而这个浏览器刻意是 git 无关的；硬编码的 `node_modules`/`.git` 跳过加遍历上限，不用引入任何一方就覆盖了病态情形。

**祖先强制展开且不可折叠（第二版）。** 过滤树把命中链上的祖先钉死在展开态、忽略点击——用了一天就发现布局读起来是固定的：宽泛的查询（`eval`）会把每棵匹配子树摊开且无法收起，而查询词点名的文件夹本身也没有默认展开的理由——文件夹本身就是答案。播种式默认展开 + 自由开合取代了它，`nameMatch` 用来区分真正的命中和被路径顺带带出的后代。

**只匹配 basename（第一版）。** 上线过一天：文件夹名命中时只显示文件夹行本身，不显示它的内容——为了点进 `web-eval/` 里的文件而搜 `web-eval`，结果只有那个文件夹，没有可以点进去的东西（首日用户反馈）。路径匹配严格包含 basename 匹配（basename 是路径的后缀），这次放宽没有损失。

**只过滤已加载节点。** 漏掉的正是动机场景——那个还没人展开到的文件——而且结果集会随交互历史漂移。

## Consequences

- 搜索对任何可浏览的绝对根目录生效，不限于工作区，每次按键防抖后只需一次 Remote 调用。在真正巨大的根（如 home 目录）上搜索可能截断；树会如实提示，而不是假装完整。
- local-files 的 FileTree 是本包自己的副本（worktrees 早已 fork 了自己的），所以搜索 chrome 只落在一个面上；worktrees 的树除了共享的 tooltip 文案修复（独立提交）外不受影响。
- `sync-icon-artwork.mts` 对当前 harness 检出对所有包都不可用（先于本次存在，现在是关键知识点）。修 artwork 解析器是后续工作；在此之前 `--check` 无法做闸，新图标照本次这样手抄。
- 测试在两个平面钉住行为：`tests/service.spec.ts` 走真实临时目录（大小写、隐藏文件策略、node_modules/.git 排除、路径穿越拒绝），`tests/workspace-view.client.spec.tsx` 断言祖先链强制展开渲染、无匹配态，以及清空查询后的还原。

## Related

- 同日的窄桌面 `预览/源码` 比例修复（commit c29b77f7）把 ui-content-preview ContentPane 里移动端的 40px 开关加高收进 `@media (pointer: coarse)`——一个独立、纯局部的 CSS 决策，搭乘同一波部署。
