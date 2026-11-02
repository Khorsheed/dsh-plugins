# Agent Note: 小说导入只保留纯文本

Status: implemented

## Problem

第一版文档导入用 Mammoth 支持 DOCX，其 Node 入口把服务端模块和全局变量假设带进浏览器产物，导致 3080 的小说插件无法激活，尽管构建、preflight 和 canary 都通过。换用 Mammoth 官方浏览器发行包可以修复入口，但用户决定暂时不引入解析器依赖和 Word 文档攻击面。

## Decision

- 小说导入只接受 `.txt`、`.md`、`.markdown`。文件选择和目录扫描不再提供 DOCX；Mammoth 与仅用于测试的 JSZip 都移除，不引入其他转换器。Zod 继续用于生成的 Remote schema。
- `.doc`、`.docx` 会明确提示先另存为 UTF-8 TXT 或 Markdown。目录扫描只返回提示，不读取 Word 文件字节，也不把它计入支持文档的字节上限。其他不支持的格式、隐藏项和符号链接仍然跳过。
- 文本解码、章节识别、预览、连续原稿写入、续传和对账不变。native 与官方 browse 两种目录选择方式都保留。
- 真实 `lib/client.js` factory 继续在只有浏览器全局变量的 VM 中执行，平台模块用测试桩提供，Node 内置模块、`process`、`Buffer`、`setImmediate` 都不提供。这是通用的浏览器加载回归测试，不是保留 DOCX 依赖的理由。
- 这一变更部分取代[文档导入决策](../feature/2026-11-02-canvas-novel-document-import.md)中的 DOCX 分支；其他文档与文件夹导入行为不变。

## Alternatives considered

- **发布 Mammoth 官方浏览器发行包。** 它能在无 Node 全局变量的环境解析验收 DOCX，但保留 DOCX 仍有解析器供应链、恶意 ZIP/XML 输入和转换依赖，用户当前不愿承担。
- **强制依赖宿主 Office/LibreOffice。** 否决：可选能力会变成硬依赖，违背插件独立安装要求；纯文本功能不需要转换器。
- **自行实现 DOCX 解析。** 否决：私有 ZIP/WordprocessingML 解析器只会增加代码与风险。
- **随 Mammoth 一起删除浏览器产物冒烟测试。** 否决：宿主 canary 不会执行客户端 factory，浏览器执行检查对将来的依赖仍有价值。

## Consequences

- Word 用户需要先另存或导出 UTF-8 TXT / Markdown，多一步手动转换；换来没有 Word 解析器、没有 DOCX 测试生成器，也没有 Node 专用浏览器依赖图。
- 纯文本导入不等于完全没有第三方依赖：Zod 仍校验生成的 Remote schema，React 与官方宿主包仍是 peer，开发工具仍只用于开发测试。
- 宿主 canary PASS 仍不能代替浏览器证据。产物测试负责执行加载，真实 UI、目录选择交互和模型对账质量仍需分别验收。

## Validation

- 解析测试覆盖中英文与 Markdown 标题、卷首、自然排序和中文章号、UTF-8/GB18030、空文件、超长文件，以及 `.doc`、`.docx` 的转换提示。
- 目录测试证明 Word 文件只产生提示、不会出现在字节结果中，旁边的文本章节仍正常导入。native 与官方 browse 选择、路径规范化、跳过和上限仍有覆盖。
- 构建后的客户端 factory 在无 Node 模块和全局变量的环境执行。现有原稿、Remote 与预览测试继续覆盖不变的写入和对账契约。
