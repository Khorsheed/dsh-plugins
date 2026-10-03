# Agent Note: 在 macOS 保留 Claude 宿主钥匙串身份

Status: implemented

## Problem

Claude 新 OAuth 登录成功，委派的 Opus 成员却立即报告会话过期。Claude Code 2.1.284 在同一作用域目录下，保留 USER 时认证成功，移除 USER 时未认证；单独恢复 LOGNAME 无效。家族环境沿用旧 CLI 的兼容处理，刻意清除了 USER。现有文件与可用钥匙串条目中的凭据一致且仍有效，重复登录无法修复启动身份不一致。

## Decision

Claude provider 通过私有进程环境 helper，在 macOS 显式恢复 USER。优先采用宿主 USER，服务启动缺省时读取系统用户名。登录 argv、版本探测、原生模型目录、一次性首轮与续跑、常驻驱动共用此身份。系统身份读取失败时降级，不编造用户名。家族白名单继续清理无关变量及环境中的凭据。

容器执行保留家族环境，不转发这个 macOS 宿主身份。其他 provider 和非 macOS 启动不变。不删除或迁移钥匙串条目，不把 token 复制到 argv。部署重启会替换常驻子进程，使其读取修正后的环境；原生会话记录仍可续跑。

## Alternatives considered

**要求用户重新登录或删除历史钥匙串条目。** 现有授权使用正确身份即可认证，修改凭据会掩盖启动缺陷，并可能影响其他使用者。

**在 local-agent 全局白名单恢复 USER。** 只有 Claude 的 macOS 凭据读取需要此例外，无需扩大到所有 provider 或向容器转发宿主用户名。

**继续依赖凭据文件镜像。** 当前 macOS Claude 自行解析钥匙串账号，文件有效不能修复进程身份错误。

## Consequences

单测固定 macOS 身份保留、系统账号回退、读取失败降级、非 macOS 行为不变及凭据环境清理。现有驱动、目录、登录和容器测试覆盖相关入口。原生 auth-status 对照可在无模型调用下安全复现。真实认证轮次与部署 canary 属于运维验收，不是单测结论。
