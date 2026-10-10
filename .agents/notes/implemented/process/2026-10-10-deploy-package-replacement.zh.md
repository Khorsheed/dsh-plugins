# Agent Note: 3080 流程中的显式包替换

Status: implemented

## Problem

Context Lens 更改 request-inspector 的安装身份，但保留服务名。新旧包同挂会重复注册服务；手改 profile 又会绕过部署锁与门禁。用户在普通合并门禁通过后明确要求部署。

## Decision

`deploy:3080 --replace OLD=NEW` 将直接安装的社区包替换为本次明确同发、可自挂载的目标包。校验拒绝替换链、重复身份、未同发的目标及自定义 profile patch 中仍引用旧包的组合。先完成构建与打包，再进行替换写入。在现有部署锁内，流程把 package/workspace/patch 配置备份到宿主 state 目录，删除旧直接依赖、bundles 条目与平铺 override pin，再走官方 add 和既有干净安装。保留旧 tarball。

替换是幂等的，安装失败可重跑同一命令修复。凭证、预检、重启之前验证安装身份；canary 闸保持必需。Context Lens 与 Canvas 错误结果修复一同使用该路径部署。

## Alternatives considered

**手改 profile。** 否决：只有流程拥有 profile 写入与重启验证权。

**暂时同时挂载两个身份。** 否决：二者注册同一服务。

**虚构 family bundle。** 否决：这是替代身份，不是组合家族。

## Consequences

集成测试以隔离命令桩执行真实编排，覆盖替换成功和重试、备份留存、构建失败保留旧登记、非法目标及自定义 patch 拒绝。这是用户要求的改名部署所需的最小流程扩展；用于其他迁移前应由共享流程 owner 复核。与普通部署一样，profile 刷新后的失败仍可能需要重跑流程；备份是恢复依据，不代表自动回滚。不会复制凭据或会话数据。
