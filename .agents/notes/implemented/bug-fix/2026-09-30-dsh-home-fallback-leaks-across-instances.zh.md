# Agent Note：`.dsh-official` home 回退把一个实例的受管状态漏进了另一个实例

Status: implemented

[English](2026-09-30-dsh-home-fallback-leaks-across-instances.md) | 中文

## 问题

`capability-catalog` 的 `dshHome()`(src/index.ts)与 `local-agent-dsh` 的 `defaultPresetRoot()`(src/provision.ts)把宿主 home 解析为 `settings.home ?? $DSH_HOME ?? ~/.dsh-official` —— 最后一档硬编码成本机官方 checkout 的 home，写在两个包诞生、dev home 恰好是 `.dsh-official` 的时期。桌面 app 上两个输入都不存在（它的 settings 服务不报 `home`，进程环境里也没有 `DSH_HOME`)，于是桌面实例静默读到了 3080 服务器的 home：桌面的 工具与技能 设置页列出 3080 的三个 preset 域受管 skill，横幅「3 个受管 skill 未在任何模式生效」，看上去就像两个实例共享了配置。这个 bug 在 3080 上不可见，因为 launch spec 显式设了 `DSH_HOME=~/.dsh-official` —— 回退在它会出错的地方从未触发。

## 决策

两个调用点都对齐官方 `resolveDshHome`(`@deepseek-ai/dsh-home-paths`）的优先级：配置指定的 home → 非空白的 `$DSH_HOME` → 安装默认 `~/.dsh`。空白/纯空格的 `DSH_HOME` 视为未设置（官方语义），旧的 `??` 链这一点也错了。

## 备选方案

**依赖 `@deepseek-ai/dsh-home-paths`，直接调 `resolveDshHome`。** 未采纳：内联的优先级判断只有几行，`.dsh` 目录名被所有现存安装钉死，而新增一条官方依赖边会给 profile 安装增加 peer 解析面，行为上没有收益。官方默认哪天真的变了，seam registry 的升级核对是我们会发现它的地方。

**从当前 profile 路径反推 home。** 否决：插件没有可靠的 profile 目录句柄，且 home 不保证是 profile 的父目录。

## 影响

- 桌面实例现在解析 `~/.dsh/capability-catalog/skills` —— 用户在那里导入之前是空的 —— 幻影横幅随之消失。不做任何迁移：那三个写作 skill 本来就是 3080 的文件，经 3080 的 catalog 创建，留在 3080 的 home。
- 3080 不受影响（`DSH_HOME` 由 launch spec 提供）；设了 `DSH_HOME` 的 dev checkout 同样不变。
- 已知接受的差异：`~` 开头的 `DSH_HOME` 这里仍不做展开（官方 helper 会展开）。没有已知调用方依赖它；记在这里，避免后来者盲目「修正」这个差异。
