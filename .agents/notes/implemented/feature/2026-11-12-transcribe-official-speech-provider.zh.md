# Agent Note：把本机转写引擎注册为官方语音 provider

状态：implemented

[English](2026-11-12-transcribe-official-speech-provider.md) | 中文

## 问题

宿主 0.2.2-rc.2 提供了 provider 中立的短录音接口和实验语音输入组合。社区 `transcribe` 已有中文 Paraformer、多语言 SenseVoice、长媒体解码、说话人分离与全局串行队列。为语音输入重写识别会重复管理模型，还可能同时运行两个原生 worker；直接替换又会丢失长音频职责。

## 决策

仅在 `speechToText` 存在时注册 `transcribe-local`。provider 接受官方的 `auto` / `zh` / `en` 语言提示，校验标准 16 kHz 单声道 PCM16 WAV，把临时文件放在现有服务的 `tmp` 下，复用 `modelsFor`、`models`、`prepare`、`run`。返回全文、音频时长和实测推理时长，结束即清理临时 WAV。官方注册表负责撤销 provider 和等待已接受任务，provider 的准备任务随注册销毁。

准备阶段提供原有 Hugging Face / HF-Mirror 选择，检查所声明语言需要的模型，重复请求共享同一任务，活动中不允许换源。取消信号现在贯穿 `TranscribeService.prepare`、`ModelManager.ensure`、源探测、HTTP 请求、输出文件流与重试等待。有效分片保留供续传，取消不会伪装为安装完成。

旧宿主或没有实验注册表的组合继续使用原 `transcribe` 服务，不硬依赖语音 UI。长文件、ffmpeg、逐段回调、分人与原队列接口不变。本次不把实验 UI 加入生产组合。

## 未采用的方案

**provider 直接启动另一个原生 worker。** 否决：会重复模型管理并破坏一次一个任务的保证。

**把 ffmpeg 输出的任意 WAV 直接交给官方接口。** 否决：普通输出可能含 LIST 元数据块。官方明确要求标准 WAV，验收生成合规 PCM 头，而不是放宽接口约束。

**只在界面报告取消。** 否决：准备取消必须让底层网络和文件工作真正结束。

## 影响

一段本机生成的短中文语音通过官方注册表转写为「你好，这是本地语音识别测试。」；音频 3.25525 秒，推理 2.518890542 秒，临时目录为空。另一次 SenseVoice 下载以 `fetch failed` 结束，模型仍未安装，因此不宣称英文模型验收成功。中文 Paraformer、标点和 VAD 已有，真实原生执行通过。

包构建及 4 个测试文件、35 项测试通过。覆盖官方注册与销毁、真实 WAV 委托、非法输入、准备取消，以及本地 HTTP 响应流取消后的分片保留。本次不代表已部署或已发布。

## 相关

- [宿主 0.2.2-rc.2 适配](../process/2026-11-12-host-022-rc2-adaptation.md)
- [官方能力整合路线](../../../../proposals/active/2026-11-12-host-022-rc2-official-capabilities.md)
