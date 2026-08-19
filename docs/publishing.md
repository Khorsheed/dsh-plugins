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
| `requires a one-time password` | 账号开了 2FA | `npm publish --otp=<6 位动态码>`;过期就换新的重试 |
| `403`(版本没变)/ `409` | 版本号 ≤ 线上已发布版本 | bump 版本再发;npm 不允许覆盖 |
| `403`(包名从没发过) | 没有该 scope 的权限 | 只能发自己拥有的 scope(@khorsheed);@deepseek-ai 是官方 org,不要尝试 |
| `Cannot resolve workspace protocol` | package.json 里残留 `workspace:*` 依赖 | 用 `scripts/pack-dist.ts` 打包(它会改写),不要直接对源目录 `npm publish` |
| 装上了但入口缺失/404 | `files` 字段没收产物 | pack 后先 `tar -tzf`;库文件、patch 文件、脚本都要在 files 里 |
| git 源安装后没有 lib/ | 缺 `prepare` 脚本 | package.json 加 `"prepare": "npm run build"`(git 依赖安装时会执行) |
| 消费者侧 `ERR_MODULE_NOT_FOUND` | tarball 内相对导入指向未包含的文件 | 跑 pack smoke:包内每个相对导入都必须可解析 |

## 纪律

- **发布源只认仓库**:不从 /tmp、scratch 或任何一次性目录发;所有改动先入库再发。
- **版本线跟官方家族走**(官方 rc.6 → 我们 rc.6.x),不自立大版本;`package.json` 里的版本是下一条发布线,发版时才 bump,不按提交 bump。
- 一次发布只做一次:pack → 验包 → publish → `npm view` 确认 → 完事;不重复发同一版本。
- 有 `dsh.bundle` 声明的插件,发完顺手验证一次 `dsh plugin --profile web add <包>@<新版本>` 能 reconcile 进 bundles 层。
