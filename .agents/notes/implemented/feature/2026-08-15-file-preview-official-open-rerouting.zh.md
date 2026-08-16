# Agent Note: 把官方文件打开改道进文件预览抽屉

Status: implemented

[English](2026-08-15-file-preview-official-open-rerouting.md) | 中文

## 问题

[文件预览抽屉](2026-08-14-file-preview-side-drawer.md)让插件自己的表面实现了就地预览，但两个官方文件入口仍然打开宿主 OS：产出文件行的 chips（ui-deliverables 的 `ProducedFiles`，onClick 闭包持有对话视图注入的 `openFile`）与结尾正文 mention（单例提供的 `chatFileMentions` 服务——cordis 会以 "service has been registered" 拒绝第二个提供者）。两个表面都没有第三方可覆盖的 slot、服务或事件，而插件的分发约束禁止修改核心包。调研还纠正了抽屉笔记里的一个错误前提：`conversation.chat.turnTail` chain 并不渲染所有注册条目——选举按 priority 升序取第一个 `select` 非空的条目（`packages/client/web-react/src/scoped-slots.tsx`），因此在默认 priority 0 下插件行与官方行本来就每回合互斥，由注册顺序决定胜者。

## 决策

两个增量机制把每个官方文件入口改道进抽屉，两处都标注了 `TODO(official-opener-seam)`，写明退役条件与每次官方升级时的复查清单。

**产出文件行的 chain 抢占。** 插件的 turn-tail 条目以 `priority: -1` 注册，`selectTurnFiles` 把自己的变更文件词汇表（write/edit 的 `file_path` 参数，加上来自 diff 调用视图的逐文件行数增减）与官方 `deliverables` 回合数据求并集（通过对 `@deepseek-ai/dsh-client-ui-deliverables/client` 的纯类型导入做结构化读取——client bundle 纯度门禁止对 `producedForClosing` 的跨插件值导入）。该条目渲染一张"N 个文件已修改"的变更卡片，卡片中的文件行打开抽屉：它认领每个有文件变更的回合，官方条目不再挂载，其 OS 打开 chips 随之消失。ui-deliverables 被取消组合时，`deliverables` 键缺席，并集一致降级。若上游 chain 语义变更，最坏结果是官方行重新出现——静默退回之前的行为，绝不崩溃。

**正文 mention 的捕获阶段拦截**（`mention-intercept.ts`）。没有任何 slot 或服务接缝够得着 mention 的 `open` 闭包，因此 document 级捕获阶段点击监听器先于 React 17+ 的根容器监听器运行，改道确认的命中。三道闸门保证它永不认领外来按钮：`code > button[title]` 结构、绝对路径形态的 `title`、以及标签等于路径或其 basename；插件自己的表面（`[role="dialog"]`、`[data-turn-file-row]`）被排除，任何无法识别的目标原样放行（fail-open——最坏结果是官方 OS 打开）。用 `click` 而非 `pointerdown`，键盘与辅助技术激活以同样方式被拦截。监听器挂在 `ctx.effect` 上，插件卸载即移除。

## 备选方案

**上游 opener 接缝**（对话视图 `openFile` inject 先查询的可选 opener 服务，或可替换的 `chatFileMentions`）。最干净的修法——一处接缝覆盖两个表面、零 DOM 依赖——但上游目前不接受 PR。作为退役条件记录在 `TODO(official-opener-seam)` 标记中，未实现。

**遮蔽 keyed `assistant-step` 对话节点渲染器。** 更高 priority 的 keyed 条目能拿到同样的 owner props（含 `fileMentions` 与 `openFile`），不做 DOM 工作即可接管 mention 点击。已否决：它必须重渲染整条 assistant 消息——markdown、步骤、操作行——并放弃上游对 `AssistantNodeView` 的一切后续改进，维护成本远高于一个点击监听器。

**包装 `workspaces.openPath`。** 已否决：它是所有调用方（工具行、show-in-folder、目录）共享的宿主 RPC 通道，不是可按表面替换的对象。

**两个表面都纯 DOM 拦截**（早期方案）。对产出文件行已否决：chain 已经通过公开 API 管辖该表面，在那里依赖非官方的 `data-produced-files-row` 属性是严格更差的选择。

**抢先提供 `chatFileMentions`。** 已否决：第二个 `provide`——ui-deliverables 自己的——会在加载时抛错，把改道变成启动失败。

## 影响

每个官方文件入口都能就地预览，核心零改动，且抢占那一半完全没有 DOM 依赖。代价是：一个 document 级捕获监听器；一个非官方 DOM 结构依赖，其失效模式是静默退回 OS 打开；以及对另一个插件回合数据的结构化读取，其形状由并集 select 测试钉住。升级复查清单写在两处 `TODO(official-opener-seam)` 标记里：chain 选举保持按 priority 升序 first-match、`deliverables` 回合数据键保持 `{ seq, path }[]` 形状、mention 仍以 `code > button[title]` 渲染且 title 为绝对路径。抽屉笔记中"chain 渲染所有注册条目、两行共存"的说法由本笔记更正。覆盖：并集 select 矩阵与拦截器闸门矩阵有单元测试，另有插件级测试把一次真实派发的 mention 点击改道进抽屉 store。
