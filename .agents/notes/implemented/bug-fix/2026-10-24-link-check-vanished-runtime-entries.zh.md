# Agent Note: 部署链接检查跳过扫描途中消失的条目

Status: implemented

## 问题

`pnpm deploy:3080` 在 profile 安装之后中止,报 `dependency link check failed: ENOENT ".../local-agent/member-bridge.sock"`,当天部署的每个 agent 都遇到过。这个检查(`scripts/dependency-links.mts`)先列出 `$DSH_HOME` 每个目录的条目,再逐个 lstat。运行中的实例一直在这里重建运行时文件:成员桥会删掉再重新绑定 `local-agent/member-bridge.sock`,成员收件箱和控制存储会写临时文件再改名。如果一个条目在列出之后、lstat 之前消失,lstat 就抛 ENOENT,检查把它当成失效的依赖链接报出来。其实什么都没坏:socket 本来就按设计被忽略,只是条目刚好不在了。协作间和本地 agent 用得越多,部署撞上这个竞态的次数就越多。

## 决定

经由目录列表发现、但 lstat 时已经不在的条目直接跳过。其余行为不变:目标不存在的符号链接仍然报出(带上目标),扫描根不存在仍然报出,不可读的目录仍然报出。目录列表改为可注入(`LinkScanIo`),让测试能列出一个已经不存在的条目。

## 备选

**按名字排除 `member-bridge.sock`(或整个 `local-agent/`)。** 否决:它旁边那些「临时文件再改名」的文件会撞上同一个竞态,以后任何新的运行时文件也会让问题复发。

## 影响

部署不再和运行中实例的运行时文件抢时间。`$DSH_HOME` 或 harness 里真正失效的链接仍会在重启前拦下部署。

## 测试

`scripts/dependency-links.spec.ts` 新增一例:列表里有一个已消失的 `member-bridge.sock`,旁边是一个真正失效的链接,结果只报出后者。去掉跳过逻辑时这一例失败,加上后 7 例全过。对真实的 `~/.dsh-official` 与 harness 检出跑 `checkDeploymentLinks` 干净。
