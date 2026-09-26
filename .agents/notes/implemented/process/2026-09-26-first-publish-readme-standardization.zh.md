# Agent Note: 首发波的 README 标准化

Status: implemented

## Problem

2026-09-26 首发 npm 的 22 个包（local-agent 家族、quote、inline-html-render、两个 bundle、typesafe 对、room 对、worktrees 对、capability-catalog、capture、dsh-reader、mobile、ui-content-preview）带去的 README 比重发的十个老包粗糙：没有顶部语言切换（quote 的 npm 页只渲染出中文——npm 只渲染 README.md，而切换链接当时在文件底部）、没有截图、缺标准小节、特性描述有过期断言。另有三个包（room、capability-catalog、mobile）走的是相反的语言约定（英文 README.md + README.zh.md），与其余包（中文 README.md + README.en.md）不一致。

## Decision

22 个包的 README 双语对全部按 message-tools / ankh-guard 模板重写（提交 `9ada31d6`）：

- 两个文件第 3 行都放语言切换——这是硬要求：npm 只渲染 README.md，切换压在底部就等于单语言。
- 结构：pitch + 问题段 → 截图（有 UI 的包）→ 特性 → 安装（add/remove 代码块 + 重启提示）→ `## Compatibility`（两个文件都用这个英文标题，内容对照 package.json `dsh.compat`）→ 已知限制 → `<details>` 内部结构 → 开发 → 变更记录（仅当 CHANGELOG.md 存在）。
- 语言约定随后统一为中文优先（用户当日拍板）：room / capability-catalog / mobile 从英文优先（README.md 英文 + README.zh.md）对调到统一布局（README.md 中文 + README.en.md 英文），切换链接、package.json `files` 与 apps/ios 的交叉引用一并跟上。
- 截图一律用绝对 URL 引用 `https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/`；新图由用户补拍，在 rc2 对齐的重发前落位——此前新 img 标签是有意的死链。
- README.i18n.yaml 台账在同一变更里重录（466 对同步）。
- 22 个首发的 tag（`<目录>-v<版本>`）与 GitHub Release 打在 README 改进后的 HEAD 上；npm tarball 里仍是旧 README，随下一次版本升级带上新文案。

## Alternatives considered

- **全部统一为英文优先 README.md**——否决：重发的十个老包是中文优先，有了顶部切换后统一买不到任何东西，npm 读者一键可达任一语言。
- **tag/Release 等 rc2 波再补**——否决：tag 标记的是真实发布出去的状态，把台账拖后会让首发状态无法回溯。

## Consequences

- 22 个包的 npm 页面在各自下一次版本升级前仍展示旧 README（计划在 rc2 对齐波一起重发）。
- 仓库里的 README 暂时引用尚未托管的截图；补拍清单在会话交接里，图片在重发前落进 dsh-web-basic 镜像仓。
- 重写带出的后续项（缓办，均不阻塞）：约十个包的 `dsh.compat.verifiedHost` 停在 `0.1.5-rc.1` 而 devDependencies 已解析 0.1.7-rc.1——下次宿主 API 审计时随包升级；多数首发包还没有 CHANGELOG.md；`packages/worktrees/package.json` 的 `dsh.compat.notes`/`description` 仍提已退役的 local-files 浏览面；`packages/room-tool/package.json` 的 description 只写了 5 个已注册工具中的 3 个；官方 npm 线已到 `@deepseek-ai/dsh@0.1.5-rc.3` 而 README 统一引用 `0.1.5-rc.1`（是否跟随是全仓一致的决策，不是单包的事）。
