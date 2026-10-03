# Agent Note: 题集整理协议随 skill 一起发布

Status: implemented

## Problem

`dataset-authoring` skill（T90，随 `@khorsheed/dsh-datasets` 发布）告诉整理 Agent「以 Dataset Authoring Protocol 为准」，并把它写成 `docs/dataset-authoring-protocol.md`——这是本仓库里的路径，任何安装后的包都不带它。3185 走查（T94）里 Agent 照字面去找：先搜工具链，再全盘 `find /`（超时转后台 job），再去读另一个实例装的 `dsh-datasets/lib/*.js` 和它的 `state/datasets/` 反推校验规则，最后用 Python 重写了 rubric 检查。动手之前读了 35 步，而能直接给出这份问题清单的 `datasets_propose_registration {dryRun: true}` 一直没用。

同一次 T90 安装还暴露了一个独立问题：datasets、eval、local-agent-dsh 的 `lib/` 裸 import `js-yaml`（tsc 原样输出说明符），而 pack-dist 会把每个发布清单的 `dependencies` 删掉（「运行时依赖要么打进 lib，要么由宿主提供」）。实例内由宿主解析不受影响，但 `node <profile>/node_modules/@khorsheed/dsh-datasets/lib/cli.js` 直接 `ERR_MODULE_NOT_FOUND`。

## Decision

**协议在构建时拷进 skill 目录。** datasets 构建的第一步是 `packages/datasets/build/copy-protocol.mjs`，把仓库里的一对文档拷成 `skills/dataset-authoring/protocol.en.md`（英文，来自 `docs/dataset-authoring-protocol.en.md`）和 `protocol.zh.md`（中文，来自 `docs/dataset-authoring-protocol.md`）。`files` 里已有的 `skills/**/*.md` 会把它们打进包；拷贝件被 gitignore，`docs/` 仍是唯一源头，双语配对记录不动。源文件缺失时构建失败。这个脚本放在包的 `build/` 而不是 `scripts/`：`pnpm check:plugins` 把包里的 `scripts/` 当作必须由 `files` 发布的载荷，而它只在构建时用。

**skill 用占位符写安装路径，由加载器解析。** skill 经宿主 `skills` 注册表以文本形式交给模型，相对路径对模型没有意义。SKILL.md 写 `{{skillDir}}/protocol.en.md` 与 `{{packageDir}}/lib/cli.js`，`loadAuthoringSkill()` 把它们替换成加载它的模块所在的 skill 目录和包根的绝对路径（`src/` 与 `lib/` 同深度，源码面和安装后的包解析结果一致）。模型用 `read` 工具读这个绝对路径。

**SKILL.md 加了基本规则**（`organize` 档的 guidance 同步加一句）：只读来源目录、目标仓库、协议三处；校验规则只从工具拿——`datasets_propose_registration {dryRun: true}`、`datasets_validate`（已登记题集）、包内 CLI 的 `validate --repo <repo>`（未登记仓库的逐题完整报告）；不搜磁盘，不读任何插件的源码或 `lib/`，不读别的实例的 `~/.dsh*` / `profiles/` / `state/`；`find` 只在来源/目标目录内并带 `-maxdepth`。「已是协议格式」这条路改为：拷入、提交、先跑检查，由检查结果决定读什么、改什么。

**js-yaml 声明为保留的运行时依赖**：datasets、eval、local-agent-dsh 在 `dsh.runtimeDependencies` 里写 `["js-yaml"]`，这是 pack-dist 已有的显式保留机制（capture 先例）。发布清单因此会把 js-yaml 装在包旁边，CLI 可以独立运行。

## Testing

`packages/datasets/tests/skill-package.spec.ts`：原始 SKILL.md 恰好引用两份协议拷贝和 `lib/cli.js`（不再出现 `docs/` 路径）；加载后的 skill 没有未解析的占位符，引用的每个绝对路径在构建后都存在；拷贝件与 `docs/` 那一对逐字节相同；`npm pack --dry-run` 的文件清单包含 SKILL.md 和它引用的每个文件。`scripts/pack-dist.spec.ts` 钉住三个真实清单经 `rescopePackageJson` 后保留 `js-yaml`。

## Alternatives considered

**`files` 直接收 `docs/dataset-authoring-protocol*.md`。** 做不到：`docs/` 在仓库根，`files` 不能越出包目录。把协议挪进包里会打断全仓的引用（eval 的协议测试、配对记录、各笔记与 README 的链接），没有收益。

**在 skill 目录里提交一份协议副本。** 一份 65 KB、改得很勤（一周内 rev14 → rev15）的文档存两份会漂移；测试能抓到漂移，但每次改协议都要动两处。构建时拷贝保持单一源头，逐字节相等的测试证明发布的副本是最新的。

**拷进 `lib/` 而不是 skill 目录。** 对模型一样能用（路径都会被解析成绝对路径），但协议离开了它所属的 skill：单独读取（或被 skill 导入器打 zip）的 skill 目录又会指向不存在的文件。

**SKILL.md 里写相对路径（「本文件旁边的 protocol.en.md」）。** 模型看不到 skill 文件的位置——注册表只交给它文本——相对路径会重现原来的问题。

**用 tsdown 把 js-yaml 打进 lib。** 宿主侧 lib 是 tsc 产物而不是 bundle；datasets 的 tsdown 只经共享的 `clientBundle` 打浏览器端，不能按包分叉。为一个小的纯 JS 依赖给三个包引入宿主侧打包会改变构建形态；声明运行时依赖只需改一行清单，用的是 pack-dist 已有的机制。

## Consequences

- 安装后的 datasets 包多出约 130 KB（中英两份协议）。整理 Agent 有了真实可读的路径和明确的「不搜盘」规则；需要模型的重走由协调者在 3185 上安排。
- `pnpm --filter @khorsheed/dsh-datasets test` 的 skill-package spec 依赖先构建（构建契约本来就要求先构建再测试）。
- 装 datasets / eval / local-agent-dsh 的 profile 现在会从公共 registry 装 js-yaml（不是 `@khorsheed` 包，不受 npm 风控影响）。
- 协议拷贝每次 datasets 构建都会重新生成；改 skill 目录里的 `protocol.*.md` 没有意义，要改 `docs/`。
