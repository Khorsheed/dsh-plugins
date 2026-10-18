# Agent Note: video-studio —— 选中菜单换宿主材质 + AI 帮改的会话框接力

Status: implemented

## Problem

在生产实例上回顾已上线的 M1 时暴露出两个缺口：

1. 选中气泡不像宿主：蓝色描边、在 macOS 上渲染成彩色 emoji 的文字符号（红色的✂）、红色的「剪掉」行——而宿主自己的选中菜单和 quote 包的 `SelectionMenu` 都是半透明菜单材质、发丝级 elevation 描边、统一的图标行。面板的空状态和吸顶/吸底栏也同样早于宿主的 elevation 材质。
2. 机械清理（查找替换、语气词/停顿扫描）之外的事，都得自己在会话里手写需求。而且如果由面板发起 LLM 调用，请求过程、模型、token 花费都不可见——所以面板永远不该直接调模型。缺的是一个一键接力：把一份写得不错的需求草稿填进会话输入框，让用户补完再发。

## Decision

- **选中菜单重建在官方 Menu 材质上**（quote 包 SelectionMenu 的配方）：半透明的 `--dsw-specific-menu` 表面加背景模糊（老宿主上回退为不透明的 `--dsw-alias-bg-layer-1`）、发丝描边（`--dsw-elevation-stroke-color` = `border-l1`）配 `elevation-prominent` 阴影（缺 token 时有回退阴影）、16px 圆角、统一的 14/22 菜单行配 14px 内联 SVG 图标（`label-secondary` 色）。图标落在新的 `src/client/icons.tsx`，按宿主 16×16 / 1.3 描边网格绘制；钢笔图标沿用宿主 list-pen 图形（经由 quote 的生成拷贝）。「剪掉」去掉红色——宿主菜单没有彩色行。定位仍是列表内 absolute（面板规范禁止 `fixed`），外加点外部关闭和 mousedown 拦截（动作执行前选区不塌）。
- **面板其余部分对齐同一材质**：空状态 hero 去掉虚线卡片，换宿主 guide 配方（15px/500 标题、三级色 13px 说明、一个主按钮）；查找栏、播放栏、撤销栏从边框改为发丝描边 + prominent 阴影；控件圆角 7→8px。主按钮保持 business 蓝——panel-design.md 把纯黑实心留给宿主自己。
- **AI 帮改**：文稿 tab 的动作，把一份点名当前绑定工程的校稿/精简需求草稿填进**当前会话**的输入框——绝不发送。机制是图书馆的 `primeConversation` 模式（`sessions.scope(id).get('conversation').input`，结构化探测，失败回退剪贴板并在面板上提示）。这个 tab 只在剪辑模式会话挂载，`video_*` 工具必然在场；工具侧按会话绑定解析工程（`resolveProject`），所以草稿里不需要任何 id。agent 做的所有改动都以提议组落在面板上等 ✓；请求过程、模型、token 花费留在宿主会话界面——它们本来该在的地方。

## Alternatives considered

- **面板侧直连 LLM、自造请求/用量日志**：否决——没有合规的插件→模型服务，成本/模型可见性会变成插件自己的负担，还会绕开提议纪律。
- **每次帮改新建一个剪辑模式会话（eval/datasets 模式）**：否决——面板是会话绑定的且只在剪辑模式会话出现，当前输入框永远是对的落点；新会话只会丢掉用户的上下文。
- **保留红色的「剪掉」行**：否决——参考系是宿主菜单的统一行；剪切的破坏性由撤销条和原始视图表达，不靠菜单颜色。
- **纯黑实心主按钮（room 空态那样）**：否决——panel-design.md 把纯黑实心留给宿主；宿主 Button 的黑底是宿主自己的特权。

## Consequences

- `VideoPaneInjected` 新增 `primeConversation(text): boolean`；客户端已有的 `sessions` inject（原为 preset 可见性声明）同时服务输入框接力。
- `TranscriptTab` 新增 `report` prop（ProjectScreen 的 notice 通道）用于帮改反馈。
- `src/client/icons.tsx` 是手工维护的图形；以后加菜单行按同一 16×16 网格、1.3 描边、currentColor 绘制。

## Testing

`pnpm --filter @khorsheed/dsh-video-studio build` 全绿（gen-typert + tsc + tsdown），包内 vitest 29/29，`pnpm check:panels --package packages/video-studio` 零错误；部署 3080 后按两种主题截图复核（桌面面板）。
