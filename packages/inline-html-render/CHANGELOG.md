# 变更记录

## 0.1.16（2026-10-22）

- **技能卡来源归一为包全名**：随包注册的两个作者 skill（`inline-html-card`、`3d-artifact`）的 `provider` 从裸词 `inline-html-render` 改为 `@khorsheed/dsh-inline-html-render`——能力目录的技能卡与其他插件一样显示包全名；行为与 skill 内容不变
- 适配宿主 0.2.1 线：退役 invariant 伴生并声明 `engines.dsh`（`>=0.1.2-rc.1 <0.3.0-0`）；peer 区间加 `|| ^0.2.1-rc.1`（严格解析路径下 `^0.2.0-rc.1` 不覆盖 0.2.1）；verifiedHost 前移 0.2.1-rc.1

## 0.1.15（2026-09-30）

无功能变更。加宽 `@deepseek-ai/dsh-*` peer 区间以覆盖宿主 0.2.0（0.2.0 的兼容闸会禁用 peer 区间不覆盖宿主版本的已装插件）。

## 0.1.14（2026-09-27）

- **修复 rc.1 宿主上卡片不再渲染**:rc.1 的 `CodeToolbar` 对 shiki 不认得的 fence 语言一律显示宿主本地化的通用标签(「代码块」),`dsh-card` 信息串完全不进 DOM(无 `.infostring`、无前导文本、无 `language-*` 类)。检测新增内容签名兜底:完整 HTML 文档(doctype/`<html` 开头 + `</html>` 收尾)或含逐字严格 CSP meta 的块即判定为卡片;`.infostring` 与前导文本两臂原样保留(旧宿主与 0.1.5 线不变)。裸 HTML 片段在信息串不可见的宿主上不再识别为卡片(已知损失,上游 `data-lang` 提案见 docs/upstream-proposals)。
- 从 `@khorsheed/dsh-file-preview` 接管 `3d-artifact` 作者 skill;两个 bundled skill 现在都通过既有的延迟 skills 注入注册,provider 统一为 `inline-html-render`。
- README 兼容段的 DOM 锚点复核钉到 master 0.1.7-rc.2(锚点无变化,无行为变更)。
