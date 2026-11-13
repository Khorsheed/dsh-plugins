# Agent Note：删除 README 中重复的 Agent 安装指南

Status: implemented

[English](2026-11-13-remove-agent-install-guides.md) | 中文

## 问题

八组套件 README 和根 README 的中英文版本都另带一份面向 Agent 的安装指南。这些章节重复了普通用户章节和集合数据已有的安装说明，且其中的版本细节容易过时。维护者不再希望 README 充当面向 Agent 的安装手册。只删标题会留下重复说明，集合生成器还会把其中一部分重新生成。

## 决策

删除 basic、dev-suite、bundle-local-agent、eval-suite、gamedev-suite、learning-suite、video-suite、writing-suite 中英文 README 里完整的 Agent 指南，也删除根 README 中英文版本的安装与开发折叠指南。普通安装、卸载、功能、兼容性和集合说明保留。`docs/readme-style.md` 不再要求末尾提供 Agent 指南。

集合生成器现在把套件中带标记的命令块视为可选：不会重新生成已删除的命令块，但仍校验保留的块。根 README 的集合块仍是必需的。专门的 fixture 证明重新生成不会补回缺失的套件块，同时仍会拒绝缺失的根集合块。

此前的目录结构决策继续保留，记录当初引入折叠指南的原因；本次只取代该呈现方式，不改变目录或面向用户的安装模型。

## 未采用的方案

**保留折叠指南。** 否决：折叠不能消除重复说明的维护成本，也保留了维护者不想要的第二类受众。

**只删除中文指南。** 否决：中英文文档必须保持配对，因此所有受影响 README 的两种语言一起删除。

**保持生成器不变。** 否决：它会要求并重建已删除的套件命令块。可选套件块既保留新的文档结构，也不削弱根集合校验。

## 影响

README 继续聚焦用户要做什么、插件提供什么。面向 Agent 的操作知识留在仓库贡献文档和 Agent Notes 中，不再另设一份 README 安装手册。插件运行时、安装、组合和兼容行为均不改变。

## 验证

集合生成器 fixture 覆盖套件块可选缺席与根集合必需。完整脚本测试、集合一致性、双语配对、仓库卫生及受影响套件的构建和测试共同作为本次门禁。

## 相关

- [公开 README 目录层](../process/2026-09-27-public-readme-catalog-layer.md)
