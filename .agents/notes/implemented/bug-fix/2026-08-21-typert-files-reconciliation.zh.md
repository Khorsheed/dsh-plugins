# Agent Note: typert 包把字面 files 条目与 whole-lib glob 调和

Status: implemented

[English](2026-08-21-typert-files-reconciliation.md) | 中文

## 问题

e007ba3 把各包的 `files` 改成整个 `'lib'` 目录（tsdown 的 hashed chunk 使逐条枚举失效）之后，`gen-typert` 对每个 typert 包报 `TypertAnalysisError: … package files must include lib/typert.host.js`。harness 生成器用字面 `files.includes('lib/typert.<face>.js')` / `.d.ts` 校验 manifest，纯目录 glob 永远无法满足——五个 typert 包的规范构建全线损坏。

## 决策

五个 typert 包——message-tools、file-preview、datasets、mission、local-agent——保留 `'lib'`（管 hashed chunks），同时在 `files` 里列出字面稳定名条目 `lib/typert.host.js`、`lib/typert.host.d.ts`、`lib/typert.remote-client.js`、`lib/typert.remote-client.d.ts`。字面条目与 `'lib'` glob 覆盖的路径重复；npm pack 会去重相同路径，冗余是惰性的——条目只为了满足生成器契约。file-preview 另带 `skills/**/*.md`（3d-artifact skill，见 [skill-registration note](../../implemented/feature/2026-08-21-3d-artifact-skill-registration.md)）。

## 备选方案

- **改 harness 生成器以接受目录 glob**：否决——我们绝不改上游；manifest 侧的修复是惰性的且按字面满足契约。
- **本次 skill 改动跳过 gen-typert**：否决——规范构建必须保持绿；该修复机械且纯增量。

## 后果

- `gen-typert` 恢复通过——已验证：五个包在同一批次里从 overlay 重新生成。
- `files` 字段出现看似冗余的条目；约定是生成器校验规则变化时同步重生成字面 typert 条目。
