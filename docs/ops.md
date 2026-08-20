# 运维与发布：从开发到社区的生命周期

本仓库插件的流转分三层环境，交付形态逐层收紧。npm 发布的动作清单与失败对照表见 [publishing.md](publishing.md),本文规定流程本身。

本文只写流程,不记录任何版本状态。当前线上运行版本以 profile 清单(`$DSH_HOME/profiles/web/package.json`)与 `dist-publish/` 为准;每次 `deploy:3080` 会自动维护它们并输出通报。流程本身变化时才改本文。

## 三层环境与交付形态

| 环境 | 用途 | 交付形态 | 规则 |
|---|---|---|---|
| 临时实例(自建 profile,如 `~/.dsh-vanilla` 或一次性 home) | 开发调试 | `link:` 仓库包目录 | 随手起、随手扔;允许带着在制品跑 |
| **3080(prod,`~/.dsh-official/profiles/web`)** | 统一部署 / 验收 | **只收 tarball**(`file:` tgz) | 进入 3080 = 一个显式的版本决定;不允许 link 在制品 |
| npm | 社区验证 | `scripts/pack-dist.ts` 产物 | 3080 跑顺之后(见"放行标准"),版本必须超过已发布线 |

3080 只收 tarball 的理由:profile 是共享状态,`link:` 会让任何开发者构建进 `lib/` 的在制品随下一次重启悄悄上线(真实事故)。"大致稳定"是进 3080 的门槛,"跑得顺"是上 npm 的门槛。

## 进 3080 的门禁清单(每次交付必过)

**自服务流程就是一条命令**——任何 agent 都可运行,无需通知守护者:

```sh
pnpm deploy:3080 --package packages/<包目录> [--package packages/<第二个包>] [--initiator <你的id>]
```

`scripts/deploy-3080.mts` 按顺序执行全部六道闸,任何一步不过即中止、不重启:① build+test(typert 生成用 `GEN_TYPERT_ONLY` 限定到本包,邻居的在制品红色状态不会拖死你)② pack-dist 出包并复制到 profile 的 tarball 目录(上一份 known-good 留在 `dist-legacy/`,回滚 = 换 tgz + 重跑本命令)③ 刷新 profile 清单与家族 overrides 并全新安装 ④ 录制绿色凭证 ⑤ preflight(**FAIL 即停,永不绕过**)⑥ `schedule-exit` 按闸重启 + 监听 canary PASS。收尾会打印一段粘贴即用的通报文本。`--no-restart` 只打包+刷新不重启。

手动分步只在脚本本身出问题时兜底(即脚本注释里的六步)。profile 的 `cordis.patch.yml` 只允许经审查的显式编辑。脚本踩过的坑(已内建处理,手排时有用):
   - profile 引用的 tarball 放在 **workspace 之外**(`~/.dsh-official/tarballs/`)——放在本仓库里的 tarball 会被 pnpm 按"名+版本匹配 workspace 包"转成 `link:` 软链,tarball 化形同虚设
   - 家族边(local-agent core/companion)在包未发布时需要 profile `pnpm-workspace.yaml` 的 `overrides` 把每个 `@khorsheed/*` 名字指到对应 `file:` tgz,否则 pnpm 去 registry 解析直接 404
   - 行为异常(装了还是软链/旧内容)时:**`rm -rf node_modules pnpm-lock.yaml` 后重装**——残留的 pnpm workspace 状态文件会把 link: 时代的解析行为还魂;同名同版本的 tgz 内容变了也可能吃到解包缓存
   - 打包前对刚改过源码的包做 **clean rebuild**(`rm -rf lib && build`)——tsc/tsdown 的增量残留会让产物引用不存在的文件(pack-dist 的 stale-types 检查只挡一类)
   - 多人并行 install 会把官方包解析出多个 peer 变体,模块增强(SlotMap/LocaleNamespaceMap)挂到不同实例上,报 `constraint 'never'` 类错误——`pnpm dedupe` 收敛即可

## 变更驱动模型:流程不是审批

**任何开发者都可以自己把插件送进 3080——但必须开完整条流程。** 守护者的职责是补漏、盯状态、收拾异常( watchdog 拓扑、profile 健康、凭证新鲜度),不是唯一司机。两条铁律没有例外:

- **只有流程能写 profile。** 禁止手改 bundles/依赖再顺手重启;禁止无 preflight 重启。
- **重启前交付物必须自包含。** 重启后 prod 服务的是 profile `node_modules` 当前内容:tarball 没刷新、依赖没装全,preflight 过了也是带病上线。

## 版本与发布节奏

- **独立线,不齐步走。** 每个插件按自己的成熟度验收、发布(semver 独立);四段式(`0.1.0-rc.8.x`)是线内补丁的既有记法。唯一硬约束:新版本必须超过 npm 已发布版本。
- **家族同发,按依赖序。** local-agent 家族(core → tool-subagent → 各 provider)作为一批发布,版本线先对齐;pack-dist 会把 `workspace:*` 改写成 `^<version>` 家族依赖,顺序错了干净机器装不上。
- **整合包**：当前 CLI 的 `reconcilePlugins` 只调和 profile 的**直接依赖**,npm 薄元包的子插件是传递依赖、不会被挂载——所以薄元包需要上游 seam(见提案 `proposals/active/2026-08-21-package-management.md` 的形态 C 与 upstream-meta-pack-reconcile)。今天可交付的整合形态是**形态 A(add 清单)与形态 B(profile 目录模板)**,成员都是 profile 直接依赖,任一 bundle 单独装卸互不影响。整合包版本只在成员增删或跨大版本线时 bump(caret 范围下子包 patch 发布不需要动 pack)。
- **首发包没有顺序问题**(除家族外),npm 上都不存在,无 403/409 风险。

## 放行 npm 的标准

3080 上**连续 3 天无相关事故**(崩溃、功能回退、与之相关的 preflight 失败)即可放行。放行时按 [publishing.md](publishing.md) 的自查清单执行;发完必做消费者验证(一次性目录 `npm install` + import 冒烟)。

## 守护者值班项(周期)

- prod 健康:watchdog 拓扑单一、canary 正常、profile 无悬空 bundles、link/file 依赖新鲜
- 凭证与门禁:harness 检出 HEAD 有绿色凭证;preflight 可用
- 版本漂移:官产品线更新时复核各包 `dsh.compat.minHost` 与 peer 范围(升线三件套:lockfile、`minimumReleaseAgeExclude`、幻影目录清理)
- 社区标准跟踪:oh-my-dsh/dsh-community-standard 定案后评估 manifest 映射
