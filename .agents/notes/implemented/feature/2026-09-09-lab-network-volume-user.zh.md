# Agent Note: lab — network, volume mounts, in-container user

Status: implemented

[English](2026-09-09-lab-network-volume-user.md) | 中文

## Problem

构建评测镜像时（T16）拿容器化真正需要的东西去对读 `packages/lab/src`，发现三件 lab 表达不出来的事。`AcquireSpec` 没有 network 字段，`docker.ts` 拼 argv 时也从不传 `--network`，于是每个单元都落在 docker 默认 bridge——那是一张有 NAT 出网的网。而评测拓扑的全部意义就在于一张 `--internal` 网络：出去的路只剩白名单代理与本地包镜像。lab 表达不了它，隔离只存在于题库自己的 `run-unit.sh` 里。这被记为 I3 最硬的缺口，因为「这个单元打不到外网」是编排器必须能作出的断言。

同一处还有两个小些的缺口。`mounts` 只拼得出 `type=bind`，于是一家一个的凭证卷挂不上——那是必须比单元活得更久的可写状态，因为 OAuth 续期要回写到它上面。以及没有 `user`：镜像以非 root 的 `node` 跑，因为有一家 CLI 在 root 下拒绝 `--dangerously-skip-permissions`，而那正是冻结决策给它定的沙箱档；以 root 跑会让四位选手里的一位落在与其他三位不同的档位上。

三件事底下是同一件：**lab 声明不了的东西，也就指纹不了**。跑在不同网络上、以不同用户跑的两个单元，此前被报为同一环境。

## Decision

**三个字段，既真传也进指纹。** `AcquireSpec` 加 `network?: string`（网络名或 `'none'`）与 `user?: string`（`uid[:gid]` 或用户名）；`MountSpec` 加 `type?: 'bind' | 'volume'`，volume 时 `source` 是卷名。`acquire` 把 `--network`、`--user`、`type=volume,source=…` 传给 `docker run`，三者同时进指纹分量。**未声明**的含义与从前完全一致——docker 默认 bridge、镜像自带的 `USER`、bind 挂载——README 在要紧处点明这件事，因为「没声明网络」不等于「没有出网」。

**挂载分量对 volume 同样不记 `source`。** bind 的宿主路径逐机而异；volume 的名字**按设计**逐格而异（一家一个凭证卷，正是为了不让任何一位选手看见别人的令牌）。格与格之间必须相同的是**布局**——什么挂在哪里、能不能写——所以分量仍是 `{target, type, readonly}`。但 `type` 本身进分量：`/creds` 上挂卷与 `/creds` 上挂 bind 是两个环境。

**网络名进分量，这不是「不含宿主信息」的例外。** 网络名是 daemon 本地的一个标签，命名的是一套拓扑，不是某人磁盘上的位置；跑同一套评测的两台机器上都有 `eval-net`，而它的不同恰恰改变单元能打到哪里。

**未声明的分量不参与哈希。** 哈希原像是分量集减去每一个值为 `null` 的后加分量。所以加上 `network` 与 `user` 没有移动任何两者都不声明的单元的指纹——测试里钉了两个由改动前的实现算出来的字面哈希值，将来再加分量若移动了它们，会被当场抓住。

这**取代**了[复合指纹那篇](2026-09-08-lab-composite-fingerprint.zh.md)的版本化立场（「定义变宽必然改变所有指纹」）。取代的理由来自指纹本身的用途：它应当在它描述的环境变化时变化，而当初没声明网络、现在也没声明的单元跑在同一个地方。`components.version` 因此编的是**哈希规则**——规范化、归一化、这条规则本身——不是分量清单。诚实的代价写进了 README 的限制一节：`network: null` 区分不了「没人管过它的网络」与「有人确认过默认 bridge 就是对的」。要断言隔离，就得显式声明。

**pid 目录改为以 root 建、置 `1777`。** `acquire` 此前用普通 `docker exec` 准备 `/run/dsh-lab/pids`，那是以容器用户身份跑的。非 root 单元——无论是声明的 `user` 还是镜像自带的 `USER`——建不了 `/run` 下的东西，于是每一次非 root 的 acquire 都会挂在这一行；acquire 不了的 user 支持不算支持。现在改为 `exec --user 0` 建，并像 `/tmp` 一样置为 sticky 可写，于是 pidfile wrapper 无论单元以谁的身份跑都能工作，lab 也不必去认识那个 uid。daemon 拒绝 `--user 0` 时（userns-remap）回落到普通建法，那正是改动前的行为。

**CLI 收 `--network`、`--user`，以及单独的 `--volume NAME:DST[:ro]`。** 挂载的种类由**它来自哪个标志**决定，绝不从 source 的文本形状去猜。docker 自己的 `-v` 按「看起来像不像路径」判 bind 还是 volume；一个相对路径悄悄变成卷，不是值得继承的猜法。`fingerprint` 收同一套 spec 标志，于是一份 spec 的分量可以在获取任何东西之前解析出来并互相 diff；`status --json` 对已持有的单元带出这三项。

## Alternatives considered

**把 `components.version` 升到 2，让所有指纹都变。** 这正是前一篇规定的做法，本篇否决了它：那会让环境**没有变化**的单元的指纹失效，而这恰是指纹要防的那种错误的反面。支撑旧立场的那个更窄的担忧——扩宽会揭示先前不可见的差异——对这三项不成立，因为它们各自的「未声明」都有唯一确定、且并未改变的含义。

**统一规则：任意深度上丢掉所有 `null`。** 说起来更干净，但它会移动每一个未声明资源上限的单元的指纹（`resources: {cpus: null, memory: null}` → `{}`）——那几乎是全部。规则之所以只限于初始分量集之后新增的分量，正因为初始集的原像字节是稳定性主张的锚。

**像 `docker -v` 那样从 source 字符串推断 volume 还是 bind。** 否决：这个推断恰好在最会咬人的那个情形上是错的（相对宿主路径），而且它失败得无声——建出一个空卷，而不是报错。

**把卷名放进指纹分量。** 否决：那会让每一格的指纹都不同，因为每家挂自己的凭证卷——指纹会报出四个不可比的环境，而设计说它们是一个。

**把 pid 目录挪到 `/tmp`，而不是修它的权限。** 更简单，但旧 lab 建的容器会被新 lab reconcile 领养，届时 `terminate` 会去清扫一个 wrapper 从未写过的目录——孤儿补偿会无声地什么都不覆盖。保留路径、只修创建方式，新旧单元才被同一段代码扫得到。

**给个 `--network none` 简写，或者 `network: false` 布尔。** 否决：`'none'` 本来就是 docker 自己的叫法，一个直通的字符串字段比两种说法要解释的东西更少。

## Consequences

- 既有单元的指纹不变，`tests/fingerprint.spec.ts` 里钉的两个哈希就是说明这一点的回归测试。
- 非 root 单元现在才真的能用；此前任何带非 root `USER` 的镜像都会在 acquire 处失败，而没有测试覆盖到它，因为测试用的镜像全以 root 跑。
- lab 现在能端到端表达评测拓扑，于是「单元没有出网」成了编排器一侧有标志支撑的断言，而不再是题库脚本一侧的事。lab 仍不去**验证**它——声明的网络就是一份声明，README 继续写明指纹钉的是声明不是实测。
- `MountSpec.source` 现在按 `type` 有两种含义。按种类分别写文档而没有改名：改名会为了一个词而弄坏每一个既有调用方。

## Testing

包内 120 个测试全绿。指纹层：两个钉死的改动前哈希、null 键与缺席哈希相同、network / `'none'` / user / 两者齐全各自得到不同指纹、同一 target 上 volume 与 bind 不同、同一 target 上两个不同卷名相同、以及一次证明卷名不会进入序列化分量的扫描。provider 层：`--network` / `--user` 真的上了命令行、未声明时不出现、`type=volume` 带与不带 `readonly`、pid 目录经 `exec --user 0` 建并 `chmod 1777`、以及 userns-remap 的回落。CLI：acquire 同时用上三项加一个 bind、坏的 `--volume` 是用法错误、`fingerprint` 对未获取的 spec 报出 network 与 user、`status --json` 对已持有单元带出它们。

实测（T16 的镜像，评测网络上）：以 `network: eval-net`、`user: 1000:1000`、一个具名卷 acquire 一个单元，容器内读到的 `id` 与 `ip route` 与声明一致。

## Cross-references

- [复合环境指纹](2026-09-08-lab-composite-fingerprint.zh.md) —— 本篇扩宽的分量集，以及本篇取代的版本化立场
- [lab M1](2026-08-20-lab-m1.zh.md) · [M2 verbs](2026-08-20-lab-m2-verbs.zh.md) · [M2 CLI](2026-08-20-lab-m2-cli.zh.md)
