# Agent Note: 容器路径挂实例自己的作用域目录，判官与所有人一样要过就绪检查

Status: implemented

[English](2026-09-08-eval-scoped-home-and-judge-readiness.md) | 中文

## Problem

两件都长得像成功的失败。

**作用域目录挂错了地方。** T20 的容器路径挂的是 `<--creds-root>/<条件 id>`——一棵 stage 出来的树；而 local-agent 家族的回读读的是 `homeDir(<家名>)`，也就是 `<homesRoot>/<家名>`。容器轮里 CLI 把 rollout（codex）、wire 日志（kimi）、会话日志（子 dsh）写进被挂进去的那个目录，回读却去另一个地方找。**不报错**：轮次完成、格子归档，而每一轮的 `model.observed` 永远是 null——就绪检查报 `ready, model —`，报告的「受试对象一致」永远停在 ⚠️。T22 是靠在驱动里手工把 `homeDir` 指到凭证目录才拿到 ✅，而产品路径没有这个手段。根因是 T20 的文案与 T17 的决定分叉了：T17 定的是**作用域目录是宿主目录，rw bind 挂进容器，回读直接读它**。一个目录，不是两个。

**判官从来没被探过。** T23 的就绪检查只覆盖选手条件。判官是同一类东西——一次会失败的真委派，凭证可以报着 `authenticated` 而每次都被拒——而且失败更贵：选手挂了只损失它自己的格子，判官挂了损失的是整轮的 llm-draft 判定。pilot B 两个判官样本全掉，run 还是一路走到 `released`，命名空间是空的。

## Decision

- **挂载源取 `localAgent.homeDir(家名)`。** 容器路径把评测实例自己的该家作用域目录挂到条件声明的容器内路径上。那正是 `/<家> login` 写进去的目录，也正是回读解析的目录，于是容器轮自己留下的痕迹落在回读会去看的地方。`--creds-root` 整个删掉——slash、CLI、README、契约文档的运行说明。条件文件不动：它仍然只声明容器内路径与变量名。
- **凭证靠在实例上登录，不 stage 副本。** 不拷贝就不会漂；CLI 在单元里做的续期直接落在宿主那个目录上，下一轮读到的就是它。授权过期就在那台实例上重登。
- **门面没有 `homeDir` 就拒绝，并点名。** 挂另一个目录正是本文说的那种失败，而且看不见——所以容器路径拒绝，不退化。
- **判官条件同样探**，同一条规则、同一条拒绝，以 `role: 'judge'` 记进 `run.meta.readiness`，与选手的 `role: 'player'` 并列。`--ignore-readiness` 一视同仁；判官探失败不跳过任何格子——它本来就没有格子。
- **容器路径下判官仍在宿主上探。** 判定是编排器发起的委派，不是格子发起的；在单元里探等于测一个它根本不会遇到的环境。就绪检查的 `unitFor` 钩子因此可以「不给单元」，而 run 循环对判官正是这么做的。
- **回读一个字没改。** 容器轮 settle 后走的还是原来那条 `homeDir` 路径，只是现在那儿有东西了。

## Real-machine verification

评测实例自己的作用域目录（`~/.dsh-lab/local-agent/<家名>`），T22 的镜像，`eval-net`，user `1000`，单元里跑真的 codex CLI——T22 驱动的同一副骨架，只是把它手工改过的 `homeDir` 去掉了，因为产品路径现在自己给。

**一格，P0 × codex，容器路径，走到 `released`：**

```
[run] readiness codex-exec: ready (7.7s, model gpt-5.6-sol)
```

是 `model gpt-5.6-sol`，不是 `model —`。报告的四条不变量：

```
- **题面一致** — ✅ 成立 · P0-placeholder: 8b38bb4698fa… × 1 格一致
- **环境一致** — ✅ 成立 · 1 格指纹一致: lab-env:0fcb…
  -   …codex-exec-rep1: lab-env:2e02ebee9261… — 排除 挂载 /creds/codex、env CODEX_HOME
- **受试对象一致** — ✅ 成立 · 模型回读与声明一致
- **程序一致** — ✅ 成立
```

四条全成立，`comparison allowed`——这是本项目历史上报告第一次愿意做比较。

**判官委派不通就拒整个 run：** 同一份计划把 `judge.conditions` 换成 `["claude-exec"]`（这台实例上它的 OAuth 授权已过期）。选手过了、判官没过，run 根本没被创建：

```
EvalRunRefused: 1 of 2 condition(s) failed the pre-run readiness check — nothing was executed
  code: 'READINESS_FAILED',
  message: 'judge claude-exec (harness claude-code): the probe exceeded 120s and was cancelled'
```

在此之前，同一份计划会走到 `released`，两个判官样本全掉，llm-draft 命名空间是空的。

## Alternatives considered

**保留 `--creds-root`，改让 local-agent 从那儿回读。** 拒绝：这是把归属倒过来。作用域目录是 local-agent 的——它建、`login` 写、各 provider 读——让编排器为同一件事另指一个目录，正是「两个目录」的成因。一个主人，一个目录。

**把实例的作用域目录按条件拷成 stage 树。** 拒绝：副本是一份**会续期**的凭证的第二个真相源。单元里的续期会落在副本上而宿主留着旧的，或者反过来；症状是一次谁也解释不了的过期。而且它根本不解决回读——回读读的是该家的 home，与挂载无关。

**给每个条件一份作用域目录，好让同一家的两个条件在这一项上不同。** 想要，但没有：按次委派覆盖 scoped home 是 I4 的 T29。在那之前，同一家的两个条件共用一个目录，只能在不落在这个目录里的因子上不同（模型、推理强度）。这一条明写在 README 里而不是糊过去——今天表达不了「同一家两次不同登录」的 run。

**为了对称，容器路径下也把判官放进单元里探。** 拒绝：与什么对称？判定在宿主上跑，单元探证明的是「凭证在判官根本不会去的地方能用」——正是当初把选手探针搬进单元所要修的那个错误，只是升了一层。

**判官探失败只告警不拒绝。** 拒绝：继续下去的代价是整轮的 llm-draft 判定，而且要等每一格都付过钱之后才发现。真想这么干的运维已经有 `--ignore-readiness`。

## Consequences

- 容器路径上「受试对象一致」够得着了，报告也随之第一次 `comparison allowed`。
- 同一家的两个条件在 T29 之前共用一份作用域目录。今天的计划没有办法说「不共用」，README 写明这归哪一迭代修。
- 判官不通的 run 在 run 记录存在之前就停住，代价是运维重跑一遍就绪探针（几秒），省下的是整轮判定。
- `--creds-root` 是删掉而不是弃用：它命名的是一个**不该存在**的目录，留着「接受但忽略」等于让错误的心智模型继续活着。
- 契约里条件 schema 的描述随之改了（v1-rev7）：`unit.scopedHome` 的宿主一侧是实例自己的作用域目录，不是一个 stage 出来的根。
