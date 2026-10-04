# Agent Note：story-bible 的 agent 面改为 preset 授予，bundle-writing 是那张授予票

Status: implemented

## 问题

M1/M3 按 canvas 的方式交付 agent 面：`story-bible-agent` 行挂在 profile 根上，于是**每个**会话——调试、翻译、不相干的代码评审——工具单里都躺着三个小说写作工具，系统提示里有 story:pointer 段，技能目录里有 story skill。工具单污染不是审美问题：每个注册的工具都是模型每轮要读的 schema，而且在错误语境下提供写作工具，等于邀请模型往用户没打算动的作品里写记忆。需求落得很明确：story 的 agent 能力（story_read/write/extract、轻指引函数段、story skill）必须只在写作 preset 的作用域里存在；核心（store、Remote、两个 tab）保持全局。

## 决定

### 出厂默认 = 「根行禁用，preset 授予」

story-bible 的 `cordis.patch.yml` 保留核心行启用，把 `story-bible-agent` 行以 `disabled: true` 出厂。装包因此不授予任何东西——唯一正确的启用方式是在某个 preset 的作用域里点名同一个组合入口（`@khorsheed/dsh-story-bible/agent`），这正是 canvas 的 patch 为 `@khorsheed/dsh-canvas/agent` 写下的配方（也正是 `@khorsheed/dsh-presets` 的 `preset-dsh-writing` 授予它的写法）。patch 注释写清了唯一会炸 boot 的错误配置：根行启用与 preset 授予同时生效，同名工具双注册。不加运行时防御——canvas 对同一条规则也只写文档，而且这个失败在 boot 时是响亮的，不是静默的。

### bundle-writing 是声明式 preset bundle，不是 family bundle

`packages/bundle-writing`（@khorsheed/dsh-bundle-writing）是 `dsh.bundle.kind: 'preset-declarations'`：一行 `@deepseek-ai/dsh-agent-preset`、loader id `preset-writing`，没有自己的运行时代码。preset 配置组合：

- **persona**——协作编辑的姿态（任务给的草案：追问灵感、规划时摆伏笔与人物上台面、写作守设定与一致性、对账如实报命中落空；作品资产以 story_* 工具取到的为准，不凭对话记忆），保持轻量、单语言英文（社区 preset 的 prompt 段惯例）——工作流留在 story skill 里，不复制；
- **授予**——在作用域内挂载 `story-bible-agent`（入口沿 scope 父链从全局核心行解析 `storyBible`；story-bible 缺席时授予保持惰性——零注册、不抛错）；
- **写作工具单**——tool-fs（正文读写）、skill-filesystem + tool-skill（story skill 经此加载）、tool-ask-user（人工闸门）、compaction 组（逐字搬 preset-dsh-writing 的已验证形态）。shell、fs-search、委派、jobs、todo、web、goal、agent-instructions 一律不进：写作流程驱动不到它们，而 preset 的价值恰恰在于它**不**给什么工具。

引用是单向数据：`dsh.references: ['@khorsheed/dsh-story-bible']，绝不做 npm 边——只装 bundle-writing 必须保持惰性（依赖会把 story-bible 的模块拖进来却不挂它的核心行，组合出一个指向无人提供之服务的 preset；两包并装的 profile 才是诚实的契约：story-bible 给界面与数据面，bundle-writing 给授予）。

### 证明在组合层，不在形状层

`tests/preset-scope.spec.ts` 用真实注册表（SystemPrompt + ToolRuntime）挂 story 核心，再用 dsh-scope 的 `createScope`——preset realm 用的同一个机制——造一个作用域，断言：出厂默认让根组装没有任何 story_ 工具、没有 story:pointer 段、没有 story skill；在作用域内挂载 `./agent` 只授予该作用域（三者俱在，轻指引是函数段——未 focus 渲染 `''`，focus 后渲染一行），而根组装保持干净。`tests/patch.spec.ts`（story-bible）与 `tests/bundle.spec.ts`（bundle-writing）冻结 patch 形状与 references 契约（presets.spec 的写法）。

## 考虑过的其他方案

**保持 canvas 默认（根行启用），让 profile 自己禁用。** M1/M3 的现状。每个装 story-bible 的 profile 都得手工改一次禁用才不付污染成本——对一个卖点就是场景边界的能力来说，这是错的默认。只有当社区默认是「不授予」时，写作 preset 才组合得干净。

**patch 里干脆不放 agent 行。** 更彻底，但行本身和它的启用路径对操作者就不可见了；禁用行把授予点写在 loader 读得到的地方，也给想要「全会话」的 profile 留了一行开关（附带双活警告）。

**让 bundle-writing 做 family bundle 依赖 story-bible。** family 边会把 story-bible 的模块传递装上——但 `dsh plugin add` 只调和 profile 的直接依赖，核心行永远不会挂，preset 的授予将指向一个缺席的服务。AGENTS.md 的「引用不是边」规则正是为这种形态写的；两包并装已在两个 README 写明。

**照抄 preset-dsh-writing 的全部工具单（shell、web、todo）。** 它的契约服务的是一般写作；小说流程的模型只写正文和 store。shell 会引诱模型绕开围栏里的 store 去动文件系统，而且每留一行，模型就多一个可以绕过 story_* 的抓手——精简本身就是设计。

## 后果

- 只装 story-bible 现在得到的是界面 + 数据面、零 agent 痕迹；bundle-writing 是可能的最小授予。两个 README 写了安装/启用配方；方案 §0 的表加了 bundle 行（gitignored，就地改的）。
- canvas 配方第一次有了第二个消费者，验证了这条约定：`./agent` 入口、根行禁用、preset 作用域授予。
- `docs/packages.md` 已重新生成（39 个包）；没有其他仓库级登记（preset-declarations bundle 不带 typert 面、不带 client 面、不带 invariant）。
- 刻意不变：轻指引仍是逐组装求值的函数段——即使在写作 preset 里，未 focus 的会话也是零 token；双活规则保持文档级（canvas 自己的立场），因为它的失败是响亮的 boot 错误，不是静默异常。
