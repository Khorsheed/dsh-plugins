# Agent Note: local-agent delegation inside an acquired container

Status: implemented

[English](2026-09-09-local-agent-container-exec.md) | 中文

## Problem

web-eval 的编排器（I3）要把每个评测格子放进受控单元里跑，可家族的每一次委派都在宿主上起 CLI：`ctx.subprocess.spawn`，宿主 cwd，宿主作用域目录。四家能不能在冻结镜像里跑，T16 已经各跑过一次最小 `exec` 证明了；缺的只剩传输层——一次委派轮怎么落到 lab 已经取得的容器里——而且有一条硬约束：spawn 之后的一切都不许变。容器轮必须与宿主轮一样地解析、settle、回读、记录，否则评测比的就是两套机制。

## Decision

- **一个可选调用选项。** `DelegationCallOptions.exec` 携带 `DelegationExecTarget = { container, workdir, env? }`，随已 stage 的委派 intent（`fresh` 与 `resume` 两种都带）传递——与 `cwd` 同一条通道，理由也相同：宿主 `SubagentStartRequest` 契约里没有家族私有启动事实的位置。哪儿都不给，每一轮就与从前逐字节相同。
- **传输层是一个共享函数。** core 里的 `containerExecSpawn(target, { argv, env }, who)` 把一次启动改写为 `docker exec -w <workdir> [-e NAME…] <container> <原样的 argv>`。`stdio` 仍是 pipe，`graceMs` 不变，宿主 `cwd` 依然生效——只是它现在是 docker **客户端**的工作目录。四家 provider 各在自己唯一的 spawn 处调用它；流解析、settle 链、回读、`delegations.jsonl` 写入一行都没动。
- **`exec` 是家族唯一碰的 docker 动词。** 取得、检视、挂载、销毁单元都属于调用方（lab）；没有 provider import lab，目标不过是一个名字加一个路径。
- **值不上 argv。** 每个转发变量只以 `-e NAME` 出现，docker CLI 从它自己的环境里解析值——那份环境正是 `containerExecSpawn` 返回的 spawn env，仍过同一层 `delegationEnv` 清洗。provider 解析出的凭据（子 dsh 的 API key）因此不进宿主进程表，与宿主路径一致。转发集是 provider 显式 env 层里**有值**的项（墓碑没有值），按键被 `target.env` 覆盖；继承白名单（`PATH`、`HOME`、代理那几个）刻意不转发——在单元里它们属于镜像和创建它的那次 `docker run`。名字排序，因此一次启动只有一种 argv。docker 客户端保留自己的守护进程坐标（`DOCKER_HOST`、`DOCKER_CONTEXT` 等）。
- **容器内的作用域目录必须由调用方点名。** `target.env` 少了 `CODEX_HOME` / `CLAUDE_CONFIG_DIR` / `KIMI_CODE_HOME` / `DSH_HOME`，`containerScopedHome` 就在任何会话记录与进程之前让这一轮失败。照转 provider 的宿主路径只会让 CLI 从一个单元里并不存在的目录起步：没凭据、没有可回读的 rollout，而且失败原因不出现在任何输出里。
- **作用域目录仍是宿主目录，rw bind 挂进去。** 这正是回读与记录能一行不改的原因：codex 的 rollout 定位、kimi 的 wire 日志镜像、子 dsh 的会话镜像，读的都是 `spec.env[<HOME 变量>]`——一个宿主路径——直接落在宿主文件系统上；CLI 做的凭据续期也回写到宿主。换成 named volume，每条回读路径上都得插一次 `docker cp`。
- **容器轮只走 exec。** 长驻驱动跑的是宿主上的常驻进程，恰恰是这个目标要替换的传输，因此 fresh 与 resume 两条路径上有目标就跳过 live 分支（评测的 drive 本来也是 exec-only——冻结决策 2）。
- **容器轮没有成员通道。** 成员桥是宿主 unix socket，其 MCP 声明还带着宿主 node 路径；kimi 那条更是要**写进**作用域目录里共享的 `mcp.json`。与其注入一个单元起不来的 server，不如这一轮不要这个通道——provider 干脆跳过注册，连 token 都不铸。
- **dsh 多一个旋钮。** 容器目标下 provider 自动补 `NODE_OPTIONS=--use-env-proxy`（调用方在目标里自己给了就不覆盖），并无条件报进 `LocalAgentEffectiveSettings.containerNodeOptions`——因为代码里这个注入本身就是无条件的。dsh 的 HTTP 客户端是 node 的 `fetch`（undici），它不读 `HTTP(S)_PROXY`：在只有白名单代理出网的单元里，这一轮会直连 API 并失败，而代理连一条 `CONNECT` 都收不到。它同时跳过宿主侧子 profile 的 provisioning——那份 profile 的 `node_modules` 符号链接在单元里解析不到，而且会被写进 bind 挂载的作用域目录里；容器化的调用方用既有的 `cliLaunch` / `profileName` 点名单元自己的入口与 profile，单元里也必须备好家族 headless bundle 及其运行期依赖闭包。

## Real-machine verification

四家各一次「回答 2+2」委派，跑在 T16 镜像（`eval-env:pinned`，`sha256:ed988b33…`）的密封评测网里，每家都经自己的 `start()` 驱动，带 exec 目标，用真实 subprocess spawn：

| 选手 | 结果 | 证据 |
|---|---|---|
| codex | `completed`，输出 `4` | `observedModel` `gpt-5.6-sol`，从**容器**写进**宿主**作用域目录的 rollout 里回读 |
| claude | `error`——`OAuth session expired and could not be refreshed` | 宿主对照组同样失败（`401 API key is invalid`）；代理日志显示续期打到 `platform.claude.com` 之后被 `console.anthropic.com` 拒绝，而评测白名单里没有那一条。传输已验证：argv 正是预期的 `docker exec …`，stream-json 正常解析，`observedModel` `claude-opus-5[1m]` |
| kimi | `error`——`provider.auth_error: 403 monthly usage limit` | 与 T16 记的是同一条账号侧配额；`observedModel` `kimi-for-coding`，从容器写进宿主作用域目录的 wire 日志里回读 |
| dsh | 单元内 `error`；宿主对照组 `completed`、输出 `4`（`observedModel` `deepseek-official/deepseek-v4-flash`） | 镜像自带的 in-box `headless` 是另一个更小的 app，不认 `--session-id`；同样的 `docker exec` 形状去掉那个 flag，在同一个单元里答出 `4`，`--use-env-proxy` 正常工作 |

其中四条属于环境而不属于本次代码的发现：评测白名单缺 claude 的 `console.anthropic.com` 续期回退；镜像必须为 dsh 备好家族 headless bundle 及其运行期依赖；整份活的作用域目录 bind 进单元会把宿主专用设置一起带进去（claude 作用域 `settings.json` 里那个给宿主守护进程用的 `https_proxy`，在单元里当场 `Connection refused`）；kimi 的账号配额仍然用尽。

## Alternatives considered

**把 CLI 驱动抽成独立包**（README 给 I3 列的第二条路）。推迟：现在只有 eval 编排器一个消费者，抽包等于立一条没人站在对面的边界，同时把四个跑得好好的驱动搬过包边界——而这恰恰是本任务要求逐字节不变的那段代码里最容易出现行为差异的改动。重新考虑的条件是出现**第二个**消费者；那时缝由两个真实调用方划出来，而不是从一个身上猜出来。

**在 docker argv 上写 `K=V`。** 否决：那会把解析出的子 dsh API key 放进宿主进程表，而 Linux 上 `/proc/<pid>/cmdline` 默认全局可读。NAME-only 形式是 docker 的既定行为（裸名字从客户端环境解析；客户端没有该变量则从容器环境里移除），在代码依赖它之前已对 docker 28.1.1 实测确认。

**只转发 `target.env`，provider 自己的一概不转。** 否决：dsh 那一轮的凭据、各家的端点覆盖，都是 provider 在内部从调用方够不着的宿主服务里算出来的。转发 provider 自己那层并允许调用方按键覆盖，才让「同一次委派、不同传输」这句话成立。

**把目标挂在 `SubagentStartRequest` 上。** 与 `cwd` 同样的理由否决：harness 缝由「不 fork 宿主」这条规则钉死，而 stage intent 通道存在的意义正是承载家族私有的启动事实。

**把容器与 workdir 记进委派记录，resume 时校验。** 本次否决：记录写入正是不许移动的那几行之一，而它已经带着的锚（宿主 `cwd`）就是 resume 比对的东西。调用方重复目标，与它重复 cwd 一样；换了容器是记录抓不到的调用方错误——这一点写进了两份 README，而不是留着不说。

**作用域目录用 named volume。** 否决：回读要读 CLI 自己的文件（codex 的 rollout、kimi 的 wire 日志、子 dsh 的会话日志），named volume 会在每条回读路径上插一次 `docker cp`。宿主 bind 让回读与凭据回写仍是它们本来就是的那次文件操作。

**容器轮保留成员通道与长驻驱动。** 否决：两者都是宿主进程机制。注入一个单元起不来的桥声明（kimi 那条还要写进共享的 `mcp.json`），是拿一个干净的缺位换一个坏掉的在位。

**让 provider 在单元里 provision dsh 子 profile。** 否决：provider 只拥有一个 docker 动词。单元里装什么是调用方的事，由 provider 去写等于家族往 lab 声明的环境里落笔。

## Consequences

- 编排器可以把一个格子的 CLI 放进 lab 单元，而这一轮怎么解析、怎么 settle、怎么回读、怎么记录一点没变——评测可比性正是靠这条性质。
- 容器轮没有成员通道、没有长驻驱动。两者都是被点名的缺位，不是无声的缺位。
- 挂什么由调用方备好。把活的作用域目录整个挂进去会带进宿主专用设置；claude 的 `settings.json` 代理是实测到的那一例，而且它是大声失败，不是悄悄失败。
- `containerNodeOptions` 是 `LocalAgentEffectiveSettings` 的新字段，因此按快照算的条件哈希会为 dsh harness 变一次。它是增量的：在它之前写的客户端直接忽略。
- 传输层由五个包的 argv 级测试钉住（容器与宿主两种 argv、fresh 与 resume 各一、NAME-only env 转发、凭据不上 argv、缺作用域目录即拒绝、dsh 的 `NODE_OPTIONS` 及其调用方覆盖），再加上四家各一次针对冻结镜像的真实委派。
