# profiles/web —— 3080 prod 部署的 preset 正本区

3080（`~/.dsh-official/profiles/web`）是写作 prod 部署：它的 **profile 文件**由 `deploy:3080` 流程写（只收 tarball），但它的 **agent preset 名册**（`$DSH_HOME/.agent-presets`）曾经是游离在版本控制外的部署资产——本地补挂过一次漂移进生产（2026-09-17，dev preset 多了评测三行）。本目录是正本化的答案：

- `presets/dsh-writing/`——写作模式 preset 的**唯一事实源**（3080 私有：canvas `./agent` 行 + 标准工具底）。改它 = 改 3080 的写作模式，走正常 PR 评审。
- `presets/` 里**没有** dsh-eval：评测模式的组合正本是 `profiles/web-eval/presets/eval/agent.cordis.yml`（web-eval pack 的 eval preset），3080 名册里的 dsh-eval 是它的部署副本。
- `presets/` 里也没有 dev：它归 web-dev pack 的 `install.sh` / `update.sh` 管（整目录覆盖）。

## 同步到 3080

```sh
DSH_HOME=~/.dsh-official sh profiles/web/scripts/sync-presets.sh
```

幂等：已一致的条目跳过；要覆盖的先备份到 `$DSH_HOME/.agent-presets/.backup-<epoch>/`。名册无缓存（每次 `list()` 重读文件系统），跑完即生效，无需重启；preset 在建会话时锁定，存量会话保持创建时的组合。

## 规则

- 3080 的 preset 改动**只允许两条路**：改 git 正本后跑 sync 脚本，或临时手改名册后**立即**把改动回流正本（否则下次 sync 覆盖回来）。
- 新 preset 进 3080 = 在本目录（或对应 pack 的 `presets/`）建正本 + 在 sync 脚本登记一行。
- 本地实验 preset 用别的 id（web-dev 的 install.sh 注释：同名 id 会被 pack 覆盖）。
