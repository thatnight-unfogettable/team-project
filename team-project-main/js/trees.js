/* 树元素（纯观感层：不参与阴影、不参与晒度时长）
 *
 * 为什么是"现场生成"而不是 data/trees.js：
 *   - data/*.js 只能由 tools/build.py 写；OSM 原始数据里没有校园树木面，build.py 没有树的数据源；
 *   - 树是装饰，不参与任何权威数字（阴影米数、暴晒千分比都由 build.py 预计算，与树无关），
 *     所以不能因为它去动 data/ 的口径；
 *   - 固定种子现场生成 => 每次打开完全一样，smoke 可以逐棵对拍，也能查出"改一行就悄悄变样"。
 *
 * 摆放规则（先撒候选，再层层筛掉不该长树的地方）：
 *   1) 行道树：沿每条道路每 15 m 一个候选，左右各偏 3.6~5.4 m（人行道/绿化带的位置）；
 *   2) 成片树：26 m 网格 + 抖动撒点，必须落在校园边界内，离楼 6 m、离水 4.5 m、离路 2.6 m 以上；
 *   3) 树冠之间保底 3.2 m 间距（空间哈希查邻居，避免糊成一坨）；
 *   4) 总数封顶 520 棵：再多画布会花，拖时间轴也要掉帧。
 *
 * 坐标全部是校园米坐标（与 data/*.js 同一套），由 map.js 用 view/proj 自行投影。
 */
(function (global) {
  'use strict';

  var SEED = 20261103;          // 换这个数 => 树的位置整体换一套（smoke 有确定性断言）
  var STEP_ROAD = 15;           // 沿路采样步长（米）
  var OFF_MIN = 3.6;            // 行道树离路中心线的最小偏移
  var OFF_MAX = 5.4;            // 最大偏移
  var SCATTER_CELL = 26;        // 成片树的网格边长
  var SCATTER_JITTER = 9;       // 网格内的随机抖动幅度
  var CLEAR_BUILD_ROAD = 2.0;   // 行道树离最近楼体（含树冠不会被墙啃掉）
  var CLEAR_BUILD_SCATTER = 6.0;
  var CLEAR_WATER = 4.5;
  var CLEAR_ROAD = 2.6;
  var MIN_GAP = 3.2;
  var LIMIT = 520;
  var R_MIN = 2.6, R_MAX = 5.2;   // 树冠半径（米）
  var H_MIN = 6.5, H_MAX = 11.5;  // 树高（米），比教学楼矮一截才像树

  /* ---------- 确定性伪随机（mulberry32：同一个种子永远同一串数） ---------- */
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- 几何小工具 ---------- */
  function pointInRing(x, y, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1];
      var xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  function distSeg(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    var t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    var qx = ax + t * dx, qy = ay + t * dy;
    return Math.sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy));
  }

  /* 点到多边形轮廓的距离；点在多边形内返回 0 */
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

  /* ---------- 空间哈希：把"查最近楼/最近路/最近树"从 O(n·m) 降到 O(n) ---------- */
  function Grid(cell) {
    this.cell = cell;
    this.bins = {};
  }
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
  /* 半径 r 内出现过的候选值（去重） */
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

  /* ---------- 主入口 ----------
     返回 [{ x, y, r, h, tone }]，已按 (y, x) 排好序：
     俯视图里先画北边的树，南边的压在上面，看着才有层次。 */
  function generate(opts) {
    opts = opts || {};
    var buildings = opts.buildings || [];
    var roads = opts.roads || [];
    var water = opts.water || [];
    var campus = opts.campusRing || null;
    var limit = opts.limit || LIMIT;
    var rnd = mulberry32(opts.seed === undefined ? SEED : opts.seed);
    var stats = { roadCandidates: 0, scatterCandidates: 0, nearBuilding: 0, inWater: 0, nearRoad: 0, outside: 0, tooClose: 0 };

    // 楼：轮廓 + 包围盒；水：轮廓
    var bRings = [], bGrid = new Grid(20);
    for (var i = 0; i < buildings.length; i++) {
      var ring = buildings[i] && buildings[i].p;
      if (!ring || ring.length < 3) { continue; }
      bRings.push(ring);
      bGrid.addBox(ringBBox(ring), bRings.length - 1);
    }
    function buildDist(x, y) {
      var idxs = bGrid.near(x, y, CLEAR_BUILD_SCATTER);
      var best = Infinity;
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
    // 路：按线段进网格
    var segs = [];
    var rGrid = new Grid(25);
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
    function roadDist(x, y, r) {
      var idxs = rGrid.near(x, y, r);
      var best = Infinity;
      for (var k = 0; k < idxs.length; k++) {
        var sg = segs[idxs[k]];
        var d = distSeg(x, y, sg[0], sg[1], sg[2], sg[3]);
        if (d < best) { best = d; }
      }
      return best;
    }

    var trees = [];
    var tGrid = new Grid(Math.max(MIN_GAP, 4));
    // 行道树先撒，但要留出空地的名额：只撒到 62% 就停手，
    // 否则 520 棵全被马路两边占满，空地还是光秃秃一片（第一版就是这个毛病）。
    var roadCap = Math.round(limit * 0.62);

    function pushTree(x, y, buildClear, cap) {
      if (trees.length >= (cap || limit)) { return false; }
      if (campus && !pointInRing(x, y, campus)) { stats.outside++; return false; }
      if (buildDist(x, y) < buildClear) { stats.nearBuilding++; return false; }
      if (waterDist(x, y) < CLEAR_WATER) { stats.inWater++; return false; }
      var neigh = tGrid.near(x, y, MIN_GAP);
      for (var k = 0; k < neigh.length; k++) {
        var t = trees[neigh[k]];
        var dd = Math.sqrt((x - t.x) * (x - t.x) + (y - t.y) * (y - t.y));
        if (dd < MIN_GAP) { stats.tooClose++; return false; }
      }
      var tree = {
        x: Math.round(x * 100) / 100,
        y: Math.round(y * 100) / 100,
        r: Math.round((R_MIN + rnd() * (R_MAX - R_MIN)) * 100) / 100,
        h: Math.round((H_MIN + rnd() * (H_MAX - H_MIN)) * 100) / 100,
        tone: Math.round(rnd() * 100) / 100
      };
      tGrid.addPoint(tree.x, tree.y, trees.length);
      trees.push(tree);
      return true;
    }

    /* 1) 沿路两侧行道树 */
    for (var ri = 0; ri < roads.length; ri++) {
      var rp = roads[ri] && roads[ri].p;
      if (!rp || rp.length < 2) { continue; }
      for (var pi = 0; pi + 1 < rp.length; pi++) {
        var ax = rp[pi][0], ay = rp[pi][1], bx = rp[pi + 1][0], by = rp[pi + 1][1];
        var dx = bx - ax, dy = by - ay;
        var len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.5) { continue; }
        var ux = dx / len, uy = dy / len;
        var nx = -uy, ny = ux;                       // 左法线
        for (var d = 0; d < len; d += STEP_ROAD) {
          var cx = ax + ux * d, cy = ay + uy * d;
          for (var side = -1; side <= 1; side += 2) {
            stats.roadCandidates++;
            var off = OFF_MIN + rnd() * (OFF_MAX - OFF_MIN);
            var px = cx + nx * off * side, py = cy + ny * off * side;
            if (roadDist(px, py, CLEAR_ROAD) < CLEAR_ROAD) { stats.nearRoad++; continue; }
            pushTree(px, py, CLEAR_BUILD_ROAD, roadCap);
          }
        }
      }
    }

    /* 2) 空地里成片撒树（校园边界内、离楼离水离路都够远） */
    stats.roadTrees = trees.length;
    if (campus && campus.length >= 3) {
      var cb = ringBBox(campus);
      for (var gx = cb[0]; gx <= cb[2]; gx += SCATTER_CELL) {
        for (var gy = cb[1]; gy <= cb[3]; gy += SCATTER_CELL) {
          stats.scatterCandidates++;
          var sx = gx + (rnd() - 0.5) * 2 * SCATTER_JITTER;
          var sy = gy + (rnd() - 0.5) * 2 * SCATTER_JITTER;
          if (!pointInRing(sx, sy, campus)) { stats.outside++; continue; }
          if (buildDist(sx, sy) < CLEAR_BUILD_SCATTER) { stats.nearBuilding++; continue; }
          if (waterDist(sx, sy) < CLEAR_WATER) { stats.inWater++; continue; }
          if (roadDist(sx, sy, CLEAR_ROAD) < CLEAR_ROAD) { stats.nearRoad++; continue; }
          pushTree(sx, sy, CLEAR_BUILD_SCATTER);
        }
      }
    }

    stats.groveTrees = trees.length - stats.roadTrees;

    trees.sort(function (a, b) { return (a.y - b.y) || (a.x - b.x); });
    generate.stats = stats;
    return trees;
  }

  function count() { return LIMIT; }

  global.TREES = {
    SEED: SEED,
    LIMIT: LIMIT,
    MIN_GAP: MIN_GAP,
    mulberry32: mulberry32,
    pointInRing: pointInRing,
    ringDist: ringDist,
    generate: generate,
    limit: count
  };
})(typeof window !== 'undefined' ? window : this);