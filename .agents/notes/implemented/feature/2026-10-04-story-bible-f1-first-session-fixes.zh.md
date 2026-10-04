# Agent Note：story-bible F1——正文写入收进 story_write，审过挪到最后

Status: implemented

## 问题

首次实测（link 开发实例）暴露一个结构性 bug 和四个界面 bug：

- **空槽登记**：作品被登记到一个不在会话沙箱里的工作区（`lab-workspace`，遗留路径）。agent 自己用宿主文件工具写正文被围栏拒掉，它在对话里如实报告了错位（这个诚实行为保留）。但章已经登记了——章节阅读永远显示「正文尚未生成」，`story_read(chapter)` 读到不存在的文件。登记和正文写入是两个可以不一致的事实。
- 定制工具行的排版（字体/字号/行高）与宿主消息正文不一致。
- 阶段灯读成 规划中 → 写作中 → 已审过 → 已抽取。用户裁定正确顺序：规划中 → 写作中 → 已抽取 → 已审过——审过是人工闸门，永远最后。
- 注册了两个 tab kind（story-fragments / story-reader），违背「一个插件一个宿主 tab」的期望。
- 未确认的 plan / 未处理的待审没有常驻入口——沉底了。

## 决定

### F1-2：正文写入收编进 story_write（结构性修复）

`story_write(what: chapter)` 增加可选 `content` 参数：给了就由 store 先把正文写进 `<工作区>/<作品目录>/第{n}章.md`——经调用会话解析出的 MODE、边界重定界到作品登记的挂载工作区（canvas exportManuscript 的围栏先例）——然后才登记章节。写入被拒就拒绝登记：空槽章这一类问题从构造上消灭。只给 plan（无 content）的路径照常登记为规划中、不碰工作区。已有文件按刚读到的版本守卫重写；fs 层自动建父目录。agent 自己用宿主文件工具写仍然允许（同一工作区、自己的围栏内）——此时登记保持规划中，读取侧派生如实呈现：规划中+无正文 = 未生成；已过规划+无正文 = 文件丢失 · 重新定位（`fileMissing` 派生阶段——存量坏数据的温和迁移面，当前仅文案提示）。

旧的失败模式从构造上不可能再发生：写入归 store 管，围栏先于索引回答。

### F1-6：审过收章，永远最后

章节状态机改为 规划中 → 写作中（派生） → 已抽取 → 已审过。具体地：`story_extract` 的 prepare/import 以「写作中」（存储态 planning + 正文非空）为闸——无正文即无可对账；已抽取与已审过都拒绝。`reviewChapter` 只给已抽取的章收章（否则 `not-extracted`；已审过幂等）。阶段灯只在已抽取时点亮「✓ 审过本章」，之前禁用并注明原因，之后回显已审过。skill 的铁律 2 改为：正文不满意就先改、别对账；审过收章永远最后。不变量 2（不满意的正文不进记忆）以流程形态存续：对账仍是用户主动发起的一步，五道 import 闸（evidence/白名单/new_*/置信度/计划落空）加待审队列与撤销共同守记忆质量。

### F1-4：一个宿主 tab

一个 tab kind `story`（写作），内部 灵感碎片/章节阅读 切换存进 StoryUiStore，M3 的两个组件保留为两个面板。闸门的门（去确认/去处理）落在会话头 chip 上（工具行已在后续方向调整中撤回）：切面板并打开这一个 tab。退役 kind 上已打开的旧 tab 渲染宿主设计的 `tab.unavailable` 回退，README 写明关掉重开。

### F1-5：官方槽位上的闸门 chip

`conversation.session.header.utilities`（list 槽：没有内容就不渲染）上两个条目：「第N章 plan 待确认」与「待确认 n」。各自经 story Remote 读本会话 focus 的闸门状态，5 秒可见节拍 + 共享 store 的 rev 双触发。会话绑定的 chrome，按 preset 判据显隐（preset-visibility.ts，canvas 模板按文档规则内联拷贝）：双查（根行 ∪ preset 组），一切读不到的路径 fail-open。点击打开写作 tab 的对应面板。

### F1-1：工作区默认 + 选择器门

新建表单的挂载工作区默认取**会话自己的 cwd**（从 useSessions 结构性读取），可经宿主目录选择器更换（datasets 的双探测先例：先 legacy `ctx.workspaces.pickDirectory`，再 `uiWorkspace.pickDirectory`；都没有则降级为路径文本输入，用新增的 `statWorkspace` Remote 动词做存在性校验）。选了非会话工作区时给一行正向陈述的提示：正文读写依赖会话沙箱，跨区可能被围栏。

### F1-3：工具行继承消息正文排版

`toolview.module.css` 在行上 `font: inherit; line-height: inherit`，删掉所有子元素的字体/字号覆盖，只留布局与 --dsw-* 强调色。

## 考虑过的其他方案

**登记时 stat 校验、不接管写入。** 作为主路径被否：agent 自己写被围栏拒掉的失败仍然可能先于登记静默发生——这正是报告的 bug。store 接管写入让围栏的回答成为闸门。stat 校验以读取侧派生（fileMissing）存续，它同时是迁移面。

**审过在对账前（M1 的顺序）。** 用户裁定推翻；灯与状态机现在一致。skill 文案与两个 README 随提交同步。

**保留两个 tab kind。** 宿主 tab 注册表的约定是一面一 type；内部切换正是 mockup v7 的形态。

**chip 放 composer dock 而不是会话头。** 会话头是一瞥即读的状态位（message-timeline 先例）；composer dock 是输入相邻动作的位置。chip 指向界面，不指向输入框。

## 后果

- 空槽章从构造上消灭；那次实测自己的损坏读作「文件丢失 + 指引」，而不是静默的空阅读器。
- 工具行排版即宿主正文——读起来是对话，不是外来卡片。
- 一个插件一个 tab 一个切换态；旧双 kind 布局按设计降级。
- 两个 chip 让两个人工闸门常驻，不新增界面。
- `story_write(chapter)` 带 content 是 skill 现在教的写路径；宿主文件工具写在登记的工作区内仍然合法。
- 工具描述、skill、双语 README 随同一批提交更新；M1/M3 note 里的流程描述保持历史原样。
