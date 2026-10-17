# Agent Note: video-studio —— 可断点续传、带完整性钉值的模型下载

Status: implemented

## Problem

四个语音模型（约 330 MB）从 k2-fsa/sherpa-onnx 的 GitHub Releases 下载，在国内典型开发网络下又慢又容易断（实测约 58 KB/s，本地 `download.log` 留有 SSL 断连记录）。旧的下载器（`src/media/models.ts`）在任何失败时删掉 `.part` 文件，每次重试——以及每次宿主重启——都从第 0 个字节重来。且没有钉死任何校验和，可续传的设计也无从信任拼接起来的字节。上游语音输入 bundle(harness 的 `speech-to-text-sensevoice`）有镜像源选择，但同样没有字节级续传，且其下载器是包内私有的，没有可 import 的共享模块。

## Decision

字节级续传 + 校验后发布，全部收在 `models.ts` 内：

- `fetchWithResume(url, part, {bytes, sha256?}, onProgress)` 跨失败保留 `.part`；存在半成品时发 `Range: bytes=<大小>-`，校验 `Content-Range`,206 追加、200（服务器忽略 Range）截断重写；盘上已完整时跳过请求只校验。进度从盘上已有字节数继续。
- 完整性在 `MODELS` 里逐文件钉死：每个下载文件都带 `bytes` + `sha256`，取自 HF 仓的 LFS oid，并与本机已验证安装交叉核对。
- 失败分类决定 `.part` 去留：网络/流/HTTP 错误与短读保留半成品（前缀有效，重试续传）;sha256 不符或 `tar` 解压失败说明完整文件已坏，`CorruptDownloadError` 在下次尝试前删除。
- 重启可见性：`refresh()` 把残留 `.part` 字节报为 `ModelStatus.partial`，面板模型列表显示「未安装 · 已下载 x%，将续传」。转写前和下载按钮本来就走 `ensure()`，两条路径都会自动续传。

## Alternatives considered

- **整体移植 sensevoice 下载器**（准备状态机、流式进度）：否决——video-studio 是全仓唯一的模型下载方（抽共享包是过早抽象），面板现有 8–15 秒轮询对进度已够用。值得移植的思想（源探测、流式 sha256、原子发布、失败分类）已吸收，机制本身不搬。
- **用 gh-proxy 类前缀代理做 GitHub 镜像**：否决——候选都是第三方转发（实测一个已从开发网络失联），且与发布资产的字节一致性无从证明。后证实 HuggingFace 上每个模型都有逐字节一致的仓（用用户本机已装好的文件比对 HF LFS oid 验证），可信镜像存在，代理无必要。
- **用独立子进程下载，让宿主重启不打断**：否决——孤儿进程管理与进度重接的成本远超续传省下的。

## Mirror sources (update)

续传落地后，确认每个模型在 HuggingFace 上都有逐字节一致的家（三个是 csukuangfj 官方仓；int8 标点模型是社区转传，用本机已验证安装比对 HF LFS oid 确认）。GitHub 发布通道因此被**删除**而非保留为第三选项：HF 逐文件通道无需解归档、端到端钉死 sha256，而 GitHub 的 paraformer 归档永远无法钉（无官方 digest，归档字节无法从解压产物反推）。下载源与语音输入 bundle 完全一致——自动选择（推荐）/ Hugging Face / HF-Mirror（国内镜像）——「自动」是一个真实选项而非藏起来的持久默认值：探测发生在下载那一刻，反映的是彼时的网络；存下来的猜测会过期。下一轮下载会顺带清扫遗留的 `.tar.bz2.part`（它们永远无法被续传）。

## Consequences

- 宿主重启或网络中断后，下次尝试不浪费已下载字节；重试循环走续传而非重来，失败的源自动落到下一个。
- 损坏的半成品在校验时被发现，不会静默发布；每个模型的每个文件都钉死了 sha256。
- `ModelStatus` 新增 `partial?: number`，`GlobalConfig` 新增 `modelSource`（协议兼容：纯增量、可选/有默认；已持久化的 `github` 旧值回落为 auto）。

## Testing

`tests/models.spec.ts`（新增）：全新下载、Range 续传 + 全文件哈希校验、Range 被忽略时截断重写、完整残留免请求校验、损坏 vs 短读的分类、`refresh()` 的 partial 上报、源探测排序、HF 逐文件安装的续传与复用——全部打本地支持 Range 的 HTTP 服务器。`tests/core.spec.ts` 新增失败任务原位重试用例。包测试全绿 29/29;`pnpm --filter @khorsheed/dsh-video-studio build` 绿。
