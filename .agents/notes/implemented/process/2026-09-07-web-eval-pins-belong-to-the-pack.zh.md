# Agent Note: web-eval 的评测 pin 归 pack，不归用户层

Status: implemented

## Problem

按 dsh 各 profile 的惯例，`cordis.patch.yml` **是用户的层**：`install.sh` 铺一次，`update.sh` 此后再不碰它。dsh-dev 把这条写在明面上，对一个开发整合包也确实该如此——那一层装的是偏好，更新时覆盖别人的偏好是不礼貌的。

dsh-web-eval 继承了同一个文件、同一条规则，而它的评测 pin 恰好只能住在这个文件里。这些 pin 不是偏好。它们是本 pack [冻结决策](../../../../profiles/web-eval/README.md#冻结决策)的执行点：驱动全 exec（决策 2）、四家沙箱档位一致（决策 3）、推理强度每家显式 pin（决策 4）、工具按域开放（决策 12）。每一条都决定「这两格只差一个因子」对一次 run 而言是不是一句真话。

在用户层规则下，一次 `update.sh` 就能悄悄换掉实例的沙箱档位或推理强度，而 `run.meta` 里记的还是改之前的值。什么都不会失败，什么都不会打印——报告的第三条不变量「受试对象一致」就此静默地失去意义。装置会变成一段用户可编辑、却没有任何哈希覆盖的状态：条件哈希够不着 provider 配置（要到 I4 的 `provision` 才把 scoped home 折进 `home.sha`），所以这一层的改动对 run 记录的每一个哈希都是隐形的。

这个悬而未决的问题在 README 里被明确留给了 I1（「I1 决定它们进 pack 自带的 patch 层还是 `cordis.patch.yml` 用户层」），到 I2 · T15 需要这些 pin 真的存在时，它仍然开着。

## Decision

**只对 dsh-web-eval**：`cordis.patch.yml` 归 pack。它随包发出评测 pin，两个安装脚本都覆盖它——它本来就在 `install.sh` 的 `PROFILE_FILES` 里，现在也进了 `update.sh` 的 `UPDATE_FILES`。个人覆盖去 preset 层，pack 不碰那里。dsh-dev 与 dsh-basic 不变——在那里这一层仍归用户，因为一个开发整合包没有需要保护的装置。

文件本身逐条写着理由，好让只翻 profile 目录的操作者也知道为什么这里的用户层不是用户层。它发出的七行：

| 行 | pin | 冻结决策 |
|---|---|---|
| `mission` | `tools: read` | 12 —— 只留四个队列读工具；写类动词全归编排器服务面 |
| `datasets` | `tools: authoring` | 12 —— 读类加 `put_item`；`worktree_path` 留在服务面 |
| `eval` | `tools: all` | 12 —— 本包只注册三个读工具，`all` 本身就是只读 |
| `local-agent-codex` | `live: false`、`sandbox: workspace-write` | 2、3 |
| `local-agent-claude-code` | `live: false`、`permissionMode: skip`、`baseUrl`、`proxyUrl` | 2、3、5 |
| `local-agent-kimi` | `live: false`、`thinkingEffort: high` | 2、4 |
| `local-agent-dsh` | `live: false` | 2 |

有三行的理由值得写出来，而不是让人去猜。

**`kimi thinkingEffort: high` 与包自带的默认值同值。** 照写不误正是决策 4 的用意：一个「因为包碰巧默认如此」才成立的推理强度不叫 pin，叫没人看过。默认值可以在一个补丁版本里挪走而无人察觉，git 里的一行不会。

**`claude baseUrl` 为什么要 pin，以及为什么 pin 的是官方端点。** 决策 5 说端点进条件。不 pin 的话 provider 退回宿主进程环境的 `ANTHROPIC_BASE_URL`，端点就成了「启动实例的那个 shell 碰巧导出了什么」——换个终端重启即静默换上游，而 `run.meta` 记的还是旧值。pin 让端点成为装置的一部分；条件文档的 `model.endpoint` 照抄同一个值。

**取值**是官方端点加 `proxyUrl` 出网，与 3080 生产 profile 同——这不是偏好，是被逼出来的。宿主环境导出的那个第三方地址，认证走 API key；而 `delegationEnv` 只放行 25 个环境变量名，`ANTHROPIC_API_KEY` 不在其中，provider 也没有传 key 的旋钮。于是一次委派只可能拿着订阅 OAuth 去打，而第三方端点拒收这份授权（实测 401）。`proxyUrl` 不是 spawn 变量——`provisionClaudeHome` 把它写进 scoped home 的 `settings.json` 的 env 块，因为守护进程拉起的实例没有用户 shell 的任何代理变量。

**`codex sandbox: workspace-write`，不是 `danger-full-access`。** 决策 3 把沙箱交给容器边界，并要求容器内取 `danger-full-access`。I2 跑在宿主上，那里没有边界——在宿主上给满权限等于把一次评测的副作用放进真实 home。所以 pack 在宿主直跑阶段发的是更窄的那一档，每次 run 的 `methodology.md` 把这条不对称作为已知偏差声明出来。I3 的容器会把 `danger-full-access` 还回来，届时四家才真正落在同一档上。

## Alternatives considered

**pin 进 pack 自带的 bundle patch，`cordis.patch.yml` 仍归用户。** 这是 README 提出的问题的另一半，也是更常规的形状——每个成员包本来就靠自己的 `cordis.patch.yml` 自挂载。否决的理由是 profile 不是包：它没有自己的 `dsh.bundle.patch` 来承载一个 patch 层，所以这些 pin 只能被推进成员包里，而那样它们会作用于**每一个**挂这些成员的 profile，dsh-dev 也在内。pin 是一个 pack 的装置，不是一个插件的行为。

**层仍归用户，改在 run 时核对合成后的值。** 编排器可以读 provider 的有效配置，pin 与声明不符就拒绝这次 run。作为一道**校验**这严格更好、也值得做，但它替代不了本决定：它在一次 run 开始的那一刻发现漂移，而要防的失败是漂移**已经发生在**某次 run 上、只在一份没人重算的报告里可见。而且它还不存在，T15 现在就要这些 pin。这道检查的自然归宿是 I4 的 `provision`——那一步本来就负责把声明变成实物 scoped home 并哈希它；到那时 pin 折进 `home.sha`，被条件哈希覆盖，这才是耐久的修法。

**把 pin 折进条件文档。** 语义上很吸引人——条件本来就是「受试对象」，沙箱档位与推理强度显然属于它。但 `dataseek.condition/1` 描述的是一个对象，而 I4 之前编排器没有任何办法把条件的声明施加到一个在跑的实例的 provider 配置上。在它能做到之前，一个描述沙箱档位的条件字段就是一句没有东西执行的声明——这正是判官条件已经为 `model.declared` 记录过的那种失败形态。把 pin 留在 profile 里、在 `methodology.md` 里**声明**它们，说出口的不多不少正好是真话。

## Consequences

把个人设置放进 `$DSH_HOME/profiles/web-eval/cordis.patch.yml` 的操作者，会在下一次 `update.sh` 时丢掉它们。这是代价，而且只由 web-eval 的操作者承担——对他们来说这个 profile 是量具而不是工位。README 在描述该文件的两处、两种语言里都写明了。

这些 pin 现在可以在 git 里评审、可以被 methodology 引用，这正是 `docs/dimensions.md` 第一条方法论底线（「评分标准开跑前冻结并公开」）对配置的同款要求。它们仍然**没有**被任何哈希覆盖——条件哈希够不着——所以真正保护一次 run 的是「装置配置进 git、跑中不改」这条纪律，不是一道机械检查。让它变成机械检查是 I4 `provision` 的活。

codex 的档位让四家在整个宿主直跑阶段都不齐：codex 跑 `workspace-write`，claude 跑 `skip`，dsh 无限制。这是每一份 I2 结果里都存在的真实不对称，每次 run 都声明，也是 I2 的结论明确不用于发布的理由之一。
