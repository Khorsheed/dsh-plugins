# Agent Note：插件可见性规范文档——三层分工，sidebar 没有 preset 开关

Status: implemented

[English](2026-09-17-plugin-visibility-convention.md) | 中文

## 问题

「开发模式插件的 sidebar 该不该在别的模式显示」反复以单包问题的形式出现，而答案散落在各处：mode-switcher 提案的 C 节、五份同构内联拷贝（eval / mission / datasets / room，外加 worktrees 徽标变体）、以及 2026-09-16 的 canvas 自隐回滚——那次回滚正是一个包给这个问题选错了层的产物。每个插件各自发明判据，canvas 的错误就会重演。

## 决定

约定收敛到一处：[docs/plugin-visibility.md](../../../docs/plugin-visibility.md)，AGENTS.md 的 Package conventions 指向它。文档钉死三条规则：

1. **三层分工，由 surface 决定，不由口味决定。** 跨会话 surface（右栏 tab、panellist 行、全局空间）归安装层——不该显示入口的 profile 就不该装这个包；没有运行时开关，也不许临时造一个。会话级 chrome（`conversation.view` tab、会话头徽标）按官方 preset 组合数据自隐，一切读不到的路径 fail-open。实例级开关走行 config（经插件自己的 Remote 送达浏览器——web boot 组合 client entries 不带 config）。
2. **sidebar 问题的答案是「不支持，且属刻意」。** host 的 tab 注册表与 slot API 没有任何可见性谓词（0.1.5 已复核）；把会话 preset 判据套在跨会话 surface 上等于永久隐藏，因为 preset 在建会话时绑定——这正是 canvas 回滚的根因，现从事故笔记升格为常备规则。声明式显隐留在上游诉求清单（mode-switcher 提案的可选 `visibleWhen` 增强）。
3. **模式保持内联拷贝。** 五份 preset-visibility 拷贝刻意不抽 helper——mode-switcher 提案 M3' 把抽取决策推迟到第 5 个新消费者出现，文档记录了这个拍板，免得有人提前「顺手整理」。

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
