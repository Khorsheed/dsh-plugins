# 数据集作者协议（Dataset Authoring Protocol）

**Version: v1-rev10** · [English](dataset-authoring-protocol.en.md)

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
  "canary": "dsh-canary:harness-comparison:6f2a13c8-5d4b-4e77-9a10-2c8be5d4f031",
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
- `canary` 可选：一个全局唯一字符串，建议格式 `dsh-canary:<dataset-id>:<uuid>`。声明之后，可见层（`modelFacing: true`，题集级与 item 级都算，register 归位的文件按其角色层算）里的每个文本文件都必须逐字包含它；缺的文件由 `validate` 逐条报 `CANARY_MISSING`（见 §5）。它的用途是泄题取证：日后在某个模型的输出里搜到这个串，就证明本题库进过它的训练语料。插件只校验，从不生成也从不注入金丝雀——串由作者自己造、自己埋。
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
- `CANARY_MISSING`：声明了 `canary` 的数据集里，某个可见层的文本文件没有包含该串。文本按扩展名白名单判定：`.md` / `.txt` / `.yml` / `.yaml` / `.json` 与无扩展名的文件；其余（图片、压缩包等）跳过，`modelFacing: false` 的层与 item.json 也不在检查范围。未声明 `canary` 的数据集完全不做此检查；这是唯一读文件内容的检查，因而只在 `validate` 上跑，不进 list/show 的摘要。
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
    "scope": {
      "type": "string",
      "description": "Optional. The harness scoped home this condition runs against, as a NAME (matching [a-z0-9-], never a path): the family resolves it to <homesRoot>/<harness>@<scope>, a sibling of the default scoped home with its own credentials, session records and delegation mappings. Absent means the harness's default scoped home — what every condition written before this field says. It IS part of the condition hash: two conditions differing only in scope are two subjects, because they log in as two accounts."
    },
    "unit": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "scopedHome"
      ],
      "description": "Optional. What this condition needs INSIDE a container unit. Required of every condition a plan with a unit segment names; absent on the host path. It IS part of the condition hash: where a subject reads its credentials from is a factor, not a comment.",
      "properties": {
        "scopedHome": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "container",
            "var"
          ],
          "description": "The condition's scoped credential directory as the UNIT sees it. The host side is never written here: the orchestrator mounts the evaluation instance's own scoped home for that harness — the directory /<harness> login writes into, and the one the delegation read-back reads.",
          "properties": {
            "container": {
              "type": "string",
              "description": "Absolute in-container mount point, e.g. /creds/codex."
            },
            "var": {
              "type": "string",
              "description": "The variable naming it inside the unit (CODEX_HOME / CLAUDE_CONFIG_DIR / KIMI_CODE_HOME / DSH_HOME); must also appear in env.keys."
            }
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
- `model.declared` 是**请求值**，不只是声明（T30b）。它非 null 时，编排器把它作为委派级 `model` 传给 local-agent，由后者落成各家 CLI 的模型参数——选手轮、判官委派、就绪探测三处一致。`null` 仍是「未解析」，仍不传任何模型参数、由 harness 自己的配置决定。请求之后照旧回读比对：请求了 X 却跑了 Y，仍然是 MisattributedRun。契约形状没有改变，改的是这个字段从「只用来核对」变成「先请求，再核对」。
- `permissions` 的词表按 harness 给定：`dsh` → `unrestricted`；`claude-code` → `skip` 或 `normal`；`codex` → `danger-full-access`、`workspace-write`、`read-only`；`kimi` → `auto-approve`。schema 枚举是并集；已知 harness 的越表取值（如 dsh 配 `skip`）由校验器报 error。
- `env.keys` 只写变量名。任何值——尤其凭证——不得进契约文件。
- `scope` 可缺省，缺省即「跑该家的缺省作用域目录」——本字段出现之前每条条件的含义。写了名字（只允许 `[a-z0-9-]`，是名字不是路径）就改成跑 `<homesRoot>/<家名>@<scope>`：与缺省目录**同级**的另一份目录，各自登录、各自的会话记录、各自的 `delegations.jsonl`，凭证**不复制**。它进条件哈希：两条只差 `scope` 的条件是**两个受试对象**——登录的是两个账号。同一家两条条件因此可以在模型、推理强度之外再差一次登录（I4 的 T30b/T31/T33 要的正是这个）。就绪检查按各自的 scope 探各自的目录；容器轮挂的也是各自的目录。带 scope 的委派只走 exec（live 驱动绑的是缺省目录），kimi 的成员桥同理只绑缺省目录。
- `preset` 只对**由本家族组出来的**受试对象有意义。今天只有 `dsh` 一家：它的作用域目录里那份子 profile 是评测实例自己写的，preset roster 也写在那份 patch 里。三家外部 CLI 跑的是各自厂商的编排，本家族组不了——给它们写 `preset` 是一句没有对应物的声明，validate 报 error（`PRESET_NOT_FOR_HARNESS`），只能写 `null`。它们那一侧的等价物是 `skills.pack`（技能包物化进作用域目录），本家族同样尚未落地，留 I6。
- `preset` 非 null 时，lock 里必须有 `provisioned.capabilities`：capability-catalog 对那份已配好的环境算出的**能力哈希**（规范形取技能的 name/source/正文 sha 与工具的 name/channel/parameters——描述措辞不进，改一次文案不该换一个受试对象）。没有它，就绪检查在花掉任何一次委派之前就拒（`CAPABILITIES_NOT_PROVISIONED`）：preset 进条件哈希，两条只差 preset 的条件是两个受试对象，没人量过就只是纸面上的两个。记录里的 preset 与声明不一致同样拒——配出来的是另一个受试对象。
- `unit` 可缺省，缺省即「本条件只在宿主上跑」。plan 声明了 `unit` 时它**必须在场**：`unit.scopedHome` 说这条件的凭证目录挂到容器内的哪里、由哪个变量指向它（`CODEX_HOME` / `CLAUDE_CONFIG_DIR` / `KIMI_CODE_HOME` / `DSH_HOME`），`var` 必须同时出现在 `env.keys` 里——注入的名字要跟声明的名字一致，validate 报 error。宿主一侧的目录**不写在这里**：编排器挂的是评测实例自己的该家作用域目录——`/<家> login` 写进去的那个，也是委派回读读的那个。挂副本会静默坏掉：容器轮把 rollout 写进挂进去的那个目录，回读却按 `homeDir(家名)` 去找，两者不是一处时不报错，只是永远读不到。
- `unit` 进条件哈希（只有 `notes` 不进）：受试对象从哪里读凭证是一项因子，不是注释。给既有条件补 `unit` 会改哈希，lock 随之过期，要重新 provision。
- 例（已全部解析；I1 手写格的「进行中」形态见题库 `conditions/dsh-exec.json`，四个 null 字段以 warning 列出）：

```json
{
  "schema": "dataseek.condition/1",
  "harness": {
    "name": "claude-code",
    "version": "2.1.236",
    "drive": "exec"
  },
  "model": {
    "declared": "claude-opus-5",
    "endpoint": "proxy"
  },
  "reasoning": {
    "effort": "default"
  },
  "permissions": "skip",
  "instructions": "none",
  "preset": null,
  "skills": {
    "pack": null
  },
  "home": {
    "sha": "4b329f9ebe6c7aa19339da9ac46cd90506af3e92d73713c8339966be071b4a74"
  },
  "env": {
    "keys": [
      "ANTHROPIC_BASE_URL",
      "CLAUDE_CONFIG_DIR"
    ]
  },
  "unit": {
    "scopedHome": {
      "container": "/creds/claude",
      "var": "CLAUDE_CONFIG_DIR"
    }
  }
}
```

### 6.3 dataseek.condition-lock/1 —— 条件的实物记录

`sha` 是条件哈希（§6.5），由 `dsh-eval conditions hash` 回算；`home.sha` 是 provision（I4）配出的 scoped home 内容哈希。plan 不写 sha——它写条件 id（§6.4），sha 从本文件解析；缺 lock 即「未就绪」。声明与实物不符（lock 落后于条件文件、`home.sha` 对不上）由 validate 以 warning 列出，就绪检查拦截。

`provisioned` 记的是 provision **实际配出来的东西**，与条件文件里的声明相对：`provisioned.preset` 从写出去的子 profile 回读，`provisioned.capabilities.sha` 是 capability-catalog 对那份环境算的能力哈希（`caps:<sha>` 去掉前缀）。声明是一句话，这一段是那句话的对应物——`preset` 字段从此可核对，而不是只能相信。

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
    },
    "provisioned": {
      "type": "object",
      "additionalProperties": false,
      "required": [],
      "description": "What provision actually built, as opposed to what the condition declares. Present once provision has run.",
      "properties": {
        "preset": {
          "type": [
            "string",
            "null"
          ],
          "description": "The preset the provisioned environment composes — read back from what was written, not copied from the declaration."
        },
        "capabilities": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "sha"
          ],
          "description": "The capability fingerprint of the provisioned environment: the hash capability-catalog computes over its canonical skill/tool face (caps:<sha>). It is what turns the condition's `preset` claim into a checkable fact.",
          "properties": {
            "sha": {
              "type": "string",
              "description": "64-hex sha256 of the canonical capability face."
            },
            "preset": {
              "type": [
                "string",
                "null"
              ],
              "description": "The preset the snapshot was taken under."
            },
            "skills": {
              "type": "integer",
              "description": "How many skills the face carries (a reader aid; the sha is the identity)."
            },
            "tools": {
              "type": "integer",
              "description": "How many tools the face carries (a reader aid; the sha is the identity)."
            }
          }
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

子 dsh 的条件长这样——`provisioned` 是 provision 写下的实物，`capabilities.sha` 即 `caps:` 标签去掉前缀：

```json
{
  "schema": "dataseek.condition-lock/1",
  "condition": "dsh-exec-lean",
  "sha": "6d2e4f1b8c9a0731e5b4d6a2c8f3097b1e4a5d6c7b8a9012f3e4d5c6b7a80912",
  "home": {
    "sha": "9a1c3e5b7d9f0246810a2c4e6081a3c5e709b1d3f507192a3c5e7091b3d5f709"
  },
  "provisioned": {
    "preset": "eval-lean",
    "capabilities": {
      "sha": "2f8b6d40c1a9573e08b2d4f6a8c0e2941b3d5f7092a4c6e80b1d3f5709a2c4e6",
      "preset": "eval-lean",
      "skills": 3,
      "tools": 11
    }
  }
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
    "retry": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "infrastructure"
      ],
      "description": "Optional. Per-cell infrastructure-retry budget (spawn failures, facade errors, timeouts). Run-call options may override.",
      "properties": {
        "infrastructure": {
          "type": "integer",
          "description": "Maximum infrastructure retries per cell; 0 disables retrying. Default 1."
        }
      }
    },
    "exports": {
      "type": "string",
      "description": "Optional. Bundle export directory (~/… allowed); default <dataset repo>/exports. Run-call options may override."
    },
    "unit": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "image"
      ],
      "description": "Optional. Present, every cell of this run executes inside one lab unit built from this image; absent, the run takes the host path unchanged. validate does not probe the docker daemon (it need not be reachable to review a plan) — the first acquire is the check.",
      "properties": {
        "image": {
          "type": "string",
          "description": "Image tag or digest of the dataset suite's env/ layer."
        },
        "network": {
          "type": "string",
          "description": "Docker network the units join. Undeclared is docker's default bridge, which HAS egress — a sealed run must name its internal network."
        },
        "user": {
          "type": "string",
          "description": "In-container user (uid[:gid]); undeclared is the image's own USER."
        },
        "resources": {
          "type": "object",
          "additionalProperties": false,
          "description": "CPU and memory ceilings; applied to the unit and hashed into its environment fingerprint.",
          "properties": {
            "cpus": {
              "type": [
                "string",
                "number"
              ]
            },
            "memory": {
              "type": [
                "string",
                "number"
              ]
            }
          }
        }
      }
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
- `retry.infrastructure` 与 `exports` 都可缺省：前者是每格的基础设施重试预算（spawn 失败、facade 报错、超时），缺省 1，`0` 表示不重试；后者是 bundle 导出目录（允许 `~/…`），缺省 `<题库仓库>/exports`。两者都是**被审阅的默认值**，run 调用选项（`retryInfrastructure` / `exportsDir`）可覆盖——审阅看 plan，临时跑法看选项。
- plan **不含 template 字段**：run 模板是题集 manifest 的确定性函数，validate 时生成、lint，随 plan 一起审阅（I2）。
- `dataset.commit` 为 `null` 表示「run 启动时由 snapshot 钉入」，run.meta 记实际值。
- `unit` 可缺省。缺省即**宿主路径**：格子目录在 `$DSH_HOME/state/eval` 下，与容器无关，与本字段出现之前逐字节相同。在场即**容器路径**：本 run 的每一格都在一个由 `image` 建出的 lab 单元里跑完 acquire → populate → 逐阶段委派与 checkpoint → 探针（经 `lab.verify` 在单元内）→ archive → release。`network` 不声明就是 docker 默认网桥（**有外网**），封闭跑法必须点名内网；`user` 不声明就是镜像自带的 `USER`；`resources` 既真加到容器上，也进环境指纹。
- validate **不查镜像是否存在**：审阅一份 plan 不该要求 docker daemon 在场。第一次 `acquire` 就是这项检查。
- 例：

```json
{
  "schema": "dataseek.plan/1",
  "dataset": {
    "repo": "~/dataseek",
    "commit": null,
    "id": "harness-comparison",
    "items": [
      "F2-multi-agent-room",
      "F3-self-restart-report"
    ]
  },
  "conditions": [
    "codex-exec",
    "claude-exec"
  ],
  "reps": 3,
  "stages": [
    "stage1",
    "stage2"
  ],
  "order": {
    "seed": 42,
    "interleave": true
  },
  "budget": {
    "activeMinutes": 60,
    "turns": 10
  },
  "unit": {
    "image": "eval-env:pinned",
    "network": "eval-net",
    "user": "1000",
    "resources": {
      "cpus": "2",
      "memory": "4g"
    }
  },
  "judge": {
    "conditions": [
      "judge-claude"
    ],
    "samples": 2
  },
  "expectedNs": [
    "script",
    "llm-draft",
    "human-final"
  ],
  "retry": {
    "infrastructure": 1
  },
  "exports": "~/dataseek/exports",
  "notes": "commit 在 run 启动时由 snapshot 钉入；conditions 与 judge.conditions 都写条件 id，sha 由 conditions/<id>.lock.json 解析。retry 与 exports 是 run 的默认值，run 调用选项可覆盖。unit 在场即容器路径：每格一个单元，挂的是评测实例自己的该家作用域目录，不写进本文件。"
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
    "ratio": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "passed",
        "total"
      ],
      "description": "Optional partial credit for a proportional criterion (rubric 的「按比例给分」). pass stays the boolean fact — the criterion FULLY holds — and ratio refines it; a reader that ignores ratio degrades to the strict boolean, never upward.",
      "properties": {
        "passed": {
          "type": "integer"
        },
        "total": {
          "type": "integer"
        }
      }
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

**`ratio` —— 按比例给分的判据。** 有些判据天生不是二值的：F2 / F3 的 `C1`（core 标准通过条数）、`C2`（bonus 标准通过条数）在 rubric 里就写着「按比例给分」。这类判定带一个可选的 `ratio: {passed, total}`：

```json
{
  "schema": "dataseek.verdict/1",
  "task": "F2-multi-agent-room",
  "criterion": "C1",
  "pass": false,
  "ratio": {
    "passed": 6,
    "total": 9
  },
  "evidence": "core 标准 R1 R2 R3 R5 R6 G1 通过，R4 R7 B2 未过（../verify/ 判定结果）",
  "by": "probes/standards-run.mjs"
}
```

规矩三条：

- **`ratio` 细化 `pass`，不取代它。** `pass` 仍是那个布尔事实——**判据完整成立**，对比例判据即 `passed === total`。读不懂 `ratio` 的消费者退回严格布尔，只会低估、绝不会高估。
- **比例是字段，不是措辞。** 判定方**不得**把比例编进 `evidence` 前缀（`通过 6/9 …` 这类）——那样每个消费者都得去解析散文，而散文一改，解析就静默错位。`evidence` 仍写可查证的事实（哪几条过、哪几条没过、从哪儿查），比例的**数值**只走 `ratio`。
- **分母是判定方看到的分母。** `total` 是本次实际参与判定的条数：rubric 允许排除的条目（如 `skipped_standards` 里选手明确排除并给出理由的）不进分母，`ratio` 记的就是扣除之后的数——防稀释是判定方的责任，报告不再二次换算。

报告（`dsh-eval report`）据此按比例计分：带 `ratio` 的判据贡献 `passed / total` 而不是 1/0（负向判据则贡献 `1 − passed / total`），加权分同理按比例乘 `weight`。`total <= 0` 或 `passed` 越界的比例按缺失处理，退回布尔——坏数据不该悄悄变成一个分数。

**极性不在 verdict 里，在 rubric 里。** `pass` 恒为「**判据成立**」，与 criterion 的字面一致，永远不表示「做得好」。负分判据的 criterion 写的是缺陷（「tradeoff 中出现 worth-the-cost」「把协议知识推给用户」），成立即缺陷存在。所以判据的极性是**判据的属性**，唯一来源是该题 grading 层 rubric 的叶子：`negative: true`（`weight` 为负与之等价；两者不一致由 `dsh-eval validate` 报错）。

这条边界是刻意的，理由有三：

- **判定方不做解释。** 探针与判官只回答「这条判据成不成立」——一个能就地核对的事实。让它们自行取反，等于把评分策略埋进两个各自独立、还会被换掉的实现里；同一条判据在探针和判官口中会得出相反的 `pass`，而两边都自称如实。
- **契约不该随记分方式变。** verdict 是判定的**记录**，不是分数。加字段（`negative`、`score`、`polarity`）会让同一事实有两个说法，且注解一旦落盘就不可改——记分口径改一次，历史 verdict 全部作废。
- **极性是题库的编辑决定。** 一条判据是奖是罚由出题人写在 rubric 里，与它被判过几次无关；rubric 随 run 的 commit 一同冻结，因此每条历史判定都能取回它当时的极性。

报告据此计分（`dsh-eval report`）：主轴是**得分判据数**——正向判据成立计 1，负向判据成立计 0、不成立计 1；加权分 = 成立判据的 `weight` 之和，负 `weight` 自然扣分，不需要第二条规则。摘要单列「负向判据命中」表（哪格、哪条、证据）——那才是读者要的缺陷清单。

**权重表随 bundle 走。** rubric 住在 `modelFacing: false` 的 grading 层，run 的自动导出只收可见层（§3，泄题闸是对的），因而自包含 bundle 里读不到极性与权重。导出时便从 grading 层**派生**一份权重表写进 bundle 的 `report/rubric-weights.json`：

```text
{ "schema": "dataseek.rubric-weights/1",
  "dataset": <题集 id>, "commit": <冻结 commit>,
  "tasks": [<有 rubric 的题>],
  "criteria": [ { "task", "id", "weight", "negative", "kind", "axis" }, … ] }
```

只有编号与数字：**不含 criterion 文字、不含 evidence、不含 note**，因而不经泄题闸；可执行的探针与 rubric 全文仍不进 bundle。表缺席时报告行为不变（只出计数），但会明确打印「极性未知，计数按正向处理」并把负向判据数记为 unknown——**不把「无从判断」显示成「没有缺陷」**。

### 6.6 哈希规则与阶段 schema

- **条件哈希** = 规范化 JSON（键全排序、无空白）的 sha256，小写十六进制。`notes` 是评审注释，**不参与哈希**——改注释不是换条件；其余任何字段变化都产生新哈希。同一输入两次计算必然一致。
- **home.sha** = scoped home 目录内容哈希。只取配置类文件（`.json .jsonc .yml .yaml .toml .ini .cfg .conf .xml .properties` 后缀），按相对路径字节序排序后，对 `<relPath>\0<content>\0` 逐文件喂入 sha256。**拒绝清单**：名为 `auth.json`、`.env*` 的文件；文件名含 `token` / `key` / `credential` / `secret` / `password` / `auth`（不分大小写）的文件；`credentials/`、`oauth/`、`sessions/`、`keys/`、`secrets/` 目录整棵跳过；符号链接、非常规文件与超大文件（> 1 MiB）跳过。文件内容只进摘要，**绝不读入日志、绝不打印**。
- **阶段 schema**：阶段的 structured schema 以题集级 `schemas/<stage>.json` 为权威（JSON Schema 子集：`type` / `required` / `properties` / `items` / `if` / `then` / `const` / `enum` / `additionalProperties`）。mission 的 schema-check 守卫与 `dsh-eval validate` 只认这个子集，出子集即 error。题集 manifest 的 `output_schema` 改为**引用文件名**，不再内联 schema，自创的 `type: enum` 记法与 markdown 记法废弃；题库侧的迁移由后续任务执行。

### 6.7 探针契约 —— script 判定怎么产生

`script` 是三个判定源里唯一确定性的一个，只由探针写。探针是可执行文件，后缀 `.mjs` 或 `.sh`，住在**任意 `probes/` 段**里（`probes/room-identity.mjs`、被 register 改过户的 `checks/probes/x.sh` 都算），来源有两处：

- **题内探针**——该题 verify 层下的，只判这道题；
- **题集级共享探针**——题集级 verify 层下的（`verify/helpers/probes/no-patch.sh` 这类），**对每道题各跑一次**。一条判据在每道题里都成立、判法也应当逐字相同（「没改宿主源码」「普通会话无污染」），这类判据只该有一把尺子；各题各写一份，严格程度会悄悄漂移。

**调用约定**（编排器在格子跑完阶段、进入 `judged` 后逐个执行）：

```text
<probe> --cell <格子目录> --rubric <rubric 路径> --out <verdicts.json>
```

| 参数 | 含义 |
|---|---|
| `--cell` | 选手的格子工作目录。探针**只读**它——判定不改被判定的东西 |
| `--rubric` | 该题 grading 层 rubric 的宿主副本路径。题目没有 rubric 时**不给这个参数** |
| `--out` | 探针把判定写到这个路径 |

**退出码就是契约，三个状态**：

| 退出码 | 状态 | 编排器怎么记 |
|---|---|---|
| `0` | **已判定**——包括判 `pass: false`，「做到了没有」和「探针能不能判」是两件事 | 判定进 `script` ns，outcome 记 `judged` |
| `3` | **本轮不适用**——探针没坏、判据也没不成立，只是这一轮的输入不在位（阶段三还没跑、harness 工作树不在格子里） | outcome 记 `probe-skipped`，附 stderr 首行；**不算失败** |
| 其余非 `0` | **探针失败**，本次不产生任何判定 | outcome 记 `probe-failed`，原因进 orchestrator ns |

第三态是必须的：没有它，一个只跑了阶段一二的 run 每格都会多出几条「探针失败」，噪声掩盖真的失败。**用 `3` 而不是 `2`**——`2` 是 getopt 传统里的「用法错误」码，探针参数给错时正是退 `2`，把它读成「判不了」等于把每一次误调用都咽下去。退出 `0` 却没写出可读的 `--out`，按**探针失败**记——它声称判了又拿不出可核对的东西。

**输出形状**是 §6.5 `dataseek.verdict/1` 的**数组**（只有一条时写成单个对象也接受）。按比例给分的判据写 `ratio: {passed, total}`，**不把比例写进 `evidence` 前缀**（§6.5）。`ratio` 的两条数值约束由编排器在**产出处**核，不符按「产物不合契约」记（与 schema 不过同一档，原因进 orchestrator ns）：

- `passed` / `total` 为整数，`total > 0`，`0 ≤ passed ≤ total`；
- `pass === (passed === total)`——`pass` 恒为「判据完整成立」，对比例判据即分子等于分母。两者互相矛盾时无从判断哪个是笔误。

报告侧（§6.5）对已落盘的数据同样兜底：越界的比例按缺失处理、退回布尔。两边都在——源头拦下的是能改的错，报告兜住的是已经写死的账。

**`task` 与 `by` 由编排器回填，回填在校验之前。** 探针自己写了也会被覆盖：这两项是编排器知道的坐标，判定方只是回声，写错会污染报告的每一次 join。**探针可以整个不写**——两项都是 `required` 且 schema `additionalProperties: false`，先校验后回填会把一份本来完整的判定判成废品，所以顺序是**先补、后校**；写了但与编排器不一致的，以编排器为准并把 `overwritten` 记进 orchestrator ns。`by` 的取值：题内探针 = 它在该题 verify 层的 display 路径（`probes/stage1-structure.mjs`）；题集级共享探针 = `shared/` + 它在题集级 verify 层的 display 路径（`shared/helpers/probes/no-patch.sh`）。`shared/` 是**命名空间不是目录**，它标出这条判定出自题集的尺子而非本题的，也让两个 `by` 空间永不相撞。

**执行环境**：编排器把**两个 verify 层都整层物化**进宿主临时目录，**相对布局与题库一致**——题集级层在 `<tmp>/verify/…`，该题的层在 `<tmp>/items/<题 id>/verify/…`。布局一致是这条的全部意义：题内探针用**在题库里同样成立的相对路径**（`../../../../verify/helpers/lib/x.mjs`）就能 import 到题集级共享库，一把尺子服务所有题，不必每题放一份会各自漂移的副本。

cwd 一律是**该题 verify 层的根**，共享探针也一样——共享探针是同一把尺子按题各量一次，它读到的 checklist 就该是这道题的那份。`.mjs` 交 node、`.sh` 交 `/bin/sh`，每个探针 5 分钟墙钟上限，跑完整个目录删除——verify 层是答案，不留过夜。I3 起这一步交给 `lab.verify` 在容器内执行，**契约不变**。

**落点**：判定写进 mission 的 `script` ns，并落到 `attempt-N/archive/verdicts/script.json`。两个层都没有探针就什么都不写——不写空文件，不写空注解。

### 6.8 判官契约 —— llm-draft 判定怎么产生

`llm-draft` 由**判官条件**写。判官本身是一份 `dataseek.condition/1`（§6.2），不是一个带工具的会话；plan 的 `judge` 块（§6.4）指定它与采样次数。三条方法论约束由编排器强制：

1. **判官不得是选手。** 校验器拒绝 id 出现在两边；编排器在开跑前再比一次 `(harness.name, model.declared)`——两个不同 id 指向同一个受试对象，仍是自己判自己。
2. **判前去指纹。** 送判材料（`stage1.json` / `stage1.md` / `stage2.json` / `stage2.md`）里的 harness 名、CLI 名、成员自报名字一律换成 `<harness>`，plan 各条件声明与回读到的模型标识换成 `<model>`。替换表与次数进 orchestrator ns；**材料原件不动**，判官看到的始终是副本。
3. **至少两次采样。** 每个判官条件独立跑 `judge.samples` 次（缺省 2），每次都是**全新委派**——续聊会让判官看见自己上一次的答案，那就不是独立样本了。报告据此给一致率与 Cohen κ。

**判官 prompt** 由编排器拼装，判官不自带提示词：该题 grading 层 rubric 里 `kind: llm-draft` 的判据（`objective` 归探针、`human` 归判官台，都不给判官看）+ 去指纹材料 + 输出要求。rubric 的选取规则是「grading 层 display 路径中文件名为 `rubric.yml` / `rubric.yaml` 者，多个取最短路径」——两种题目布局（约定式的 `rubric.yml` 与 register 改户的 `answers/rubric.yml`）都覆盖到。

**输出**与探针同形：判官把 §6.5 的数组写进自己 cwd 下的 `verdicts.json`，`task` 与 `by`（= 判官条件 id）由编排器回填，**回填顺序同 §6.7：先补后校**。读不出来就记 orchestrator ns 并**重试一次**，再失败该样本如实丢弃，不补造。

**落点**：每个样本一条 `llm-draft` 注解，形状 `{sample, judgeCondition, judgeSha, promptSha, verdicts}`——出处与判定放在一起，报告拆信封取 `verdicts`；同时落 `attempt-N/archive/verdicts/llm-draft-<判官条件>-<样本号>.json`。判官的用量与耗时记进 orchestrator ns 的 `kind: judge`，**不算进选手的效率表**。判官材料目录（prompt + 去指纹材料 + 判官的回答）在 run 结束后保留，供复核。

grading 层与 verify 层只经 datasets 服务面以**显式单层 scope** 读取（`layers: ['grading']` / `['verify']`），物化进宿主侧的判官目录与探针目录，**绝不进选手格子**。
