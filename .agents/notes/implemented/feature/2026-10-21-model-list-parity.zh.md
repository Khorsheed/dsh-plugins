# Agent Note: codex 与 kimi 共用同一份「可用模型」分节与 models.json

Status: implemented

[English](2026-10-21-model-list-parity.md) | 中文

## 问题

claude-code 此前独占了「可用模型」交互（有序短名单持久化为 `<scopedHome>/models.json`，首项即默认模型，添加弹窗从端点供应目录勾选），而 codex 和 kimi 还是旧卡交互：自由文本 `model` 输入框 + 最近模型建议 + 下拉菜单。三张 harness 卡两套模型编辑交互读起来就是不一致，而且自由文本允许用户钉一个端点根本不供应的模型。

## 决定

一份实现服务三张卡，各家不再留有会分叉的东西：

- **core**（`packages/local-agent`）：`src/model-list.ts` 持有 harness 中立的 `models.json` 读写助手（从 claude-code 搬入，只按作用域目录寻址），从包根导出。`src/client/ModelListSection.tsx` 是整个「可用模型」分节——区块外壳、可拖拽排序的行、逐行删除、端点目录添加弹窗，以及自带状态（激活时读名单、每次手势即写、凭据保存后随 `directoryRefresh` 令牌重读目录）。文案放在 core 词典（`models.*`），像 `ProviderAuthBlock` 的 `authT` 一样以 core 命名空间的 `t` 传入。
- **伙伴包**（claude-code、codex、kimi）：各卡经两个面（`modelList` 读写、`modelDirectory`）渲染 `<ModelListSection>`，面由既有 gateway Remote 支撑；自由文本字段、建议菜单、`harnessModel`/`renderModelPicker` 卡面全部移除。volatile `model`/`recentModels` 配置键保留——它们仍是回退链与成员选择器的词汇。
- **解析链**（codex + kimi，对齐 claude-code）：settings 层变为 `firstModelOf(models.json) ?? model 配置键`，在接线处折叠，于是所有消费方原样搭乘——每轮 spawn argv（provider 的模型解析器现在收到本轮的 scope）、常驻驱动的 spawn 绑定、broker 的 settings 层（broker 传入成员的作用域目录，命名 scope 读自己的名单）、评测快照的 `effectiveSettings.model`（读快照自己的作用域目录）。broker 的候选词汇把非空名单视为**全集**（端点目录外的值混不进成员选择器）；空名单完整回退旧链。

## 考虑过而未取

- 把 claude-code 的编辑器组件复制进 codex 和 kimi。不取：三份拖拽/弹窗逻辑一经修补就分叉——用户要的是一致，core 单组件是唯一不会再次不一致的答案。
- 只搬无状态编辑器、状态留在各卡。不取：状态切片（激活才读、写即生效、凭据保存后刷目录）正是行为差异最容易藏的地方，分节自己持有。
- 升级时把既有 `model` 键值迁移成 models.json 首项。不取：空名单回退链本来就会答出同一个模型，迁移只会多写一份随后遮蔽配置编辑的文件——名单里该有的是用户明确的第一选。
- 用最近模型或 config 发现值给添加弹窗做种子。不取（claude-code 已如此决定）：名单的价值恰在它只能装端点真实供应的模型。

## 影响

- codex 和 kimi 的卡失去自由文本 `model` 字段和生效模型行；`model` 键作为回退继续静默生效（YAML、API 写入），`/<name> status` 照报生效设置。
- `CodexModelBrokerDeps.settingsModel` 与 kimi broker 的对应依赖现在接收作用域目录；两家 provider 的模型解析器接收本轮 scope。命名 scope（评测容器）读自己的 `models.json`，与端点凭据同一机制。
- 有名单时评测条件哈希会变（`model` 因子报首项）——符合预期：模型本就是公平性因子，冻结 run 的回读仍会把中途改动判为 misattributed。
- claude-code 删除本地 `model-list.ts`、`ModelListEditor.tsx`、`models.*` 文案键与编辑器 CSS——卡面与行为逐字节不变，只是改由与其他两家相同的 core 组件渲染。
- dsh harness 仍是旧自由文本字段：它的模型按 `provider/model` 拼写、来自宿主自己的模型选择，端点目录弹窗对不上；要对齐需要先有一个宿主模型目录。

## 验证

- core：`tests/model-list.spec.ts`（搬入的存储用例）与 `tests/model-list-section.client.spec.tsx`（行、默认徽章、删除、拖拽排序、添加弹窗、非激活不读、刷新令牌重读）——391 测试全绿。
- claude-code：共享组件上行为不变——255 全绿；卡片 spec 保留一条注入面接线用例。
- codex/kimi：卡片 spec 重写为分节接线；broker spec 钉住 curated 词汇（非空即全集、为空不动）与作用域 settingsModel——233 + 244 全绿。
- `pnpm check:plugins` 干净；全量构建按依赖序（core → 伙伴）绿。
