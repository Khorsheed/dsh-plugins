# 上游接缝请求登记处（官方不支持 → 绕行点台账）

- **分类**：T4（需官方运行时/契约扩展）集合
- **状态**：常驻登记处（随用随加，不归档）
- **目标**：集中收集所有"官方不支持该能力、且不接受 PR，我们不得不绕远"的点。每条记录：需求、当前绕行方案、官方落地后的退役条件。官方哪天开闸，这张表就是提交顺序的优先级清单；官方一直不开，这张表就是我们的长期维护成本台账。

## 条目格式

每条一节，字段固定：**需求 / 现状绕行 / 官方落地后的退役条件 / 状态**。状态取值：`绕行中`（线上跑的就是绕行方案）、`待实施`（方案已定未动工）、`已退役`（官方落地，绕行已拆）。

## 条目

### S1. 文件打开路由不可覆盖（产物行 / 正文 mention）

- **需求**：第三方能替换"打开文件"的目标（官方写死 `workspaces.openPath` → 跳 OS/IDE）。
- **现状绕行**：turnTail chain 以 `priority: -1` 抢占官方产物行（first-match 选举）；正文 mention 用 document 捕获阶段 click 拦截（三道闸门 + fail-open）。代码标记 `TODO(official-opener-seam)`。
- **退役条件**：ui-conversation 提供文件打开覆盖点（可选 opener 服务或可替换的 `chatFileMentions`)。每次官方升级核对：chain 选举语义、`deliverables` 回合数据形状、mention 的 `code > button[title]` 结构。
- **状态**：绕行中（@khorsheed/dsh-client-ui-file-preview）。

### S2. bash/子进程写入的文件不进任何日志结构

- **需求**：bash 工具（cat heredoc、sed -i、python 脚本）写入的文件出现在产物视图。实测：whalesong 游戏会话十几个 HTML 产物几乎全走 bash,fold 完全不可见。
- **现状绕行**："B 通道 + A 采集"混合——监听 `tools/result` 提取 bash 命令里的写入候选（重定向/tee/sed -i/cp/mv/python open 等高精确模式）,`fs.stat` 事后验证（宁缺毋滥），追加 log-only 会话事件（`ignorable: true`)，宿主 fold 多读一个事件类型。
- **退役条件**：官方 bash 工具在结果 meta 带写入路径（小改，首选），或执行层（沙箱/子进程）落文件写入事件（大改，根治）。官方落地后采集器整体退役，fold 改读官方数据。
- **状态**：待实施（@khorsheed/dsh-file-preview 宿主半）。

### S3. Code Mode 嵌套派发无 diff 数据

- **需求**:`tool/code-dispatch` 事件带 oldText/newText（或 diff hunk)，让 code-kimi 会话的文件也有改动记录。
- **现状绕行**：无——列表能进（S2 之前修的 dispatch fold)，改动记录 tab 对这类文件隐藏。
- **退役条件**：官方在派发事件里带 diff 数据。
- **状态**：绕行中（无绕行，纯缺失，UI 如实隐藏）。

### S4. Code Mode 派发事件无 turn/step 归属

- **需求**:`tool/code-dispatch` 事件带 turn/step，回合级 fold（变更卡片）才能归属嵌套变更。
- **现状绕行**：宿主 fold 借外层 `run_code` 根调用的 turn/step（列表可用）；客户端回合卡片无法归属（match 拿不到 turn),code-kimi 会话不出卡片。
- **退役条件**：官方给派发事件补 turn/step 字段。
- **状态**：绕行中（部分）。客户端卡片侧的缺失等官方补字段。

### S5. Typert Remote 生成器只在官方构建链

- **需求**：社区仓库能独立生成 `lib/typert.*`(Remote 客户端/宿主产物）。
- **现状绕行**：构建放在官方 checkout 测试位跑（dsh-plugins 的 `build/vitest.ts` 与 gen-typert 已按此搭好）;file-preview 迁移提案里的决策点。
- **退役条件**：官方把生成器作为可独立运行的包发布。
- **状态**：绕行中。

### S6. 官方包 scope 不可发布 → 打包改名的正确姿势

- **需求**：社区包发布到自有 npm scope 时，家族内互相引用（peer、patch 行、lib 产物里的 import specifier）全部换名。
- **现状绕行**:`scripts/pack-dist.ts --family`（已实施，含改写后残留扫描）；注意该脚本在官方仓 scripts/ 下，dsh-plugins 已复制一份。
- **退役条件**：无需退役（这是发布工具，不是绕行官方缺陷）。登记在此因为它源于"官方不接受 PR"的约束。
- **状态**：已退役（工具已自建）。

### S7. 守卫凭证自报制（不含类型检查覆盖证明）

- **需求**:checkpoint/restart 的绿色凭证由守卫自执行命令验证，而不是 agent 自报。
- **现状绕行**：无（guard 是自家包）。建议已整理成交给守卫维护者的一段话（`--gate <cmd>` 方案，含后台触发盲区的开放问题）。
- **退役条件**：守卫包实现 `--gate`。
- **状态**：待实施（ankh-guard 维护者评估中）。

## 维护约定

- 新增条目：发现"官方不支持 → 绕行"即登记，先登记者在提案总表更新计数。
- 条目退役：官方落地后同一 PR 里拆绕行 + 标 `已退役` + 写明退役版本。
- 每次官方升级：逐条核对"退役条件"是否已满足（S1 的核对清单可以直接抄进升级 checklist)。
