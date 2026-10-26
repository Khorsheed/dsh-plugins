# Agent Note:host-021 message-tools 图片——就地消费 conversation.images.content 工厂

Status: implemented

[English](2026-10-18-host-021-message-tools-images-factory.md) | 中文

## 问题

宿主 0.2.1-alpha.3 从 `ChatNodeOwnerProps` 删除了 `renderMessageImages`:单一图片槽位拆分为 `conversation.chat.user.images` / `conversation.chat.message.images`（作为 ui-chat 自身注册的 children 声明，只有官方 `UserContent`/`AssistantNodeView` 有权渲染），官方画廊收进 ui-attachment 提供的 root 作用域 `conversation.images.content` 工厂。message-tools 以 priority -1 遮蔽官方 user/steering 渲染器并拥有撤回分隔线，图片区由它自渲染，在 0.2.1 下失去了这个面。波次批次 2 留下的编译级 shim（本地可选 prop，在 0.2.1 下恒为 undefined）让两个视图只渲染文本。

## 决策

- **就地消费工厂，绝不注册图片槽位条目。** 两个视图在自己的渲染里经共享的 `src/client/message-images.ts` helper 调用 `renderFactorySlot('conversation.images.content', { images, loadImage, align: 'end' })`。`renderFactorySlot` 是框架授予每个渲染器组件的标准席位（ui-slots `ComposedProps` 里的 `PropsRenderFactories`),`loadImage` 仍是 `ChatNodeOwnerProps` 的必需成员，自定义节点渲染器无需新 seam。官方槽位条目正是这样做的——ui-attachment 的 `MessageImages` 适配器把槽位 owner props 转发给同一工厂——所以遮蔽行渲染出与官方逐像素一致的画廊，官方槽位与渲染器不受任何影响。画廊文案缺省取自工厂自己的 `conversation` locale（不传 `labels`)，与官方聊天图片一致。
- **legacy 优先的双路径，不是工厂优先。** 0.2.1-alpha.3 之前的宿主仍透传 `renderMessageImages` owner prop（在其 `ChatNodeOwnerProps` 中为必需），而中间宿主（0.1.6-alpha.2 → 0.2.1-alpha.2）有工厂席位但工厂从不注册——在那里偏好席位会把这些宿主从有图退化为无图。helper 因此在 legacy prop 在场时优先走它，否则走工厂；0.1.5（连席位都没有）legacy prop 恒在场，工厂调用永不执行。兼容 prop 以有据可查的本地可选项保留（`slots.ts` 的 `LegacyMessageImagesProp`)，因为 0.2.1 的类型面不再声明它。
- **缺席按设计降级为不渲染。** 渲染器的 `FactoryOutlet` 在工厂未注册时返回 `fallback ?? null` 并订阅其到来，所以未组合 ui-attachment 时不渲染图片，插件晚到则自愈——与官方图片槽位空缺时的行为一致。不做 apply 期探测（`ctx.slots.snapshot('factory:…')`):apply 顺序不受约束，而活体 outlet 让它没有必要。

## 放弃的备选

- **注册自己的 `conversation.chat.user.images` 条目**（在该槽位遮蔽 ui-attachment 的画廊）：否决——该槽位是 ui-chat 与官方 `UserContent` 共享的 child 声明；低优先级条目会连带替换*官方*用户渲染器里的画廊，违反波次简报（「不干扰官方节点」)，还会耦合到一个 owner props 不受我们控制的槽位。
- **席位在场即工厂优先**：否决——会把 0.1.6-alpha.2 → 0.2.1-alpha.2 宿主（席位在、工厂永不注册、legacy prop 可用）从有画廊退化为无画廊。
- **保留批次 2 的纯文本 shim 直到 minHost 升到 0.2.1**：否决——波次钉在 0.2.1-rc.1,shim 让波次目标本身处于降级态；双路径成本低廉且 minHost 不动。

## 后果

- 两个视图在宿主 ≥0.2.1-alpha.3 渲染官方画廊，在更早的支持范围内宿主保持 legacy 画廊；minHost(`0.1.5-rc.1`）与 engines 区间不变。
- `RenderMessageImagesShim`/`RenderMessageImagesShimProp` 与所有 `TODO(host-021 batch-3)` 标记移除；两个客户端 spec 现覆盖工厂调用形状、legacy 优先与工厂缺席的不渲染分支。`pnpm --filter ./packages/client-message-tools run build && pnpm --filter ./packages/client-message-tools test` 全绿（229 测试）。
- 无需新的上游 seam：现有工厂席位加常驻的 `loadImage` owner prop 已覆盖自定义节点渲染器的图片需求。
- 两个 README 改述正式消费，取代批次 2 的降级描述（配对 sidecar 已重录）。
