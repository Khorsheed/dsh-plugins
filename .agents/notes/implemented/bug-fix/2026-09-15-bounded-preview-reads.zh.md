# Agent Note:大文件预览读取限定在窗口内(local-files、file-preview)

Status: implemented

[English](2026-09-15-bounded-preview-reads.md) | 中文

## 问题

两个预览读取路径都是「整读进内存再切」。local-files 的 `readFile` 直接 `fs.readFile(canonical)`——2GB 的日志会整个进堆,然后才 `subarray(0, 2MB)`;file-preview 的未知大小分支经 `ctx.fs.readText` 同样整读。文档里写的「最多读 MAX_CONTENT_BYTES」对响应成立,对读取不成立。host-016 波从 host-015 第四批承接此项(「大文件分页 → `ctx.fs.readByteRange`」),范围定为有界读取 + 宿主侧窗口管道;客户端分页 UI 是后续项。

## 决策

- **local-files 维持自带 node:fs 安全模型,改用文件句柄窗口读**:`open()` + `read(buffer, 0, length, position)`,上限 `MAX_CONTENT_BYTES + 1`(> MAX 即 `truncated`,正文取前 MAX 字节;截断边界的 U+FFFD 行为与现状一致)。图片在打开前按 stat 大小短路——但读后的 `byteLength > MAX` 兜底保留:stat 与 read 之间文件增大的竞态下旧行为是 `too-large`,去掉它会静默产出半张图的 data URL。
- **Remote 增加纯增量分页管道**:`ReadLocalFileRequest.offset?: number`(默认 0)与 `LocalFilesRead.nextOffset?: number`(仅截断时出现,字节位)。纯增量——客户端对着重新生成的 typert 类型编译,两个字段都暂不消费。`offset` 只作用于文本:图片是 all-or-nothing 的 data URL,窗口化只会产出坏图(已写进类型注释)。
- **file-preview 切到官方区间读**:`ctx.fs.readByteRange(target, { offset: 0, length: cap + 1 })`——0.1.5-rc.1 起就在 `Fs` 抽象接口上,不需要探针(minHost 已是 0.1.5-rc.1)。非 fatal `TextDecoder` 取代字符串切片;`truncated` 保持「文件超过 cap」语义,已知大小的 `too-large` 短路与 `isScriptedHtml` 分支不动。公开参数带显式类型标注(typert 分析器要求)。

## 否决的方案

- **同批做客户端分页 UI**——转入波次 rc 后讨论清单:本波的线是 build/test 全绿 + 行为逐字一致,分页 UI 是有独立验收的功能,不是适配。
- **local-files 也走 `ctx.fs.readByteRange`**——否决:local-files 刻意自持 node:fs + 自己的 `assertSafeLocalPath` 模型;句柄窗口读达到同样的界限,不引入新服务接线。
- **stat 短路后去掉图片读后校验**——见上面的竞态兜底;三行换一个诚实的失败模式。

## 后果

- 响应词表逐字节一致(`kind` union、`truncated`、`size`);唯一用户可见变化是内存占用:大文件预览不再整读。
- `nextOffset` 按字节计,窗口若切断多字节字符,续读会从字符中间开始并以 U+FFFD 开头——与切片读取原有的容忍度一致。
- 测试钉住窗口契约(read 长度 ≤ MAX+1、offset 位置、`nextOffset` 续读无重叠无缺口、图片 stat 短路、非 fatal UTF-8 解码、`too-large` 回归)。
