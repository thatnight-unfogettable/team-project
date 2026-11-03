# 变更日志

本项目最怕的是**口径漂移**（同一个数字在 README/PPT/代码里不一致），所以这里的
"改了什么口径"是一等公民。格式参考 Keep a Changelog，版本号用 SemVer。

## [未发布]

### 新增

- **2.5D 立体视图（零依赖）**：地图右上角「平面 / 立体」按钮（或按 `V`）可在原平面视图与
  **体块视图**之间切换。`js/iso.js` 在 Canvas 2D 上手算轴测投影：地面绕画布中心旋转 −26°、
  纵向压缩到 0.80，楼按 `h × 3.2` 竖直拔起，侧面亮度 = 外法线·太阳方位（背光压暗偏冷），
  只画朝向观察者的面并按屏幕深度做画家算法排序。**没有引入 three.js / WebGL，也没有模型文件**，
  `file://` 双击即用、零网络、`data/*.js` 一个字节没动；点选坐标走同一投影的逆变换。
- 指北针在立体视图下按 `atan2(sin yaw, compress·cos yaw)` 旋转（地面既然转了、压了，N 不能再指屏幕正上方）。
- **树（绿化）**：地图上新增 **520 棵树**（322 棵行道树 + 198 棵空地树），由图例「树」标注。
  位置由 `js/trees.js` 用固定种子 `20261103` **现场确定性生成**（每次打开完全一样），
  逐点筛掉落进楼内、落进水内、离路太近、出校园边界、与已有树挨太近的候选。
  **树的坐标不进 `data/*.js`、不进阴影、不进晒度计算** —— `build.py` 的口径与全部权威数字一个字未动。
  平面视图给 3 px 屏幕最小半径 + 细描边（1200 m 跨度下真实 4 m 树冠只有 1.8 px，否则是灰点）；
  立体视图里树冠是压扁的椭圆多边形，和楼进同一条深度排序链。

- **校门**：地图上新增 **6 扇门**（北门/东门/南门/西门 + 西南便门/北便门）。位置由 `CORE.gatesFromRoads()`
  把「道路线段 × 校园边界」求交（10 个交点）后按 90 m 聚类得到，再按方位角 `atan2(x, y)` 命名；
  **不是手填坐标**，也不新增任何数据文件。正门（主干道/校内路）画大圆点 + 粗体名，便门（服务道/步道）小圆点。
  立体视图下门牌文字保持正立。

### 测试

- `tools/smoke.js` 129 → **173 条断言**：其中 21 条覆盖投影可逆性、面可见性（方楼只画 2 侧 + 1 顶）、
  受光亮度随太阳方位/高度变化、按钮与 `aria-pressed` 同步、指北针角度、切回平面后状态干净、深链接；
  14 条覆盖树的确定性、离楼/离水/离边界、最小间距、图例齐全、平面视图真的画了（arc 计数）、
  立体视图树冠存在且整体深度排序单调；8 条覆盖校门的求交数量、命名唯一、四个正门齐全、落在边界上、
  方位命名一致、正/便门与道路等级一致、确定性与画布落字。

## [0.2.0] - 2026-11-03

一轮以"可交付性"为目标的修复：不改变任何算路口径与数据数值，只修**可验证的缺陷**
与**工程基座**。数据文件（`data/*.js`）与 `b2b212d` 逐字节一致。

### 修复（用户可见）

- **高分屏标注错位**：`js/map.js` 的 `drawLabels()` 是全图唯一漏掉 `setTransform(dpr)` 的图层，
  dpr≥1.25 时地名标注字号减半并整体偏移到画布左上 1/2（52 个 `fillText` 里 48 个受影响）。
- **地图点选后下拉框变空白**：`markSelect()` 把选项下标当 `value` 用，临时项 `value="-1"`
  匹配不到任何选项 → `selectedIndex = -1`。改用 `selectedIndex`。
- **方向键与原生控件抢事件**：`document` 级 ←/→ 不判断焦点，`<select>` 上按一次键会
  "换选项 + 切时间"双动作；滑块上则一次跳两帧。已加 `SELECT/INPUT/TEXTAREA` 焦点保护。
- **`<40 m` 拒绝文案**：原文案把"沿路长度"说成"两点距离"（实测 `只隔 10 米` 实为直线 61.2 m），
  现在同时给出沿路与直线两个数。
- **低置信度横幅自相矛盾**：太阳高度 ∈ [14.95°, 15°) 时输出「15.0°，低于 15°」，现改为多留一位小数。
- **图例颜色对不上画布**：阴影图例 `#2b3d63` vs 实际合成色 `#9b9c9b`；建筑色阶右端 `#5c616a`
  永远画不出来（全库最高楼 57.6 m → `#7a7c80`）。
- **移动端底部被裁**：`#app` 高度补 `100dvh` 回退；`resize` 加 80 ms 防抖；`dpr` 封顶 2
  （2560×1440@2x 双画布 96.7 MB → 约 21 MB）；新增 `prefers-reduced-motion` 支持。

### 新增（功能）

- **「示例 A / 示例 B」切换**：`index.html` 路线对比标题右侧新增两个按钮，
  `js/app.js` 新增 `state.userPicked` / `selectPair()`：
  未手动选点时用 Python 预计算示例（瞬时，`data/routes.js` 重新被使用），
  下拉/地图选点后走 `ROUTER` 现场算。此前 `state.pair` 恒为 0 且无控件，
  而 README:28、PITCH:120、PPT:208、SOLO-PLAN:73 的演示脚本都写了"切第二组"。
- **无障碍**：`#map` 补 `role="img"` + `aria-label`，`#delta` 补 `role="status"` + `aria-live`，
  示例按钮带 `aria-pressed`。
- `tools/tasks.ps1`：`test / serve / build / preview / clean` 命令入口，人和 CI 不用再手抄命令。

### 新增（工程基座）

- `.github/workflows/smoke.yml`：`smoke`（含 `data/*.js` 存在性 preflight + `node --check`）、
  `data-integrity`、`hygiene`（禁入文件/凭据/BOM/换行/单文件体积）、`commit-msg`、
  `artifact-drift`（迁移期告警）。
- `tools/ci/check_data.py`：体积预算（`data/*.js` 1.6 MB、单文件 1 MiB、`raw` 700 KB）+
  raw JSON 解析 + 口径不变量（演示日、31 帧、613 边、474 节点、`coolFactor=6`、routes 帧数）。
- `tools/ci/check_commits.sh`：PR 提交信息 `type(scope): 摘要` 校验。
- `.githooks/pre-commit`（可选）：`git config core.hooksPath .githooks` 启用。
- `LICENSE`（默认保留所有权利 + ODbL 数据例外）、`.editorconfig`、`.gitattributes`
  （全仓 `eol=lf`，`data/*.js` 标记 `linguist-generated`）、`.gitignore` 补 `data/.bak/`。

### 文档

- **根 `AGENTS.md` 重写**：原文件描述的是另一个项目（4 人分工 `huang/jiang/xu/li`、
  `src/backend`、`pytest -q`、hub relay），而它是 agent 新会话唯一自动加载的流程文件。
  新版按真实目录/真实命令写，含"改动 → 必须重跑什么"表与 CI 门禁约定。
- README / docs 的数字校正：12:00「全天最低」→「正午时段最低」（5 处）、
  夏至「正午 83.4°」→「12:00 帧 83.4°（真正午 89.65°/12:29）」、「6.4 倍」→「6.7 倍」、
  `router.js` 体积 7.9→8.5 KB、14:00 阴凉占比 19.8→19.9 并注明"按边长加权"、
  边界断言 6→7 条、`roadnames.json`「空着」→「尚未生成」。
- `docs/PROJECT-SCOPE.md` 由空模板补全（目标/persona/P0 功能与验收/明确不做/里程碑/风险）；
  `docs/TASKS.md` 去掉指向不存在的 `hub.cmd` 的说明；`docs/PITCH.md` 改掉第一人称人物矛盾。

### 数据管线（`tools/build.py`）

- `import` 产出闸门：解析为空时拒绝落盘；`write_js` 改原子写（`.tmp` → `os.replace`）并备份到 `data/.bak/`。
- `sample` 成套写入，避免"假阴影 + 真路网"混用。
- `lakering` 候选集全序排序：`--list` / `--pick N` 不再随 `PYTHONHASHSEED` 变化。
- `check` 失败以非 0 退出；`campus.json` 缺失时 fail-closed。

### 验证

```
node tools/smoke.js          # 全绿（含新增 dpr / 示例切换 / 前置守卫断言）
python tools/ci/check_data.py  # PASS 0 阻断 / 0 警告
```

## [0.1.0] - 2026-11-02

首个可交付版本（对应 commit `b2b212d`）：285 栋建筑 / 613 条边 / 31 帧（07:00–17:00，步长 20 分钟）/
两对示例路线；前端零网络、`file://` 双击即用；62 个「帧 × 示例起终点」上浏览器 Dijkstra
与 Python 预计算结果完全一致。