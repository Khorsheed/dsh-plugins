# Agent Note: 宿主 0.2.2-rc.3 分两轮适配

Status: implemented

[English](2026-11-13-host-022-rc3-adaptation.md) | 中文

## Problem

宿主 0.2.2-rc.3 紧随大规模 rc.2 迁移发布。它新增官方实验性 DeepSeek 官网会话导入、一个新建会话操作 HOC 槽，以及带第三个目录流程槽的可复用工作区选择器。社区需要精确兼容基线与能力复核，但把每个相似官方功能都视为整包替代，会重演标题编辑的工作流回退。

既有基线只钉了部分官方包。真实全新安装显示，仍留在旧预发布区间的包（包括 `ui-workspace`）不会自动解析到新 RC。因此，即使固定 CI 标签正确，只升一部分版本也会形成混合类型面。

## Decision

采用两轮。第一轮更新开发与 CI 基线，对精确 rc.3 源码验证全部插件，只做必要的增量适配。第二轮分别评估产品整合，要求真实 Session 与浏览器证据，不悄悄并入这次兼容发布。

仓内实际使用的 117 个官方 dsh 包在 `pnpm-workspace.yaml` 中统一钉到 0.2.2-rc.3，Cordis 与 Schemastery 的独立版本钉保持不变。锁文件不再有 rc.2 实解。CI 与发布 workflow 使用 `dsh-v0.2.2-rc.3`；前瞻兼容 lane 与稳定 lane 一样使用 Node 24.9，符合宿主引擎下限。现有宽 peer 区间与各包 `minHost` 不变，`verifiedHost` 只随对应验收证据推进。

移动端除两个旧目录流程槽外，也把现有目录面板注册进 `workspace.picker.directoryFlow`。可复用选择器（包括官方可选导入器）因此使用移动流程。`uiWorkspace.pickDirectory` 适配继续保留：新 Factory 选择或创建 Workspace，而 Room、datasets、video-studio、capability-catalog 与 canvas-novel 需要的是不产生该注册副作用的任意目录路径。

官方导入器产生普通持久 Session。消息工具、消息时间轴、Context Lens、file-preview、TaskPilot 与 quote 因而可以直接在导入历史上验收，无需复制 ZIP 解析或冷写入实现。可复用工作区选择器是画布与评测后续整合点。新建会话 HOC 槽目前没有需要迁移的 DOM 消费方，本波不会为了用新槽而发明功能。

没有整包退役。标题原位编辑继续留在 basic。Room、Context Lens、Transcribe、Worktrees、Local Files、Ankh Guard、Quote 与 SideChat 仍有官方未覆盖的职责。S8、S10、S12、S13、S14、S15、S17、S19、S20、S21、S22、S23 仍未解除；S2 的 bash 写入上报缺口与 S5/S7 同样保留。官方导入器没有开放自定义模型角色恢复、通用插件事件转发或任意路径选择。

## Alternatives considered

**一次发布同时升版并采用全部新能力。** 否决：依赖解析与第三个移动目录流程槽属于兼容工作，画布/评测工作流变化和导入 Session 的产品验收则有不同风险与 owner。

**只沿用 rc.2 已钉的包集合。** 经真实构建失败后否决：`ui-workspace` 实解为 0.2.0-rc.2，新槽不在类型表中。现在所有官方 dsh 包共用同一 RC，不再依赖对预发布区间的猜测。

**所有目录选择都改用 `workspace.picker`。** 否决：选择 Workspace 与选择任意路径是不同操作。画布的多选工作区列表以后可以增加添加流程，但 datasets、Room 和其他原始路径消费方不能整体迁移。

**再次退役标题编辑，或把导入器当作通用 Session API 解锁。** 否决：用户已明确保留原位编辑；导入器既没有改变在线 append/projection 限制，也没有满足未决接缝条件。

## Consequences

第一轮隔离在 worktree 中，不因此切换生产检出、写 profile、重启实例、发布 npm 或 push。官方导入器仍是实验性可选 bundle，不默认加入 basic。第二轮各项分别验收：导入工具卡与统计、工作区选择器的产品改动，以及任何兼容路径删除。

移动端记录与中英文参考现在描述三个公开目录流程。真机/网络矩阵完成前仍不声明 `verifiedHost`。接缝登记处记录 rc.3 审计，并修正「标题编辑保持退役」这一过时说法。

## Testing

精确 rc.3 worktree（`38a6a5c965aa`）已在 Node 24.9.0 下完成依赖安装、`build:lib`、`build:web` 与原生 addon 构建。移动端构建及 32 个测试文件、176 项测试通过，包括三槽注册契约。锁文件不再出现 `0.2.2-rc.2`，`ui-workspace` 实解为 `0.2.2-rc.3`。

真实 Loader/Chromium 组合同时挂载移动端与官方导入器。桌面打开导入对话框后切换到触控尺寸的移动视口，经可复用 Factory 选择添加工作区并输入新路径，页面显示移动目录面板，Host 工作区注册表随即创建该工作区，页面错误为 0。这是浏览器组合证据，不等于完整真机资格验收。

干净 `pnpm gate --all` 在 583 秒内通过全部 17 步：全仓构建与测试、检查器测试、组合与文档门禁，以及 42 个包 tarball 验证。冷安装仍只能由 CI 覆盖；本次不宣称已经部署生产或完成真机资格验收。

## Related

- [宿主 0.2.2-rc.2 适配](2026-11-12-host-022-rc2-adaptation.zh.md)
- [移动端目录选择留在手机内](../bug-fix/2026-09-13-mobile-directory-browser.zh.md)
- [上游接缝登记处](../../../../docs/upstream-seam-registry.md)
