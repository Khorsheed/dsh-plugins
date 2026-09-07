# Agent Note: codex 委派带上 --skip-git-repo-check

Status: implemented

## Problem

`codex exec` 的工作目录不在 Git 仓库里时会拒绝启动：

```
Not inside a trusted directory and --skip-git-repo-check was not specified.
```

它打完这一行就退出，一个 `--json` 流事件都没发出。于是 provider 没有东西可折叠、没有东西可归因、也没有值得上浮的 stderr——委派到调用方那里只剩一句光秃秃的 `Error: subagent run failed`，看不出原因是工作目录，而不是凭据、模型或任务本身。

工作目录是**调用方**的选择。自从门面有了 `cwd` 选项，委派就跑在调用方指定的任何地方，而那个路径没有任何理由必须是仓库。这个失败是 web-eval pilot 发现的：它的编排器把每一格物化进 `$DSH_HOME/state/eval/cells/<runId>/<missionId>/attempt-N/`——一棵它自己创建的普通目录树。同一次 run 里每个 codex 格子都以同样的方式失败，而 dsh 格子照常跑完。这不是评测特有的问题：任何把委派指向临时目录、新建输出目录、或任何非仓库路径的调用方都会撞上同一堵墙，而拿回来的报错一个字都没提。

选定这个 flag 之前实测排除了两条路。codex 的 `projects.<path>.trust_level = "trusted"` 配置项在 `exec` 下不满足该检查——精确目录与父目录两种写法都仍然被拒（对 codex-cli 0.144.0 实测）。而把格子的**父目录**做成仓库确实能让 codex 满意，但在评测里，这等于让选手在自己的格子里跑一句 `git status` 就能看见、进而读到其他每一位选手的答案。互相污染比要修的这个缺陷更糟。

## Decision

一次性 provider 构造的每一条 `codex exec` argv 都带上 `--skip-git-repo-check`——首轮与 `resume` 两种形状都带，位置在 `resume` 子命令之前，不影响 codex 的位置参数解析。

这道检查是 codex 给「人在交互模式下误入某个目录」准备的护栏。而一次委派已经由调用方明确指向了它的工作区，所以这道护栏只可能拒掉调用方明确要求的工作。跳过它是把 provider 的契约还原：委派跑在调用方说的地方。

**沙箱不受影响。** 档位仍然由 `--sandbox` 自己那个 flag 决定，仍然决定进程能写什么。Git 检查不是沙箱——它管的是**能否启动**，不是**权限**——把两者混为一谈正是本文要拦住的读法。

live 驱动（`codex app-server`）不接受也不需要这个 flag：app-server 的线协议按 thread 携带工作目录，没有对应的护栏。

## Testing

`tests/non-git-cwd.spec.ts` 把这个 flag 钉在两种 argv 形状上，并断言它排在 `resume` 之前、且 `--sandbox` 仍在——这样后来的改动既不能悄悄把 flag 删掉，也不能改成「放宽沙箱」来「修」这件事。三处既有的 argv 断言（`codex-cli-provider.spec.ts` 一处，`member-bridge-injection.spec.ts` 两处）同步到新 argv。包内 112 个测试通过。

对真实 CLI 验证过：在非仓库目录里 `codex exec --sandbox workspace-write --skip-git-repo-check --json` 能跑到 `turn.completed`，而同一条命令去掉 flag 则停在那句拒绝上。

## Alternatives considered

**把委派 cwd 做成 Git 仓库。** 要么每格 `git init`（那些目录由编排器在 run 中途创建，外部没有东西能赢下这个竞态），要么在它们的共同父目录上 `git init`（正是上面「互相污染」那段排除掉的做法）。两者还都把一条 codex 独有的要求推给了每一个调用方，而四家里只有它有这条要求。

**用 codex 自己的配置把目录标为可信。** 这是设计上该走的形状，也是最先试的：对精确目录和父目录分别写 `-c 'projects."<path>".trust_level="trusted"'`。在 codex-cli 0.144.0 的 `exec` 下两者都不满足检查，拒绝原样出现。就算它管用，也需要每格一条配置、在每次 spawn 前写好——一个常量 flag 能办的事，不必换成会动的零件。

**不预防，改成把拒绝上浮。** 从 codex 的 stderr 里认出这一行、重新抛一个可读的错，确实能把不透明的失败变成清楚的失败——但它仍然是失败，委派仍然没跑。作为通用诊断这值得另做（任何在首个流事件之前退出的情况，现在都只读作 `subagent run failed`）；它替代不了让委派真的跑起来。

## Consequences

codex 委派现在能在调用方指定的任何目录里启动，这本来就是家族里其他 provider 早已具备的行为。刚才在做拒绝的那道护栏，从来没有替调用方挡住任何东西；真正在挡的是沙箱，而沙箱没变。

没有修掉的是诊断：一个在首个流事件之前就退出的 codex 进程，仍然只报 `subagent run failed`，原因只在调用方看不到的 stderr 里。这次修掉的是这一类里最常见的那个实例，不是这一类。
