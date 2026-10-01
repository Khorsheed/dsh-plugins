# Agent Note: 宿主 0.2.0 上子 dsh 的 preset 是一个拷进 scope 的包

Status: implemented

[English](2026-10-01-sub-dsh-preset-package-host-020.md) | 中文

## Problem

[子 dsh 的 preset 随 scope 目录走](2026-09-18-sub-dsh-preset-in-scope.zh.md)建在宿主 0.1.5 的 preset 机制上：preset 是 `$DSH_HOME/.agent-presets/<id>` 下的一个目录（`preset.yml` + `agent.cordis.yml` + `skills/`），scope 的子 profile patch 带一条 `@deepseek-ai/dsh-agent-presets` roster 行，`default` 点它。宿主 0.2.0 两半都没有：0.2.0 工具链里没有 roster 模块；取代它的 registry（`@deepseek-ai/dsh-agent-preset-registry`，服务 `agentPresets`）既不扫目录也不收 preset 路径，preset 只以声明式 `@deepseek-ai/dsh-agent-preset` loader 行的形式存在。于是在 0.2.0 评测实例上，每一条声明了 preset 的 dsh 条件都组不出来（T82 记下的已知缺口）。

0.2.0 线上还有两件事落在同一条代码路径上：

- 评测把一切装在实例自己的 profile 里，而 T82 起实例跑的是 0.2.0 工具链。宿主轮理应跟着实例走。pin 住的 `/opt/dsh-headless` 路径（[双文件系统 pin](2026-09-09-dsh-headless-bundle-dual-filesystem-pin.zh.md)）却让宿主轮取决于那条机器级软链恰好指着谁。
- 委派工具封口：社区委派工具行不被 preset 点名就不出现。preset 到达子 dsh 的方式一改，就得拿评测 preset 的本意核一遍。

## Decision

**preset 层是一条 registry 行。** scope 组了 preset 时，`provisionDshSubProfile` 在子 profile patch 里追加一个 `insert`：`{id: agent-preset-registry, name: '@deepseek-ai/dsh-agent-preset-registry', config: {default: <id>}}`，位置在 headless patch 之后、权限层之前。headless 的 agent loader 在 agent setup 里 `mount` 缺省 preset，所以 headless bundle 不用改。`readSubProfilePreset` 按包名回读这一行；eval 的探针（`packages/eval/src/sub-profile.ts`）同理。0.1.5 的 roster 行既不写也不认。

**preset 定义是一个包。** preset 包就是一个声明了 `dsh.bundle.patch` 的 `package.json`，patch 里有一行 `@deepseek-ai/dsh-agent-preset`，`config.id` 即 preset id。`@khorsheed/dsh-presets` 是这个形态，题库的 `env/presets-0.2.0/{eval-lean,eval-full}` 也是。技能根经包自身解析，用官方 preset 的 `createRequire(baseUrl).resolve('<包>/package.json')` 表达式。0.2.0 上 `baseUrl` 是 profile 根，不再是组合文件自己的目录。

**scope 留一份包副本。**
- `provisionDshScope(home, config, {preset, instanceProfileDir})` 在评测实例自己的 profile 里找声明该 id 的那一个直接依赖：扫 `package.json` 的依赖，按 realpath 解析 `node_modules/<包名>`，必须唯一命中。
- 然后检查这个包（包名、patch 文件、不得有绝对路径、id 确实声明了），逐字节镜像到 `<scope>/preset-packages/<id>`。
- 子 profile 在 `dsh.profile.bundles` 里于 `@deepseek-ai/dsh-base` 之后列这个包，它的 `node_modules/<包名>` 是一条指向副本的**相对**软链，宿主与单元（只 bind 挂 scope）因此解析到同一个目录。
- 刷新、保留并报告、持久化三条规则与 09-18 那篇相同，只有一处例外：显式请求现在先快照、后持久化，请求失败时 scope 里什么都不写。

**实例 profile 目录取自 `ctx.baseUrl`。** loader 把它设成 profile 的 `cordis.yml` 所在目录。T91 之前插件另有一个 preset 根解析器 `defaultPresetRoot`，顺序是 settings home → 非空 `DSH_HOME` → `~/.dsh`。这次把它**删掉**，而不是保留优先序：preset 的来源现在是实例装的一个包，实例的 profile 目录是唯一该找的地方。

**宿主轮跟实例走，容器轮保留 pin 的路径。**
- 新配置键 `unitHeadlessBundleDir` 写单元里的 headless 路径。写了之后，provisioning 写两份子 profile：
  - `<profileName>` 链向本实例自己的 headless bundle（宿主轮用）；
  - `<profileName>-unit` 链向单元路径（容器轮用）。
- 孪生 profile 的 patch 在宿主上读得到单元路径时取那份，否则取宿主 bundle 的。
- 轮次带 `exec` 时 provider 选 `-unit` profile，否则不选。
- web-eval profile 的 pin 从 `headlessBundleDir` 改成 `unitHeadlessBundleDir`。`headlessBundleDir` 保留原意，给仍想共用一个目标的部署用。

**宿主 profile 拷贝 headless bundle，不再软链。** 宿主 0.2.0 启动时给每个模块路径分类。`$DSH_HOME/profiles/` 下的路径是 *profile 层*，未声明的裸导入落到安装的入口上。realpath 落在 profiles 树之外的软链包是 *linked root*，只路由它 `peerDependencies` 里的名字。pack-dist 剥掉了 `dependencies`，打包后的 headless bundle 没声明 `commander`、`@deepseek-ai/schemastery`、`@deepseek-ai/dsh-cmdline`。于是从 scope 软链到实例安装时，它的 startup 与 runner 两行导入失败，没有谁调 `appExit`，子 dsh 挂住、不出会话。3185 上第一次真机就绪探针正是这样，420 秒超时。
- provisioning 现在把 bundle 自己的文件镜像到 `<profile>/node_modules/@khorsheed/dsh-local-agent-dsh-headless`：内容相同不动，安装变了重镜像，旧方案留下的软链直接替换、不碰其目标。
- 依赖闭包不拷。`@deepseek-ai/*` 仍从运行子 dsh 的那份安装解析，双文件系统契约反对拷贝的理由（每个包只一份实例）照样成立。
- `-unit` 孪生仍软链到镜像路径。只 pin `headlessBundleDir`、没有孪生的写法也仍软链：那是 0.1.x 共用一个子 profile 的形态，要的就是两个文件系统都解析得到的同一条路径。
- 探针证据：0.2.0-rc.2 工具链上，scope 的完整组合（headless patch、registry 行、preset 包、权限层）软链时挂住，拷贝时以 `MISSING_CREDENTIAL` 退出（探针没有 key）。同一份拷贝在 0.1.5-rc.1 工具链上也走到 `MISSING_CREDENTIAL`。
- `home.sha` 现在也覆盖拷贝里的 `package.json` 与 `cordis.patch.yml`。headless 安装升级后，在重新 provision 之前会表现为漂移；这是对的，受试对象变了。

**封口对评测 preset 不改变任何东西。** `eval-lean` 与 `eval-full` 只点名 `persona`、`skill-filesystem`、`tool-skill`，工具来自 dsh-base 的根行，从来没点过委派工具行。它们写明的口径「同工具、不同技能」在 0.2.0 封口下原样成立。真要委派的 preset，在自己的组合里点名 provider 的 `./tool` 行。

## Alternatives considered

**保留目录形态，加一层 0.2.0 垫片把每个目录注册成一行。** 这得在子 dsh（headless bundle）里加代码，去读宿主自己已经不读的目录，等于在受试对象里续命第二套 preset 机制。受试对象就不再是原装的 0.2.0 dsh。

**不拷包，把 preset 行直接内联写进子 profile patch。** diff 最小，因为组合文本搬进生成的 patch。但技能目录照样得放在单元读得到的地方，拷进 scope 这一步省不掉；patch 也不再是 config 的纯函数，而[重启地雷](2026-09-18-sub-dsh-preset-in-scope.zh.md)那条正靠这一点；探针还会失去「就是实例 catalog 量过的那个包」这层对应。

**把实例装的包软链进子 profile（不拷）。** 宿主上能用，但目标在 scope 之外，单元里悬空；而且实例一重装就能把 run 底下的受试对象挪动。

**保留 `defaultPresetRoot`（settings home → `DSH_HOME` → `~/.dsh`），在它下面找包。** 「preset 根」目录在 0.2.0 上没有含义。包在实例装它的地方找；再来一个解析器，唯一的作用是找到一份与 catalog 量过的不同的副本。

**两种轮次继续共用 pin 的 `headlessBundleDir`。** 只有机器级 `/opt` 软链一直跟着实例时它才对。实例换宿主线时，要么多一步要特权的操作，要么宿主轮静默地测旧版本。单元路径则由镜像定死，pin 它是安全的。

## Consequences

- 评测实例要把它量的每个 preset 包作为 profile 的直接依赖装上（`file:` 指向题库检出）。这是部署步骤，不是 pack 成员：preset 归题库所有。3185 临时实例上这一步是手做的，web-eval README 写明了它。
- 实例的 preset 选择器也会列出这几个 preset；无害，0.1.5 的目录 preset 也是如此。
- 在 0.1.5 上 provision 过的 scope 留着 `.agent-presets/<id>`，0.2.0 不读。0.1.5 条件用各自的 scope，`*-0.2.0-rc.2` 条件用新 scope，所以不做迁移。
- scope 的 `home.sha` 现在也覆盖 `profiles/<name>-unit/` 与 `preset-packages/<id>/`（其中配置后缀的文件）。
- 宿主轮不再依赖宿主上的 `/opt/dsh-headless` 软链。那两条只剩仍 pin `headlessBundleDir` 的 profile（0.1.5 线）在用；3171 切换时改指它们，是用户手跑的特权步骤。

## Testing

- `packages/local-agent-dsh/tests/provision.spec.ts`：
  - registry 层；
  - 包 bundle 加相对链接；
  - 非法包名；
  - `-unit` 孪生 profile（单元 patch 缺与在两种情况）。
- `packages/local-agent-dsh/tests/scope-preset.spec.ts`：
  - `findPresetPackage`；
  - 快照的复制、保留、无 profile 自愈、刷新；
  - 拒绝绝对路径、缺 preset 与软链；
  - 解析顺序，以及请求失败不持久化。
- `packages/eval/tests/{preset-snapshot,capability-probe,capabilities}.spec.ts`：包形态、registry 回读、「没有 preset 行」的拒绝。
- `packages/local-agent-dsh/tests/provision.spec.ts`（bundle 拷贝）：刷新并删掉旧文件、替换旧软链、拒绝非纯文件树、默认从安装解析。
- 真机：0.2.0-rc.2 临时实例（端口 3185）上两条 `dsh-{lean,full}-0.2.0-rc.2` 条件 provision 出带 `provisioned.capabilities` 的 lock。`dsh-lean-0.2.0-rc.2` 的第一次一格运行用的是软链，就绪探针失败（即上面的 420 秒挂住）；改拷贝后的结果见 T91 回报。
