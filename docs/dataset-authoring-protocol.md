# 数据集作者协议（Dataset Authoring Protocol）

**Version: v1-rev2** · [English](dataset-authoring-protocol.en.md)

本协议定义「一个数据集在 git 仓库里长什么样」。它独立于任何 agent 工具链：`@khorsheed/dsh-datasets` 插件的校验器、绑定表单预填、`dataset-authoring` skill 都从本协议派生。协议里的每个 JSON 示例都直接进校验器的测试夹具（防漂移）。

## 0. 心智模型

一个数据集 = 一个 git 仓库里的 `datasets/<dataset-id>/` 目录；一个仓库可含多个数据集。版本 = git commit；评测 run 经 snapshot 固化 `{repo, commit, datasetId}`。

你的文件不用改名、不用搬家到固定层目录：角色由注册文件声明（§2 的 `register`），目录布局只是零配置的默认形态。

## 1. 布局（默认形态；用 register 时可自由）

```
datasets/<id>/
  dataset.json              # 注册文件，见 §2
  <其他顶层文件/目录>         # 透传区：对所有绑定会话可读，不校验、白名单管不到
  <layer>/…                 # 题集级共享层（目录名须在 layers 声明）
  items/<item-id>/
    item.json               # item 元数据。★ 与透传区同级：白名单管不到、未声明字段直通——敏感内容一律不放
    <layer>/<文件…>          # item 级层
```

## 2. dataset.json

```json
{
  "id": "harness-comparison",
  "name": "Harness 对比评测集",
  "layers": [
    { "name": "visible", "modelFacing": true },
    { "name": "verify", "modelFacing": false },
    { "name": "grading", "modelFacing": false }
  ],
  "itemMetaSchema": {
    "type": "object",
    "properties": { "difficulty": { "type": "string" } }
  },
  "register": [
    { "item": "P0-placeholder", "layer": "visible", "files": ["task.md", "docs/*.md"] },
    { "item": "P0-placeholder", "layer": "grading", "files": ["answers/*", "answers/oracle/*"] }
  ]
}
```

- `id` 必须与目录名一致；`name` 可选；`layers` 非空，每层 `name`（段安全：字母数字与 `._-`，不以点开头）+ 可选 `modelFacing`（缺省 `true`）。
- `itemMetaSchema` 可选，仅形状校验为对象（插件不做 JSON Schema 全量校验）。
- `register` 可选：显式把 item 目录内的自由文件注册进 `item`/`层` 角色。**v1 约束**：路径是 item 相对路径、不得越出 item 目录（无绝对路径、无 `..` 段）；glob 仅限单层通配（`*` 不跨 `/`，禁止 `**`）；不得重新注册 `item.json`；与布局形态冲突（同一显示路径同时被约定层目录与 register 覆盖）或精确路径不存在时 fail loud。glob 零命中允许（内容可以后到）。
- 纪律：每个层必须显式声明 `modelFacing`；混合敏感度数据集里缺键的层会被 warn（见 §5）。

## 3. 可见性纪律（协议的核心，违反即泄题）

- `modelFacing` 语义：该层能否进入「模型可见面」（物化进执行环境、发给选手、agent 工具可读）。
- **默认安全**：会话绑定未显式列出 layers 时，`modelFacing:false` 层默认对 agent 不可读；读敏感层必须显式列出（主动、清醒的动作）——忘了列的时候机制拦住你。未声明任何敏感层的数据集不受影响（全部可见）。
- **消费者拆分**：白名单是 agent 的边界（工具 + worktree 物化），不是人的边界——UI 上人始终能看到自己仓库的全部内容（敏感层带 `· 敏感` 标记）；真正没保护的是透传区与 item.json——它们在界面上必须显眼，而不是被藏起来。
- 判定类内容 → `modelFacing:false` 层，由编排方在判定时挂载，做题时不可见。
- 评分/答案类内容 → `modelFacing:false` 层，永不下发；导出分享收录这些层要过人工确认闸。
- item.json 与透传区不受白名单保护（机制上不经过层过滤），视同永远可见——敏感内容一律不放。
- 正例：题目的敏感注解（含技术路径的提示）放 grading 层、按 item id 对应，如 `items/F1/grading/standards-notes.yml`。

## 4. 共享内容

跨 item 共用且有可见性要求的内容（如验收 helpers）放题集级层 `datasets/<id>/<layer>/`，不要在每个 item 里复制（严格程度会漂移）。

## 5. 自验

产出完成后运行 `dsh-datasets validate`（或调用 `datasets_validate` 工具）。形状错误与非零退出必须修到全过；警告应当回应而非忽略。警告包括：

- `MODELFACING_UNDECLARED`：混合敏感度数据集里未表态的层；
- `FIELD_NAME_SENSITIVE`：item.json 里出现 note / hint / answer / rubric / grading 词根的键（便宜的字面启发式，专门抓「敏感备注写错地方」）；
- `UNREGISTERED_FILES`：未被任何层目录或 register 条目覆盖的文件（漏配的文件会静默掉进透传区变成「永远可见」；glob 单层通配盖不住子目录是高频踩法）。
- 评测契约目录（§6.1 的 `conditions/`、`plans/`、`schemas/`、`templates/`）被报为 UNREGISTERED_FILES 属预期：它们本来就是题集级透传区，不进层与 register 的语义。

## 6. 评测契约（condition / plan / verdict）

本节把 web-eval 的三份契约 schema 收进协议，与 `dataseek.verify/1`、`dataseek.rubric/2` 并列。它们由 `@khorsheed/dsh-eval` 校验与哈希（`dsh-eval validate` / `dsh-eval conditions hash`），执行语义归 web-eval 的编排器；`dsh-datasets` 不解释它们。每个 JSON 示例都是校验器夹具，schema 文档与代码常量（`packages/eval/src/schema.ts`）由测试钉住互不漂移——**改这里的 schema 就是改契约**。

### 6.1 位置：题集级透传区

契约文件住在题集目录下的四个目录（§1 的透传区语义；`dsh-datasets validate` 对它们报 UNREGISTERED_FILES 属预期）：

```text
datasets/<id>/
  conditions/<id>.json        # 条件声明（agent 起草、人评审）
  conditions/<id>.lock.json   # 条件哈希与 scoped home 的实物记录（工具写）
  plans/<plan>.json           # run 计划（agent 起草、人批准）
  schemas/<stage>.json        # 阶段 structured schema（见 §6.6，权威）
  templates/<name>.json       # run 模板（I2 起由 manifest 生成，不手写）
```

### 6.2 dataseek.condition/1 —— 受试对象

一个条件 = 一个 harness + 一组模型声明 + 权限词 + 一个 scoped home + env 键名，整体内容哈希即条件身份。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "dataseek.condition/1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema",
    "harness",
    "model",
    "reasoning",
    "permissions",
    "instructions",
    "preset",
    "skills",
    "home",
    "env"
  ],
  "properties": {
    "schema": {
      "const": "dataseek.condition/1"
    },
    "harness": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "version",
        "drive"
      ],
      "description": "The harness under test. version: null while undetected; drive: exec only (frozen decision 2).",
      "properties": {
        "name": {
          "type": "string"
        },
        "version": {
          "type": [
            "string",
            "null"
          ]
        },
        "drive": {
          "enum": [
            "exec"
          ]
        }
      }
    },
    "model": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "declared",
        "endpoint"
      ],
      "description": "The declared model and endpoint. null while unresolved; the orchestrator reads back what actually served (frozen decision 5).",
      "properties": {
        "declared": {
          "type": [
            "string",
            "null"
          ]
        },
        "endpoint": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "reasoning": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "effort"
      ],
      "description": "Reasoning effort, pinned explicitly per harness (frozen decision 4).",
      "properties": {
        "effort": {
          "type": "string"
        }
      }
    },
    "permissions": {
      "enum": [
        "auto-approve",
        "danger-full-access",
        "normal",
        "read-only",
        "skip",
        "unrestricted",
        "workspace-write"
      ],
      "description": "The harness permission word; each harness accepts a subset of this union (protocol §6.2)."
    },
    "instructions": {
      "type": "string",
      "description": "System-instruction posture; \"none\" keeps the harness default."
    },
    "preset": {
      "type": [
        "string",
        "null"
      ],
      "description": "A named preset the condition runs under, or null for none."
    },
    "skills": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "pack"
      ],
      "description": "The skill pack materialized into the condition's environment, or null for none.",
      "properties": {
        "pack": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "home": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "sha"
      ],
      "description": "sha of the scoped home's config content (see the protocol hash rules); null while not provisioned.",
      "properties": {
        "sha": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "env": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "keys"
      ],
      "description": "Environment variable NAMES the condition injects — never values.",
      "properties": {
        "keys": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    },
    "notes": {
      "type": "string",
      "description": "Review commentary; excluded from the condition hash (a comment edit is not a new factor)."
    }
  }
}
```

- 可空字段（`harness.version`、`model.declared`、`model.endpoint`、`home.sha`）的 `null` 读作「**未解析**」：validate 列为 warning，run 前的就绪检查拦截。`null` 是显式的「还不知道」，不是「没有」。
- `permissions` 的词表按 harness 给定：`dsh` → `unrestricted`；`claude-code` → `skip` 或 `normal`；`codex` → `danger-full-access`、`workspace-write`、`read-only`；`kimi` → `auto-approve`。schema 枚举是并集；已知 harness 的越表取值（如 dsh 配 `skip`）由校验器报 error。
- `env.keys` 只写变量名。任何值——尤其凭证——不得进契约文件。
- 例（已全部解析；I1 手写格的「进行中」形态见题库 `conditions/dsh-exec.json`，四个 null 字段以 warning 列出）：

```json
{
  "schema": "dataseek.condition/1",
  "harness": { "name": "claude-code", "version": "2.1.236", "drive": "exec" },
  "model": { "declared": "claude-opus-5", "endpoint": "proxy" },
  "reasoning": { "effort": "default" },
  "permissions": "skip",
  "instructions": "none",
  "preset": null,
  "skills": { "pack": null },
  "home": { "sha": "4b329f9ebe6c7aa19339da9ac46cd90506af3e92d73713c8339966be071b4a74" },
  "env": { "keys": ["ANTHROPIC_BASE_URL"] }
}
```

### 6.3 dataseek.condition-lock/1 —— 条件的实物记录

`sha` 是条件哈希（§6.5），由 `dsh-eval conditions hash` 回算；`home.sha` 是 provision（I4）配出的 scoped home 内容哈希。plan 不写 sha——它写条件 id（§6.4），sha 从本文件解析；缺 lock 即「未就绪」。声明与实物不符（lock 落后于条件文件、`home.sha` 对不上）由 validate 以 warning 列出，就绪检查拦截。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "dataseek.condition-lock/1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema",
    "condition",
    "sha"
  ],
  "properties": {
    "schema": {
      "const": "dataseek.condition-lock/1"
    },
    "condition": {
      "type": "string",
      "description": "The condition id this lock was computed from."
    },
    "sha": {
      "type": "string",
      "description": "The condition hash at lock time; plans resolve their shas here."
    },
    "home": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "sha"
      ],
      "description": "Present once provision has materialized the scoped home.",
      "properties": {
        "sha": {
          "type": "string"
        }
      }
    }
  }
}
```

```json
{
  "schema": "dataseek.condition-lock/1",
  "condition": "claude-exec",
  "sha": "fb2bd2b2417d2c2f52b7fb3b133765e1a439ed89e318d685d20a014fa4632671",
  "home": { "sha": "4b329f9ebe6c7aa19339da9ac46cd90506af3e92d73713c8339966be071b4a74" }
}
```

### 6.4 dataseek.plan/1 —— 一次 run 的全部输入

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "dataseek.plan/1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema",
    "dataset",
    "conditions",
    "reps",
    "stages",
    "order",
    "budget",
    "expectedNs"
  ],
  "properties": {
    "schema": {
      "const": "dataseek.plan/1"
    },
    "dataset": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "repo",
        "commit",
        "id",
        "items"
      ],
      "description": "What is being tested against. commit: null means the snapshot pins it at run start.",
      "properties": {
        "repo": {
          "type": "string"
        },
        "commit": {
          "type": [
            "string",
            "null"
          ]
        },
        "id": {
          "type": "string"
        },
        "items": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    },
    "conditions": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Condition IDs (file names), not hashes; hashes resolve from conditions/<id>.lock.json."
    },
    "reps": {
      "type": "integer",
      "description": "Independent samples per cell; each rep is its own mission."
    },
    "stages": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Stage names, each backed by schemas/<stage>.json."
    },
    "order": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "seed",
        "interleave"
      ],
      "description": "Execution order; the seed is recorded with the run (frozen decision 11).",
      "properties": {
        "seed": {
          "type": "integer"
        },
        "interleave": {
          "type": "boolean"
        }
      }
    },
    "budget": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "activeMinutes",
        "turns"
      ],
      "description": "Per-cell budget in active minutes (not wall clock) and delegation turns.",
      "properties": {
        "activeMinutes": {
          "type": "number"
        },
        "turns": {
          "type": "integer"
        }
      }
    },
    "judge": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "conditions",
        "samples"
      ],
      "description": "Optional. The judge is itself a condition; absent judge means no LLM judging this run.",
      "properties": {
        "conditions": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "samples": {
          "type": "integer"
        }
      }
    },
    "expectedNs": {
      "type": "array",
      "items": {
        "enum": [
          "script",
          "llm-draft",
          "human-final"
        ]
      },
      "description": "Verdict sources this run expects; the report marks the missing ones honestly."
    },
    "notes": {
      "type": "string",
      "description": "Review commentary; not part of any hash."
    }
  }
}
```

- `conditions` 与 `judge.conditions` 写**条件 id**（文件名），不写 sha；sha 由校验器从 `conditions/<id>.lock.json` 解析并随 run.meta 记录。
- `judge` 可整个缺省：缺省时 `expectedNs` 不得含 `llm-draft`（validate 交叉检查）。judge 在场但 `samples: 0` 是合法的「本 run 无 LLM 判定」，此时 llm-draft 在报告里如实缺失。
- 判官不得是选手：`judge.conditions` 与 `conditions` 的交集必须为空（validate 报 error）。
- plan **不含 template 字段**：run 模板是题集 manifest 的确定性函数，validate 时生成、lint，随 plan 一起审阅（I2）。
- `dataset.commit` 为 `null` 表示「run 启动时由 snapshot 钉入」，run.meta 记实际值。
- 例：

```json
{
  "schema": "dataseek.plan/1",
  "dataset": { "repo": "~/dataseek", "commit": null, "id": "harness-comparison", "items": ["F2-multi-agent-room", "F3-self-restart-report"] },
  "conditions": ["codex-exec", "claude-exec"],
  "reps": 3,
  "stages": ["stage1", "stage2"],
  "order": { "seed": 42, "interleave": true },
  "budget": { "activeMinutes": 60, "turns": 10 },
  "judge": { "conditions": ["judge-claude"], "samples": 2 },
  "expectedNs": ["script", "llm-draft", "human-final"],
  "notes": "commit 在 run 启动时由 snapshot 钉入；conditions 与 judge.conditions 都写条件 id，sha 由 conditions/<id>.lock.json 解析。"
}
```

### 6.5 dataseek.verdict/1 —— 判定输出

探针脚本与判官都按它输出；编排器写进对应 ns（`script` / `llm-draft` / `human-final`），报告按它做表。`by` 记录判定来源：探针路径、判官条件、或判官台。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "dataseek.verdict/1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema",
    "task",
    "criterion",
    "pass",
    "evidence",
    "by"
  ],
  "properties": {
    "schema": {
      "const": "dataseek.verdict/1"
    },
    "task": {
      "type": "string"
    },
    "criterion": {
      "type": "string"
    },
    "pass": {
      "type": "boolean"
    },
    "evidence": {
      "type": "string",
      "description": "A checkable fact, not an opinion."
    },
    "by": {
      "type": "string",
      "description": "Where the verdict came from: probe path, judge condition, or the judge bench."
    }
  }
}
```

```json
{
  "schema": "dataseek.verdict/1",
  "task": "F2-multi-agent-room",
  "criterion": "R3",
  "pass": true,
  "evidence": "quorum 在 12:04:11 达成：3/3 成员发出 arrival 事件（probes/dispatch-trace.mjs）",
  "by": "probes/dispatch-trace.mjs"
}
```

### 6.6 哈希规则与阶段 schema

- **条件哈希** = 规范化 JSON（键全排序、无空白）的 sha256，小写十六进制。`notes` 是评审注释，**不参与哈希**——改注释不是换条件；其余任何字段变化都产生新哈希。同一输入两次计算必然一致。
- **home.sha** = scoped home 目录内容哈希。只取配置类文件（`.json .jsonc .yml .yaml .toml .ini .cfg .conf .xml .properties` 后缀），按相对路径字节序排序后，对 `<relPath>\0<content>\0` 逐文件喂入 sha256。**拒绝清单**：名为 `auth.json`、`.env*` 的文件；文件名含 `token` / `key` / `credential` / `secret` / `password` / `auth`（不分大小写）的文件；`credentials/`、`oauth/`、`sessions/`、`keys/`、`secrets/` 目录整棵跳过；符号链接、非常规文件与超大文件（> 1 MiB）跳过。文件内容只进摘要，**绝不读入日志、绝不打印**。
- **阶段 schema**：阶段的 structured schema 以题集级 `schemas/<stage>.json` 为权威（JSON Schema 子集：`type` / `required` / `properties` / `items` / `if` / `then` / `const` / `enum` / `additionalProperties`）。mission 的 schema-check 守卫与 `dsh-eval validate` 只认这个子集，出子集即 error。题集 manifest 的 `output_schema` 改为**引用文件名**，不再内联 schema，自创的 `type: enum` 记法与 markdown 记法废弃；题库侧的迁移由后续任务执行。
