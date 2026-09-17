# Reader — hi-fi 原型设计说明（伴 dsh-card）

Date: 2026-09-17
Status: 原型（用于确认视觉与交互，非实现）
Branch: `feat/reader`

这份文档记录本轮原型**用了什么、依据是什么**，避免后来者把它误读成"设计稿"或"实现"。

## 1. 颜色：全部来自宿主 token，逐条映射

取值来源 `~/code/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css`
（`:root` 静态色 + `body` 别名层）。原型里直接写死解析后的字面值，因为 **srcdoc 拿不到宿主的
CSS 变量**——但每个值都对应一个真实 token，实现时必须写 token 名而不是字面值：

| 原型里的值 | 宿主 token | 用途 |
|---|---|---|
| `rgb(255,255,255)` | `--dsw-static-neutral-bluish-00` | 面板底 |
| `rgb(245,246,247)` | `--dsw-static-neutral-bluish-60` | 平台/工具条底 |
| `rgb(241,243,245)` | `--dsw-static-neutral-bluish-75` | 悬停实底 |
| `rgb(235,238,242)` | `--dsw-static-neutral-bluish-100` | 按下/分段底 |
| `rgb(225,229,238)` | `--dsw-static-neutral-bluish-200` | 弱分隔 |
| `rgb(15,17,21)` | `--dsw-static-neutral-bluish-1000` | 主文字、品牌绿底 |
| `rgb(97,102,107)` | `--dsw-static-neutral-bluish-700` | 次级文字 |
| `rgb(129,133,140)` | `--dsw-static-neutral-bluish-600` | 三级文字、说明 |
| `rgb(173,178,184)` | `--dsw-static-neutral-bluish-400` | 极弱文字 |
| `rgba(0,0,0,.04 / .10 / .12)` | `--dsw-alias-border-l1 / l2 / l3` | 分级描边 |
| `rgba(38,49,72,.06 / .10)` | `--dsw-alias-interactive-bg-hover / -active` | 悬停、选中 |
| `rgb(65,118,230)` | `--dsw-static-deepseek-500` | 链接、强调、未读点 |
| `rgb(236,19,19)` | `--dsw-static-red-600` | 失败态 |
| `rgb(245,158,11)` | `--dsw-static-amber-500` | 截断/警告态 |
| `rgb(34,197,94)` | `--dsw-static-green-500` | 成功态 |
| `rgb(84,85,87)` | `--dsw-static-neutral-600` | 图标按钮静默色 |

字体家族取 `--dsw-font-family`（`design-platform.css:7`）。

## 2. 图标：宿主 `ui-primitives` 的真实 path

原型里的 SVG 是从 `~/code/deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx`
逐条抠出的原始 `d` 属性，不是重画的近似图形：

| 位置 | 宿主导出名 |
|---|---|
| 刷新 | `IconRefreshOutline16` |
| 复制链接 | `IconCopyOutline16` |
| 在浏览器打开原文 | `IconRightUpOutline16` |
| 返回 | `IconChevronLeftOutline14` |
| 更多 | `IconEllipsisOutline16` |
| 详情入口 | `IconBrowseOutline16` |
| 添加源 | `IconPlusOutline16` |
| 全局/来源标识 | `IconGlobeOutline14` |

实现时直接 `import { IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'`，
不要内联 path。Card 上的来源图标按 D11 的定案（源自带 `<image>` 优先，否则域名首字母色块），
原型里用的是色块兜底形态。

## 3. 布局与尺寸

- **侧栏宽度实测**：`RIGHTBAR_MIN = 300`，默认占框架 45%，上限 70%
  （`ui-layout/src/client/columns.ts:25-29`）。所以原型按 **300px / 380px / 520px 三档真实宽度**
  渲染再按比例缩放显示，而不是假装面板有 900px。
- **卡片列数**：`grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`——纯 CSS 自适应。
  300px 面板 1 列，520px 面板仍是 1 列（280×2 > 520），宽到 580px 以上才 2 列。这是刻意的：
  窄栏里强行多列会让标题和摘要都读不了。
- **触达尺寸**：图标按钮 26×26（宿主右栏工具按钮的既有尺寸）；卡片整块可点。

## 4. 交互（与定稿设计一致）

| 动作 | 行为 |
|---|---|
| 点卡片（整块） | 进入面板内详情页（用户 2026-09-17 定案，方案 B） |
| 详情页顶栏「打开原文」 | 系统浏览器打开原文（D12 的打开路径，S0 探针待验） |
| 划选详情正文 | 交给 `quote` 的选区菜单，本插件不再自造浮层（D13） |
| 详情页「复制链接」 | 剪贴板写 URL |
| 粘贴框回车 | 立刻入库抓取；抽取在客户端本地完成，点详情时正文已就绪（D7） |
| 抽不出正文时 | 提示块里直接给「在浏览器中查看原文」主按钮，不让用户白点一次空详情 |
| 未读标记 | 卡片左缘竖条；本次会话内有效，打开即读，不落盘（D10） |
| 截断 | 详情页文末固定提示「更多内容请查看原文」+ 打开原文（D6） |

## 5. 排版（中英分开，D5）

| 项 | 中文 | 英文 |
|---|---|---|
| 行高 | 1.78 | 1.66 |
| 字距 | `+0.005em` | `-0.003em` |
| 行宽 | `max-width:40em` | `max-width:62ch` |
| 字号 | 13.5px 基准 | 同 |
| 段距 | 12px，段首不缩进 | 同 |
| 层级 | h2 15px/700、h3 13.5px/700 | 同 |
| 引用 | 3px 左边框 + 弱化色，无背景块 | 同 |

正文内容是**真实抽取产物**（`src/client/extract-article.ts` 跑真页面 fixture 的结果：
Anthropic 英文 41 KB、阮一峰中文 29 KB），不是手写的示例文本。
