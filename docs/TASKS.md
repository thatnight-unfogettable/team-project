# 任务与完成度

> 本仓库**不使用 relay 任务板**（旧模板里的 relay 任务命令本仓库并不存在，已作废）。
> 任务视图见 [`SOLO-PLAN.md`](./SOLO-PLAN.md)（单人 4 天计划）与 [`README.md`](../README.md) §4「四天计划」/ §9「演示前倒计时」。

| 事项 | 状态 | 验收方式 |
|---|---|---|
| OSM 拉取 + 校园多边形裁切（bbox 555 栋 → 校内 285 栋） | ✅ | `python tools\build.py osm`；`data/meta.js` 的 `campus.area_m2` |
| 31 帧阴影预计算（285 环/帧，07:00–17:00 每 20 分钟） | ✅ | `data/shadows.js` 帧数 = 31；`node tools/smoke.js` |
| 两条示范路线预计算（pair0 / pair1） | ✅ | `data/routes.js`；14:00 pair0 = 多走 44 米 / 少晒 4.0 分钟 |
| 任意两点现场算路（53 个地名下拉 + 地图点选） | ✅ | smoke 62 组「帧 × 起终点」对拍：差 0 米 / ≤0.05 分钟 |
| 底图 / 示意水面 / 标注 | ✅ | `data/basemap.js`：296 段道路 / 1 处水面（`approx`）/ 61 条标注 |
| 路名（`build.py water`） | ⬜ 阻塞 | `data/raw/roadnames.json` 尚未生成（OSM 抓取受阻） |
| 路线两侧 10 栋楼人工高度（`HEIGHT_OVERRIDES`） | ⬜ 待补 | `data/height-report.csv` 前 10 行填完并重跑 `shadows` + `routes` |
| 树冠 / DSM 阴影 | ⬜ 未来工作 | 见 `README.md` §6、`docs/DATA-SOURCES.md` §5.3 |
| 11-02 实拍对比 | 🚫 不可完成 | 演示日 2026-11-02 已过，光照无法复现（见 README §9） |