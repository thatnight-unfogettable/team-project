# AGENTS.md —— 本项目的 agent 协作规则

> **放置位置**：项目仓库根目录（`AGENTS.md`）。每个成员机器上的 agent 开新会话时会自动读到它。
>
> **每个人只需要改本节的 3 个字段**（下面第 1 节），其余内容 4 个人完全一致，**不要各自改动**（要改就由 lead 改并提交，大家 pull）。

---

## 0. 我需要改的只有这 3 行

| 字段 | 说明 | 例子 |
|---|---|---|
| `huang` | 你的 agent id（relay 里的身份，必须和 token 对应） | `jiang` |
| `lead` | `lead` 或 `member` | `member` |
| `docs/,README.md,config/` | 你**只能改**的路径（逗号分隔） | `src/backend/` |

改完检查一遍：`hub whoami` 打印的 id 必须和 `huang` 一模一样。

---

## 1. 我是谁

- 成员名（agent id）：`huang`
- 角色：`lead`
  - `lead`：拆任务、答疑、复核、**唯一有权合并 main 的人**
  - `member`：领任务、实现、自测、汇报
- 我的写作用域（**只准改这些路径**）：`docs/,README.md,config/`
- 我的分支：`feat/huang`

### 4 人分工表（由 lead 在本节维护，成员按自己的行执行）

| agent id | 角色 | 写作用域 | 主要交付 | 测试命令 |
|---|---|---|---|---|
| `huang` | lead | `docs/`, `README.md`, `config/` | 接口定义、拆任务、合并 main、验收 | 见第 10 节 |
| `jiang` | member | `src/backend/` | 后端接口实现 | 见第 10 节 |
| `xu` | member | `src/frontend/` | 前端页面与交互 | 见第 10 节 |
| `li` | member | `src/core/`, `tests/` | 核心逻辑 + 测试 | 见第 10 节 |

> 这张表是**边界约定**，不是能力限制。要跨 scope 改东西，走第 3 节第 2 条。

---

## 2. 协作总线（跨机器通信）

所有跨机器通信都走 **agent-hub relay**，不走人肉转述、不依赖任何 IM 群、不靠"谁喊一声"。

- 服务地址与 token：`~/.dsh-hub/config.json`（或环境变量 `HUB_URL` / `HUB_TOKEN`）
- CLI：`hub.cmd`（Windows）/ `hub.sh`（Linux/macOS）
- 收件游标：`~/.dsh-hub/cursor`，`hub inbox` 会自动推进，不会重复

**每次开始干活前，第一件事就是 `hub inbox`。**

---

## 3. 铁律（违反会直接阻塞整个项目）

1. **绝不直接 push `main`**。只 push 自己的 `feat/huang`，合并由 lead 做。
2. **只改自己的写作用域**。需要改别人的文件 → 先 `hub send --to <owner> --kind question`，等确认再动。
3. **动手前先 `git pull --rebase`**，收工时 `git push`。冲突自己解决不了 → 发 `blocker`，别硬推。
4. **领任务必须走 CAS**：`hub claim <id> --rev <n>`。收到 `REVISION_CONFLICT` 就重新 `hub task <id>` 再决定，**绝不重试同一个 rev**。
5. **消息必须可执行**：带任务号、分支名、commit、下一步。不写"我在弄了"这种无信息量的话。
6. **不伪造进度**：没跑通的不要说 done；`done` 必须带 summary 说明**怎么验证的**。
7. **不外泄 token**：不把 `~/.dsh-hub/`、`data/hub.db`、`*.token` 提交进仓库。
8. **同一问题失败 2 次就停**：发 `blocker` 给 lead，附报错原文。空转比卡住更浪费。

---

## 4. 每一轮的工作循环

```bash
# 0) 同步
git pull --rebase
hub inbox                       # 有新消息先处理（可能被重新指派/要求改方案）

# 1) 认领任务
hub tasks                       # 看有哪些 pending
hub task Txxxx                  # 看详情和当前 revision
hub claim Txxxx --rev 1         # 拿到立即 claim，避免撞车

# 2) 干活
git checkout -b feat/huang   # 首次创建，之后复用同一分支
#    ... 只改 docs/,README.md,config/ 内的文件 ...
#    ... 跑测试 ...

# 3) 提交推送
git add -A
git commit -m "feat(<scope>): <做了什么> (Txxxx)"
git push -u origin feat/huang

# 4) 汇报收尾
hub send --to huang --kind done --task Txxxx --body "Txxxx 完成：<结论>；分支 feat/huang @ <sha>；验证：<命令与结果>"
hub done Txxxx --rev 2 --summary "已实现并自测通过，等待合并"
```

> 报 `done` 前先自问：**别人能凭这条消息复现我的验证吗？** 不能就补上命令和结果。

---

## 5. 消息类型

| kind | 什么时候用 | 必带内容 |
|---|---|---|
| `status` | 进度同步（里程碑、阶段完成） | 结论 + 分支/commit + 下一步 |
| `question` | 需要别人决策才能继续 | 问题 + 我的建议方案 + 需要谁回答 |
| `blocker` | 真卡住（缺权限/接口未就绪/依赖缺失） | 卡点 + 已尝试 + 需要谁做什么 |
| `decision` | 我定了接口/架构，广播全员 | 决定 + 理由 + 影响面 |
| `review` | 请求复核 | 分支 + 改了什么 + 重点看哪里 |
| `done` | 任务完成 | 任务号 + 验证方式 |

- 点名：`--to jiang`
- 全员广播：`--to all`
- 关联任务：`--task Txxxx`（方便以后按任务追溯）

---

## 6. 任务板规则

- 任务由 **lead** 建（`hub new-task`）；成员可以为自己发现的子任务建，但要带 `--scope` 标明归属。
- 认领：`hub claim <id> --rev <n>`；被别人占了返回 `TASK_TAKEN`。
- 依赖：`hub block <id> --rev <n> --by T1,T2`（依赖完成后 lead 解除）。
- 完成：`hub done <id> --rev <n> --summary "..."`。
- 拿到 `409 REVISION_CONFLICT` = 有人先改了 → **重新读再操作**。

**任务粒度**：一个任务 = 一个人 0.5~2 天能完成的、可独立验证的成果。太大就拆，太小就合并。

---

## 7. Git 协作

- 分支：`feat/huang`（长期复用，不要每个任务新建分支）
- 提交信息：`type(scope): 摘要 (Txxxx)`，type ∈ `feat` / `fix` / `refactor` / `test` / `docs` / `chore`
- 提交前必须能跑通项目测试命令（见第 10 节）
- 冲突原则：**自己 scope 内的冲突自己解**；跨 scope 冲突找 lead 裁决
- 合并：**只有 lead** 把 `feat/*` 合进 `main`；member 不要 `merge main`，需要新代码就 `git rebase origin/main`
- 每个 PR 描述要写：任务号、改了什么、怎么验证、有风险的地方

---

## 8. 求助与停止条件

- 同一问题失败 **2 次** → 停下来发 `blocker`，别试第 3 次
- 需要改自己 scope 外的文件 → 发 `question`
- 连续 3 轮（约 30 分钟）没进展 → 主动上报，不要空转
- 收到 lead 的 `decision` → 无条件按新决定执行；有异议**先执行再提问**
- 收到 `review` 意见 → 当轮改完，不要攒着

---

## 9. 命令速查

```bash
hub health                                     # 服务是否活着
hub whoami                                     # 我是谁（身份自检）
hub agents                                     # 成员列表与最后在线
hub inbox                                      # 收消息（自动推进游标）
hub inbox --wait 25                            # 长轮询：有消息立刻返回
hub send --to huang --kind status --body "..."  # 发消息
hub tasks                                      # 任务列表
hub tasks --status pending                     # 只看待领
hub task Txxxx                                 # 任务详情（看 revision）
hub new-task --title "..." --desc "..." --scope "src/backend/"
hub claim Txxxx --rev 1
hub block Txxxx --rev 2 --by Tyyyy
hub done  Txxxx --rev 2 --summary "..."
```

> 网络不稳时：`send` 带 `client_id` 幂等，重试不会产生重复消息。

---

## 10. 项目约定（lead 维护）

- **技术栈**：`<待填：例如 Python 3.11 + FastAPI + React>`
- **目录结构**：

```
<待填，例如>
src/
  backend/     jiang
  frontend/    xu
  core/        li
tests/         li
docs/          huang
```

- **测试命令**：`pytest -q`
  - 全员一致；提交前必须本地跑通
  - 跑不通就别 push，先发 `blocker`
- **代码风格**：`<待填：例如 black + ruff / prettier + eslint>`
- **接口先行**：跨模块接口由 lead 在 `docs/API.md` 定义并广播 `decision`；接口变了必须立刻广播，否则别人会按旧接口写
- **数据/配置**：不进仓库的敏感文件列在 `.gitignore`；示例配置放 `config/*.example`

---

## 11. 开工前 60 秒自检

```bash
hub health          # 1. relay 活着
hub whoami          # 2. 身份对（id 与本文第 1 节一致）
git branch          # 3. 在 feat/huang 上，不在 main 上
git status          # 4. 没有意外改动
hub inbox           # 5. 没有漏读的指令
```

五项都正常再动手。任何一项异常，先解决再干活。