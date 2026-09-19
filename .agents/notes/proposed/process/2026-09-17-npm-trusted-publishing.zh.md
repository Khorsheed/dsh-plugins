# Agent Note: npm trusted publishing——手动触发 → CI 暂存 → 网页审批，token 退出流程

Status: proposed

## Problem

目前的发布跑在维护者的笔记本上，而且每一环都很脆：TOTP 注册已下线（2FA 只剩 security key / WebAuthn）；拿恢复码当 OTP 会触发 72 小时安全冻结（0.1.5 波次已踩实）；颗粒度 token 正在被收紧——bypass-2FA token 已经不能做账号/包管理动作，直发也将在 2027-01 取消（我们的 publish token 现在已经直接吃 EOTP）。2026-09-17 这波是手工驱动的 staged publishing 发出去的（笔记本上 `npm login --auth-type=web`、`npx npm@12 stage publish`、网页审批）——能用，但发布的产物是在本地机器上构建的，`~/.npmrc` 的会话凭证切换是每波一次的仪式，而且从 git 提交到暂存产物之间没有 CI 可证的链条。

## Proposal

用 npm trusted publishing（OIDC）把暂存搬进 CI——流程里不再有任何 npm token：

1. `.github/workflows/publish.yml`（已提交，仅手动触发）：输入包列表；按 ci.yml 钉的 tag 克隆 harness 种子；从该工作流所在提交构建 + 测试 + 打包指定包；已在线上的版本直接拒绝；每个 tarball 经 OIDC 走 `npm stage publish`（`permissions: id-token: write`、`environment: npm-publish`、node 24 自带的 npm@12）；job 总结列出待审批清单。
2. npm 侧（一次性、逐包、维护者用 security key 操作）：包 Settings → Trusted Publisher → GitHub Actions——org `Khorsheed`、repo `dsh-plugins`、workflow `publish.yml`、environment `npm-publish`、允许动作**仅 stage**（不开放直接 `npm publish`：上线永远保留人工审批）。
3. 审批留在原地：npmjs.com 的 Staged Packages 标签页 + security key。批准后 `npm view` 确认，`pnpm release:status` 照旧重录。
4. 首次实盘演练：下一个宿主 rc 适配波次的发布。
5. `pack-dist` 新增 `--family auto`（从清单 + 仓内版本推导伴生边——与 deploy-3080 已有的推导同源），CI 和人工都不再手工枚举家族边；publishing.md 的打包步骤同步采用。

GitHub Release / tag 流程维持现状（每波的 tag 与 Release 已在建）；把 `gh release create` 并进工作流留作后续可选项。

## Alternatives considered

- **维持笔记本暂存（现状）**——今天已验证可行，但产物是本机构建、凭证仪式每波重复，而且对 2027-01 的 bypass token 死线没有答案。
- **OIDC 放开直接 `npm publish`**——少一步人工，但拿掉了我们明确想要的审批闸：每次上线都保留维护者 + security key 确认。仅 stage 是刻意选择。
- **GitHub secrets 里放长期 npm token**——正是 npm 正在淘汰的凭证类型；CI token 泄露就是这些新规要关掉的攻击面。
- **等 2027 强制迁移再说**——staged publishing 今天就能用（2026-09-17 波次已实证），管线现在搭很便宜，下一个 rc 波次正好演练。

## Acceptance criteria

- 一次 `publish.yml` 的 dispatch 运行完全经 OIDC 暂存一个真实包版本（CI 里没有任何 `NPM_TOKEN`），包出现在 Staged Packages，网页审批后上线，`npm view` 确认版本。
- publishing.md 把 CI 流程写成默认，笔记本 staged 路径保留为有文档的兜底。
- npm 侧的 trusted-publisher 配置覆盖所有已发布包（截至 2026-09-17 共 10 个）。

## Risks

- npm 侧配置是逐包手工的（维护者一次性 10+ 次网页操作）；org/repo/workflow 文件名/environment 名不匹配只会让 OIDC 交换大声失败，绝不会静默发布。
- 全新包不能走 stage（registry 规则：包必须已存在）——每个包的首次发布仍走笔记本路径，之后补登 trusted-publisher。
- 工作流要克隆并构建 harness 种子（CI 里最慢的部分）；按波次的节奏可接受。
