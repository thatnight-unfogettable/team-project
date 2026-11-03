/* 种树优化器（治理侧）——纯计算层：不含 DOM、不写 data/*、不发请求。
 *
 * 为什么单独一个文件：这里要回答"多种 20 棵树，阴凉涨多少、每万元值不值"，
 * 而 js/trees.js 那 520 棵是**装饰**、明确不进阴影口径。两件事不能混：
 *   - 装饰树：固定种子现场撒，只影响观感（README §7.10）；
 *   - 规划树：用户/优化器放的人工点位，只影响**规划指标**（本文件的 measure/optimize）。
 * 官方「阴凉 xx% / 少晒 x 分钟」仍然只由 build.py 预计算建筑阴影，本文件一个字都不改它。
 *
 * 树阴影模型（与建筑同一套，见 tools/build.py 的 _shadow_rings）：
 *   树冠当半径 r 的圆，树高 h 的影子长度 L = h / tan(高度角)，上限 500 m；
 *   影子圆心沿太阳反方向平移 (-sin(az)·L, -cos(az)·L)，az 是方位角（0°=北，顺时针）。
 *   于是影子是"圆 ⊕ 线段"的胶囊形，点在影子内 <=> 点到那段线段的距离 ≤ r。O(1) 判定。
 *
 * 指标口径（已冻结，见 README §7.13）：
 *   遮阴面积 = 校园内 10 m 网格里被树影盖住的格数 × 100 m²（当前帧）
 *   路网阴凉占比 = Σ 边长 × max(建筑遮挡比例, 树遮挡比例) ÷ 路网总长（每米等权，与官方同源）
 *   遮阴分钟 = 被树遮住的路段长度 ÷ 1.25 m/s ÷ 60（"把阴凉路段连起来走一遍要多久"）
 *   成本 = 3000 元/株，20 株 = 6 万元；每万元 = 日累计遮阴分钟 ÷ 6
 */
window.PLAN = (function () {
  'use strict';

  /* ---------------- 常量（全部可调，smoke 会锁住关键几个） ---------------- */
  var COST_PER_TREE = 3000;      // 元/株（含 3 年养护，页面标注为假设值）
  var WAN = 10000;
  var MAX_SHADOW_LEN = 500;      // 与 build.py 一致
  var MIN_SUN_ELEV = 3;          // 与 build.py 一致：太阳低于 3° 不画影子
  var WALK_SPEED = 1.25;         // m/s，与 CORE / build.py 一致
  var CELL = 5;                  // 面积统计网格（米）：10 m 太粗，单棵树会被量化成 100 或 200 m²
  var ROAD_SAMPLES = 4;          // 每条边采样点数，与 build.py 一致
  var TREE_R = 4.0;              // 规划树冠半径（米），取装饰树区间 2.6–5.2 的中值
  var TREE_H = 9.0;              // 规划树高（米），取 6.5–11.5 的中值
  var MIN_GAP = 30;              // 优化选点两两最小间距（米）
  var STEP_ROAD = 15;            // 行道树候选沿路步长
  var OFF_MID = 4.5;             // 行道树候选离路中心的偏移（3.6–5.4 的中值）
  var SCATTER_CELL = 26;         // 空地候选网格
  var SCATTER_JITTER = 9;
  var CLEAR_BUILD_SCATTER = 6.0; // 空地树离楼
  var CLEAR_BUILD_ROAD = 2.0;    // 行道树离楼
  var CLEAR_WATER = 4.5;
  var CLEAR_TREE = 3.2;          // 与装饰树之间（trees.MIN_GAP 一致）
  var ROAD_MIN = 1.2;            // 规划树不能种在路中间
  var MAX_CANDIDATES = 4200;     // 候选池上限，防止极端数据把浏览器拖死

  function num(v, d) { var n = typeof v === 'string' ? parseFloat(v) : v; return (typeof n === 'number' && isFinite(n)) ? n : d; }

  /* ---------------- 几何 ---------------- */

  function distSeg(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    var t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    var qx = ax + t * dx, qy = ay + t * dy;
    return Math.sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy));
  }

  function pointInRing(x, y, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi) { inside = !inside; }
    }
    return inside;
  }

  function ringDist(x, y, ring) {
    if (pointInRing(x, y, ring)) { return 0; }
    var best = Infinity;
    for (var i = 0; i < ring.length; i++) {
      var p = ring[i], q = ring[(i + 1) % ring.length];
      var d = distSeg(x, y, p[0], p[1], q[0], q[1]);
      if (d < best) { best = d; }
    }
    return best;
  }

  function ringBBox(ring) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    for (var i = 0; i < ring.length; i++) {
      if (ring[i][0] < b[0]) { b[0] = ring[i][0]; }
      if (ring[i][1] < b[1]) { b[1] = ring[i][1]; }
      if (ring[i][0] > b[2]) { b[2] = ring[i][0]; }
      if (ring[i][1] > b[3]) { b[3] = ring[i][1]; }
    }
    return b;
  }

  /* 树影胶囊：a→b 是树冠圆心在地面的投影轨迹，r 是树冠半径 */
  function shadowCapsule(tree, sun) {
    if (!tree || !sun) { return null; }
    var az = num(sun[0], 0), el = num(sun[1], 0);
    var h = num(tree.h, TREE_H), r = num(tree.r, TREE_R);
    // 太阳低于 3° 时 build.py 不画影子，这里保持一致（否则影子长到荒谬）
    if (el < MIN_SUN_ELEV) { return null; }
    var L = Math.min(MAX_SHADOW_LEN, h / Math.tan(el * Math.PI / 180));
    var rad = az * Math.PI / 180;
    var dx = -Math.sin(rad) * L, dy = -Math.cos(rad) * L;
    return { ax: tree.x, ay: tree.y, bx: tree.x + dx, by: tree.y + dy, r: r, len: L };
  }

  function pointInCapsule(px, py, cap) {
    if (!cap) { return false; }
    return distSeg(px, py, cap.ax, cap.ay, cap.bx, cap.by) <= cap.r;
  }

  /* 胶囊的轴对齐包围盒（撒点/取格用） */
  function capBBox(cap) {
    return [Math.min(cap.ax, cap.bx) - cap.r, Math.min(cap.ay, cap.by) - cap.r,
      Math.max(cap.ax, cap.bx) + cap.r, Math.max(cap.ay, cap.by) + cap.r];
  }

  /* ---------------- 空间哈希（同 trees.js 的思路，独立一份，避免动到已锁定的装饰树逻辑） ---------------- */
  function Grid(cell) { this.cell = cell; this.bins = {}; }
  Grid.prototype.key = function (ix, iy) { return ix + ',' + iy; };
  Grid.prototype.addBox = function (box, val) {
    var c = this.cell;
    for (var ix = Math.floor(box[0] / c); ix <= Math.floor(box[2] / c); ix++) {
      for (var iy = Math.floor(box[1] / c); iy <= Math.floor(box[3] / c); iy++) {
        var k = this.key(ix, iy);
        (this.bins[k] || (this.bins[k] = [])).push(val);
      }
    }
  };
  Grid.prototype.addPoint = function (x, y, val) {
    var k = this.key(Math.floor(x / this.cell), Math.floor(y / this.cell));
    (this.bins[k] || (this.bins[k] = [])).push(val);
  };
  Grid.prototype.near = function (x, y, r) {
    var c = this.cell, out = [], seen = {};
    for (var ix = Math.floor((x - r) / c); ix <= Math.floor((x + r) / c); ix++) {
      for (var iy = Math.floor((y - r) / c); iy <= Math.floor((y + r) / c); iy++) {
        var bin = this.bins[this.key(ix, iy)];
        if (!bin) { continue; }
        for (var i = 0; i < bin.length; i++) {
          if (!seen[bin[i]]) { seen[bin[i]] = 1; out.push(bin[i]); }
        }
      }
    }
    return out;
  };

  /* ---------------- 上下文：把建筑/水/路/边界/路网整理成可反复查询的结构 ---------------- */
  function makeContext(opts) {
    opts = opts || {};
    var buildings = opts.buildings || [];
    var water = opts.water || [];
    var roads = opts.roads || [];
    var ring = opts.campusRing || null;
    var frames = opts.frames || [];
    var graph = opts.graph || null;
    var blockers = opts.blockers || [];      // 已存在的装饰树：规划树不能叠上去

    var bRings = [], bGrid = new Grid(20);
    for (var i = 0; i < buildings.length; i++) {
      var br = buildings[i] && buildings[i].p;
      if (!br || br.length < 3) { continue; }
      bRings.push(br);
      bGrid.addBox(ringBBox(br), bRings.length - 1);
    }
    function buildDist(x, y) {
      var idxs = bGrid.near(x, y, CLEAR_BUILD_SCATTER), best = Infinity;
      for (var k = 0; k < idxs.length; k++) {
        var d = ringDist(x, y, bRings[idxs[k]]);
        if (d < best) { best = d; }
      }
      return best;
    }
    function waterDist(x, y) {
      var best = Infinity;
      for (var k = 0; k < water.length; k++) {
        var w = water[k] && water[k].p;
        if (!w || w.length < 3) { continue; }
        var d = ringDist(x, y, w);
        if (d < best) { best = d; }
      }
      return best;
    }
    var segs = [], rGrid = new Grid(25);
    for (var r = 0; r < roads.length; r++) {
      var pts = roads[r] && roads[r].p;
      if (!pts || pts.length < 2) { continue; }
      for (var s = 0; s + 1 < pts.length; s++) {
        segs.push([pts[s][0], pts[s][1], pts[s + 1][0], pts[s + 1][1]]);
        var si = segs.length - 1;
        rGrid.addBox([Math.min(segs[si][0], segs[si][2]), Math.min(segs[si][1], segs[si][3]),
          Math.max(segs[si][0], segs[si][2]), Math.max(segs[si][1], segs[si][3])], si);
      }
    }
    function roadDist(x, y, rad) {
      var idxs = rGrid.near(x, y, rad), best = Infinity;
      for (var k = 0; k < idxs.length; k++) {
        var sg = segs[idxs[k]];
        var d = distSeg(x, y, sg[0], sg[1], sg[2], sg[3]);
        if (d < best) { best = d; }
      }
      return best;
    }
    var tGrid = new Grid(10);
    for (var ti = 0; ti < blockers.length; ti++) {
      var bt = blockers[ti];
      if (bt && isFinite(bt.x) && isFinite(bt.y)) { tGrid.addPoint(bt.x, bt.y, ti); }
    }
    function treeDist(x, y) {
      var idxs = tGrid.near(x, y, CLEAR_TREE), best = Infinity;
      for (var k = 0; k < idxs.length; k++) {
        var bt = blockers[idxs[k]];
        var d = Math.sqrt((x - bt.x) * (x - bt.x) + (y - bt.y) * (y - bt.y));
        if (d < best) { best = d; }
      }
      return best;
    }

    /* 合法性：一条规则一处，UI 与候选池共用，不允许两套口径 */
    function legal(x, y, kind) {
      if (!ring || !pointInRing(x, y, ring)) { return { ok: false, reason: '出校园边界' }; }
      var need = kind === 'road' ? CLEAR_BUILD_ROAD : CLEAR_BUILD_SCATTER;
      if (buildDist(x, y) < need) { return { ok: false, reason: '离建筑太近' }; }
      if (waterDist(x, y) < CLEAR_WATER) { return { ok: false, reason: '离水面太近' }; }
      var rd = roadDist(x, y, Math.max(ROAD_MIN, need));
      if (rd < ROAD_MIN) { return { ok: false, reason: '种在路中间了' }; }
      if (treeDist(x, y) < CLEAR_TREE) { return { ok: false, reason: '和已有树重叠' }; }
      return { ok: true, reason: '', roadDist: rd };
    }

    /* 面积网格：只保留落在校园内的格，省一半计算 */
    var bb = opts.bbox || (ring ? ringBBox(ring) : [-900, -700, 900, 700]);
    var gw = Math.ceil((bb[2] - bb[0]) / CELL), gh = Math.ceil((bb[3] - bb[1]) / CELL);
    var nCells = gw * gh;
    var cellInside = new Uint8Array(nCells);
    var cx0 = bb[0], cy0 = bb[1];
    var insideCount = 0;
    for (var gx = 0; gx < gw; gx++) {
      for (var gy = 0; gy < gh; gy++) {
        var wx = cx0 + (gx + 0.5) * CELL, wy = cy0 + (gy + 0.5) * CELL;
        var ok = ring ? pointInRing(wx, wy, ring) : true;
        if (ok) { cellInside[gx * gh + gy] = 1; insideCount++; }
      }
    }

    /* 沿路采样点：直接用 data/graph.js 的 613 条边（与算路同一份图），每边 4 点 */
    var edges = (graph && graph.edges) || [];
    var nodes = (graph && graph.nodes) || [];
    var sx = [], sy = [], sw = [], sEdge = [], sFrac = [];
    var totalLen = 0, edgeLen = [], edgeStart = [];
    for (var e = 0; e < edges.length; e++) {
      var a = nodes[edges[e][0]], b = nodes[edges[e][1]], len = num(edges[e][2], 0);
      if (!a || !b || !(len > 0)) { continue; }
      edgeStart.push(sx.length);
      edgeLen.push(len);
      totalLen += len;
      for (var k = 0; k < ROAD_SAMPLES; k++) {
        var f = (k + 0.5) / ROAD_SAMPLES;
        sx.push(a[0] + (b[0] - a[0]) * f);
        sy.push(a[1] + (b[1] - a[1]) * f);
        sw.push(len / ROAD_SAMPLES);
        sEdge.push(e);
        sFrac.push(f);
      }
    }
    var nSamples = sx.length;
    var sGrid = new Grid(30);
    for (var si = 0; si < nSamples; si++) { sGrid.addPoint(sx[si], sy[si], si); }

    /* 优化用的候选池：行道树位 + 空地，两类都先过 legal()。
         两类按 1:1 轮流进池（先到先得会全被行道树占满，空地一个都进不来）。 */
    var candidates = null;
    function buildCandidates() {
      if (candidates) { return candidates; }
      var roadPool = [], grovePool = [];
      function addTo(list, x, y, kind) {
        if (list.length >= MAX_CANDIDATES) { return; }
        var l = legal(x, y, kind);
        if (!l.ok) { return; }
        list.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, r: TREE_R, h: TREE_H, kind: kind });
      }
      // 1) 行道树位：沿每条底图道路每 15 m，两侧各一个候选
      for (var ri = 0; ri < roads.length; ri++) {
        var rp = roads[ri] && roads[ri].p;
        if (!rp || rp.length < 2) { continue; }
        for (var pi = 0; pi + 1 < rp.length; pi++) {
          var ax = rp[pi][0], ay = rp[pi][1], bx = rp[pi + 1][0], by = rp[pi + 1][1];
          var dx = bx - ax, dy = by - ay, dl = Math.sqrt(dx * dx + dy * dy);
          if (dl < 0.5) { continue; }
          var ux = dx / dl, uy = dy / dl, nx = -uy, ny = ux;
          for (var d = 0; d < dl; d += STEP_ROAD) {
            var cxp = ax + ux * d, cyp = ay + uy * d;
            addTo(roadPool, cxp + nx * OFF_MID, cyp + ny * OFF_MID, 'road');
            addTo(roadPool, cxp - nx * OFF_MID, cyp - ny * OFF_MID, 'road');
          }
        }
      }
      // 2) 空地：26 m 网格 + 固定抖动（确定性，不用随机数）
      if (ring && ring.length >= 3) {
        var cb = ringBBox(ring);
        var n = 0;
        for (var gx2 = cb[0]; gx2 <= cb[2]; gx2 += SCATTER_CELL) {
          for (var gy2 = cb[1]; gy2 <= cb[3]; gy2 += SCATTER_CELL) {
            n++;
            var jx = ((n * 37) % 19) / 19 - 0.5, jy = ((n * 53) % 23) / 23 - 0.5;
            addTo(grovePool, gx2 + jx * 2 * SCATTER_JITTER, gy2 + jy * 2 * SCATTER_JITTER, 'grove');
          }
        }
      }
      var out = [];
      var half = Math.ceil(MAX_CANDIDATES / 2);
      var ri2 = 0, gi2 = 0;
      while (out.length < MAX_CANDIDATES && (ri2 < roadPool.length || gi2 < grovePool.length)) {
        if (ri2 < roadPool.length && (out.length < half || gi2 >= grovePool.length)) { out.push(roadPool[ri2++]); }
        if (gi2 < grovePool.length && out.length < MAX_CANDIDATES) { out.push(grovePool[gi2++]); }
      }
      candidates = out;
      return candidates;
    }

    /* ---------- 指标 ---------- */

    // 测量用的临时数组：拖动时每帧都要算，反复 new 会拖 GC，做成复用（每次 fill(0)）
    var mCellCov = null, mSampCov = null, mECov = null;

    /* 单帧：树影盖住的网格面积 + 盖住的路段长度 + 与建筑合并后的路网阴凉占比 */
    function measure(trees, frameIdx) {
      var fr = frames[frameIdx] || null;
      var sun = fr ? fr.sun : null;
      var coveredCells = 0, treeLen = 0;
      var cellCov = mCellCov || (mCellCov = new Uint8Array(nCells));
      cellCov.fill(0);
      var sampCov = mSampCov || (mSampCov = new Uint8Array(nSamples));
      sampCov.fill(0);
      var eCov = mECov || (mECov = new Uint16Array(edgeLen.length));
      eCov.fill(0);
      var i, k, t, cap;

      for (i = 0; i < trees.length; i++) {
        cap = shadowCapsule(trees[i], sun);
        if (!cap) { continue; }
        var box = capBBox(cap);
        var gx1 = Math.max(0, Math.floor((box[0] - cx0) / CELL)), gx2 = Math.min(gw - 1, Math.floor((box[2] - cx0) / CELL));
        var gy1 = Math.max(0, Math.floor((box[1] - cy0) / CELL)), gy2 = Math.min(gh - 1, Math.floor((box[3] - cy0) / CELL));
        for (var gx3 = gx1; gx3 <= gx2; gx3++) {
          for (var gy3 = gy1; gy3 <= gy2; gy3++) {
            var idx = gx3 * gh + gy3;
            if (!cellInside[idx] || cellCov[idx]) { continue; }
            var wx2 = cx0 + (gx3 + 0.5) * CELL, wy2 = cy0 + (gy3 + 0.5) * CELL;
            if (pointInCapsule(wx2, wy2, cap)) { cellCov[idx] = 1; coveredCells++; }
          }
        }
        var near = sGrid.near((box[0] + box[2]) / 2, (box[1] + box[3]) / 2,
          Math.max(box[2] - box[0], box[3] - box[1]) / 2 + 30);
        for (k = 0; k < near.length; k++) {
          var si2 = near[k];
          if (sampCov[si2]) { continue; }
          if (pointInCapsule(sx[si2], sy[si2], cap)) { sampCov[si2] = 1; eCov[sEdge[si2]]++; }
        }
      }
      for (k = 0; k < nSamples; k++) { if (sampCov[k]) { treeLen += sw[k]; } }

      // 与建筑阴影合并：每边取 max(建筑遮挡比例, 树遮挡比例)，避免重复计算
      var exposed = (graph && graph.exposed && graph.exposed[frameIdx]) || null;
      var shadedLen = 0;
      for (i = 0; i < edgeLen.length; i++) {
        var bFrac = 0;
        if (exposed && exposed[i] !== undefined) {
          // data/graph.js 里 exposed[帧][边] = 该边的暴晒千分比（0–1000）
          bFrac = 1 - num(exposed[i], 1000) / 1000;
          if (bFrac < 0) { bFrac = 0; }
          if (bFrac > 1) { bFrac = 1; }
        }
        var tFrac = eCov[i] / ROAD_SAMPLES;
        shadedLen += edgeLen[i] * Math.max(bFrac, tFrac);
      }
      var ratio = totalLen > 0 ? shadedLen / totalLen : 0;
      return {
        frame: frameIdx,
        areaM2: coveredCells * CELL * CELL,
        treeShadeLen: treeLen,
        shadedLen: shadedLen,
        totalLen: totalLen,
        ratio: ratio,
        minutes: treeLen / WALK_SPEED / 60,
        cells: coveredCells,
        sun: sun
      };
    }

    /* 全帧累计：只算"树带来的"遮阴分钟（优化器的目标函数） */
    function measureDay(trees) {
      var minutes = 0, areaSum = 0, n = frames.length || 0;
      for (var f = 0; f < n; f++) {
        var m = measure(trees, f);
        minutes += m.minutes;
        areaSum += m.areaM2;
      }
      return { minutes: minutes, areaAvg: n ? areaSum / n : 0, frames: n };
    }

/* ---------- 优化器 ----------
       贪心选点：每轮挑"日累计边际遮阴分钟"最高的候选，直到 count 个或没有正增益。
       覆盖函数对树的位置是**子模**的（每多一棵，新增覆盖只会更少），所以贪心有 1-1/e 近似保证。
       约束：两两 ≥ minGap（要"分散到多个片区"，不能 20 棵挤一条路）。

       为什么不是每轮把所有候选重算一遍：4200 个候选 × 31 帧 × 每帧几十个采样点，
       全量重算实测 20 s（第一版就这么写的）。现在做两件事把它压到百毫秒级：
         1) 树的 h/r 固定 => 每帧的影子方向与长度与候选无关，预计算一次；
         2) 每个候选一次性取出"影子最长时可能够到"的采样点（reach），
            之后每帧只做点积判距（不再查空间哈希），并缓存到 Float32Array；
         3) 惰性贪心（CELF）：候选的边际增益只会随选点变少，
            堆顶条目没被更新过就直接用，只有变旧了才重算。
    */
    function optimize(opt) {
      opt = opt || {};
      var count = num(opt.count, 20);
      var gap = num(opt.minGap, MIN_GAP);
      var onProgress = opt.onProgress || null;
      var pool = opt.candidates || buildCandidates();
      var nF = frames.length || 0;
      if (!pool.length || !nF) {
        return { picks: [], pool: pool.length, alive: 0, frames: nF, totalMinutes: 0,
          totalMeters: 0, totalAreaM2: 0, budgetWan: 0, perWanMinutes: 0, costYuan: 0 };
      }

      // 1) 每帧的影子单位向量与长度（树高固定，与候选无关）
      var ux = new Float64Array(nF), uy = new Float64Array(nF), sl = new Float64Array(nF);
      var maxL = 0;
      for (var f = 0; f < nF; f++) {
        var sun = (frames[f] || {}).sun || [0, 0];
        var el = num(sun[1], 0), az = num(sun[0], 0);
        var L = el < MIN_SUN_ELEV ? 0 : Math.min(MAX_SHADOW_LEN, TREE_H / Math.tan(el * Math.PI / 180));
        var rad = az * Math.PI / 180;
        ux[f] = -Math.sin(rad);
        uy[f] = -Math.cos(rad);
        sl[f] = L;
        if (L > maxL) { maxL = L; }
      }
      var reach = maxL + TREE_R + 2;
      var r2 = TREE_R * TREE_R;
      var nP = pool.length;

      // 2) 每个候选：够得着的采样点 + 相对位移（与帧无关）
      var nearIdx = new Array(nP), nearDX = new Array(nP), nearDY = new Array(nP), nearSW = new Array(nP);
      for (var ci = 0; ci < nP; ci++) {
        var c = pool[ci];
        var list = sGrid.near(c.x, c.y, reach);
        var idx = new Int32Array(list.length), dxs = new Float32Array(list.length);
        var dys = new Float32Array(list.length), sws = new Float32Array(list.length);
        for (var k = 0; k < list.length; k++) {
          var s = list[k];
          idx[k] = s;
          dxs[k] = sx[s] - c.x;
          dys[k] = sy[s] - c.y;
          sws[k] = sw[s];
        }
        nearIdx[ci] = idx; nearDX[ci] = dxs; nearDY[ci] = dys; nearSW[ci] = sws;
      }

      // 覆盖计数：cnt[帧][采样点]（Uint8 够用：最多 20 棵）
      var cnt = new Uint8Array(nF * nSamples);
      var areaFrame = num(opt.areaFrame, -1);     // 面积只报某一帧（默认不报）
      var cellCnt = new Uint8Array(nCells);
      var areaCells = 0;

      // 候选 ci 在当前已选集合下的边际增益；commit=true 时顺便把覆盖记账
      function marginal(ci, commit) {
        var dxs = nearDX[ci], dys = nearDY[ci], sws = nearSW[ci], idx = nearIdx[ci];
        var m = idx.length, total = 0, s, dx, dy, dot, f, L, vx, vy, off;
        for (f = 0; f < nF; f++) {
          L = sl[f];
          if (L <= 0) { continue; }
          vx = ux[f]; vy = uy[f]; off = f * nSamples;
          for (var k = 0; k < m; k++) {
            s = idx[k];
            if (cnt[off + s]) { continue; }
            dx = dxs[k]; dy = dys[k];
            dot = dx * vx + dy * vy;
            // 点到胶囊轴的平方距离：t = clamp(dot, 0, L)，d² = |v|² - 2·t·dot + t²
            // （不能写成 |v|²-dot²：影子末端之外的点，dot 被夹住之后那个式子不成立）
            var t = dot < 0 ? 0 : (dot > L ? L : dot);
            if (dx * dx + dy * dy - 2 * t * dot + t * t <= r2) {
              total += sws[k];
              if (commit) { cnt[off + s] = 1; }
            }
          }
        }
        // 面积（只算指定帧、只给最终入选的点算）
        if (commit && areaFrame >= 0 && areaFrame < nF && sl[areaFrame] > 0) {
          var px = pool[ci].x, py = pool[ci].y;
          var bx2 = px + ux[areaFrame] * sl[areaFrame], by2 = py + uy[areaFrame] * sl[areaFrame];
          var capA = { ax: px, ay: py, bx: bx2, by: by2, r: TREE_R };
          var box = [Math.min(px, bx2) - TREE_R, Math.min(py, by2) - TREE_R,
            Math.max(px, bx2) + TREE_R, Math.max(py, by2) + TREE_R];
          var gx1 = Math.max(0, Math.floor((box[0] - cx0) / CELL)), gx2 = Math.min(gw - 1, Math.floor((box[2] - cx0) / CELL));
          var gy1 = Math.max(0, Math.floor((box[1] - cy0) / CELL)), gy2 = Math.min(gh - 1, Math.floor((box[3] - cy0) / CELL));
          for (var gx = gx1; gx <= gx2; gx++) {
            for (var gy = gy1; gy <= gy2; gy++) {
              var idx2 = gx * gh + gy;
              if (!cellInside[idx2] || cellCnt[idx2]) { continue; }
              if (pointInCapsule(cx0 + (gx + 0.5) * CELL, cy0 + (gy + 0.5) * CELL, capA)) {
                cellCnt[idx2] = 1;
                areaCells++;
              }
            }
          }
        }
        return total;
      }

      // 3) 二叉堆（大顶堆）+ 惰性重算
      var heap = [];
      function hpush(g, ci3, it) {
        heap.push([g, ci3, it]);
        var i = heap.length - 1;
        while (i > 0) {
          var p = (i - 1) >> 1;
          if (heap[p][0] >= heap[i][0]) { break; }
          var t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p;
        }
      }
      function hpop() {
        var top = heap[0], last = heap.pop();
        if (heap.length) {
          heap[0] = last;
          var i = 0;
          for (;;) {
            var l = 2 * i + 1, r = l + 1, b = i;
            if (l < heap.length && heap[l][0] > heap[b][0]) { b = l; }
            if (r < heap.length && heap[r][0] > heap[b][0]) { b = r; }
            if (b === i) { break; }
            var t = heap[b]; heap[b] = heap[i]; heap[i] = t; i = b;
          }
        }
        return top;
      }

      var blocked = new Uint8Array(nP);
      var picks = [], iter = 0, alive = 0;
      for (var i0 = 0; i0 < nP; i0++) {
        var g0 = marginal(i0, false);
        if (g0 > 0) { hpush(g0, i0, 0); alive++; }
      }

      while (picks.length < count && heap.length) {
        var top = hpop();
        var ci2 = top[1];
        if (blocked[ci2]) { continue; }
        var gain;
        if (top[2] === iter) {
          gain = marginal(ci2, true);          // 精确边际 + 记账
        } else {
          var g2 = marginal(ci2, false);       // 变旧了，重算再排队
          if (g2 > 0) { hpush(g2, ci2, iter); }
          continue;
        }
        if (gain <= 0) { continue; }
        var chosen = pool[ci2];
        picks.push({
          x: chosen.x, y: chosen.y, r: chosen.r, h: chosen.h, kind: chosen.kind,
          gainMeters: gain,
          gainMinutes: gain / WALK_SPEED / 60,
          rank: picks.length + 1
        });
        iter++;
        if (onProgress) { onProgress(picks.length, count); }
        // 分散约束：把太近的候选永久出局
        var gx3 = gap * gap;
        for (var b3 = 0; b3 < nP; b3++) {
          if (blocked[b3]) { continue; }
          var ddx = pool[b3].x - chosen.x, ddy = pool[b3].y - chosen.y;
          if (ddx * ddx + ddy * ddy < gx3) { blocked[b3] = 1; }
        }
      }

      var totalMin = 0, totalM = 0;
      for (var pk = 0; pk < picks.length; pk++) {
        totalMin += picks[pk].gainMinutes;
        totalM += picks[pk].gainMeters;
      }
      var budgetWan = picks.length * COST_PER_TREE / WAN;
      return {
        picks: picks, pool: nP, alive: alive, frames: nF,
        totalMinutes: totalMin, totalMeters: totalM,
        totalAreaM2: areaCells * CELL * CELL,
        budgetWan: budgetWan,
        perWanMinutes: budgetWan > 0 ? totalMin / budgetWan : 0,
        costYuan: picks.length * COST_PER_TREE
      };
    }

    return {
      legal: legal,
      measure: measure,
      measureDay: measureDay,
      optimize: optimize,
      candidates: buildCandidates,
      geometry: { gw: gw, gh: gh, cell: CELL, nCells: nCells, insideCount: insideCount },
      road: { nSamples: nSamples, totalLen: totalLen, edges: edgeLen.length },
      frameCount: frames.length || 0
    };
  }

  /* ---------------- 成本 ---------------- */
  function cost(n) {
    var k = num(n, 0);
    return { trees: k, yuan: k * COST_PER_TREE, wan: k * COST_PER_TREE / WAN, perTree: COST_PER_TREE };
  }

  /* 每万元能买到多少分钟：UI 与 smoke 共用一处换算 */
  function perWan(minutes, trees) {
    var wan = num(trees, 0) * COST_PER_TREE / WAN;
    return wan > 0 ? num(minutes, 0) / wan : 0;
  }

  /* ---------------- 点位描述：最近的有名字的楼 + 方位 ---------------- */
  function describe(x, y, buildings) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < buildings.length; i++) {
      var b = buildings[i];
      if (!b || !b.name || !b.p || b.p.length < 3) { continue; }
      var c = centroid(b.p);
      var d = Math.sqrt((x - c[0]) * (x - c[0]) + (y - c[1]) * (y - c[1]));
      if (d < bestD) { bestD = d; best = { name: b.name, c: c }; }
    }
    if (!best || bestD > 150) { return '空地（' + Math.round(x) + ', ' + Math.round(y) + '）'; }
    var dx = x - best.c[0], dy = y - best.c[1];
    var dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
    var az = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    var dir = dirs[Math.round(az / 45) % 8];
    return best.name + dir + '侧 ' + Math.round(bestD) + ' m';
  }

  function centroid(ring) {
    var sx2 = 0, sy2 = 0;
    for (var i = 0; i < ring.length; i++) { sx2 += ring[i][0]; sy2 += ring[i][1]; }
    return [sx2 / ring.length, sy2 / ring.length];
  }

  /* ---------------- 持久化（localStorage，不可用时由调用方降级为内存） ---------------- */
  var STORE_KEY = 'shaderoute.plan.v1';

  function serialize(trees) {
    var out = [];
    for (var i = 0; i < (trees || []).length; i++) {
      var t = trees[i];
      if (!t || !isFinite(t.x) || !isFinite(t.y)) { continue; }
      out.push([Math.round(t.x * 10) / 10, Math.round(t.y * 10) / 10]);
    }
    return JSON.stringify({ v: 1, trees: out });
  }

  function parse(raw) {
    if (!raw) { return []; }
    var obj;
    try { obj = JSON.parse(raw); } catch (e) { return []; }
    if (!obj || obj.v !== 1 || !obj.trees || !obj.trees.length) { return []; }
    var out = [];
    for (var i = 0; i < obj.trees.length; i++) {
      var p = obj.trees[i];
      if (!p || !isFinite(p[0]) || !isFinite(p[1])) { continue; }
      out.push({ x: p[0], y: p[1], r: TREE_R, h: TREE_H });
    }
    return out;
  }

  return {
    COST_PER_TREE: COST_PER_TREE,
    TREE_R: TREE_R,
    TREE_H: TREE_H,
    MIN_GAP: MIN_GAP,
    CELL: CELL,
    ROAD_SAMPLES: ROAD_SAMPLES,
    WALK_SPEED: WALK_SPEED,
    STORE_KEY: STORE_KEY,
    makeContext: makeContext,
    shadowCapsule: shadowCapsule,
    pointInCapsule: pointInCapsule,
    capBBox: capBBox,
    distSeg: distSeg,
    cost: cost,
    perWan: perWan,
    describe: describe,
    serialize: serialize,
    parse: parse
  };
})();