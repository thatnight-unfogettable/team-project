# AGENTS.md —— 凉径 · ShadeRoute Lite（单人 + AI agent 协作）

> **本文件是本仓库唯一的"协作与流程"权威**；数字/口径以 `docs/AGENTS-10.md` 为唯一权威。
> 两者冲突时：流程看本文件，数字看 `docs/AGENTS-10.md`，且必须当次修掉冲突。
> 适用基线：commit `b2b212d` 之后（2026-11-03 起）。

## 0. 一句话
中山大学广州校区南校园「热浪天走哪条路」决策工具：浏览器端纯静态、离线、零依赖；
数据由 `tools/build.py` 预计算成 `data/*.js`，页面只查表 + 现场跑 Dijkstra。

## 1. 事实清单（先看这张表，别再按任何模板假设）

| 项 | 事实 |
|---|---|
| 目录 | `content/ data/ docs/ js/ tools/` + `index.html` + `styles.css` |
| **没有** | `src/`、`tests/`、`config/`、`package.json` |
| 前端 | `js/{proj,core,iso,trees,plan,router,map,app}.js`（8 个），原生 JS + Canvas，经典 `<script>` |
| 工具链 | `tools/build.py`（零第三方依赖，13 个子命令）、`tools/smoke.js`、`console-check.js`、`dpr-check.js`、`preview.py`、`tools/ci/*` |
| 技术栈硬约束 | 无 npm / 无框架 / 无构建工具 / 无 CDN / 运行时零网络；`file://` 双击可用 |
| 数据 | `data/raw/*.json` = 原始抓取（**只读**）；`data/*.js` = **生成物**（`window.DATA_*`） |
| 测试 | `node tools/smoke.js`（219 条），退出码 0 才算过 |
| CI | **当前仓库没有工作流文件**（`.github/` 只剩 PR 模板）；要加 workflow 需 token 带 `workflow` scope（`gh auth refresh -s workflow`）。等价门禁：`node tools/smoke.js` + `python tools/ci/check_data.py` |
| 协作 | **单人 + 1~N 个 AI agent**；历史上写的 hub relay / 4 人分工 / pytest **全部作废** |
| 分支 | `main` 单分支；有第二个人/agent 长期参与时才开 `feat/<name>` + PR |

## 2. 目录职责
| 路径 | 谁能改 | 说明 |
|---|---|---|
| `js/`、`content/`、`index.html`、`styles.css` | 人/agent 均可 | 前端逻辑与文案 |
| `tools/build.py` | 人/agent 均可 | 预计算管线；改常量（`WALK_SPEED`/`COOL_FACTOR`/`DEMO_DATE`/`BBOX`/`CAMPUS_ONLY`/`HEIGHT_REPORT_LIMIT`）必须重跑 `shadows`+`routes`+`basemap` 并重跑 smoke |
| `data/raw/*.json` | **只能由 `build.py` 写** | 原始数据；手工编辑会在下次构建时被覆盖 |
| `data/*.js` | **只能由 `build.py` 写** | 生成物；禁止手改、禁止手工解决冲突 |
| `data/.bak/` | `build.py` 自动备份 | 已 gitignore，可随时删 |
| `docs/`、`README.md` | 人/agent 均可 | 口径文档；改数字见 §5 |
| `.github/`、`.gitignore`、`.gitattributes`、`.editorconfig` | 人 | 仓库基座 |

## 3. 写作用域（单人也要守，因为 agent 会并行）
1. **同一时刻只允许一个进程跑 `python tools/build.py`**：它会重写 6 个 `data/*.js`。并发会让 `smoke.js` 读到半截文件（现已加前置守卫，但仍是坏状态）。
2. agent 并行时，`data/` 与 `tools/build.py` 只能有一个 owner；需要同时改前端和数据时，先改前端、再串行跑构建。
3. 不要为了"让测试过"去改 `data/*.js` 的数值 —— 那是改口径，见 §5。

## 4. 提交规范
- 分支：单人直接提交 `main`；多人/多 agent 用 `feat/<name>` + PR。注意 `main` 现有"必须走 PR"的保护规则，owner 直推会被**放行但留下 rule bypass 记录**（见 §7）。
- 提交信息：`type(scope): 摘要`，`type ∈ feat|fix|polish|docs|test|chore`；**一次提交只做一件事**。
- 禁止一个提交里同时出现「文档 + 生成物 + 前端 + 工具链」；超过 20 个文件或 1500 行请拆。
- 提交前必做：`node tools/smoke.js` 通过 + `git status --porcelain` 只含预期文件。
- 可选：`git config core.hooksPath .githooks` 启用 pre-commit（自动跑 smoke + 数据检查）。
- 禁止提交：`*.bak`、`.env*`、`*.token`、`*.pem`、`*.key`、`data/hub.db*`、`node_modules/`、任何本机绝对路径（Windows 用户目录 / macOS 家目录）。

## 5. 改动 → 必须重跑什么（照表执行，别猜）

| 改了 | 必须跑 | 必须同步的文档 |
|---|---|---|
| `tools/build.py` 的常量/算法 | `python tools/build.py shadows` + `routes` + `basemap`，再 `node tools/smoke.js` | `docs/AGENTS-10.md` §10-14、`README.md` §1/§7、`docs/PPT-OUTLINE.md`、`docs/PITCH.md` |
| `js/` | `node tools/smoke.js` | 一般无需 |
| `data/raw/*.json`（重新抓数） | 全套 `python tools/build.py shadows routes basemap` + smoke | 同上 + `docs/DATA-SOURCES.md` |
| 卡片文案/口径 | `node tools/smoke.js`（有逐字断言） | `README.md` §1.2、`docs/AGENTS-10.md` §14 |
| 文档 | `node tools/smoke.js`（它也会读文档里的数字断言） | — |

## 6. 发版
- 版本号 SemVer：口径变化 → MINOR，纯修 bug → PATCH，交付版 → MINOR。
- 发版动作：更新 `CHANGELOG.md` → `git tag -a vX.Y.Z -m "..."` → `git push origin vX.Y.Z`。
- 每个演示/交付节点必须有一个 tag。

## 7. GitHub 门禁（现状 + 约定）

- **现状（2026-11-03）**：仓库已公开、已开 GitHub Pages（源分支 `main`）；`.github/` 只有 PR 模板，**没有工作流文件**，所以"必须过 CI 才能合并"目前靠本地两条命令保证：`node tools/smoke.js` + `python tools/ci/check_data.py`。
- `main` 开了「Changes must be made through a pull request」保护；owner 直推会被放行但记录一次 rule bypass（2026-11-03 更新 `main` 就是这样一次）。要规范化：要么都走 PR，要么到 Settings → Branches 关掉该规则。
- 若以后启用 CI：必须过 `smoke` + `data-integrity` + `hygiene` 才合并（加工作流前需 `gh auth refresh -s workflow`）。
- 禁止 force push 到 `main`、禁止直接删除 `main`。
- PR 必须填模板：改了什么 / 动了哪些权威数字（旧值→新值）/ 验证命令的真实输出 / 风险。

## 8. 保密与合规
- **OSM 数据 ODbL 1.0**：页面页脚与 `content/strings.js` 必须保留 "© OpenStreetMap contributors"；由 `data/raw/*.json` 派生的几何数据同样受 ODbL 约束，**不能单独以更严格许可再发布**。
- 湖是**示意轮廓**（`approx: true`），任何对外材料都必须带"不是测绘数据"这句。
- token 只放环境变量，**永不进仓库**；一旦怀疑泄漏：先撤销/轮换密钥，再考虑清历史（顺序不能反）。
- 严禁把本机绝对路径（Windows 用户目录、macOS 家目录）写进任何文件（CI 的 `hygiene` job 会拦）。

## 9. 与 AI agent 协作（DSH Agent Teams）
- 任务走共享任务板（`team_task_create` / `list` / `update`），领任务时声明 `write_scopes`；跨 agent 同一文件是**软警告不是锁**，所以 §3 的"一个 owner"规则必须人工守。
- 汇报必须带三样：改了什么 / **验证命令 + 真实输出** / 剩余风险。禁止只写"已完成"。
- 关键结论要写进文件（docs 或 issue），不要只留在对话里 —— 对话不落盘就等于没发生。
- 同一问题失败 2 次就停下来报告，不要空转。

## 10. 停止条件
- `node tools/smoke.js` 不过且 30 分钟内定位不到原因 → 停下来，贴完整输出求助。
- 需要改 `data/*.js` 的数值才能让测试过 → 停，那是口径变更，必须走 §5 全表。
- 连续两个动作方向相反（改了又改回去）→ 停，先确认需求。

## 11. 开工前 30 秒自检（复制即用）
```bash
git rev-parse --abbrev-ref HEAD     # 在 main（或约定的 feat 分支）
git status --porcelain              # 只含预期改动；data/ 不该莫名变脏
node tools/smoke.js                 # 全绿、退出码 0
```