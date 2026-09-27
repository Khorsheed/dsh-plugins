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
| `~/.dsh-official`(3080) | **prod 专用**:稳定线宿主的常驻环境,3080 是我们的稳定部署(非社区 prod) | 只有 `profiles/web`;**测试 profile 一律不许建在这里**——`settings.yaml` 是全 HOME 共享的,测试 profile 改插件配置会漏进 3080 |
| `~/.dsh-lab` | 稳定线(rc 线)的全部测试 | 所有 `<主题>-test` profile + `web-candidate`(3083,原 3082 验收实例,已迁移);凭据软链回 official(注意:并发刷新 token 有写竞争,凭据刷新失败先怀疑这里),settings/state/sessions 与 official 隔离 |
| `~/.dsh-toolchains/stable` | 官方 npm 宿主的缓存工具链(**无状态**) | 测"社区同款体验"的基座;由 mainline 在官方发新版时主动刷新( playbook 第 4 步)。用法:`DSH_HOME=$(mktemp -d) ~/.dsh-toolchains/stable/node_modules/.bin/dsh web --port <port>` |
| `$(mktemp -d)` | 一次性 HOME:纯净安装测试、历史兼容测试 | "纯净"是会衰减的性质,只配一次性;历史兼容用 `npx @deepseek-ai/dsh@<minHost>` 起对应版本 |

已退役:`~/.dsh-vanilla`(3081)——常驻纯净 HOME 与"纯净即一次性"矛盾,由工具链缓存 + mktemp HOME 取代;`~/.dsh-acceptance`(3082)——并入 lab 的 `web-candidate`;`~/code/deepseek-harness-alpha` 与 `~/.dsh-alpha-check`(3091)——0.1.2-alpha 线的提前兼容验收环境,0.1.5 波次落地后退役(alpha 检出已删除)。

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

### 3080 的 preset 名册:正本在 git,名册是卸出物

`$DSH_HOME/.agent-presets` 的名册**无缓存**(每次 `list()` 重读文件系统,改完即生效不用重启),也因此是谁都能手改的部署资产——2026-09-17 dev preset 本地补挂评测三行、漂移进生产。规则:

- 3080 名册里 prod 拥有的 preset 以 git 正本为准:`dsh-writing` 正本在 `profiles/web/presets/`;`dsh-eval` 的组合跟随 web-eval pack 的 eval preset;`dev` 归 dev pack 的 install/update 脚本。
- 同步动作只有一个:`DSH_HOME=~/.dsh-official sh profiles/web/scripts/sync-presets.sh`(幂等、先备份、名册即时生效;存量会话的 preset 建会话时锁定,不受影响)。
- 手改名册是允许的调试手段,但改动必须立即回流正本,否则下次 sync 覆盖回来。
- 插件 UI 的 preset 自隐判据读的就是名册组合——名册漂移 = 可见性漂移,见 [plugin-visibility.md](plugin-visibility.md)。

## 进 3080 的门禁清单(每次交付必过)

**自服务流程就是一条命令**——任何 agent 都可运行,无需通知守护者:

```sh
pnpm deploy:3080 --package packages/<包目录> [--package packages/<第二个包>]
# --initiator <会话id> 只用于"代某个会话调度重启"的罕见场景;默认不要传——
# 不传时 ankh-guard 把重启报告路由给它的调用方会话($DSH_SESSION_ID)。
# 传一个非会话 id(用户名、分支名)会把报告投进永不存在的会话:记录一直
# pending 直到被下次重启覆盖,报告静默丢失(2026-09-12 实踩)。
```

`scripts/deploy-3080.mts` 按顺序执行全部六道闸,任何一步不过即中止、不重启:① build+test(typert 生成用 `GEN_TYPERT_ONLY` 限定到本包,邻居的在制品红色状态不会拖死你)② pack-dist 出包并复制到 profile 的 tarball 目录(上一份 known-good 留在 `dist-legacy/`,回滚 = 换 tgz + 重跑本命令)③ 刷新 profile 清单与家族 overrides 并全新安装 ④ 录制绿色凭证 ⑤ preflight(**FAIL 即停,永不绕过**)⑥ 按闸重启 + 监听 canary PASS。第 ⑥ 步的动词由活 `launch-spec.json` 决定:无漂移走 `schedule-exit`;两类漂移自动改走 `reconfigure`——(a) 本次部署重建了 ankh-guard 的 runner(动了 `preflight-runner.ts` 的部署必然如此),(b) 宿主版本切换漂移了 install anchor(锚是宿主 CLI 的 package.json,版本字段随宿主动,rc.1→rc.2 切换即此类,2026-09-27)——按活 spec 逐字段重绑哈希、重启前重录凭证(10 分钟新鲜窗要盖住双份 preflight + canary),`--on-failure restore-previous`(runbook 与事故始末见 `.agents/notes/implemented/process/2026-09-26-ankh-guard-self-deploy-reconfigure.md`)。收尾会打印一段粘贴即用的通报文本。`--no-restart` 完成安装/更新和诊断 preflight，但不请求重启；通报明确写“未重启、运行实例尚未验证加载本次构建、未验证 canary”，不能当作上线验收。失败路径不打印成功通报，旧 tarball 保留到整条请求流程成功后才清理。

**首次安装与更新统一走 `deploy:3080`。** 对明确用 `--package` 指定、声明了 `dsh.bundle.patch` 的插件，脚本检查 dependency 与 `dsh.profile.bundles`：任一缺失，就调用当前 `DSH_HARNESS` 的已构建官方 CLI 执行 `plugin add <tarball> --profile web`，由宿主登记 bundle；已完整登记的插件直接更新。安装后验证实际包名、版本、bundle 登记和 patch 文件，再进入凭证/守护预检。首次安装需要宿主 `apps/cli/lib/bin.js` 已构建；无 bundle 的新内部 companion 不会被自动挂载，应通过其所属插件安装。

**家族 bundle 部署与成员退场**：部署声明 `dsh.bundle.kind: 'family'` 的元包（`bundle-local-agent`、`bundle-conversation-toolbox`）时，脚本在刷新清单后自动**成员退场**——把每个 member 移出 profile 的 `dependencies` 与 `dsh.profile.bundles`（已不在则记日志跳过，幂等）；成员的自挂载 patch 随之不再收编（reconcilePlugins 只认直接依赖），bundle patch 接管同名规范行，无双挂，清单页也不再给成员出顶层卡。`pnpm-workspace.yaml` overrides 里成员的 `file:` 钉**保留**——bundle 里重写后的 `^版本` 边靠它传递解析；钉缺失时从本次同部署成员的新 tarball 或 tarballs 目录最新匹配补齐，两者都没有则拒绝部署并提示把成员一起点名。**成员更新随 bundle 一起点名即可**（`--package packages/bundle-x --package packages/<member>`，顺序无关：成员先 pack 刷新，bundle 后注册退场）；bundle 自身的首装仍走官方 `plugin add`。安装后校验同步扩为：bundle 在 dependencies、成员不在 bundles 名册、成员包从 bundle 安装目录出发仍可 `require.resolve`。

**部署依赖诊断**：脚本在构建/部署写入前，以及安装后录制凭证前，各检查一次失效链接。也可以单独运行只读诊断：

```sh
pnpm deploy:check-links
# 非默认环境：DSH_HOME=<实例目录> DSH_HARNESS=<宿主检出> pnpm deploy:check-links
```

诊断遍历实际 home 与 harness 目录，排除 `.git` 和 home 顶层 `scratch/`；检查符号链接目标是否可解析，但不递归追踪目录别名。报告完整路径、原链接目标与系统错误码；缺失目录、权限错误或无法解析的链接均返回非零。不会删除链接或修改配置，也不替代 ankh-guard 对外部依赖图、隔离快照及组合的完整验证。

发现失效链接后，先确认所属包与目标：有效依赖缺失应重建或重装；只有确认属于废弃生成文件，且已备份链接路径和目标后，才考虑清理。不要删除会话、认证文件或为了过检移除有效依赖。修复后重新运行诊断及部署流程。

手动分步只在脚本本身出问题时兜底(即脚本注释里的六步)。profile 的 `cordis.patch.yml` 只允许经审查的显式编辑。脚本踩过的坑(已内建处理,手排时有用):
   - profile 引用的 tarball 放在 **workspace 之外**(`~/.dsh-official/tarballs/`)——放在本仓库里的 tarball 会被 pnpm 按"名+版本匹配 workspace 包"转成 `link:` 软链,tarball 化形同虚设
   - 家族边(local-agent core/companion)在包未发布时需要 profile `pnpm-workspace.yaml` 的 `overrides` 把每个 `@khorsheed/*` 名字指到对应 `file:` tgz,否则 pnpm 去 registry 解析直接 404
   - 行为异常(装了还是软链/旧内容)时:**`rm -rf node_modules pnpm-lock.yaml` 后重装**——残留的 pnpm workspace 状态文件会把 link: 时代的解析行为还魂;同名同版本的 tgz 内容变了也可能吃到解包缓存
   - 打包前对刚改过源码的包做 **clean rebuild**(`rm -rf lib && build`)——tsc/tsdown 的增量残留会让产物引用不存在的文件(pack-dist 的 stale-types 检查只挡一类)
   - **家族内部 bundle 的挂载声明已撤（T6, 2026-09-05）**——`@khorsheed/dsh-local-agent-dsh-headless` 这类子 profile 专属 bundle 不声明 `dsh.bundle`，reconcilePlugins 对它永不自动挂载（误装成直接依赖也只是 "plain dependency" 警告）;仍应经其父包传递安装（overrides 钉版），patch 由 provisioner 拷进子 profile 自己的 patch 层。历史背景（2026-08-23 P0）:声明还在时,直接依赖 → 自动挂载 → `code-runtime` 撞 web-app 同名行 → 全实例 boot 失败;未来新的家族内部组合包必须沿用"不声明 + provisioner/父 patch 落位"模式
   - 多人并行 install 会把官方包解析出多个 peer 变体,模块增强(SlotMap/LocaleNamespaceMap)挂到不同实例上,报 `constraint 'never'` 类错误——`pnpm dedupe` 收敛即可

## 部署卡在中途 / 退役包清理(2026-09-28 事故后立)

**时长预期与调用方预算。** 六道闸刻意全非增量——全新 profile 安装、整树组合干跑、按闸重启 + canary——多 agent 并发下全程 10-20 分钟是常态(16GB 机器,swap 压力会放大每一步);脚本按 `[deploy-3080 +Ns]` 打印各阶段耗时。**调用方必须给足预算**:后台任务默认 600s 超时会把它杀在中途——杀在全新安装中途 = profile 半写(node_modules 已删未装完,下一次任何重启都会踩中);杀在重启之后 = 实例其实会被 watchdog 自己拉回来,但调用方看不到 canary 结论。修复方式只有一个:原命令重跑一遍(锁在原 holder 死后自动回收)。

**preset 与包的版本错位(本次事故的根因)。** preset 行挂在注册表的 standing scope 上,不在 profile 根——boot 干净 ≠ preset 可用。症状:模式选择器卡片「加载失败」、该 preset 的会话 resume 报 `<row> (<module>): never started`。preset 正本有两个载体:0.1.7 线是 `packages/presets` 的声明式 preset 行(随 `deploy:3080 --package packages/presets` 部署),目录名册 `$DSH_HOME/.agent-presets` 是 0.1.5 线与 pack install 脚本的卸出物——改 preset 时两处正本(还有 `profiles/dev/presets/dev`)要与引用的包**同波部署**。处置二选一:① 前滚——把行需要的模块/子路径所在的包 deploy 进生产;② 回滚——把 preset 正本里该行改回已安装包能提供的名字。ankh-guard 0.4.0 起 preflight 直接 FAIL 在坏 preset 上(回读注册表的 `broken` 诊断),这类错位从此过不了重启闸;不动任何东西时也可先跑 `node packages/ankh-guard/lib/cli.js preflight --profile web` 做只读诊断。

**退役包。** 退役登记处在 `scripts/retired-packages.ts`(名字、替代、原因);`pnpm check:profiles` 拒绝仓内组合再引用它们;`deploy:3080` 开工前扫描生产 profile,发现退役名仍是直接依赖/bundles 条目就打印清理步骤(删 dependency + bundles 条目 + `pnpm-workspace.yaml` 的 overrides 钉,再在 profile 里 `pnpm install`)。残留本身无害(无 patch 的行什么都不挂),但要在同一发布波里清掉,别让下一个部署者替你还债。

## 变更驱动模型:流程不是审批

**任何开发者都可以自己把插件送进 3080——但必须开完整条流程。** 守护者的职责是补漏、盯状态、收拾异常( watchdog 拓扑、profile 健康、凭证新鲜度),不是唯一司机。两条铁律没有例外:

- **只有流程能写 profile。** 禁止手改 bundles/依赖再顺手重启;禁止无 preflight 重启。
- **重启前交付物必须自包含。** 重启后 prod 服务的是 profile `node_modules` 当前内容:tarball 没刷新、依赖没装全,preflight 过了也是带病上线。

## 版本与发布节奏

- **独立线,不齐步走。** 每个插件按自己的成熟度验收、发布(semver 独立);四段式(`0.1.0-rc.8.x`)是线内补丁的既有记法。唯一硬约束:新版本必须超过 npm 已发布版本。
- **家族同发,按依赖序。** local-agent 家族(core → tool-subagent → 各 provider)作为一批发布,版本线先对齐;pack-dist 会把 `workspace:*` 改写成 **`^<目标包自己的版本>`**(`--family name=version`,不是被打包者的版本——否则 `0.1.0` 的伴生包会声明出 `^0.1.0`,而 core 是 `0.1.0-rc.1`,干净机器直接解析失败),顺序错了干净机器装不上。
- **整合包**：当前 CLI 的 `reconcilePlugins` 只调和 profile 的**直接依赖**,npm 薄元包的子插件是传递依赖、不会被挂载——所以薄元包需要上游 seam(见提案 `proposals/active/2026-08-21-package-management.md` 的形态 C 与 upstream-meta-pack-reconcile)。今天可交付的整合形态是**形态 A(add 清单)与形态 B(profile 目录模板)**,成员都是 profile 直接依赖,任一 bundle 单独装卸互不影响。整合包版本只在成员增删或跨大版本线时 bump(caret 范围下子包 patch 发布不需要动 pack)。
- **首发包没有顺序问题**(除家族外),npm 上都不存在,无 403/409 风险。

## 迁移/升级验收清单(任何 agent 做完宿主迁移或重打包后执行)

三步,做完才算迁移完成——写给所有迁移方(包括未来的我们):

1. **会话里能列出 skill,并且真调用一次**:在 3080 开一个会话,确认插件注册的 skill(如 `dsh-self-restart-guard`)在技能目录可见——还要**真的触发一次调用**:宿主在 load 时才校验注册载荷(`source` 等字段),只看目录会漏掉"列出即正常、调用即炸"这一类(0.1.0 的教训)
2. **check-env 读数正常**:`dsh-ankh-guard check-env --port 3080` 的监督/启动读数无异常(缺能力、降级项要出声,不允许静默)
3. **跑一次门禁重启**:`deploy:3080` 或 `schedule-exit` 走一遍完整闸,canary PASS 才算闭环
4. **改了 client bundle 的,加验"HTTP 层确实在服务它"**:宿主只服务组合 URL(`/plugins/??<id>/client.js&rev=<rev>`),rev 是每进程 nonce,静态 `/plugins/<pkg>/client.js` 永远 404、不是探针。从 graph 快照取当前 URL 再访问(无需鉴权):

   ```sh
   URL=$(curl --noproxy '*' -gsNm3 http://127.0.0.1:3080/plugins/events | sed -n 's/^data: //p' | head -1 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const e=JSON.parse(s).graph.entries.find(e=>e.id===process.argv[1]);if(!e)process.exit(1);console.log(e.url)})" '<pkg>') \
     && curl --noproxy '*' -gs -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:3080$URL"   # 应为 200
   ```

   boot 的 activation 阶段已读取每个 client bundle 的字节(缺失即 ClientPackageCompositionError、boot 失败),所以"ready + canary PASS"证明的是"被读取并组合";这条探针补 HTTP 层的直接证据,"浏览器里真跑起来"仍靠浏览器验收兜底:开一条有用户消息的会话,确认功能渲染且 console 零错误。

打包产物层面的验证已由工具接管(pack-dist 打包即校验、CI 全包 pack 门禁、`check:plugins` 的 files 覆盖不变量),迁移方不需要手工 `tar -tzf` 抽查——但验收清单这三步是部署后信号,替代不了。

**构建卫生:跨宿主大版本,先清缓存强查再信「全绿」。** tsc -b 的增量缓存(tsbuildinfo)只认源码指纹——源码未变的包直接跳过复查,永远不会对新宿主的类型面验证过,跨宿主大版本(minHost 抬升、宿主 API/类型面变化)时「全绿」可能是缓存假象。规则:这类验收的全量构建前先 `find packages -name '*.tsbuildinfo' -delete`(或整 lib/ 清掉)再跑。实证(2026-09-25,host-016 波):worktree 全绿,main 清缓存强查后 mission / eval-tool / mission-tool 三个 typed `Config: z<XxxConfig>` 在 rc.1 的 schemastery + `exactOptionalPropertyTypes` 下全炸(TS2375,`Volatile<string>` 不可赋,照裸 `z` 先例修);`--force` 复算同样炸,坐实是缓存掩盖而非合并引入。同类第二坑:删过源码的包,tsc -b 不清 lib/types 的陈旧产物,pack-dist 的 stale-types 闸会在打包时拦(「stale lib/types emits with no backing src module」)——部署前对改动包清 lib/ 最稳。第三坑:全量构建卡在某个包的 gen-typert、进程 0% CPU 超过一分钟,查 `~/.dsh/scratch/typert-gen.lock`——被强杀的生成器留下锁目录,后续等待者按 900 秒自愈期互相打断形成活锁(所有进程 0% CPU、锁目录 mtime 却持续刷新),`rm -rf` 锁目录再跑即可(自愈设计保证最坏只是重复生成同字节产物)。

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


## 移动端公网入口恢复

`pnpm mobile:tunnel` 是独立于宿主的电脑端 Quick Tunnel 管理进程。应从已合并的部署 checkout 运行，并由系统服务管理器保持在线。它不修改手机配置；公网域名切换后，用户从 Web「设置 → 连接手机」重新扫码。

管理器只在本地 3080 健康且公网连续三次失败时重建，重试间隔十分钟。新域名通过 `pnpm deploy:3080 --package packages/mobile --mobile-origin https://new-link.trycloudflare.com` 进入标准构建、测试及 `reconfigure` 流程，会重启宿主。配置形态不受支持、代码未提交或部署锁被占用时拒绝操作，诊断写入 `$DSH_HOME/state/mobile-tunnel/`。`--repair-now` 用于已确认公网故障的首次恢复，可跳过初始检测等待。

Web 生成二维码前匿名检查公网入口，并定期撤下已失效的二维码。更多配置和限制见 [mobile README](../packages/mobile/README.md#电脑端-quick-tunnel-自动恢复)。
