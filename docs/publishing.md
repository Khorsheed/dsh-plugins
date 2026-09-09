# 发布到 npm:最佳实践与自查指南

每条都来自真实事故。发布前自查按顺序跑,任何一步不过就停。

## 发布前自查

```sh
npm whoami                                    # 1. 确认账号是你以为的那个
npm view <包名> version                        # 2. 线上最新版本;新版本必须更高(403/409 就是撞这个)
pnpm --filter <包名> run build && pnpm --filter <包名> test   # 3. 构建和测试全绿
pnpm exec tsx scripts/pack-dist.ts --package <包目录> --scope @khorsheed --version <新版本> --out /tmp/dist   # 4. 打包(会做 scope 重写和 files 校验)
tar -tzf /tmp/dist/<包>.tgz                    # 5. 检查 tarball:lib/、cordis.patch.yml、scripts/ 一个不能少
```

## 发布与发布后验证

```sh
npm publish /tmp/dist/<包>.tgz --otp=<认证器 6 位动态码>
npm view <包名> version                       # 确认线上版本已更新

# 消费者验证(必做,30 秒):装进一次性目录,import/跑一次入口
T=$(mktemp -d) && cd "$T" && npm install <包名>@<新版本> \
  && node -e "import('<包名>').then(m => console.log('ok'))"
```

## 失败对照表

| 报错 | 原因 | 解法 |
|---|---|---|
| `requires a one-time password` | 账号开了 2FA | `npm publish --otp=<6 位动态码>`;过期就换新的重试。npm 账号的 64 位十六进制恢复码(recovery code)可直接作 `--otp` 值——但一次性、用过即废,余量不足时在账号设置里重新生成(重新生成会作废旧的一套);恢复码等价于第二因子,不得入库或进公开记录 |
| `403`(版本没变)/ `409` | 版本号 ≤ 线上已发布版本 | bump 版本再发;npm 不允许覆盖 |
| `403`(包名从没发过) | 没有该 scope 的权限 | 只能发自己拥有的 scope(@khorsheed);@deepseek-ai 是官方 org,不要尝试 |
| `Cannot resolve workspace protocol` | package.json 里残留 `workspace:*` 依赖 | 用 `scripts/pack-dist.ts` 打包(它会改写),不要直接对源目录 `npm publish` |
| 装上了但入口缺失/404 | `files` 字段没收产物 | pack 后先 `tar -tzf`;库文件、patch 文件、脚本都要在 files 里 |
| git 源安装后没有 lib/ | 缺 `prepare` 脚本 | package.json 加 `"prepare": "npm run build"`(git 依赖安装时会执行) |
| 消费者侧 `ERR_MODULE_NOT_FOUND` | tarball 内相对导入指向未包含的文件 | 跑 pack smoke:包内每个相对导入都必须可解析 |

## 变更记录与发版标记

每次发版在三个层级记录变更：

- **包自己**:`packages/<包>/CHANGELOG.md` 记完整条目(版本号、日期、功能要点)。
- **monorepo 根**:`CHANGELOG.md` 记一行摘要(什么包、什么版本)。
- **整合包仓**:dsh-web-basic 的 `CHANGELOG.md` 记用户向大白话——仅当该包属于整合包成员时。

发版时打 git tag,格式 `<包名去掉 @khorsheed/dsh- 前缀>-v<版本>`,如 `message-tools-v0.5.0`;并在 GitHub 上建对应 Release(可附 CHANGELOG 条目)。local-agent 家族整体一波发布,tag 逐包打。

每波发布后运行 `pnpm release:status` 重新生成 [release-status.md](release-status.md)(各包 npm 已发布版本 / 仓内版本 / minHost / verifiedHost / 整合包成员一览)并提交——发布状态以此为准,不手维护。

**ankh-guard 镜像同步**:每次 ankh-guard 发版(或其代码进 main 的关键节点)运行 `npx tsx scripts/sync-ankh-guard-mirror.mts`,把 `packages/ankh-guard` 同步到公开的单插件仓 Khorsheed/dsh-ankh-guard。镜像面向"只装这一个插件"的受众:issue 开在镜像仓,PR 回流 monorepo。

## README 图片

包 README 的截图一律用 dsh-web-basic 仓的绝对地址(`https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/<文件>`),不用相对路径——npm 按 `repository` 字段改写相对路径,dsh-plugins 未 public 时会全裂。新增/更新截图时两个仓同步:dsh-plugins 的 `docs/screenshots/` 留档,web-basic 的同名目录是图床,两边文件保持一致。

## 纪律

- **发布源只认仓库**:不从 /tmp、scratch 或任何一次性目录发;所有改动先入库再发。
- **纯 semver，不跟官方宿主版本号**:rc 后缀时代的"版本线跟官方家族走"自第一波起退役——宿主兼容性由 `dsh.compat`（minHost/verifiedHost）与 README 兼容性段表达，版本号只表达插件自己的演进;`package.json` 里的版本是下一条发布线,发版时才 bump,不按提交 bump。
- **worktree 不动版本号**:分支/工作区里的 `package.json` 版本保持与 main 一致,版本治理只在 mainline 发版时发生。3080 的日常部署不需要新文件名激励——deploy-3080 的 profile 副本文件名自带构建时间戳(`<名>-<版本>+<yymmddhhmm>.tgz`),同版本反复部署也会被实例吃到。改动不值得发版(测试/内部重构/仓库文档)就攒着随下次;改动值得发版(动 lib/ 或行为)就叫 mainline 发,版本号没有稀缺性。
- 一次发布只做一次:pack → 验包 → publish → `npm view` 确认 → 完事;不重复发同一版本。
- 有 `dsh.bundle` 声明的插件,发完顺手验证一次 `dsh plugin --profile web add <包>@<新版本>` 能 reconcile 进 bundles 层。
