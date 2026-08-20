# Agent Note: 3d-artifact skill 随 file-preview 打包并在 apply 时注册

Status: implemented

[English](2026-08-21-3d-artifact-skill-registration.md) | 中文

## 问题

沙箱可运行的 3D HTML（three.js 场景、数字孪生）必须遵守严格的生成侧契约——单文件自包含、零运行时网络、GLB 内联零 fetch 模型——否则会在沙箱预览内静默失败（`connect-src 'none'` 拦截一切 fetch，包括 three.js 对 `data:` URI 缓冲的加载；已在 [file-view-html-rendering 提案](../../../proposals/active/2026-08-21-file-view-html-rendering.md) 的 M0 实测验证）。契约只有"在生成时刻可被发现"才能到达生成模型，且必须随插件家族交付，让社区用户零官方改动即可获得。

## 决策

skill 随 `@khorsheed/dsh-file-preview` 交付于 `packages/file-preview/skills/3d-artifact/SKILL.md`，被 `files` 的 `skills/**/*.md` glob 收录，并在 `FilePreviewService` 构造器通过可选 `skills` 服务在 apply 时注册——与 ankh-guard 重启 skill 注册完全同款拉取式范式：`ctx.get('skills')` 探测、解析 SKILL.md frontmatter 的 `name`/`description`、`ctx.effect(() => skills.register({ name, description, content }))`。能力缺失或文件损坏只降级为警告——发现辅助绝不能拖垮 boot；pack-smoke 测试（`tests/skill-registration.spec.ts`）负责断言 tarball 内文件存在并校验注册内容。

契约内容（硬规则）：单文件自包含（JS/CSS 内联、图片 `data:`）；零运行时网络；模型必须用 GLB base64 + `atob` → `parse(arrayBuffer)`——绝不用 `.gltf` JSON 的 `data:` URI 缓冲（three r152 通过 `fetch` 解析 `data:` URI，会被 CSP 拦截）；库只能来自白名单 CDN（jsdelivr/cdnjs）且经内联 importmap；`<head>` 内嵌 Tier1 meta CSP；体积红线（GLB ≤ 6 MB 原始 ≈ 8 MB base64，整页 ≤ 16 MB）。

## 备选方案

- **AGENTS.md 常驻规则 / 生成后 lint 脚本 / `gen_3d_artifact` 工具**：按提案决策后置——skill 是最廉价可靠的通道，且契约违约是可见失败（渲染器回退静态/源码视图），lint/工具化有具体触发条件而不是臆造构建。
- **为 skill 单开一个包**：否决——file-preview 是 HTML 预览家族的所有者、同装即得，skill 只是几 KB 指引，不构成独立特性。

## 后果

- 社区用户安装 `@khorsheed/dsh-file-preview` 即免费获得生成契约；零官方改动。
- 注册可选且防御性：没有 `skills` 能力的组合静默跳过；SKILL.md 缺失/损坏只告警不崩溃。
- skill 是拉取通道：模型只在任务匹配其描述时加载（渐进式披露），非 3D 任务零上下文成本。
- skill 内容随 file-view-html-rendering 提案 M3（3D 里程碑）演进；参考实现为 `02-gltf-inline` 测试页模式。
