# Agent Note：让账号通知在普通 Web 上获得所需的账号服务

Status: implemented

[English](2026-11-13-account-notifications-web-activation.md) | 中文

## 问题

Web 启动覆盖层禁用了 `ui-settings-account`，却保留了 `ui-account-notifications`。通知客户端的 `inject` 依赖由账号设置客户端提供的 `accountUi`，因此内置插件页面一直报告账号通知正在等待激活。覆盖层中的理由来自旧假设：账号设置只支持 Desktop；当前官方实现明确同时支持 Desktop 和普通 Web 客户端。

## 决策

在普通 Web 客户端启用 `ui-settings-account`，同时保留 `ui-account-notifications` 和账号后台。无需修改上游源码，也不绕过通知插件的必需依赖。启动覆盖层现在明确说明这两个客户端必须配套。修改前已在部署状态的替换备份目录中保存原覆盖层。

## 未采用的方案

**同时禁用账号通知。** 否决：这只会隐藏报错并移除功能，并没有修复依赖。启用提供方既保留官方交互，也不破坏 `accountUi` 的必需约定。

**由社区插件伪造或绕过 `accountUi`。** 否决：这会复制官方所有者，并用另一条兼容路径掩盖配置不匹配。官方账号设置已经支持普通 Web。

## 影响

内置账号设置现在能够提供 `accountUi`，通知客户端可正常激活。本次修改不读取或合成账号凭据，通知轮询仍由账号登录状态决定。修复落在生产启动配置中，不是官方包的 fork。

## 验证

真实 rc.2 Web 组合打开内置插件清单，展开全局插件分组，显示 `Account notifications`，未出现 `waiting for activation` 或页面错误。验收位于 `packages/basic/tests/account-notifications.host.spec.ts`。

rc.3 复验覆盖未登录时的登录菜单项、与宿主清单一致的版本号、账号通知激活及无页面错误。未登录时不显示账号设置页是官方规则，不是插件回退。测试不启动外部授权，也不读取凭据。

## 相关

- [宿主 0.2.2-rc.2 适配](../process/2026-11-12-host-022-rc2-adaptation.md)
- [完整客户端构建保留版本元数据](2026-11-13-complete-client-build-metadata.md)
