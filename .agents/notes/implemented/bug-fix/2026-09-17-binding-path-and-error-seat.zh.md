# Agent Note: 绑定路径是规范路径，失败是三句话（I5 · T62）

Status: implemented

[English](2026-09-17-binding-path-and-error-seat.md) | 中文

## Problem

用户在实机上打开了两个 tab。两个都打不开，而且两个都没说出一句用户能照着做的话。

题集 tab：`~/.dsh/scratch/dataseek-eval-i5 is not a git repository: GitError: git rev-parse --show-toplevel failed`。实验室 › 条件页：`not a dataset repository (no datasets/ directory)`。说的都是一个存在的、确实是 git 仓库、确实有题集的仓库。

**根因（I5 走查缺口 G5）**。绑定存储把 `repoPath` 原样记下。`~` 是 **shell** 的便利，存储下游没有任何一环展开它——`git -C` 不展开，`readdir(<repo>/datasets)` 不展开，拿仓库路径与会话 realpath cwd 严格比较的包含性检查也不展开。而 web tab 写绑定时回路里根本没有 shell，composer 里跑 `/datasets bind ~/x` 同样没有。于是存储里躺着一个指向名叫 `~` 的目录的路径，每个读取方各自用各自的措辞失败。

**用户真正看到的是第二重失败**。上面两句都是宿主诊断：写给调宿主的人看的英文，带着 `GitError: git rev-parse --show-toplevel failed`，引着绝对路径。两个 tab 把它们原样打在页上——光实验室 tab 就有 22 处 `{t('x.error')}: {message}`。读的人既没得到「坏在哪」，也没得到「怎么办」，而这是两个 tab 的第一屏。

## Decision

**一个归一化函数，进出都过它**。`normalizeRepoPath` 去空白、展开前导 `~`（只认 `~` 与 `~/…` 这个简写——名字以 `~` 开头的目录就是一个目录）、转绝对路径，目录存在时再解到 realpath。路径不存在就保留绝对形态：归一化不是存在性检查，那是 `assertRepository` 的活，绑到一个没挂载的卷也必须能原样存回。

它住在 `repo-path.ts` 里——I5·T58 为同一个形状刚加的那个模块（把 agent 的 `repo` 参数与它只能复述的绑定比对）。T58 写的是「刻意不动绑定存储」，而本任务正是那个改动，于是两者并成一个函数，而不是留下两份会各自漂移的实现。它跑在 `validateBinding` 里——所有写入与所有读取本来就都过这个函数，于是没有任何消费方需要记得这件事。`resolveScope` 把胜出的那个来源（显式 `repo`、绑定、配置缺省）也过一遍：这三者不该对同一个路径的含义各执一词。

**旧记录在读到时就地迁移**。`readBinding` 比对存储里的写法与规范写法，不同就把记录写回去。修复之前绑过的人不必重绑，那个文件也不再是下一个读取方的坑——CLI、`git`、`readdir` 看到的是同一个路径。写回是尽力而为：一个我们无权写的存储，读依然给出正确答案。

**eval 侧读到的也归一**。`resolveRepoScope` 把绑定的 `repoPath` 也送进 eval 自己的 `normalizeRepoPath`，不只是它本来就展开的那个显式 `repo` 参数。datasets 现在已经规范化了它存的东西，所以这是第二道；但旧绑定不该由读它的人来踩，而 eval 读的绑定恰恰出自一个它刻意不 import 的插件。

**失败渲染成三段**（ui-spec §九）：一句人话说发生了什么，一句说怎么修（能给命令就给命令），异常原文与路径折在「详情」里。页面不渲染 `error.message`，也不裸露绝对路径。原文仍然有它的读者——调宿主的人——所以是折起来，不是丢掉。

**原因从消息文本认出来，并由测试钉住**。Remote 失败过线时带的是网关的三个**传输**码（`gateway/bad-request` / `gateway/cancelled` / `gateway/internal`），域内错误码过不来。所以 `classifyError` 匹配消息里的标记——而两个包各自的 `tests/error-state.client.spec.tsx` 都是把**真实**服务驱进每一种拒绝，再把**真实**消息交给真实的分类器。改了宿主的措辞，测试先红，而不是 tab 在用户面前悄悄退化成「说不清」。

**同一个组件的两份副本，按规矩**。`ErrorState.tsx` 在 `packages/datasets/src/client/` 与 `packages/eval/src/client/` 各一份，除了它所泛化的词典键类型之外逐字相同。客户端包不 import 兄弟插件（ui-spec §八），所以两个 tab 共用一个实现的方式就是各持一份副本。

**证据不是错误**。就绪拒绝（`review.refusal`）与 run 的 job 日志照旧原样贴在 `<pre>` 里：拒绝是机制在正常工作，而拒绝原文是就绪判定唯一被写下来的地方。为了把两者分开，实验室的 store 在 `approveRefusal` 旁加了 `approveError`、在 `notice` 旁加了 `noticeError`——一个位置两个渲染器，谁来了就清掉另一个。在此之前，一个字段同时装着「这个 tab 写给人看的句子」与「宿主写给调试者的句子」，这正是它们被同样渲染的原因。

## Alternatives considered

**在每个读取点展开 `~`，而不是在存储处**。代码本来就是半个这样：eval 展开了显式 `repo` 参数、没展开绑定，datasets 两个都没展开。缺陷**就是**这个形状——一个要求每个调用方记得的归一化，就是一个总有调用方忘掉的归一化，而忘掉的后果是整页报出一件不对的事。把函数放在存储自己的边界上，是唯一没有「还剩一处会忘」的版本。

**bind 时直接拒绝 `~`，而不是展开**。诚实，而且会让走查更早更响地失败。否决的原因是：`~/…` 正是人会敲的东西，也正是 CLI usage 行自己印出来的东西；拒绝它只是让工具在用户本就有理由期待的地方变差。

**在 Remote 线上声明域内错误码**（`RemoteErrorDetailsMap` 是可合并扩展的，插件可以加 `datasets/not-a-repo` 并抛 `RemoteError`）**，按码分类**。这是有原则的做法，而且抗措辞改动。本次否决：仓库里还没有任何插件声明过域内码，这意味着要在一次「两个 tab 打不开」的热修里，为两个包的每个 Remote 方法引入一套机制。消息标记分类器是收敛的版本，宿主消息测试是它诚实的保证。线上码的版本随时可以后做——要改的只有 `classifyError` 一处。

**让 `ErrorState` 只住一个包，另一个 import 它**。省一半的活。ui-spec §八 禁止，而且理由是实打实的：一个 import 了兄弟插件的客户端包，没有那个兄弟就装不上。两份副本、两边各写一条注释点名对方，是更便宜的那种失败。

**只归一不解符号链接**。对 `~` 这个缺陷够用了。否决的原因是同一个仓库的两种写法会比不相等——macOS 上 `/tmp` 与 `/private/tmp` 就是那个案例，T47 已经为它搭进过一个下午：工作区记录的 path 与会话 realpath cwd 的严格比较不相等。

## Consequences

绑定路径现在在所有读取处都是规范路径，两个 tab 能打开了。旧版本写下的记录在第一次被读到时自我修复，所以不需要让任何人重新绑定。

**条件页的动作位得拆成两个**。原先一个 store 字段同时装着 endpoint 写成功的回执与 provision 被拒的失败，而且失败是先与宿主的 `error.message` 拼成一句再存进去的。现在是 `{kind: 'receipt', text}` 或 `{kind: 'failure', what, message}`：回执照旧渲染成它本来就是的那条通知，失败进错误位、原文折起来。

**夹具也得跟着变成规范的**。`makeFixtureRepo`（datasets）与 `tmpTree`（eval）现在返回 `realpathSync(mkdtempSync(…))`。macOS 上运行时临时目录根本身是软链，所以每一处「拿夹具路径比对代码答出来的路径」的断言，比的都是同一个目录的两种写法；归一化落地的那一刻它们红了 11 个。错的是夹具——`git rev-parse --show-toplevel` 从来答的就是 realpath。

**分类器与宿主措辞耦合**。这是收敛方案的代价，而且这份耦合由两个包各自的测试钉住，不是靠一条注释。认不出来不是故障模式：错误位会退回调用方自己的那句话（「题集列表加载失败」）加一句通用修法，仍然比一句异常强。

**剩下的文案归 T63**。本次只动了错误与失败文案。状态词表、矩阵页把所有键摊成因子、报告页余下的绝对路径都是那个任务的事，而那些页面的错误位用的就是本次加的这个组件。
