# Agent Note: a Codex member's effort passes when the directory cannot list its model

Status: implemented

## Problem

用户把 Codex 端点换成 openproxy 的 codex 路由后，房间 5d4f0d41 的游戏策划大师一启动就报错："Codex has not advertised this reasoning effort for the selected model; refresh its native directory"。这个路由用 `gpt-6.1-sol` 加 `reasoning.effort: high` 调 `/responses` 是正常的，但它的 `GET /v1/models` 返回 403，于是模型目录变成 `unsupported`，里面一个模型都没有。而代码只要发现明确设置的思考强度在目录里找不到对应模型，就会拒绝，所以这个成员连这一轮都没开始就失败了。

## Decision

Codex 的配置适配器现在只在一种情况下拒绝明确设置的思考强度：目录列出了这个模型的思考强度选项，而所选强度不在其中。这和 Kimi 那边的规则一致。目录里没有这个模型，或者没有思考强度信息时，照原样把强度传过去，由端点自己判断。

## Alternatives considered

- **换一条路径拉模型列表。** `/models` 返回什么由中转服务决定；目录为空，不应该挡住一个能用的端点。

## Consequences

如果给目录里没有的模型设了不支持的思考强度，现在会在端点那一侧报错，用端点自己的错误信息，而不是在这一轮开始之前就被拦下。Claude 和 DSH 两家仍保留更严格的规则，因为它们的目录是本地的。

## Testing

`local-agent-codex`（263）：新增一个配置用例，在空的 `unsupported` 目录下，`gpt-6.1-sol` 加 `high` 能正常通过。
