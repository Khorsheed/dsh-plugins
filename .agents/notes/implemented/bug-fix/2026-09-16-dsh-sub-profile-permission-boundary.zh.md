# Agent Note: 子 dsh 的权限边界是作用域目录里的一个文件

Status: implemented

## Problem

在 web-eval 的容器单元里，dsh 选手没有 shell。每一笔 `bash` 都被拒，它自己
在答卷里写着：

> 本会话 shell 不可用——宿主无可用 sandbox 后端且无审批通道，bash 全部被拒；
> 我改用文件/检索工具完成了读取与结构校验，因此 JSON 未经过解析器验证

（I5·T39 走查日志的缺口 G14。）P0 那道占位题不需要 shell，所以走查就这么过去了；
F2 与 F3 都要交 shell 脚本、都要跑测试，真题轮上这条条件会因为与模型无关的理由
拿零分。

在单元里复现，两段拒绝原文：

```
Error: sandbox mode "workspace-write" is requested but no sandbox backend is usable on this host; refusing to run the command unconfined. Install bubblewrap or run a Landlock-enforcing kernel (Linux), ensure sandbox-exec is usable (macOS), or ensure the ACL restricted-token runner can start (Windows) — otherwise switch the consumer to danger-full-access.
Error: sandbox escalation to "danger-full-access" requires approval, but no approval channel is available
```

诊断的两半都成立，且互相独立：

- **没有可用后端。** `dsh-sandbox-local` 的 Linux 链是 bwrap，然后 Landlock。
  评测镜像没装 bubblewrap，Landlock 那一档包在、但用不了——
  `@deepseek-ai/node-addon-system/landlock-run` 自己的 `probe()` 在容器内核下
  返回 `"unusable"`。接缝于是 fail closed，这是对的：它宁可拒绝也不无防护地跑。
- **没有审批通道。** `dsh-base` 把 `user-approval` 组成 `ask`，而模型那一次
  受认可的升档重试需要对面有人。无头子 dsh 那头没有人，重试同样 fail closed。

两条都不是缺陷。缺陷是**没有任何东西决定子 dsh 的边界**。`local-agent-dsh`
**根本没有权限旋钮**，子 profile 就按 `dsh-base` 组成的那一档跑——`workspace-write`
加 `ask`——于是「沙箱交给容器边界」这条冻结决策，在四家里的这一家上没有执行点。
条件文件的 `permissions: "unrestricted"` 是一句背后没有东西的声明，
`effectiveSettings` 报的是「没有这个旋钮」，provision 闸因此把它判成不可核验而
不是判错。宿主上没人察觉：macOS 有 Seatbelt，沙箱起得来，`bash` 能跑。

## Decision

供给（provisioning）把边界写进该作用域的子 profile，成为 preset roster 旁边的
又一层生成 patch。

`local-agent-dsh` 的配置新增 `permissions`，用 dsh 自己的三词词表拼写
（`read-only` / `workspace-write` / `danger-full-access`——即 `dsh-base` 的
`permission-presets` 表的三个键）。给了值，`provisionDshSubProfile` 就追加：

```yaml
# --- permission boundary (written by local-agent-dsh provisioning) ---
- id: sandbox-policy
  name: '@deepseek-ai/dsh-sandbox-policy'
  config:
    mode: danger-full-access
    workspaceRoot: !!js process.cwd()
- id: approval
  name: '@deepseek-ai/dsh-user-approval'
  config:
    policy: never
```

这段文本有三处是承重的。它们是**覆盖**行而不是 insert：两个 id 已经在本 profile
所叠的 `dsh-base` 层里，而这一层落在它之后。每行把自己拥有的键**全部重抄**，
因为 `applyEntryPatches` 做的是 `target[key] = value`——整值替换，只写 `mode`
会把 `workspaceRoot` 静默抹掉。每行还带 `name`，万一 id 被别的插件占了，loader
报 name mismatch 并跳过，而不是把这份配置塞给它。若某条基线两行都没有，loader
报「entry not found」并跳过：子 dsh 带着它现有的组成启动，好过为了一个旋钮起不来。

两行按 `dsh-base` 自己的表配对移动：`danger-full-access` 配 `never`，另两档配
`ask`。分开钉而让它们漂开，等于造一个跑不进去、也问不到人的边界——那恰恰就是
G14 撞见的状态。

**不写就是不写。** 没有 `permissions` 时一层都不写，patch 文件与从前逐字节相同：
现存的每一个宿主作用域都保持 `workspace-write` + `ask`。这个键是选择性加入的，
因为在开发机上子 dsh 共享的是真实 home。

`effectiveSettings` 把配置的档位报作 `sandbox`——codex 早就用这个字段表达同一
件事——而 `dsh-eval` 把它映射进条件词表：`danger-full-access` 变成
`unrestricted`，即协议 §6.2 给这一家的唯一词；其余档位**原样**返回，于是一个仍在
约束子 dsh 的作用域读起来就是它本来的样子，与声明对不上。缺位仍然映射为 `null`。
provision 闸的 `permissions` 一行判 ERROR，所以从此一条声称 `unrestricted`
的 dsh 条件若配着一个约束子 dsh 的作用域，就写不出 lock。

评测装置在 `profiles/web-eval/cordis.patch.yml` 里钉 `permissions:
danger-full-access`，与 codex 的 `sandbox`、claude 的 `permissionMode` 并列，
补齐冻结决策 3 的第四家。**这条 pin 与容器路径是一对**，与 codex 那条同理：谁要
在宿主上跑阶段一二，必须先把它改回去。

## 为什么钉在作用域目录而不是 spawn env

`dsh-base` 那两行本来都读 `DSH_PERMISSION_MODE`，容器轮本可以再带一个 `-e` 把值
送进去。没有这么做，理由有两条。

这个值是受试对象的一部分，而作用域目录正是定义受试对象的状态已经住着的地方：
`home.sha` 哈希 `cordis.patch.yml`（`.yml` 在配置扩展名清单里），边界因此与
preset roster 走同一道门进入条件的身份。bind 挂载的作用域目录于是把自己的边界
一并带进单元，不需要编排器配合。

而单元的复合指纹按**每一个 env 名字**计数。评测已经为 dsh 单独花掉一个名字
（`NODE_OPTIONS=--use-env-proxy`），并特意在
`effectiveSettings.containerNodeOptions` 里报出来让这条不对称可见；再加一个，
「两格只差一个因子」这句话就更难说清，而这件事根本不是关于环境的。

一个值得写下的副作用：生成层落在 base 层之后，字面值因此压过
`DSH_PERMISSION_MODE`。钉过的作用域，其边界不再取决于是谁起的这个进程。

## Alternatives considered

**只在容器轮注入 `DSH_PERMISSION_MODE`。** 改动最小，而且有个诱人的性质：宿主轮
自动保持 `workspace-write`——边界跟着「有没有容器」走，而不是跟着一个配置键走。
按上面的指纹与身份理由否决，另加第三条：它会让边界对 `home.sha`、对任何读这个
作用域的人都不可见，而 G14 隐身两个迭代靠的正是这一点。任务的冻结决策点名了
子 profile 就是那个位置。

**给评测镜像装 bubblewrap。** 单元会因此有一个能用的后端，子 dsh 可以继续自我
约束。否决，因为它回答的是另一个问题：冻结决策 3 说单元**就是**沙箱，另外三家
也都已经钉在各自的满权限档上。第一层边界里再套第二层，等于让 dsh 一家落在更严的
档位上，而那正是这条决策要消除的不对称——并且它把答案烧进镜像 digest，而不是
写进条件。

**把这两行烧进镜像的 profile。** 单元里本来就有一份子 profile 的形状。否决，因为
那样一来这个值就成了环境的属性，对条件不可见，不重建镜像就改不了；而
`permissions` 是一个人应当能在两格之间变动的因子。

**除 `sandbox` 外再报 `autoApprove`。** 审批那一半是实打实的事实，家族也有对应
字段。否决，因为 `autoApprove` 是 kimi 的布尔旋钮，而 `effectivePermissionsOf`
按 harness 名分派：给 dsh 再加一个字段，同一个边界就有了两种拼写。档位词本身已经
蕴含策略，因为配对它们的正是 `dsh-base` 那张表。

## Testing

`packages/local-agent-dsh/tests/provision.spec.ts` 钉住生成层：不写时一个字节都
不写、`danger-full-access` 出两行且 `policy: never`、两个约束档保持 `ask`、
`workspaceRoot` 被重抄、词表之外的值抛错、该层叠在 preset roster 之后且两者都读
得回来、撤掉 pin 后下一次供给把这层原样去掉。
`packages/eval/tests/provision.spec.ts` 钉住权限词表里 dsh 的三行。

在 `eval-env:pinned` 单元里对着 bind 挂载的 `dsh-exec` 作用域目录端到端实测。
修前，`bash -c 'echo ok'` 返回 Problem 一节引的那两段拒绝。带 pin 重新供给之后，
单元内组成出来的配置读作 `mode: danger-full-access` / `policy: never`，同一轮答：

> The command ran successfully. Full result verbatim:
>
> ```
> ok
> ```
>
> Exit code: 0 (no `[exit code: N]` marker was present, indicating success). The tool did not refuse.

宿主上，不带这个键供给出来的作用域组成的是
`mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'` 与那个
`ask`/`never` 三元表达式——`dsh-base` 自己的写法，纹丝未动。

## Consequences

dsh 选手能在单元里跑 shell 了，这是 F2 / F3 真题轮有意义的前提。冻结决策 3 对
四家都有了执行点，承载它的那个条件字段也从不可核验变成可核验：一个悄悄约束子
dsh 的作用域，现在会挡住自己的 lock。

代价是这条 pin 碰到的每一个 dsh 作用域，`home.sha` 都变。两条 dsh 条件
（`dsh-exec`、`judge-dsh-v4-pro`）都需要重新 provision 并把 `home.sha` 抄回去
才重新 ready——就是 G7 已经记过的那个两步。在 T22 冒烟作用域上实测：
`da8d8088…` → `a348cd3d…`。

这条 pin 同样作用于钉过的部署的宿主轮，判官委派在内。这是有意的——两条 dsh 条件
都声明 `unrestricted`，所以改之前判官那句声明同样不属实——但它意味着一个钉过的
实例把真实作用域目录的满权限交给了子 dsh。web-eval 的 patch 在 pin 旁边写明了
这一点，与 codex 那行早就带着的同一句警告并列。

未处理：子 dsh 的 member-bridge 行在单元里仍然起不来
（`DSH_MEMBER_BRIDGE_ENTRY` 在那里按设计为空，于是 `node ''` 往 stderr 打一个
`SyntaxError`）。那是预期中的 `failOnStartupError: false` 降级路径，不花这一轮
任何代价，但它是每个容器轮 stderr 上的噪声。

## Related

- [按 preset 的能力快照与子 dsh preset roster](../feature/2026-09-11-capability-hash-and-sub-dsh-preset.zh.md) — 本层紧挨着叠的另一层生成 patch。
