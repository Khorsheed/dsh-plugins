# 变更记录

## 0.1.14（2026-09-27）

- **修复 rc.1 宿主上卡片不再渲染**:rc.1 的 `CodeToolbar` 对 shiki 不认得的 fence 语言一律显示宿主本地化的通用标签(「代码块」),`dsh-card` 信息串完全不进 DOM(无 `.infostring`、无前导文本、无 `language-*` 类)。检测新增内容签名兜底:完整 HTML 文档(doctype/`<html` 开头 + `</html>` 收尾)或含逐字严格 CSP meta 的块即判定为卡片;`.infostring` 与前导文本两臂原样保留(旧宿主与 0.1.5 线不变)。裸 HTML 片段在信息串不可见的宿主上不再识别为卡片(已知损失,上游 `data-lang` 提案见 docs/upstream-proposals)。
- 从 `@khorsheed/dsh-file-preview` 接管 `3d-artifact` 作者 skill;两个 bundled skill 现在都通过既有的延迟 skills 注入注册,provider 统一为 `inline-html-render`。
