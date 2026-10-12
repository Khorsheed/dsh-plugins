# Agent Note: 受管 skill 分册的 scoped 只读读取器

Status: implemented

## 问题

SKILL.md 只是 skill 的入口，接口细节写在 bundle 分册里（weread-skills 把各能力的接口文档拆在 `search.md` / `notes.md` 等）。宿主的 `skill` 工具只返回 SKILL.md 正文和 `resourceBase` 目录路径，模型读分册要靠 fs 工具。刻意不挂 fs 的模式——见[学习模式的白名单化 skill 面](2026-10-12-learning-mode-whitelisted-skills.md)——于是拿到入口却永远读不到参考资料。

## 决策

受管投递在它所服务的每个 preset 层里，随 skill provider 一同注册一个只读 `read_skill_file` 工具。读取器只回答该投递服务于调用方 preset 的 skill（本 preset 的限定集合，加上每个 preset 经全局层都能看到的未限定受管集合）；省略 `path` 时列出 bundle 文件，否则读一个 bundle 相对路径的文件：绝对路径、盘符和 `..` 在触碰文件系统之前被拒绝，解析后的路径穿符号链接也必须留在 bundle 目录内，返回文本截断于 10 万字符。无 fs 的模式因此恰好只得到投递给它的那些 skill 的文件——磁盘上的其他内容依然不可达。`skill` 工具的 post-execute 提示会报出读取器和分册文件清单，但只在调用方自己的 scope 携带着该工具时。

## 考虑过的替代方案

**给无 fs 的 preset 挂一个只读 fs 工具。** 不采用：任何 fs 读取器都会把可见面从「投递来的 skill 的 bundle」扩大到「工作区」，这正是节食要排除的。

**把分册内联进投递的 skill 正文。** 不采用：拆册就是为了上下文经济；把参考资料折进每次加载，会让每个模式里的每次 skill 加载都膨胀。

**上游原生的分册读动词**(`skill` 工具或注册表直接服务 bundle 文件）。正确的长期归宿——已立[上游提案](../../../docs/upstream-proposals/2026-10-12-skill-bundle-file-read.md)；宿主发布后这个 scoped 读取器退役。

## 影响

无 fs 的 preset 可以端到端使用拆册 skill，投递的安全态势不变（读取器不超出投递本身已服务的范围）。读取器只是 reconcile 已有的 scope 上的第二个注册，随该 scope 一并销毁；没有 tools 服务的组合保留 skill 投递、仅少这个读取器。上游提案是既定的退役路径。
