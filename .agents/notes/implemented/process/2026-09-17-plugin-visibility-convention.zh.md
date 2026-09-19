# Agent Note：插件可见性规范文档——判据轴是内容，不是座位

Status: implemented

[English](2026-09-17-plugin-visibility-convention.md) | 中文

## 问题

「开发模式插件的 sidebar 该不该在别的模式显示」反复以单包问题的形式出现，而答案散落在各处：mode-switcher 提案的 C 节、五份同构内联拷贝（eval / mission / datasets / room，外加 worktrees 徽标变体）、以及 2026-09-16 的 canvas 自隐回滚——那次回滚正是一个包给这个问题选错了层的产物。每个插件各自发明判据，canvas 的错误就会重演。

## 决定

约定收敛到一处：[docs/plugin-visibility.md](../../../docs/plugin-visibility.md)，AGENTS.md 的 Package conventions 指向它。文档钉死三条规则：

1. **三层分工，由 surface 的内容绑定谁决定，不由口味或座位决定。** 内容绑定会话的 surface——会话 chrome（`conversation.view` tab、会话头徽标）以及渲染当前会话状态的框架级入口（worktrees 右栏 tab）——按官方 preset 组合数据自隐，一切读不到的路径 fail-open（含无会话的首页状态）。内容跨会话的 surface（canvas 空间这类部署级工作区）归安装层——不该显示入口的 profile 就不该装这个包。实例级开关走行 config（经插件自己的 Remote 送达浏览器——web boot 组合 client entries 不带 config）。
2. **sidebar 的答案是「看内容」，不是「永远不行」。** host 的 tab 注册表与 slot API 没有任何可见性谓词（0.1.5 已复核），但 `register` 返回 disposer，且「类型已注销」是设计好的 fallback——`tab.unavailable`，host 注释明写「a kind with no registrant is a real state, not a defect」——已打开的 tab 按会话存储，未授予会话的布局里本就没有它。内容绑定会话、伴生行被某 preset 引用的右栏 tab 两个前提都满足，可以用同款注册级 toggle 自隐（worktrees 右栏 tab 是样板）。canvas 回滚的根因现在精确表述为：canvas **两个前提都不满足**——任何 preset 都不引用的纯 UI 包 + 跨会话工作区——叠加 preset 只在建会话时可选的事实：框架级 surface 在有会话之前没有 preset 输入。声明式显隐留在上游诉求清单（mode-switcher 提案的可选 `visibleWhen` 增强）。
3. **模式保持内联拷贝。** 五份 preset-visibility 拷贝刻意不抽 helper——mode-switcher 提案 M3' 把抽取决策推迟到第 5 个新消费者出现，文档记录了这个拍板，免得有人提前「顺手整理」。

## 修订记录（2026-09-17，当日）

本 note 初版把判据轴画在**座位**上：「跨会话 surface（右栏 tab……）一律没有运行时开关」。协调者用 canvas 案例反驳——画布消失不是会话出了问题，而是框架级 surface 在有会话之前根本没有 preset 输入——并提出框架级 sidebar 入口应像 conversation tab 一样可门控。复核 host（`ui-sidebar-right` 的 tab 注册表：disposer 语义、按会话存储的已打开 tab、设计好的未注册类型 fallback）后确认：对内容绑定会话的 surface，机制成立。判据轴从座位改为内容，记入上文规则 1–2 与文档的「判据轴」一节。

## 放弃的替代方案

- **现在就抽 helper 包。** 按既有 M3' 拍板否决：四份同构拷贝加一个变体还不足以换来一个共享居所，无人拥有的 helper 会变成第五个分叉点。
- **做「preset → 可见性」注册表/配置中心。** mode-switcher 提案已否决：preset 组合文件是唯一事实源，`pluginInventory.list()` 已经提供。
- **给 sidebar API 打客户端谓词补丁。** 那是上游改动；仓库规则是 host 改动走上游提案管道，提案已在跟踪这个诉求。如实写文档胜过把 canvas 实验重跑一遍的本地绕行。

## 影响

- 新文档 `docs/plugin-visibility.md`（中文，与 docs/development.md 的单语惯例一致）；AGENTS.md 增加「Mode visibility (self-hide)」约定条目；docs/packages.md 的 `preset-composed-row` 条目指向该文档。
- 已知缺口记录在文档里而非本次修掉：slash 命令与 local-agent 家族的设置卡仍无条件注册（提案 M3' 的推广待办）。
- 本次不动任何包代码、测试与 profile 组合；约定的行为内容早已由五份现有实现落地。

## 验证

纯文档与政策。复核了引用的每一处来源：room 模板（`packages/room/src/client/preset-visibility.ts`）、eval 消费方（`packages/eval/src/client/index.ts`）、canvas 回滚 note、以及文档中引述的 host 注册表形状。

## 相关

- [mode-switcher 提案](../../../proposals/active/2026-08-26-mode-switcher.md)（C 节，约定的源头；M3' 持有推广待办）。
- [canvas preset 自隐回滚](../feature/2026-09-16-canvas-preset-self-hide-reverted.md)（本文档将其升格为规则的那次事故）。
- [worktrees 徽标 preset 门](../feature/2026-09-10-worktrees-badge-preset-gate.md)（最早的模板 note）。
