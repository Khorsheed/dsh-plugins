# Agent Note: 给一个 CI 按人的节奏跑的仓库配一道本地合并门禁

Status: implemented

## Problem

CI 在推 main 时触发，而推送由 human 协调、不自动化。这是刻意的选择——仓库后续要转 public，协调者希望每次推送都是一个决定。它的代价是：CI 的反馈按协调者的节奏到达，而不是按改动的节奏。

2026-09-01 这笔账结清了。一周的工作（378 个提交，上次推送 2026-08-25）一次性撞上 CI，连红三次：

1. `cc31c1a` 退役了 taskpilot 的 `tsconfig.paths.json` 机制并删掉 `scripts/sync-harness-paths.mjs`，却留下了调用它的 CI 步骤——`MODULE_NOT_FOUND`。
2. 08-29 合入的 `room` 传递引入了 `koffi`；pnpm ≥ 11 在冷装遇到未经审阅的依赖构建脚本时硬失败——`ERR_PNPM_IGNORED_BUILDS`。
3. `dsh-basic` 镜像已经落后于 `profiles/basic`。

三个都不是本地能发现的。第一个只活在 workflow 文件里，没有任何本地命令读它。第二个只在冷装 `pnpm install` 时复现，热的 `node_modules` 永远不会再报。第三个需要联网和镜像仓的推送权。

两个直觉解法都不成立。「每次合并就推」这个选项不可用——协调者保留了这个决定权。「所有测试统一交给 mainline」会让一个 agent 成为 25 个包的瓶颈，把两分钟的本地信号换成半天的往返；而且这三个红它一个也接不住，因为三个全是组合层的，不是包层的。

## Decision

`pnpm gate`（`scripts/gate.mts`）是包 owner 在自己 worktree 里跑的合并前门禁。它按由廉价到昂贵的顺序跑完 CI 里所有能从热检出复现的步骤，遇红即停：下面两个新检查器、全树 hygiene、插件独立性、三个文档门禁、门禁自己的 spec，然后是 build、test、pack-all。

两个新检查器顶替了热检出复现不了的那几步 CI：

- **`check-workflow-refs`** 解析 `.github/workflows/*.yml`，断言每个步骤引用的仓库文件与每个 `pnpm run` / `npm run` 目标真的存在。带 `working-directory` 的步骤跳过——那些跑在克隆下来的 harness 里。这是把故障 1 搬到了本地。
- **`check-build-scripts-declared`** 遍历已安装树里带 `preinstall`/`install`/`postinstall` 的依赖，要求每个在 `pnpm-workspace.yaml` 的 `allowBuilds` 里有明确取值。两种取值都算通过；**没有决定**才算失败。这是把故障 2 搬到了本地，而且不需要冷装。

第三个缺口只给提醒、不设门禁：gate 第一步比对本地 `DSH_HARNESS` 检出的 `git describe` 与 `ci.yml` 里钉的 `ref:`，不一致就打印一行。领先是正常状态（guard checkpoint 提交落在部署检出里），为此报红只会训练大家无视门禁；但「你的类型面和 CI 不是同一棵树」这件事仍然值得一行字。

`pnpm gate --full` 额外用 `act` 在 Docker 里跑真实 workflow，这是本地复现冷装的唯一手段。它是 opt-in 的，因为需要 Docker 和 `act`；`act` 不在时它打印明确的安装指引，而不是静默放行。

镜像 `--check` 被刻意排除在 gate 之外：镜像漂移归 mainline 修（同步需要镜像仓的推送权），不该挡住 owner 合并。CI 保留这几道，故障 3 属于那里。

分支保护不可用——GitHub 对免费账户的私有仓，protected branch 与 ruleset 两个接口都答 403（"Upgrade to GitHub Pro or make this repository public"）。因此 `.githooks/pre-push` 在本地兜住最要紧的两条：不许对 main 非快进推送、不许删除 main。仓库转 public 后应启用服务端规则，届时这个 hook 退化为本地的快速回声。

## Alternatives considered

**每次合并就推，让 CI 当门禁。** 最直白的解法，也是多数项目的做法。这里不可用：协调者保留了推送决定权，因为仓库要转 public，每次推送都是一次可见性决定。记录在此是因为这个约束可能解除——真解除了，本文的多数机制就从主网退化为冗余。

**fork + PR，或推分支配必需状态检查。** 开源世界的标准答案，也是仓库 public 之后的正确归宿。当下否决有两条理由：必需状态检查与直推模型不兼容（检查没法在它要守的那次推送之前跑），而分支保护在当前账户计划上买不到。`docs/development.md` 把它记为迁移路径，而非否决项。

**所有测试统一交给 mainline。** 之所以认真考虑，是因为这是协调者的第一直觉。基于证据否决：三个红全是组合层的，没有一个由包 owner 造成；而要交上来的包级测试（ankh-guard 的 116 个、room 的 183 个）不会给 mainline 带来任何 owner 两分钟内得不到的信息。真正站得住的分界是**「你自己的包」对「大家的组合」**，不是「开发」对「测试」。

**把冷装做进默认 gate。** 作为默认否决：清掉 `node_modules` 要花几分钟，而且会扰动一个被生产 profile `link:` 着的检出。`--full` 按需提供；`check-build-scripts-declared` 覆盖了这一类真实产生过的失败形态。

**用 lockfile 而非已安装树来找 install 脚本。** 原则上更优——lockfile 与平台无关——但 lockfile v9 不记录 `requiresBuild`，信息根本不在那里。已安装树是现成的来源；它的盲区（只在别的平台安装的依赖）写在检查器注释里，留给 CI 的冷装兜底。

## Consequences

- 包 owner 的义务只多了三个秒级检查器；他们本来就被要求在提交前跑的 build 与 test 没有变化。
- gate 的价值上限就是它对盲区的覆盖度，而有一个盲区按构造无法消除：本机不是的那个平台上的冷装。CI 仍是最后一道网——这让**推送节奏成为设计的一部分而非偏好**：一张一周才收一次的网，正是这次事故的成因。
- 两个检查器都把各自的起因事故冻在 spec 里，所以回归复现的是 2026-09-01 的真实故障，而不是它的抽象版本。
- `pnpm gate` 把 CI 的步骤清单抄了第二份，两份会漂。`check-workflow-refs` 挡住的是要紧的那种漂移（步骤引用了不存在的东西），而不是「CI 跑了但 gate 漏了某一步」。
