# 变更记录

monorepo 级别的发布摘要；各包的完整变更见 `packages/<包>/CHANGELOG.md`。

## Unreleased —— 预览面板的「刷新当前文件」手势（仓主 2026-09-24 提出）

- `@khorsheed/dsh-client-ui-content-preview` 新增可选 prop `onReload`（contract 同步加 `action.reload` 文案键）：标题行动作区在复制路径之前多一个刷新钮（官方 `IconRefreshOutlineMedium`），仅在调用方注入 `onReload` 时渲染；点击后按钮禁用、图标旋转直至调用方 promise 落定（dsh-reader `.toolSpinning` 先例，含 `prefers-reduced-motion` 回落）。未传 `onReload` 的调用方零变化
- 三个消费面同构接入——`@khorsheed/dsh-local-files` 文件列表详情、`@khorsheed/dsh-worktrees` 详情面板（diff 档重拉 diff、内容/图片档重走 read Remote）、`@khorsheed/dsh-client-ui-file-preview` 产物详情页：重走各自 Remote 读当前文件，重读期间旧内容保持显示；失败保留旧内容、错误走各包既有 error 槽；晚到的旧答案按选择键丢弃。worktrees 的提交详情页不接——文件钉死在那一提交，内容不可变
- 三包字典各加 `action.reload`（zh 重新加载 / en Reload），PREVIEW_KEYS 覆盖测试机械保证三命名空间双语齐全

## Unreleased —— capability-catalog：rc.1 的按模式能力面读取恢复（host-016 适配漏网）

- **修 rc.1 适配漏网**：rc.1 的 `@deepseek-ai/dsh-agent-preset-registry` 删除了 `standingKeyFor(id)`，换成租约式 `acquireScope(id?)`——内部走 `retain()`，未知 preset 抛 `agent-preset/not-found`、坏 preset 抛 `agent-preset/invalid` 带诊断，**租约用完必须 async dispose**（否则 generation.users 泄漏，preset 卸载后 scope 永不回收）。capability-catalog 的 `resolvePresetScope` 只探旧面，rc.1 上 100% 落入「无 roster」静默回退：`snapshotAt` / `snapshotFor` / `modeFaces` 与按 preset 投递全部读成全局层且不盖 preset 戳（3093 实测，roster 本身健康）
- 修复走**双线探测**（`packages/capability-catalog/src/preset-scope.ts` 新导出 `acquireStandingScope`）：0.1.5 的无租约 `standingKeyFor` 优先，缺失时用 rc.1 的 `acquireScope`；`ResolvedPresetScope` 新增可选 `dispose`，所有消费点 try/finally 释放——`collect` 整段 body 包 try（`catalogSnapshot` 改 `return await`，释放不抢在指纹正文加载前）、`catalogScope` 获取即放（租约只挡「卸载且零占用」的回收，活 preset 的 scope 不受释放影响，与 0.1.5 无租约键同语义）、scoped-delivery 的 `resolveKey` 读完 key 即放。释放失败只记日志不砸读；strict/降级措辞两线逐字一致（`agent-preset/not-found` / `agent-preset/invalid` 的 message 直接进既有措辞）
- 232 测试绿（+6：rc.1 臂的读取盖戳 / 租约恰好释放一次 / 无 key 租约由解析器自放 / broken·unknown 的 listing 降级与 fingerprint strict 抛错 / 双面 roster 下 0.1.5 臂优先；scoped-delivery 真注册表下租约面投递 + 每 preset 释放一次）

## Unreleased —— I5 · T59：子 dsh 的权限边界是作用域目录里的一个文件

- `@khorsheed/dsh-local-agent-dsh` 新增配置键 `permissions`（`read-only` / `workspace-write` / `danger-full-access`）：供给时多写一层生成 patch，**覆盖** `sandbox-policy` 的 `mode` 与 `user-approval` 的 `policy`（两者按 `dsh-base` 自己的 `permission-presets` 表配对）。不写这个键就一层都不写，子 profile 的 patch 与从前逐字节相同——宿主上现存的每个作用域仍是 `workspace-write` + `ask`。同时导出 `permissionBoundaryLayer` 与 `readSubProfilePermissions`
- 修 I5·T39 的缺口 G14：**容器单元里 dsh 选手没有 shell**。镜像既无 bubblewrap、Landlock 探针又报 `unusable`，沙箱按设计 fail closed，于是每一笔 `bash` 拿 `SANDBOX_UNAVAILABLE`；无头子 dsh 没有审批通道，模型那一次受认可的升档重试也只拿到「no approval channel is available」。根因不是这两条，而是**没有任何东西决定子 dsh 的边界**——这一家此前没有权限旋钮，冻结决策 3 在四家里缺一个执行点
- `@khorsheed/dsh-local-agent-dsh` 的 `effectiveSettings` 开始报 `sandbox`（配了才报）；`@khorsheed/dsh-eval` 把它映射进条件词表：`danger-full-access` → `unrestricted`，其余档位原样返回，缺位仍为 `null`。条件的 `permissions` 一行判 ERROR，所以声称 `unrestricted` 却仍在约束子 dsh 的作用域从此写不出 lock
- `dsh-web-eval` pack 钉 `permissions: danger-full-access`，与 codex 的 `sandbox`、claude 的 `permissionMode` 并列。**这条 pin 与容器路径是一对**：要在宿主上直跑阶段一二，先改回 `workspace-write`。两条 dsh 条件的 `home.sha` 随之改变，需重新 provision 并抄回

## Unreleased —— I5 · T34：起草实验的一个动词，三个面

- `@khorsheed/dsh-eval`：新增服务面 `draftExperiment(request, {session})`——把「写 `plans/<名称>.json` + 写它引用的新条件 + validate」并成一次调用，文件落进会话绑定题库工作树的透传区（`plans/` 与 `conditions/`），不 commit、不覆盖已有文件。新条件一律从现有条件**复制**再改点名的六个字段（harness / model.declared / scope / preset / permissions / reasoning.effort），改零个字段会被拒；复制后 `home.sha` 一律置空、换 harness 时 `harness.version` 置空、`notes` 换成出处行。validate 不过的 plan 照样落盘——它就是「草稿」。配套 `draftOptions` 给表单填选择器（题集 → 题目 / 阶段 schema）
- `@khorsheed/dsh-eval` Remote 加 `newExperiment` / `draftOptions` 两个带会话的动词；客户端的「实验室 › 新建实验」从占位变成真表单（ui-spec §五的字段全在，题目 / 条件 / 阶段都是多选，「新建条件」是复制表单），保存后跳到该草稿的计划审阅页。**启动仍不在这张表单上**：能起 run 的只有计划审阅页的「批准并启动」与 `/eval run`
- `@khorsheed/dsh-eval-tool` 的 `tools: all` 从四个工具变五个：新增 `eval_plan_draft`，与表单走同一个服务面动词，所以人建的草稿与 agent 建的草稿是同一份文件、落进同一个列表。这是这一行唯一的写，理由与其它写类动词不给的理由是同一条——草稿是文件不是动作，批准 / 登录 / provision / 终评一个都没挪位（ui-spec R1）
- `dsh-web-eval` pack 随包装 `eval-planning` 技能到 `$DSH_HOME/skills`

## Unreleased —— 单实例多模式 M4'③：mission / datasets / eval 工具行拆分

- 三个新伴生包（0.1.0）：`@khorsheed/dsh-mission-tool`（12 个 mission 工具 + `tool:mission` 段；`tools`: all / read / none）、`@khorsheed/dsh-datasets-tool`（8 个 datasets 工具 + `datasets:tools` 段；`tools`: all / read / authoring / none）、`@khorsheed/dsh-eval-tool`（3 个只读 eval 工具 + `tool:eval` 段；`tools`: all / none）——只注册工具与提示词段、不发布服务、不声明 `dsh.bundle`（依赖安装仅可解析、不自挂载），由各 agent preset 的 `agent.cordis.yml` 按名引用；core 缺席时记一条日志后静默不注册
- **BREAKING**（`@khorsheed/dsh-mission` / `-datasets` / `-eval`）：三个 core 不再在 profile 根注册模型工具、不再贡献工具提示词段，`tools` 配置键从 core 移除并搬到伴生行（迁移两条：装伴生包 + preset 引用该行）；服务 / CLI / slash / Typert Remote / 会话 tab 全部不变。工具定义工厂经各 core 新增的 `./tool` 子路径导出，伴生包零复制复用业务逻辑
- 任务 tab（mission）与数据集 tab（datasets）按 preset 组合自隐（M3'③/M3'④）：当前会话的预设组合里有对应伴生行才注册，读不到组合数据 fail-open，「有页签没有工具」的空体按钮不再出现
- 评测包的 `eval` 预设接管原先挂在 profile 根的按域档位（`mission-tool: read` / `datasets-tool: authoring` / `eval-tool: all`），`profiles/web-eval/cordis.patch.yml` 不再给三个 core 写 `tools`；三个伴生包加进该 pack 的成员清单与源码模式的 `UNPUBLISHED_DIRS`（profile 的 `autoInstallPeers: false`，peer 不会被自动安装）。web-dev 的 dev preset **刻意不引用**这三行——三个 core 不在它的成员清单里，缺行会让整个 preset 报 broken
- 修复一处观察：标准模式会话的拼装提示词此前带 mission / datasets / eval / Agent Teams 四段（2026-09-11 session-aabca0ed 轨迹为证）；拆分后标准模式恢复干净默认

## Unreleased —— 单实例多模式：工具行拆分（worktrees ① + room ②）

- 新伴生包 `@khorsheed/dsh-worktrees-tool`（0.1.0）：模型可见的 `worktrees` 工具按会话授予——只注册工具、不发布服务、不声明 `dsh.bundle`（依赖安装仅可解析、不自挂载），由各 agent preset 的 `agent.cordis.yml` 按名引用；core 的服务缺席时静默不注册
- 新伴生包 `@khorsheed/dsh-room-tool`（0.1.0）：同形态的 room 工具三件套（`room_invite` / `room_task` / `room_message`）按会话授予；工具定义工厂（`roomInviteTool` / `roomTaskTool` / `roomMessageTool`）经 core 的 `./tool` 导出零复制复用
- **BREAKING**（`@khorsheed/dsh-worktrees`）：core 不再在 profile 根注册该模型工具（迁移路径见包 CHANGELOG/README）；工具定义工厂 `defineWorktreesTool(service)` 经 `./tool` 导出供伴生包零复制复用
- **BREAKING**（`@khorsheed/dsh-room`）：core 不再在 profile 根注册 3 个 room 模型工具（迁移路径见包 CHANGELOG/README）；room 服务/成员 UI/Remote 不变
- worktrees 徽标显隐默认判据改读官方 `pluginInventory` preset 组合数据（组合里有工具行则显示），`visiblePresets` 保留为手动 override，数据不可得 fail-open
- room 会话 chrome（「邀请 agent」chip +「成员」tab）按同一判据自隐（M3'②）：组合无 `@khorsheed/dsh-room-tool` 行则隐藏，读不到 fail-open，已是 room 的会话始终保留；成员 tab 走注册层隐藏（注销条目，不留空体按钮）
- web-dev 场景包新增开发模式 preset（`profiles/web-dev/presets/dev`，官方 standard 为底 + 三家委派工具行 + worktrees 工具行 + room 工具行），install.sh/update.sh 负责卸进 `$DSH_HOME/.agent-presets/dev`
- 0.1.5-rc.1 活体验收通过：A3/B1/C1/C2/D1/D3 + M4'② room 行活挂载（3299 实例，截图 `docs/screenshots/m4-*.png`）

## 2026-09-10 —— 0.2.0 波：宿主 0.1.2 适配（BREAKING）

- 10 个已发布插件齐发 0.2.0：ankh-guard、context-guard、file-preview、message-timeline、message-tools、session-title-edit、taskpilot、ui-file-preview、ui-shortcuts、whalesong
- **BREAKING**：minHost 地板整体前移至宿主 `0.1.2-rc.1`（client-runtime 移除 / Session API 更名 / ui-primitives 强制 labels 等）；宿主 `0.1.0-rc.6` ~ `0.1.1-rc.2` 的用户停留在 0.1.x 线（ankh-guard / file-preview 末版 0.1.1，其余末版 0.1.0）
- 各包适配明细见各自 CHANGELOG：message-tools 走 `snapshotEvents` + `SessionSeq` 品牌化、whalesong blocked 铃改订阅 `uiSession.pendingInteractions`、message-timeline 改 `useChat` 单座席、ui-file-preview 的 external-open 按钮在 0.1.2 隐藏、taskpilot 历史 loader 走 `remote.session` follow/page 等
- ankh-guard 另携两项新能力随波发布：进程内 `requestRestart` 触发缝 + boot 代际浏览器刷新；preflight 快照跳过 socket/FIFO 与顶层 `scratch/`（home 快照不再因运行时条目拒绝，慢复制提前警告）

## 2026-08-27 —— local-agent 家族：设置卡片 + live 热切 + token 流式收尾

- **设置卡片**（提案 2026-08-26-local-agent-live-settings-card）：每个 provider 在 设置 → 插件 → 插件配置 自带一张卡片（认证 + live 开关 + 输出粒度，说明收 ⓘ 悬浮），live 切换即时生效、进行中的轮不打断；卡头状态点一眼可见授权状态。独立「本地 Agent」设置 tab 同步撤除（M3），认证管理全进卡片。
- **工具名对齐**：委派工具改为官方模型面向名 `subagent_codex` / `subagent_claude_code`（官方行出厂禁用，patch 加 disable 兜底）。
- **token 粒度流式收尾**：四家统一——settle 合成一条最终消息打在流式同 (turn, step)，无重复渲染、无悬挂「已停止」。
- **凭证可靠性**：kimi 凭证空壳哨兵（备份 + 自动恢复 + 归因日志）；claude 认证探测改为先同步 keychain 并认可 refresh token 有效期。
- **镜像修复**：四家折叠层全量 persistence append 撞 seq 契约导致 offset 不推进的问题全部修复。

## 2026-08-23 —— 补丁：ankh-guard / file-preview 0.1.1

- 修复随包 skill "目录可见、调用即炸"（宿主 load 时校验注册 `source` 字段，之前未传）；两包各发 0.1.1，附真实 SkillRegistry 往返测试

## 2026-08-22 —— 第一波：dsh-web-basic 成员首发

- 10 个插件首发 npm，统一 0.1.0：ankh-guard、context-guard、file-preview、ui-file-preview、message-tools、message-timeline、session-title-edit、taskpilot、ui-shortcuts、whalesong(message-tools 此前内部迭代至 0.4.x，公开线从 0.1.0 起）
- local-agent 家族（7 包）member-channel 适配收尾中，第二波整体发布
- datasets / lab / mission 为孵化中在途工作，不在发布线
