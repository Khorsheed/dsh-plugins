# Agent Note: 剪辑台——剪辑 tab 在非剪辑模式会话自隐

Status: implemented

## Problem

M1 proposal 让剪辑右栏 tab 无条件常驻（「部署级工作区，不做会话级自隐」)。实际用起来，每个会话——写代码、聊天——都挂着一个剪辑台，而用户只在剪辑模式会话里剪片子。用户拍板：tab 和工具都只属于剪辑模式。

## Decision

tab 类型只在「当前会话能触达 `video_*` 工具」时注册——判据是官方 `pluginInventory` Remote：会话 preset 组合里的 `@khorsheed/dsh-video-studio/tool` 行（该行只由 preset 挂载、profile 根从不挂；保留根行检查作为兜底第二路径）。`src/client/preset-visibility.ts` 是 canvas 双查模块的内联拷贝（含 `RegistrationToggle`)，遵守 docs/plugin-visibility.md 的保持拷贝规则。所有读不到的路径一律 fail-open；标准模式是宿主内建 `standard` preset，组合里永远没有该行，tab 如愿隐藏。tab body 槽保持注册（canvas 的两阶段挂法）：类型被注销的已开 tab 渲染宿主设计的 `tab.unavailable` 兜底。

工具和技能本来就随 preset 走（`./tool` 行由 `preset-dsh-video` 按会话授予），无需改动。preset 本身从「写作模式的精简拷贝」改成独立组合：persona + fs（找录音路径）+ skill 加载器 + compaction + ask-user + todo + video-studio 工具行。shell 行（bash/pwsh）删除——shell 是绕过剪辑「提议-确认」纪律的万能出口；web 删除——不是剪辑的工作流。

## Alternatives considered

- **面板保持常驻（M1 proposal 的原决定）。** 面板没有工具也能用，但用户的产品决定是：剪辑是一种模式，不是常驻装置；判据有真值（工具行），canvas 的「恒假」事故条件不成立。
- **组件级隐藏（`return null`）代替注销类型。** 会在 tab 选择页留下空壳按钮——规范要求注册级 toggle。
- **preset 保留 bash/web。** 逐行否决：剪辑流程用不到它们，每个多余的工具都是剪辑会话白白付出的提示词面积。

## Consequences

- client 半的 `inject` 补上 `'sessions'`（判据要读会话列表）；缺了它客户端插件启动即崩，只报一句「did not activate」——这类失败只有真机刷新才看得见。
- 会话布局按会话存储：剪辑模式会话里打开的剪辑 tab 留在该会话的布局里；标准模式会话里残留的已开 tab 按设计渲染 `tab.unavailable`。
- 空白草稿的模式 chip 一切换，判定即时翻转（草稿的 preset 投影就地更新）——同一个草稿在标准/剪辑两模式间来回切换实测验证。

## Testing

3197 临时实例实测：全新标准模式会话 → tab 选择页没有剪辑入口；同一草稿切成剪辑模式 → 类型注册、面板正常打开；切回 → 注销，残留已开 tab 渲染宿主的不可用兜底；线上抓包 `pluginInventory.list()` 确认精简后的 dsh-video 行组成。过程中两次误判（把 workspace 的 treeitem 当成会话、把残留的已开 tab 当成选择页入口），靠临时插桩 `__vsVisibility`（已移除）读真值后才定位——教训：先确认点击的是会话，再确认看的是入口。
