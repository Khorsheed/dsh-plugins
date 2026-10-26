# Agent Note：多个合集插入同一行时设置写入被拒

状态：已实现

[English](2026-10-27-settings-write-refused-by-duplicate-rows.md) | 中文

## 问题

在装了好几个模式合集的 profile 上（3080 装了 dev、eval、gamedev、video，桌面版装了 dev 和 gamedev），local-agent 的设置卡片什么都改不了。比如关掉 DeepSeek 委派（enabled）或某家的「常驻模式」开关，卡片显示「已保存」，但开关停在原位，重启也没用。

原因是每个合集的配置都会插入 local-agent 这一家的同一组插件行：`local-agent`、`-kimi`、`-codex`、`-claude-code`、`-dsh`。用 `dsh --profile web --dump-config` 导出合成后的配置，`- id: local-agent-dsh` 出现了四次，加载器只保留其中一个实例运行。宿主的 `ConfigEditor.edit`（harness 1600d8a1e1 的 `packages/boot/config-editor/src/index.ts:137-140`）写入前会用 `flatten(...).find(row => row.id === id)` 找到对应的行来核对，而 `find` 拿到的是**第一个**重复行，也就是某个合集插入的、没带配置的那一行。核对因此失败，报 "Configuration for … is overridden by a home patch or command-line overlay"，文件根本没写。客户端的 `ConfigForm.set` 遇到拒绝时返回 `false`，并不抛错；而卡片把任何返回都当成了成功。

我们在临时实例上用 3080 的组合复现过：装四个合集时，dsh、kimi、codex 的写入都被拒，只被插入一次的行能正常写入；只装一个合集时，每个开关都能写入，界面也立刻更新。

## 决定

- **卡片如实提示。** 四个驱动的卡片把 `false` 当作写入失败，显示「保存失败」而不是「已保存」，开关保持宿主那边的值。
- **根因暂不定。** 重复插入需要做个选择：
  - 让宿主写入前的核对和加载器挑同一行（用 `findLast`，或者直接对比加载器实际用的那一行）。宿主我们不能直接改，要走上游变更流程。
  - 或者让我们的合集不再各自插入这一组插件行。但合集依赖的成员包，它们自带的配置不会生效，所以只要两个合集都需要 local-agent，就躲不开重复插入。
  由负责人决定。

## 考虑过的方案

**把重复插入当作无害。** 否决：只要同时装了两个合集，这些共用插件行上的可热更新设置就全都写不进去。

## 后果

- 根因修好之前，装了两个模式合集的用户改不了这些设置；现在卡片至少会提示保存失败。
- 其他被多个合集共同插入的行（room、worktrees、typesafe、context-lens）很可能也有同样的问题，没有逐个核实。
- 测试：写入被拒（`set` 返回 `false`）时显示「保存失败」，开关不变。
