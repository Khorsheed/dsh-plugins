# Agent Note：story-bible M1——纯 host 面记忆核心、focus 作用域与 brief 预算

Status: implemented

## 问题

连载长篇让「全文注入」这个答案失效：一部百章作品塞不进 prompt，于是模型记不住设定、接不上上一章的结尾、欠下死伏笔、把人物写串。方案（`proposals/active/2026-10-04-story-bible.md`，刻意 gitignored）设计了一个作品级记忆系统——注册表、per-work 记忆/角色/伏笔/章节 store、三个工具、三个 brief 变体、轻指引函数段与 skill——并切成四个里程碑。M1 要在没有 UI 的前提下把记忆核心和注入面做得仍然可用，同时还要落下方案留给实现的三个决定：M1 带多少界面、focus 映射怎么设键怎么读、brief 的 token 预算怎么执行。

## 决定

### M1 刻意纯 host 面

本包挂核心行（store + `story` Remote 数据面，M1 动词全集）与 `./agent` 行（三个 origin 打标工具、轻指引函数段、`story` skill），**不声明 `dsh.client`**。右栏 tab 是 M3 的事，但它们消费的正是现在挂上的这批 Remote 动词——所以 M1 不是一次性脚手架：每个 store 动词、Remote 面、工具与 brief 渲染器都是最终形态。M1 验收环（focus → brief → 写作 → 审过 → 对账）只靠工具就能完整走通，测试也正是这么驱动的。

### store：部署级 state、围栏重定界、按表 max+1 发号

state 落在 `$DSH_HOME/state/story/`（部署级，绝非会话工作区）。每次写入都经挂载的 `ctx.fs`，带调用会话解析出的 MODE 和会话 id，但可写边界重定界到插件自己的 state 目录——canvas store 的围栏模式，只读部署照样拒绝。`work.json` **不带计数器**（方案草稿写「元信息 + 计数器」）：所有 id（`m<n>` / `c<n>` / `p<n>`、章节 `n`）都在同一次版本守卫写入里对持有它的文件取 max+1，发号与写入同原子，计数器漂移这类 bug 被整类消除。两个 JSONL 流水用「守卫式读-拼-写」追加、冲突重试一次——`ctx.fs` 没有 append 动词，state 也绝不走裸 `node:fs`；输掉竞争就重试，而不是覆盖。写作中不落库：章节阶段由正文文件是否有内容派生（方案的「阶段从事实派生」），持久的只有 规划中 → 已审过 → 已抽取。

### focus 作用域：一个字符串键，两个读者

focus 映射是 `Map<string, {workId, title}>`，键为 `String(session.id)`。它有两个读者：持有 `exec.agent.session` 的工具，和从组装上下文读 `context.agent?.sessionId` 的轻指引函数段。两边字符串化的是同一个 branded id，映射因此只需要一种键形。映射刻意进程内——重启即「未 focus」，工具如实答引导语，轻指引如实答 `''`。作品标题随映射项存（focus 时捕获），因为轻指引按宿主 section 契约是同步函数，永远碰不了文件系统。轻指引的所有降级路径——组装上下文没有 agent、没有 sessionId、没有 focus、甚至映射抛错——都渲染 `''`：一行指引绝不能弄炸 prompt 组装。M1 没有 UI，`story_write(what=work, title)` 就是 focus 入口（同名已有作品即 focus，否则新建并 focus）；Remote 的 `focusWork` 是同一扇门，M3 的 tab 将来用它。

### brief 预算：估算 token、确定性收紧、如实从略

渲染器是纯同步函数，输入是 store 异步装配的 `BriefData`（拆分的原因正是函数段契约：它永远不能 await）。预算按方案钉死（write ~2k / plan ~2.5k 估算 token；extract 随正文不设预算）。估算按一个 CJK 字符一个 token、ASCII 四字符一个 token——粗糙、稳定，够当护栏。渲染先用宽松上限（write：伏笔 topK 8、摘要 10 章、每人 3 条经历；plan：台账 20 行、摘要 5 章）；估算超了就换紧上限重渲，并附一行从略脚注，写明略掉了什么、去哪里取（`story_read`）——预算是带收据的规则，不是静默截断。铁律在每个变体都成立：绝不注入全部前章、绝不注入全部伏笔、幽灵卡（intent `draft`）绝不泄漏——种子 spec 把三条都钉死了。

### import 校验闸留在插件代码里

`story_extract` prepare 组装 CP0 C 变体素材包（指令 → 正文全文 → 计划 → 带 id 的活跃伏笔榜 → 带 id 的花名册 → 输出 schema）；委派宿主原生 subagent 是主 agent 自己的事，所以 preset 没有 subagent 工具时降级为主 agent 自己跑两段，五闸不变。import 不信任任何模型：evidence 必须在正文 grep 到（先精确、再容忍空白换行——换行不是编造）；伏笔 id 必须在 import 当下重新推导的活跃榜白名单里；new_* 必待审；high 以 reviewed + 「自动·可撤销」标落入库（retract 即归档）；medium/low 进 pending；计划核对由已记录的 mentions 计算——计划内却没动的操作以「计划落空」进待审（「忘了还是改主意」是人答的题），mentions 流水带 `planned`/`reconciled` 标志。计划核对只读 import 自己记录的提及，所以 subagent 少报了提及，结果是误报给人，而不是静默丢弃。

## 考虑过的其他方案

**M1 带一个最小信息页客户端。** 方案允许「无 UI 或最小信息页」。但浏览器面意味着 client bundle、locale 文件、`dsh.client` 声明和槽位注册——这些到 M3 会被两个真 tab 整体替换。现在挂的 Remote 面就是 M3 的真契约，砍掉占位页不损失什么，还省掉一次重写。

**把「写作中」落成持久阶段。** 那需要一对设置和清除的动词，而且它会说谎（烂尾的草稿永远显示写作中）。从正文文件是否存在派生，是方案自己的规则（阶段从事实派生），而且永远不与现实矛盾。

**在 `work.json` 里放发号计数器。** 计数器和它服务的表要保持同步就需要跨文件原子性，而 `ctx.fs` 一次只守卫一个文件。在同一次守卫写入里对持有表取 max+1，严格更安全；计数器文件在这个规模下什么都买不到。

**JSONL 用裸 `node:fs` 追加。** 省一次系统调用，但脱离了围栏：沙箱策略看不到这次写入、观察轨迹缺一环、只读部署也拒绝不了它。守卫式读-拼-写让每一字节都留在和 JSON 文档同一道围栏里。

**轻指引段里异步渲染 brief。** 宿主的函数段契约是同步的，所以轻指引只读进程内 focus 映射；完整 brief 也根本不自动注入（skill 与 brief 分离——模型用 `story_read` 自取）。这也是为什么 `BriefData` 的装配在 store（异步）、渲染在 `brief.ts`（同步、纯、可快照测试）。

**第 5 闸信任 subagent 的 `plan_results`。** subagent 判读的依据和 import 记录的 mentions 是同一份，它的结论没有代码算不出来的东西——而信任它就是把一道闸从插件代码挪进模型输出，方案明文禁止（落库校验永远在插件服务代码里）。schema 保留 `plan_results` 作叙述，裁决由代码计算。

## 后果

- M1 在无头环境完整可用：spec 用工具走通整个旅程（focus → 幽灵卡 → 规划 → 写作 brief → 审过 → prepare → import → 待审处理），CP1  fixture 用《梦境监护者》种子渲染三个 brief 变体供文案审阅。
- Remote 动词集已冻结为 M3 UI 的契约；之后改动词就是改 wire，不是内部重构。
- focus 映射随进程消亡。哪天有部署需要 focus 跨重启存活，映射要加一个持久副本——刻意推迟，因为重 focus 的成本只是一次工具调用。
- token 估算是启发式，不是真 tokenizer；预算是带从略收据的护栏，种子 spec 钉住三个变体都在预算内，回归会响亮地红。
- `story_read(what=works)` 比方案的 `what` 清单多一行——M1 没有 UI，模型没有别的途径发现可 focus 的作品。属增量，README 已写明。
- `scripts/gen-typert.mts` 的 `TYPERT_PACKAGES` 加了 story-bible 条目（每个 `./typert` 包都要登记的注册表），`docs/packages.md` 已重新生成——新包躲不开的两处仓库级登记。

## Related

- 已被 [canvas-novel 引擎](2026-10-04-canvas-novel-engine.zh.md) 取代：包现在是 `@khorsheed/dsh-canvas-novel`，即画布上的「长篇小说」体裁。
