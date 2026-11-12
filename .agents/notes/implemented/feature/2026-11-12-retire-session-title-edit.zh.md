# Agent Note：用官方重命名流程退役 client-session-title-edit

状态：implemented

[English](2026-11-12-retire-session-title-edit.md) | 中文

## 问题

社区包通过 DOM 定位在标题旁提供内联编辑器。宿主 0.2.2-rc.2 已提供统一 `session.rename` 对话框：会话菜单、标题双击和可重绑快捷键，并包含空白校验及失败状态。继续保留两套相同操作只会增加 DOM 维护成本。

## 决策

整包退役，不保留另一个内联编辑器或单薄的后台包装。官方交互覆盖了产品需求，标题旁入口不是必须独立保留的要求。两条路径都走 `session.rename`，因此没有剩余的后台职责需要社区包承担。

移除 basic 的 loader 行及成员/依赖/引用三处条目、lab profile 的依赖和 bundle 条目、源码目录与根包列表，并在 `scripts/retired-packages.ts` 登记官方替代。basic 现为 11 个成员，文档指向内建改名入口。历史发布记录和旧 Agent Note 不改写。

回归测试移到 `packages/basic/tests/official-session-rename.host.spec.ts`：真实 rc.2 浏览器从会话菜单打开统一对话框，验证空白名禁用保存，保存新标题并观察刷新。还验证旧 `data-ste-inplace` 编辑器不存在且页面无错误。这证明的是删除后官方能力，而不只是旧插件还能工作。

## 未采用的方案

**因为标题旁交互不同就保留铅笔。** 否决：它只是同一改名的另一条路径，依赖私有 DOM 定位，没有明确需求支撑这份成本。

**保留纯后台插件。** 否决：官方 `session.rename` 已提供持久化和用户标题固定，不再有独立职责。

**未验收官方界面就删除。** 否决：结论来自真实浏览器验收，不是仅比较源码接口。

## 影响

该包不再发布，npm 名称不得重新引入。生产清理需要删除退役依赖及 overrides pin，再经正常 profile 安装流程刷新。无需宿主 fork 或新增 RPC。

basic 的 7 项测试通过，包含真实 rc.2 浏览器流程。源码删除与生产清理是不同操作，不能据此声称已发布 npm 或 GitHub。

## 相关

- [宿主 0.2.2-rc.2 适配](../process/2026-11-12-host-022-rc2-adaptation.md)
- [官方能力整合路线](../../../../proposals/active/2026-11-12-host-022-rc2-official-capabilities.md)
