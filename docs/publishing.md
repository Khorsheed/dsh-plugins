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
| `requires a one-time password` | 账号开了 2FA | `npm publish --otp=<6 位动态码>`;过期就换新的重试。**不要把恢复码当日常 OTP**（见下行） |
| 403 且账号页显示 "temporarily suspended due to a recent security-sensitive action" | npm 2026-06 起的防劫持冻结：**使用恢复码、换邮箱等敏感动作会触发 72 小时只读冻结**（安装/下载不受影响，发布/token 管理全停，到期自动解除） | 无捷径，等 72 小时；预防 = 日常发布只用认证器 TOTP 动态码，恢复码只留作真正的账号恢复。另注意 2026 年的新规：颗粒度 token（GAT）在强制 2FA 的账号上**不能直接发布**（bypass-2FA 也在收紧下线），发布用 `npm login --auth-type=web` 拿的 session token + TOTP |
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

### 家族发布:同版、按依赖序、可恢复

local-agent 家族七包(core → tool-subagent / dsh-headless → 各 provider)以**同一版本**成一波发布,顺序按依赖。理由不是洁癖:`pack-dist` 会把每条家族边按其**目标包自己的版本**改写成 `^<目标版本>`(发版时七包同版,结果才等价于"按同一个 dist 版本改写"),拆开就会发布出一个自己都满足不了的 range。

发版前跑 **`pnpm check:release-groups --release`**。gate 里的同名检查只对版本线**告警**(版本治理只发生在发版时,worktree 不动版本号),但 core/companion 的 range 必须能解析到 core 这一条**始终是硬错误**——`^0.1.0` 排除 `0.1.0-rc.1`、`^0.1.0` 排除 `0.2.0` 这两个真实事故就冻在那条规则里(见 `scripts/check-release-groups.ts`)。

**部分发布怎么收**:npm 没有多包原子发布,"整波回滚"不存在(已发版本不可覆盖)。一波中途失败时,补齐缺失的包、**版本号保持不变**,逐个 `npm view` 确认后再跑一次 `--release`,然后才进整合包。顺序永远先 core 后 companion/provider——反过来会让干净机器在窗口期里装不上。

**ankh-guard 镜像同步**:每次 ankh-guard 发版(或其代码进 main 的关键节点)运行 `npx tsx scripts/sync-ankh-guard-mirror.mts`,把 `packages/ankh-guard` 同步到公开的单插件仓 Khorsheed/dsh-ankh-guard。镜像面向"只装这一个插件"的受众:issue 开在镜像仓,PR 回流 monorepo。

## README 图片

包 README 的截图一律用 dsh-web-basic 仓的绝对地址(`https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/<文件>`),不用相对路径——npm 按 `repository` 字段改写相对路径,dsh-plugins 未 public 时会全裂。新增/更新截图时两个仓同步:dsh-plugins 的 `docs/screenshots/` 留档,web-basic 的同名目录是图床,两边文件保持一致。

## 纪律

- **发布源只认仓库**:不从 /tmp、scratch 或任何一次性目录发;所有改动先入库再发。
- **纯 semver，不跟官方宿主版本号**:rc 后缀时代的"版本线跟官方家族走"自第一波起退役——宿主兼容性由 `dsh.compat`（minHost/verifiedHost）与 README 兼容性段表达，版本号只表达插件自己的演进;`package.json` 里的版本是下一条发布线,发版时才 bump,不按提交 bump。
- **worktree 不动版本号**:分支/工作区里的 `package.json` 版本保持与 main 一致,版本治理只在 mainline 发版时发生。3080 的日常部署不需要新文件名激励——deploy-3080 的 profile 副本文件名自带构建时间戳(`<名>-<版本>+<yymmddhhmm>.tgz`),同版本反复部署也会被实例吃到。改动不值得发版(测试/内部重构/仓库文档)就攒着随下次;改动值得发版(动 lib/ 或行为)就叫 mainline 发,版本号没有稀缺性。
- 一次发布只做一次:pack → 验包 → publish → `npm view` 确认 → 完事;不重复发同一版本。
- 有 `dsh.bundle` 声明的插件,发完顺手验证一次 `dsh plugin --profile web add <包>@<新版本>` 能 reconcile 进 bundles 层。
