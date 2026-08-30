# 运维与发布：从开发到社区的生命周期

本仓库插件的流转分三层环境，交付形态逐层收紧。npm 发布的动作清单与失败对照表见 [publishing.md](publishing.md),本文规定流程本身。

本文只写流程,不记录任何版本状态。当前线上运行版本以 profile 清单(`$DSH_HOME/profiles/web/package.json`)与 `dist-publish/` 为准;每次 `deploy:3080` 会自动维护它们并输出通报。流程本身变化时才改本文。

## 环境拓扑(每个目录/实例是谁、能干嘛)

先立三维正交模型(2026-08-30 定):**宿主版本**由启动用哪个检出/工具链决定,**状态**(settings/sessions/凭据)由 `DSH_HOME` 决定,**插件组合**由 `--profile` 决定。三者独立取值,环境数量 = 要同时支持的宿主版本数,而不是测试主题数——测试主题用同一 HOME 下的 `<主题>-test` profile 解决。

第一条原则:**能让工具自动清的,绝不靠人记。** 一次性环境用 `$(mktemp -d)`(测完即弃,探针脚本也写在里面,不写进仓库);常驻环境只有下表这几行,其余都是僵尸的培养基。

| 路径 | 角色 | 纪律 |
|---|---|---|
| `~/code/dsh-plugins` | 主仓(mainline) | 多 agent 共享,worktree 开发、合并回 main |
| `~/code/deepseek-harness` | **部署检出**:prod 3080 从这里启动,guard 凭证绑定它的 HEAD | 只准 `reset --hard` 到官方 tag + guard checkpoint 提交;禁止任何其他本地改动 |
| `~/code/deepseek-harness-alpha` | 0.1.2-alpha 源码检出(3091 的宿主) | 只读使用,停在 tag |
| `~/.dsh-official`(3080) | **prod 专用**:稳定线宿主的常驻环境,3080 是我们的稳定部署(非社区 prod) | 只有 `profiles/web`;**测试 profile 一律不许建在这里**——`settings.yaml` 是全 HOME 共享的,测试 profile 改插件配置会漏进 3080 |
| `~/.dsh-lab` | 稳定线(rc 线)的全部测试 | 所有 `<主题>-test` profile + `web-candidate`(3083,原 3082 验收实例,已迁移);凭据软链回 official(注意:并发刷新 token 有写竞争,凭据刷新失败先怀疑这里),settings/state/sessions 与 official 隔离 |
| `~/.dsh-alpha-check`(3091) | 0.1.2 线的提前兼容验收 | 宿主用 `deepseek-harness-alpha` 检出启动;跑的是分支 tarball,合并后换回正式产物 |
| `~/.dsh-toolchains/stable` | 官方 npm 宿主的缓存工具链(**无状态**) | 测"社区同款体验"的基座;由 mainline 在官方发新版时主动刷新( playbook 第 4 步)。用法:`DSH_HOME=$(mktemp -d) ~/.dsh-toolchains/stable/node_modules/.bin/dsh web --port <port>` |
| `$(mktemp -d)` | 一次性 HOME:纯净安装测试、历史兼容测试 | "纯净"是会衰减的性质,只配一次性;历史兼容用 `npx @deepseek-ai/dsh@<minHost>` 起对应版本 |

已退役:`~/.dsh-vanilla`(3081)——常驻纯净 HOME 与"纯净即一次性"矛盾,由工具链缓存 + mktemp HOME 取代;`~/.dsh-acceptance`(3082)——并入 lab 的 `web-candidate`。

配套约定:

- **测试 profile 命名** `<主题>-test`,用完 `rm -rf $DSH_HOME/profiles/<name>`;**僵尸判据:14 天没动且无对应活跃分支/worktree**,清理前群里点名、24 小时无人认领再删(`settings.yaml.bak-*` 之类遗迹同规则)。
- **历史兼容覆盖:floor + current + 标记中点。** 每次发布验两条:成员包声明的最低 `minHost` 和当前稳定线;中间 rc 只在某包 `dsh.compat.notes` 点名特定降级项时补验。
- **新 profile 的正确搭法**:手写骨架三件套(package.json 空 deps + `dsh.profile.bundles` 清单、cordis.patch.yml、pnpm-workspace.yaml)再 boot——官方 bundle(dsh-base/dsh-web-app)由宿主在 boot 时链接进 profile,**不要 `plugin add` 官方 bundle**:web-app 依赖未发布的官方包(如 `dsh-client-ui-model`),从 registry 装必炸(2026-08-30 搭 lab 时踩过,CLI 报错文案里的 `plugin add` 提示只适用于社区包)。
- **发布前测试矩阵**(包级 build+test 之后、生产六道闸之前的中间三层,原为空白):组合级 preflight(全装配组合过一次门禁)→ 交付级全新安装与升级(mktemp HOME 从零装 + 已装实例走升级路径)→ 体验级(agent 照 README 安装 + 逐个成员装卸载,整合包必做)。
- **prod 检出与 npm 工具链的分工**:验证 prod 配置用 `~/code/deepseek-harness` 检出;验证"用户拿到手什么样"用 toolchains 缓存的 npm 线。

## 三层环境与交付形态

| 环境 | 用途 | 交付形态 | 规则 |
|---|---|---|---|
| 临时实例(lab 的测试 profile,或 `$(mktemp -d)` 一次性 home) | 开发调试 | `link:` 仓库包目录 | 随手起、随手扔;允许带着在制品跑 |
| **3080(prod,`~/.dsh-official/profiles/web`)** | 统一部署 / 验收 | **只收 tarball**(`file:` tgz) | 进入 3080 = 一个显式的版本决定;不允许 link 在制品 |
| npm | 社区验证 | `scripts/pack-dist.ts` 产物 | 3080 跑顺之后(见"放行标准"),版本必须超过已发布线 |

3080 只收 tarball 的理由:profile 是共享状态,`link:` 会让任何开发者构建进 `lib/` 的在制品随下一次重启悄悄上线(真实事故)。"大致稳定"是进 3080 的门槛,"跑得顺"是上 npm 的门槛。

## 进 3080 的门禁清单(每次交付必过)

**自服务流程就是一条命令**——任何 agent 都可运行,无需通知守护者:

```sh
pnpm deploy:3080 --package packages/<包目录> [--package packages/<第二个包>] [--initiator <你的id>]
```

`scripts/deploy-3080.mts` 按顺序执行全部六道闸,任何一步不过即中止、不重启:① build+test(typert 生成用 `GEN_TYPERT_ONLY` 限定到本包,邻居的在制品红色状态不会拖死你)② pack-dist 出包并复制到 profile 的 tarball 目录(上一份 known-good 留在 `dist-legacy/`,回滚 = 换 tgz + 重跑本命令)③ 刷新 profile 清单与家族 overrides 并全新安装 ④ 录制绿色凭证 ⑤ preflight(**FAIL 即停,永不绕过**)⑥ `schedule-exit` 按闸重启 + 监听 canary PASS。收尾会打印一段粘贴即用的通报文本。`--no-restart` 只打包+刷新不重启。

**deploy:3080 是"再部署"工具,不是首次安装工具。** 它只刷新 `dsh.profile.bundles` 里已在册插件的 tarball;一个从未装过的新包,deploy 会把依赖写进 deps/overrides、preflight 和 canary 也都会绿,但因为不在 bundles 清单里,组合时根本不会加载(症状:client.js 404、插件静默缺席)。**新包首次上线必须先 `dsh plugin add <tarball> --profile web`**(自挂载入口,理清 deps+bundles),**然后再跑一次 deploy:3080** 让凭证/preflight/canary 闭环。(2026-08-29 capability-catalog 首装踩过:deploy 全绿但插件未加载。)

手动分步只在脚本本身出问题时兜底(即脚本注释里的六步)。profile 的 `cordis.patch.yml` 只允许经审查的显式编辑。脚本踩过的坑(已内建处理,手排时有用):
   - profile 引用的 tarball 放在 **workspace 之外**(`~/.dsh-official/tarballs/`)——放在本仓库里的 tarball 会被 pnpm 按"名+版本匹配 workspace 包"转成 `link:` 软链,tarball 化形同虚设
   - 家族边(local-agent core/companion)在包未发布时需要 profile `pnpm-workspace.yaml` 的 `overrides` 把每个 `@khorsheed/*` 名字指到对应 `file:` tgz,否则 pnpm 去 registry 解析直接 404
   - 行为异常(装了还是软链/旧内容)时:**`rm -rf node_modules pnpm-lock.yaml` 后重装**——残留的 pnpm workspace 状态文件会把 link: 时代的解析行为还魂;同名同版本的 tgz 内容变了也可能吃到解包缓存
   - 打包前对刚改过源码的包做 **clean rebuild**(`rm -rf lib && build`)——tsc/tsdown 的增量残留会让产物引用不存在的文件(pack-dist 的 stale-types 检查只挡一类)
   - **家族内部 bundle 绝不列为 profile 直接依赖**——reconcilePlugins 会把声明 `dsh.bundle` 的直接依赖自动挂进组合 layer 栈;`@khorsheed/dsh-local-agent-dsh-headless` 这类子 profile 专属 bundle 经其父包传递安装即可(2026-08-23 P0:直接依赖 → 自动挂载 → `code-runtime` 撞 web-app 同名行 → 全实例 boot 失败)
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

## 迁移/升级验收清单(任何 agent 做完宿主迁移或重打包后执行)

三步,做完才算迁移完成——写给所有迁移方(包括未来的我们):

1. **会话里能列出 skill,并且真调用一次**:在 3080 开一个会话,确认插件注册的 skill(如 `dsh-self-restart-guard`)在技能目录可见——还要**真的触发一次调用**:宿主在 load 时才校验注册载荷(`source` 等字段),只看目录会漏掉"列出即正常、调用即炸"这一类(0.1.0 的教训)
2. **check-env 读数正常**:`dsh-ankh-guard check-env --port 3080` 的监督/启动读数无异常(缺能力、降级项要出声,不允许静默)
3. **跑一次门禁重启**:`deploy:3080` 或 `schedule-exit` 走一遍完整闸,canary PASS 才算闭环

打包产物层面的验证已由工具接管(pack-dist 打包即校验、CI 全包 pack 门禁、`check:plugins` 的 files 覆盖不变量),迁移方不需要手工 `tar -tzf` 抽查——但验收清单这三步是部署后信号,替代不了。

**门禁时效**:preflight 的 PASS 只对"那一刻的组合"负责。preflight 与真实 boot 之间任何对 profile 的改动(`dsh plugin add/remove`、手改 bundles 列表或 cordis.patch.yml、pnpm install 刷新链接)都会使门禁失效——**改动后必须重新过 preflight 再重启**。(2026-08-23 事故:preflight PASS 后 boot 撞 `duplicate loader entry id: code-runtime`,查证是 preflight 与 boot 之间 profile 被改动;已实验证明 preflight 对跨层重复行无盲区——同样的组合在 preflight 里一样炸。)

## 放行 npm 的标准

3080 上**连续 3 天无相关事故**(崩溃、功能回退、与之相关的 preflight 失败)即可放行。放行时按 [publishing.md](publishing.md) 的自查清单执行;发完必做消费者验证(一次性目录 `npm install` + import 冒烟)。

**README 发布标准**(参照顶尖开源项目的门面结构,样例:`packages/whalesong/README.md`):

1. 标题 + 一句话 pitch(用户得到什么,不写实现)
2. pitch 之后紧跟截图:`docs/screenshots/` 已有图直接用;没有的先放占位注释 `<!-- screenshot placeholder: docs/screenshots/<包名>.png (pending) -->`,**在验收实例(3082)人工验收时补拍**、用 `git add -f` 提交(图片扩展名是 gitignore 的),替换占位
3. Features 3–6 条(用户视角,实现细节折叠进 `<details>` 的 How it works)
4. Install/Uninstall 命令、Config(如有)、Compatibility(机器核对过的事实段,verbatim 维护)、Known Limitations、Development 一行
5. 中英双语逐节对应,改完必须重录 sidecar(`verify-translation-pairing --write`)

**验收即截图**:每个波次的验收实例不只是"跑起来"——人工验收时逐包把可见界面拍下来,回填 README 占位。截图缺失不阻塞发布,但占位注释必须在(提醒后补)。

## 守护者值班项(周期)

- prod 健康:watchdog 拓扑单一、canary 正常、profile 无悬空 bundles、link/file 依赖新鲜
- 凭证与门禁:harness 检出 HEAD 有绿色凭证;preflight 可用
- 版本漂移:官产品线更新时复核各包 `dsh.compat.minHost` 与 peer 范围(升线三件套:lockfile、`minimumReleaseAgeExclude`、幻影目录清理)
- 社区标准跟踪:oh-my-dsh/dsh-community-standard 定案后评估 manifest 映射
