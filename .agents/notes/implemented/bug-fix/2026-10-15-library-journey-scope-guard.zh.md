# Agent Note: 图书馆——只覆盖一本书的项目路线被拒收并指向书（旅程分流护栏）

Status: implemented

## Problem

两条旅程在真实使用里混了：在「数学」项目里让教练给一本书排路线，教练把项目级路线写成了每站只覆盖《普林斯顿微积分读本》——书路线被停在了项目上，书自己反而没有路线，学习者面对两条半截旅程。`validateRoadmapShape` 此前只强制了单向（书级路线只能覆盖那本书），镜像方向没有护栏；prompt 里「超出一本书才走项目路线」的条文也没有牙齿。

## Decision

- `validateRoadmapShape` 加镜像护栏：项目级草稿（无 `bookId`）若每个节点的每条 cover 都指同一本书，拒收并在教学信息里点书名、要求带 `book: <id>` 重发。出现第二本书、或任何非书 cover（resource / url / topic），才算真正的项目路线。
- `LIBRARY_PROMPT` 的路线规则补上镜像表述：每站只覆盖同一本书的路线 IS 那本书的路线——传 `book`，不停在项目上。

## Alternatives considered

- **只靠提示词引导**：否决——条文本来就在，模型照样停错地方；机械拒收才是不会错过的纠正。
- **放行并按书路线渲染**：否决——两个 scope 装同一条旅程，进度与考卷账本会分叉。

## Consequences

- 材料型书证据闸的测试夹具移到书自己的路径上（单书的站本就该挂在书上）；闸门行为本身不变。
- 已采用的错挂路线不做数据改写：学习者让教练在书上重排，下一条真正的项目草稿会覆盖被停错的那条。

## Testing

`service.spec.ts`（+1：纯单书项目草稿被拒并指向书；同书加讲授站放行）。`tool.spec.ts`（cover 别名测试改为真正的双来源项目路线）。`pnpm --filter @khorsheed/dsh-library test` 111/111 绿。
