> **边界（2026-11-03）**：本文件只负责**数字与口径**（事实、常量、断言覆盖、文案精度），是项目数字的唯一权威。
> **协作与流程以仓库根 `AGENTS.md` 为准**；两处冲突时，流程看 `AGENTS.md`、数字看本文件，并当次修掉冲突。

## 10. 项目约定（lead 维护）

- **项目**：凉径 · ShadeRoute Lite —— 中山大学广州校区南校园「热浪天走哪条路」决策工具
- **范围**：OSM 官方校园多边形 `way 300917756`「中山大学(广州校区南校园)」，**1,201,723 m² / 114 顶点**；拉取 bbox `(S,W,N,E) = (23.0932, 113.2837, 23.1059, 113.3013)`（校园外接矩形 + ~55 m 余量）；校区内 **285 栋建筑 / 613 条道路边 / 474 个节点 / 143 个独立回路**
- **校园裁切**：`CAMPUS_ONLY = True` —— 建筑按**质心**、道路按**路段中点**过滤；bbox 内 555 栋里剔除 270 栋校外建筑；原始数据留 `data/raw/`（`buildings.json` 555 栋、`ways.json` 297 条 way、`campus.json` 多边形）
- **演示日**：`DEMO_DATE = "2026-11-02"`，07:00–17:00 每 20 分钟一帧，**共 31 帧**（11 月 18 点太阳已落山，所以收到 17:00）
- **主口径**：14:00 pair0（**老年人活动中心 → 岭南学院**）**多走 44 米，少晒 4.0 分钟**；阴影覆盖 6% → 35%（最快 14.8 分 / 暴晒 14.0 / 1113 m；阴凉 15.4 分 / 暴晒 10.0 / 1157 m）
- **第二组**：14:00（学生饭堂 → 老年人活动中心）**多走 57 米，少晒 3.3 分钟**（17.6/16.5/1320/6% vs 18.4/13.2/1377/28%）
- **首页 slogan**：与 14:00 卡片文案逐字一致 = 「多走 44 米，少晒 4.0 分钟」
- **高度口径**：`osm_levels` **21 栋**（×3.2 m）/ `estimated` **264 栋**（12 m，≈92.6%）/ `osm` **0 栋**（`height` 标签一个都没有）；人工覆盖走 `HEIGHT_OVERRIDES`；`data/height-report.csv` 只列 **60 行数据 + 1 行表头**（`HEIGHT_REPORT_LIMIT = 60`），6 列，第一行「伍舜德图书馆」
- **技术栈硬约束**：纯静态 HTML5 + 原生 CSS + 经典 `<script>`；**无 npm / 无框架 / 无构建工具 / 无 CDN / 运行时零网络**；`file://` 双击可用；数据以 `data/*.js` 形式赋给 `window.DATA_*`
- **不碰**：`tools/`、`js/`、`data/`、`index.html`、`styles.css`、`content/`（并行修改会冲突）；文档改动只落 `README.md` + `docs/*.md`

## 11. 目录与文件（唯一权威）

```
team-project/                                # 代码合计约 5750 行（前端约 1470 / 工具链约 3670 / 页面约 610）
├── index.html              # 页面骨架（约 130 行，含起终点下拉 + 地图点选）
├── styles.css              # 样式（约 470 行）
├── content/strings.js      # 全部文案与免责说明，含 OSM 署名（约 17 行）
├── js/                     # 前端逻辑合计约 1470 行
│   ├── proj.js             # 经纬度 ↔ 屏幕坐标（约 44 行）
│   ├── core.js             # 纯函数：shadeMeters / routeSummary / WALK_SPEED（约 290 行）
│   ├── router.js           # 浏览器端算路：二叉堆 + Dijkstra + 吸附（约 230 行 / 约 8.5 KB）
│   ├── map.js              # Canvas 9 层：地面+网格 / 水系 / 道路 / 阴影 / 建筑 / 边界 / 路线 / 标注 / 标记（约 410 行）
│   └── app.js              # 交互：时间滑块、起终点下拉、地图点选、卡片（约 500 行）
├── data/
│   ├── meta.js             # date / 31 帧 / frames[].sun / bbox_m / campus{name,area_m2,ring}
│   ├── buildings.js        # 285 栋：{id, name, p, h, src}
│   ├── graph.js            # 101.2 KB：474 节点 / 613 边（毫米精度）/ 31 帧暴晒千分比 / 53 地名
│   ├── basemap.js          # 32.2 KB 底图：{roads:[{t,p}], water:[{n,p,approx}], labels:[{n,x,y,k,r,a}]}
│   ├── shadows.js          # 31 帧 × 285 环（861.6 KB）
│   ├── routes.js           # 31 帧 × 2 pairs：[{fastest:{minutes,sun_minutes,length_m}, cool:{...}}]
│   ├── height-report.csv   # 60 行 6 列
│   └── raw/
│       ├── campus.json     # {name, area_m2, ring[[x,y],...114]}
│       ├── buildings.json  # 555 栋（bbox 原始，含校外）
│       ├── ways.json       # 297 条 way（bbox 原始）
│       └── water.json      # [{name:"园东湖", ring[[x,y],...40], approx:true}]（lakering 反推的示意轮廓）
└── tools/                  # 工具链合计约 3670 行（比前端还长，重点在数据）
    ├── build.py            # 零依赖管线（约 1970 行）：sample/osm/fetch/import/shadows/routes/check/all/basemap/water/nodes/lakering/waterblob
    ├── smoke.js            # 173 条断言（约 1300 行）
    ├── console-check.js    # 浏览器控制台手动核对脚本（约 250 行，含底图 4.5 节）
    └── preview.py          # 无浏览器 PNG 预览（约 290 行）：按 map.js 图层重画，沙箱自查用
```

## 12. 数据获取三级方案

1. **主路径**：`python tools\build.py osm` —— OSM 主 API，一次约 3.6 秒（含校园多边形）。
2. **兜底 A**：`python tools\build.py fetch` —— Overpass 优先，任一镜像失败自动降级到 OSM 主 API。
3. **兜底 B**：`python tools\build.py import buildings.json ways.json` —— 用浏览器导出的 Overpass JSON 落盘。
4. **诊断**：`python tools\build.py check` —— **只测 Overpass** 连通性，不拉数据；用于判断"是 Overpass 挂了还是网挂了"。
5. **底图**：`python tools\build.py basemap` —— **纯离线**，从 `data/raw/ways.json` + `data/raw/water.json` 生成 `data/basemap.js`（**296 段道路** / **1 处示意水面** / **61 条标注**）。
6. **湖（无 OSM 依赖）**：`python tools\build.py lakering --list` 列出候选 → `--pick 1 --shrink 0.06 --smooth 2 --name 园东湖` 写 `data/raw/water.json`（`approx: true`）；快速试位置用 `python tools\build.py waterblob --x 300 --y 180 --w 240 --h 150`；改完都要**重跑一次 `basemap`** 才上图。湖是**示意轮廓**（半透明 + 虚线边），不是测绘数据。
7. **路名（需网络）**：`python tools\build.py water` —— 仍会尝试抓道路 `name` 存成 `data/raw/roadnames.json`；当前 OSM 抓取受阻，**路上不写字**（**有意降级，不是 bug**）。`water` 也会抓 `natural=water`，抓到后重跑 `basemap` 即可用真实岸线替换示意轮廓。

> Overpass 的 POST 在本机网络下会被 TLS 中断（`SSL: UNEXPECTED_EOF_WHILE_READING`），所以主路径是主 API，不要反过来。

## 13. 测试方式

- `node tools/smoke.js` → **173 条断言全过**（退出码 0）。
- 断言覆盖：数据契约（date=2026-11-02、31 帧、285 环、`src` 分布 21/264、14:00 数值、height-report 60 行数据 + 1 行表头 6 列）+ 前端纯函数（`shadeMeters`、`routeSummary` 文案精度）+ **7 条底图断言**（`data/basemap.js` 结构完整、道路全部来自本地 OSM 路网（297 条 way 裁成 296 段）、四档线型齐全、所有道路坐标在 bbox±60 m 内、楼名标注全部在校园 bbox 内、标注数 ≥60、按重要度排序）+ **4 条湖断言**（园东湖已画上、湖面是多边形且面积 5000–40000 m²、`approx=true`、湖名以 `k=w` 进标注表）+ **7 条校园边界回归**（含"边界环点数 ≥ 3"；建筑质心在校内、路线采样点在校内、每帧阴影环与校园有交集、14:00 两条路线最大偏离 ≤120 m、校园名含"中山大学/南校园"、面积在 1.0~1.4 km²）+ **17 条算路断言**（62 个「帧 × 起终点」对拍：长度**全等、差 0 米**、暴晒差 ≤0.05 分钟；同点提示、任意两地名可算、往返对称、5 km 外拒绝、中心点吸附、4 条地图点选）。
- 手动冒烟：双击 `index.html` → 拖滑块 07:00–17:00 → 两组起终点 → **下拉换两个地名 / 地图点两下** → 断网刷新。
- 14:00 卡片必须显示「多走 44 米，少晒 4.0 分钟。」（多一个空格都算错）。

## 14. 文案口径（全项目统一，改一处就要全改）

- "多走"一律用**米**（44 / 46 / 29 / 57 / 110）；"少晒"一律用**一位小数分钟**（4.0 / 2.5 / 3.3 / 6.2 / 0.9）。
- 卡片大数字（用时 / 暴晒）是**四舍五入到整数分钟**：14.8 → 15 分钟。
- 阴影覆盖用**百分比整数**：6% → 35%；精确值（5.7% / 35.2%）只在被追问时给。
- 低置信度帧固定 5 个：07:00 / 07:20 / 07:40 / 16:40 / 17:00。
- **底图口径**：道路 **296 段**（原始 297 条 way 裁切后，**296 段 ≠ 297 条**）、标注 **61 条**（60 条楼名：68 栋有名建筑过滤编号型垃圾名后、1400×900 实画 50 个 + 1 条湖名）、水面 **1 处**（园东湖，**约 1.7 万 m²（16,814 m²）/ 40 顶点**，路网环路反推的**示意轮廓**，`approx: true`，页面半透明 + 虚线边）；**路名仍 0 条**（`roadnames.json` 尚未生成：`build.py water` 需联网、本机未跑通）。图层说法统一为"**9 层**"。
- **湖的限定语（必须带）**："示意轮廓""`approx`""虚线边""非测绘数据"；位置统一写"中心 **(536, −85) 米**（路网反推 + 用户指认）"，**不编造经纬度**；**不得写"园东湖的准确边界"**，也不得说"路名也补上了"。
- **作废的旧说法**（任何文档/PPT 里都不该再出现，除了明确标"作废"的对照表）：旧矩形 bbox 的栋数/道路数/回路数、旧 slogan（见 README §9）、旧终点名（见 README §9）、旧版夏至/11 月对比的百分比、`height` 有标签的假象数字。

## 15. 关键接口契约（js ↔ data）

```js
// data/meta.js
window.DATA_META = {
  date: "2026-11-02", step: 20,
  frames: [{ t: "07:00", sun: [az, el] }, ...],   // 31 个
  bbox_m: [-901.1, -701.9, 901.1, 701.9],
  campus: { name: "中山大学(广州校区南校园)", area_m2: 1201723, ring: [[x,y], ...] } // 114 点
};

// data/buildings.js
window.DATA_BUILDINGS = [{ id, name, p: [[x,y],...], h, src }];  // 285 个；src ∈ "osm_levels" | "estimated"

// data/shadows.js
window.DATA_SHADOWS = [[ring, ...], ...];  // 31 帧 × 285 环（本地米制坐标）

// data/routes.js
window.DATA_ROUTES = {
  pairs: [{ name, from: [lat,lon], to: [lat,lon] }, ...],   // 2 组
  frames: [{ t, routes: [{ fastest: {minutes, sun_minutes, length_m}, cool: {...} }, ...] }]
};

// data/graph.js（浏览器端算路包）
window.DATA_GRAPH = {
  nodes: { [id]: [x, y] },      // 474 个（本地米制坐标）
  main: [0|1, ...],             // 474 项，真值 466 = 最大连通分量，只有这些允许吸附
  edges: [[a, b, len_m], ...],  // 613 条，边长毫米精度（3 位小数）
  exposed: [[0-1000, ...], ...],// 31 帧 × 613 条，暴晒千分比（整数）
  anchors: [{ name, x, y, node }], // 53 个校园地名（下拉 + 默认起终点）
  coolFactor: 6.0, walkSpeed: 1.25
};

// data/basemap.js（底图：只用于绘制，不参与算路；道路/楼名与 graph 同源 ways.json，湖来自 water.json）
window.DATA_BASEMAP = {
  roads: [{ t, p: [[x, y], ...] }],          // 296 段；t ∈ "main" | "local" | "service" | "path"
  water: [{ n, p: [[x, y], ...], approx: true }],  // 1 处（园东湖，approx=true 表示示意轮廓）；字段名是 n/p，不是 name/ring
  labels: [{ n, x, y, k, r, a }],            // 61 条（60 楼名 k="b" + 1 湖名 k="w"）；r=重要度档，a=底面积
  roadCount: 296, sourceWays: 297, waterCount: 1, approxWater: 1
};

// js/router.js（浏览器端，无依赖、file:// 可用）
window.ROUTER = {
  prepare(graph),                       // 建邻接表
  snap(x, y, maxM = 120),               // 吸附到主网节点；失败返回 null
  solve(fromXY, toXY, frameIdx),        // 返回 { ok, fastest, cool, ... }；同点/太远返回 { ok:false, reason }
  anchors()                             // 53 个地名列表
};
```

**注意 `water` 的字段名**：`data/basemap.js` 里是 `{n, p, approx}`（`n` 名称、`p` 折线点）；`{name, ring}` 只存在于源头 `data/raw/water.json`——别把两套字段名混着写。

**核心函数**：`CORE.shadeMeters(route)` 返回 `{shadeMeters, shadePct}`，定义是
`shadeMeters = length_m - sun_minutes * 60 * 1.25`（`WALK_SPEED = 1.25` 在 `js/core.js` 顶部单独声明，注释"必须与 tools/build.py 的 WALK_SPEED 一致"——这是刻意的重复常量，靠 smoke 断言锁住）。

## 16. 交付硬约束（违反任何一条就算没做完）

1. **纯静态**：直接双击 `index.html` 能开；不启动任何服务器、不装任何东西。
2. **零网络请求**：页面打开后 Network 面板 0 请求（含字体、图标、CDN）。
3. **零依赖**：`build.py` 只用 Python 标准库（functools/heapq/math/json/csv/urllib 可以，第三方库不行）；浏览器端 `router.js` 也不引任何库。
4. **数字可回溯**：页面上每个数都能在 `data/*.js` 里找到，且能从 `tools/build.py` 复算。
5. **诚实边界**：不出现"降温几度"；不承诺绝对阴影面积；低角度必须标黄条；树/车/临时棚明确"未计入"。
6. **校园边界**：`CAMPUS_ONLY = True` 不得关闭；建筑质心、路段中点必须在多边形内；路线不得跨出校门。
7. **口径单一权威**：`WALK_SPEED`、`COOL_FACTOR`、`DEMO_DATE`、`BBOX`、`HEIGHT_REPORT_LIMIT`、`CAMPUS_ONLY` 都只在 `tools/build.py` 配置区定义；前端只能引用数据，不能另写一套常量。
8. **双实现一致**：`js/router.js` 现场算路必须与 Python 预计算一致——62 个「帧 × 起终点」组合长度**全等（差 0 米）**、暴晒分钟差 **≤0.05 分钟**，由 smoke 锁死；改任一侧算法都必须重跑 smoke。

## 17. 文档分工（谁维护什么）

| 文档 | 内容 | 谁维护 |
|---|---|---|
| `README.md` | 一页读懂 + 怎么跑 + 技术要点 + 交付清单 | lead（docs 起草） |
| `docs/PITCH.md` | 3 分钟逐句讲稿 + 9 条 Q&A + 翻车话术 | lead（docs 起草） |
| `docs/PPT-OUTLINE.md` | 12 页每页放什么 + 附录 | lead（docs 起草） |
| `docs/DATA-SOURCES.md` | 数据来源、算法、误差、换算、合规 | docs |
| `docs/QA-EXTRA.md` | 17 条工程视角追问（含湖的来源/精度、任意两点/现场算一致性/短距离边界） | docs |
| `docs/EXAMPLE-QUERIES.md` | 6 组地名 × 4 个时刻的任意两点实测表 | **lead**（Python 独立复跑生成） |
| `docs/SOLO-PLAN.md` | 单人 4 天计划 | docs |
| `docs/AGENTS-10.md` | 本文件：约定 / 契约 / 硬约束 | lead |

## 18. 当前状态（交付前更新这一行）

- 数据：已换成**校园多边形**版本（1.20 km² / 285 栋 / 613 边 / 143 回路），`CAMPUS_ONLY = True`，`date = 2026-11-02`，31 帧。
- 功能：**任意两点现场算路**（53 个校园地名 + 地图点选，`data/graph.js` 101.2 KB + `js/router.js` 约 230 行），与预计算 62 组合对拍长度全等。
- 底图：`data/basemap.js`（32.2 KB）已上线——**296 段道路**（四档线型）+ **1 处示意水面**（园东湖，16,814 m² ≈1.7 万，路网环路反推、`approx`、40 顶点）+ **61 条标注**（60 楼名 + 湖名）+ 图例「道路 / 水系」，地图 **9 层**渲染；**湖是示意轮廓（半透明 + 虚线边），不是测绘数据**；**路名仍 0 条**（`roadnames.json` 尚未生成，待 `build.py water`，属有意降级）。
- 测试：`node tools/smoke.js` **173 条全过**（含 7 条底图断言 + 4 条湖断言）。
- 数据体积：页面加载约 **1.08 MB（1104.2 KB）**，阴影 861.6 KB 是大头。
- 文档：README + 6 份 docs 已同步到新口径（"多走 44 米，少晒 4.0 分钟"）；另有 lead 维护的 `docs/EXAMPLE-QUERIES.md` 实测表。
- 待补：页面截图（14:00 / 12:00 / 16:40 / 07:00 / 任意两点）、11-02 实拍、3 分钟 MP4、Network 0 请求截图。