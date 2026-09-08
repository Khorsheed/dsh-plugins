# Agent Note: lab — composite environment fingerprint

Status: implemented

[English](2026-09-08-lab-composite-fingerprint.md) | 中文

## Problem

评测报告要放行格与格之间的比较，前提是能证明它们跑在同一环境里，而它读的机制就是 `refs.fingerprint`。lab 的指纹此前只是镜像的 repo digest。同一镜像配不同 CPU 或内存上限、多挂一个卷、注入的环境变量键不同——三种情况都得到**相同**指纹，报告会据此放行一场本不可比的比较，对耗时敏感的测量尤其如此。pilot A 的报告因为完全没有指纹而拒绝比较；I3 的第一份容器内报告要靠这条指纹放行，那它必须在被用之前就是诚实的。

web-eval 的架构早已定义了指纹该是什么——镜像 digest、CPU 与内存上限、挂载布局、注入的 env 键名——lab 没有实现。底下还压着第二个缺口：`AcquireSpec` 根本无法声明资源上限，架构点名的那个分量原则上也无从哈希。

## Decision

**指纹 = 四个分量的规范化 JSON 的 sha256，形如 `lab-env:<hex>`。** `DockerProvider.fingerprint(spec)` 的返回值从裸字符串改为 `EnvironmentFingerprint`——`{ fingerprint, components }`，`acquire` 接收这个对象。四个分量：

| 分量 | 内容 | 刻意排除 |
|---|---|---|
| `image` | 解析出的 repo digest（无 digest 时回退镜像 id；本地没有则先 pull） | — |
| `resources` | `--cpus` 与 `--memory`，规范化后比较（`4g`、`4096m`、`4294967296` 是同一个上限；`2`、`2.0`、`2.00` 是同一个数） | — |
| `mounts` | 每个挂载的容器内路径、类型、只读位，按容器内路径排序 | 宿主 `source`；声明顺序 |
| `envKeys` | 注入的变量名，排序 | 值 |

两条排除承担了主要重量。**宿主路径绝不进入**：同一份物化输入在不同机器、不同 run 下落在不同宿主路径，把它算进去会把事实上相同的单元判成不同——那是反方向的同一种不诚实。**env 值绝不进入**：值是凭据，或是每格本就该不同的坐标，不是环境的形状；分量会被打印、写进标签、写进归档，值放在那里就是泄露。

分量形状恒定：未声明的上限记 `null` 而不是省略键，未声明的列表为空。`components.version` 参与哈希，所以将来把定义扩宽必然改变所有指纹——这是对的：在窄定义下被判为相同的单元，在宽定义下未必仍然相同。（已被取代：[network、volume 挂载与 user](2026-09-09-lab-network-volume-user.zh.md) 改成了「未声明即缺席」，扩宽定义只移动声明了新分量的那些单元的指纹。）

**`AcquireSpec.resources` 会被真的加上，不只是被哈希。** `acquire` 用与哈希同一份规范化值，把 `--cpus` / `--memory` 传给 `docker run`。指纹若宣称一个容器并不具备的上限，就是用一个新谎替掉旧谎。无法规范化的上限在算指纹时报错，而不是把原始字面量哈希进去。

**daemon 仍是记录本身，状态目录只是镜像。** `acquire` 把分量 JSON 写进容器标签 `dsh-lab.fingerprint-components`，reconcile 从标签读回——宿主重启后幸存的单元照样能恢复「它的指纹为什么是这个」，信任链上没有宿主文件。在此之外，lab 现在会在 `stateDir`（`$DSH_HOME/lab`，否则 `<cwd>/.dsh-lab-state`，可配置）下写 `units/<id>.json`。这个文件没有权威：reconcile 领养单元时会重新写出它，`release` 会删掉它，写失败像 mission 登记一样 warn 跳过，整个目录删掉不丢任何东西。被释放单元的持久副本在归档的 `manifest.json` 里——它现在在 `fingerprint` 旁边多了 `fingerprintComponents`。

**旧的裸 digest 仍是合法指纹，只是没有分量。** 本线之前获取的单元没有分量标签，reconcile 后 `fingerprintComponents` 为 undefined，`fingerprint` 对它们输出 `components: null`，没有任何代码把 digest 反向解释成分量集。标签不可读或被手改时同样降级，而不是让正在重建整个注册表的 reconcile 崩掉。

**两个界面展示分量。** `dsh-lab status` 在 `TASK` 旁新增 `ENV` 列（短哈希）：各行 TASK 一致是公平性证据，ENV 一致是可比性证据，两者当场可见。`dsh-lab fingerprint` 用一个动词回答两个问题——给 UNIT 时打印已持有单元的指纹与分量；给 acquire 那套标志时解析一份 spec **将会**得到的指纹，不获取任何资源，于是开跑前 diff 两次输出就能点名是哪个分量会让这些格子不可比。

mission 未动：`refs.fingerprint` 仍只是一个不透明字符串，分量留在 lab 这一侧。

## Alternatives considered

**保留裸 digest，让报告自己把校验做宽。** 否决：报告将不得不逐个单元去读资源上限、挂载与 env，自行推导可比性，这等于把「同一环境」的定义放在消费方，而不是放在创造了这个环境的插件里。一个**本身就诚实**的不透明字符串，才是消费方能据以行动的东西。

**直接哈希声明的原始字面量，不做规范化。** 否决：`4g` 与 `4096m` 是同一个上限，某个 spec 生成器对一部分格子写一种、对另一部分写另一种，就会报出假的环境差异。规范化正是「相同环境哈希相同」的保证。代价是无法解析的字面量现在会报错而不是被不透明地哈希——这笔交易划算，因为 docker 到 run 的时候本来也会拒绝它，只是更晚、报错更难看。

**把挂载的宿主 `source` 算进去。** 否决：这是最可能造成假差异的一项——同一个 datasets worktree 每次 run、每台机器落在不同路径——而且会把宿主绝对路径塞进一个要写标签、要打印、要进归档的值里。

**把 env 值、或值的哈希算进去。** 值本身否决（凭据；以及 `EVAL_CELL` 这类**本就该**不同的每格坐标）。值的哈希同样否决：它照样会把仅因 `EVAL_CELL` 而合理不同的格子劈开，而真正描述环境形状的是键集合。

**不要状态目录，只用标签。** 这是既有立场——[物化清单那篇](2026-08-24-lab-materialization-status-view.zh.md) 当时否决了 lab 自持状态目录。本任务的任务书另作了决定，而这个决定成立的唯一理由是：镜像被造成了没有权威的东西——派生自标签、reconcile 时重新写出、release 时删除。对任何会成为**第二个真相来源**的东西，那篇的理由仍然有效：清单在这里仍然没有家，路径仍由调用方指定。

**release 之后保留状态文件作为诊断存档。** 否决：它会无界增长，并悄悄变成人们真正依赖的东西。被释放单元的环境属于归档清单，而清单现在带上了分量。

**指纹字符串用裸 `sha256:<hex>`。** 否决：那与镜像 id 在视觉上无法区分——而镜像 id 恰恰是旧回退路径产出的东西。`lab-env:` 这个 scheme 让复合指纹与旧指纹用肉眼、用 `isComposite` 都分得开。

## Consequences

- 所有单元的指纹都变了。仓库内没有任何地方钉死过指纹字符串，`refs.fingerprint` 对 mission 不透明，所以唯一可见的效果是既有容器保留旧 digest，被读作「无分量」。
- `UnitProvider.fingerprint` / `acquire` 的签名改了（string → `EnvironmentFingerprint`）。发布前可以接受；仓库内除 `DockerProvider` 外唯一的实现者是联调套件的 fake。
- lab 现在会写一个宿主目录，而 invariant companion 的注释此前否认这一点。注释已改为它仍能站得住的那句更窄的话：没有**权威性**宿主状态。
- 指纹钉住的是声明，不是实测：镜像自带的 `ENV`、内核、CPU 型号、网络策略都不在分量里。它挡的是一次 run 之内的配置漂移，不是机器等价——这条写进了 README 的限制，免得报告读过头。
- lab 现在能声明资源上限（`resources`、`--cpus`、`--memory`），这本身就是架构里 I3 那一行的需要，与指纹无关。

## Testing

包内 100 个测试全绿。纯函数层（`tests/fingerprint.spec.ts`）：单位规范化的正反两面与它的拒绝、对键顺序不敏感的规范 JSON、恒定的分量形状、scheme 判别、短哈希渲染、标签解析的降级而非抛错。provider 层（`tests/docker.spec.ts`）：任务书点名的三条——同镜像不同资源上限指纹不同、挂载顺序无关、env 值不同键相同指纹相同——外加 env 键不同、等价上限的不同写法、宿主路径无关、多一个挂载 / 移动 target / 去掉只读位、一次证明序列化后的分量里既无宿主路径也无 env 值的扫描、上限确实进了 `docker run`、以及分量标签。service 层：acquire 写镜像、release 删镜像、宿主重启后领养单元时重新写出、镜像写不进时 warn 且不阻断、旧标签与被改坏的标签都被接受为「无分量」、归档清单带上分量（或 `null`）。CLI：`fingerprint` 的两种模式、`ENV` 列、上限真的落到命令行上。

## Cross-references

- [lab M1](2026-08-20-lab-m1.zh.md) · [M2 verbs](2026-08-20-lab-m2-verbs.zh.md) · [M2 CLI](2026-08-20-lab-m2-cli.zh.md)
- [物化清单与进度视图](2026-08-24-lab-materialization-status-view.zh.md) —— 本篇所限定的「不要状态目录」立场
