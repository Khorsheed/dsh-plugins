# Agent Note: a preset scope only where the host will write one

Status: implemented

## Problem

`@khorsheed/dsh-capability-catalog` 的 skill 详情弹窗随着 preset-scope 投递功能长出了「生效的 preset」区块：每个 preset 一个勾选框、一个「保存」按钮，受管 skill 还多一个「释放回用户技能目录」。它给**每一个** skill 都渲染了这套网格。

host 只会在一个地方写这个范围：`setManagedPresetScope` 重写插件自己受管根里某个 skill 的 `presetScope` frontmatter，其他一切情况答 `"<name>" is not a managed skill`。于是插件提供的 skill（`source: runtime`，例如 `inline-html-render` 的 `3d-artifact`）或内置 skill（`source: bundled`）拿到的是一个「保存」必然失败的控件，还被呈现成「它的模式可以由你选择」。这类 skill 在哪些模式生效，其实由**该插件在每个 preset 组合里的那一行**决定——这个事实 UI 手里有，但没有显示。

同一个弹窗也给用户/项目根里的 skill 提供了「保存」，而那里唯一的写路径是 `presetScopeAdopt`：勾选是 adopt 装进去时的范围，那个「保存」同样是必然被拒的。

## Decision

`scopeEditorFor` 现在带 `writable`（受管**或**可 adopt）与 `provider`（该行提供的插件），弹窗据此分支：

| 行 | 区块 |
|---|---|
| 在受管根 | 网格 + 保存 + 释放回用户技能目录 |
| 用户 / 项目 / 自定义根 | 网格 + 移入受管目录并可限定 preset，没有「保存」 |
| 插件提供 `runtime` | 说明是哪个插件决定的 |
| 内置 `bundled` | 说明由部署决定 |
| 没有 roster / 没有受管投递 | 既有的不可用提示 |

对不可写的行，区块是**保留**而非隐藏：一个悄悄没有编辑器的 skill 是用户从 UI 里答不出来的问题，而一行解释（「由插件「inline-html-render」提供：…不能在这里单独限定」）答了它，并指向模式视图——那里显示它实际在哪儿加载。

## Alternatives considered

**对不可写的 skill 直接隐藏该区块。** 最简单，也是面板 owner 自己的措辞会引向的选项。否决，因为「缺失」才正是让人困惑的状态：同一个弹窗给旁边的 skill 显示编辑器，屏幕上却没有任何东西说明为什么。一句说明每语言只花一个字符串。

**保留网格但禁用。** 被禁用的网格依然主张「这个 skill 拥有这个范围」；错的是这个主张，不是可交互性。

**让 host 也替插件提供的 skill 写范围。** 超出本插件的职权：那些 skill 由它们的插件注册，它们被哪些模式加载属于组合，不是 catalog 拥有的某个单 skill 文件。伸手去写别的包的 skill 源，也会打破 catalog「registry 的消费者、从不是贡献者」的边界。

## Consequences

- preset-scope 编辑器不再生产一类本可避免的写入失败（`is not a managed skill`），也不再暗示这个部署并不具备的能力。
- 传给弹窗的字段多了一对（`writable`、`provider`），于是卡片那边的 scope-editor 面描述的是「这个 skill」，而不只是「这个部署」。
- 没有 roster 的部署仍显示不可用提示；这次诚实化改动没有改那条路径。
- 由 `tests/capability-catalog-card.client.spec.tsx`（插件提供/受管两种情形分别渲染说明/网格与保存）与 `scopeEditorFor` 的单元用例覆盖。
