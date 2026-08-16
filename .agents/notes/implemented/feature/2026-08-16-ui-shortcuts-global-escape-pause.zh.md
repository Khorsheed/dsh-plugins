# Agent Note：Escape 暂停改为全局，带三重让路规则

Status: implemented

[English](2026-08-16-ui-shortcuts-global-escape-pause.md) | 中文

## 问题

Escape 暂停最初是 composer 限定的：只有事件目标在 composer 文本框里才暂停，没点过聊天框的用户无法暂停运行中的回合。当时的限制说明把全局 Escape 搁置了，理由是"共享弹层消费方注册表尚不存在"——模态框、菜单、popupSelect 都用 Escape 关闭，一个无视弹层的全局暂停会在每次关弹层时误触发。

## 决策

Escape 改为全局暂停（仍挂 document bubble 监听），composer 目标门控换成三重让路规则：

1. `event.defaultPrevented`——组件处理器已消费该键（斜杠菜单仲裁、popupSelect）。组件处理器先于 document bubble 监听执行，标志位永远可见。
2. `document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')`——有弹层打开。这些层（Modal、Menu、设置面板、lightbox、斜杠菜单）用 Escape 关闭且不 `preventDefault`，而它们状态驱动的卸载在事件分发之后才落地，所以分发期间 DOM 仍可查。
3. composer 之外的可编辑目标（`[data-composer-card]` 外的 input/textarea/contenteditable）——行内重命名、搜索框保留自己的 Escape 语义。

没有新建弹层注册表；role 查询加事件标志已覆盖当前宿主的全部弹层。

## 考虑过的备选

**保持 composer 限定。** 被产品负责人否决：暂停必须与前一次点击位置无关。

**先建共享弹层消费方注册表。** 否决，投入产出不匹配：注册表是宿主级工程，而 role 查询加 `defaultPrevented` 已能区分宿主现有的每一类弹层。未来若某个弹层不以 dialog/menu/listbox 角色渲染，让路规则退化为"关弹层同时误暂停"——可见、不具破坏性。

**任何可编辑焦点都让路，composer 也不例外。** 否决：composer 文本框是暂停的主表面；其内的 combobox 式弹层已由规则 1/2 覆盖。

## 影响

`pauseCurrentTask` 自身的守卫（无当前会话、未在运行、一次性子智能体）仍是最后一道线——漏网的 Escape 只会暂停一个真正在运行的回合。composer 文本框判定保留为可编辑规则中的排除项。两份 README 删除了"Escape 暂停限定在 composer 内"的已知限制，分层一节改为记录让路规则。
