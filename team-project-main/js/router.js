/* ============================================================
   凉径 ShadeRoute Lite —— 浏览器端即时算路
   ============================================================
   为什么要在浏览器里再算一遍？
     预计算只能覆盖 tools/build.py 里写死的那两条路线。老师现场问
     "从宿舍到图书馆怎么走"，页面就答不出来。所以把路网（474 节点 /
     613 边）和每帧的暴晒比例一起发给浏览器，现场跑 Dijkstra，就能
     回答任意两点。

   和 Python 端保持一致的约定：
     · 用时 = 长度 / walkSpeed / 60，walkSpeed 默认 1.25 m/s
     · 阴凉权重 = 长度 × (1 + coolFactor × 暴晒比例)，coolFactor 默认 6
     · 暴晒分钟 = Σ(边长 × 该边暴晒比例) / walkSpeed / 60
     · 只允许吸附到最大连通分量上的节点（否则会吸到孤岛，算不出路）

   图数据来自 data/graph.js（window.DATA_GRAPH），由 build.py 的
   routes 子命令生成；这里不联网、不读文件。
   ============================================================ */

window.ROUTER = (function () {
  'use strict';

  var state = {
    adj: null,          // [{v, e}, ...] 按节点索引
    nodes: null,        // [[x, y], ...]
    edges: null,        // [[a, b, len], ...]
    exposed: null,      // [帧][边] = 0..1000（千分比）
    main: null,         // [1/0, ...]
    anchors: null,
    coolFactor: 6.0,
    walkSpeed: 1.25
  };

  function prepare(graph) {
    if (!graph || !graph.nodes || !graph.edges) { return false; }
    state.nodes = graph.nodes;
    state.edges = graph.edges;
    state.exposed = graph.exposed || [];
    state.exposedUnit = typeof graph.exposedUnit === 'number' ? graph.exposedUnit : 1000;
    state.main = graph.main || [];
    state.anchors = graph.anchors || [];
    state.coolFactor = typeof graph.coolFactor === 'number' ? graph.coolFactor : 6.0;
    state.walkSpeed = typeof graph.walkSpeed === 'number' ? graph.walkSpeed : 1.25;

    var adj = [];
    for (var i = 0; i < state.nodes.length; i++) { adj.push([]); }
    for (var e = 0; e < state.edges.length; e++) {
      var a = state.edges[e][0], b = state.edges[e][1];
      adj[a].push({ v: b, e: e });
      adj[b].push({ v: a, e: e });
    }
    state.adj = adj;
    return true;
  }

  function ready() { return !!state.adj; }

  function anchors() { return state.anchors || []; }

  /* 把任意米坐标吸附到最近的、在最大连通分量上的路网节点 */
  function snap(x, y, maxM) {
    if (!state.adj) { return null; }
    var limit = typeof maxM === 'number' ? maxM : 120;
    var best = null, bestD = Infinity;
    for (var i = 0; i < state.nodes.length; i++) {
      if (state.main && state.main.length && !state.main[i]) { continue; }
      var dx = state.nodes[i][0] - x, dy = state.nodes[i][1] - y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best === null || bestD > limit) { return null; }
    return { node: best, dist: bestD, x: state.nodes[best][0], y: state.nodes[best][1] };
  }

  /* 二叉堆（手写，避免依赖） */
  function Heap() { this.a = []; }
  Heap.prototype.push = function (d, v) {
    var a = this.a;
    a.push([d, v]);
    var i = a.length - 1;
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) { break; }
      var t = a[p]; a[p] = a[i]; a[i] = t; i = p;
    }
  };
  Heap.prototype.pop = function () {
    var a = this.a;
    var top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      var i = 0;
      for (;;) {
        var l = 2 * i + 1, r = l + 1, m = i;
        if (l < a.length && a[l][0] < a[m][0]) { m = l; }
        if (r < a.length && a[r][0] < a[m][0]) { m = r; }
        if (m === i) { break; }
        var t = a[m]; a[m] = a[i]; a[i] = t; i = m;
      }
    }
    return top;
  };
  Heap.prototype.size = function () { return this.a.length; };

  /* src -> dst 的最短路，weightFn(边索引) 给权重 */
  function dijkstra(src, dst, weightFn) {
    var n = state.nodes.length;
    var dist = new Array(n);
    var prevN = new Array(n);
    var prevE = new Array(n);
    var done = new Array(n);
    for (var i = 0; i < n; i++) { dist[i] = Infinity; prevN[i] = -1; prevE[i] = -1; done[i] = false; }
    if (src === dst) { return { nodes: [src], edges: [], cost: 0 }; }

    dist[src] = 0;
    var heap = new Heap();
    heap.push(0, src);
    while (heap.size()) {
      var top = heap.pop();
      var d = top[0], u = top[1];
      if (done[u]) { continue; }
      done[u] = true;
      if (u === dst) { break; }
      var nbrs = state.adj[u];
      for (var k = 0; k < nbrs.length; k++) {
        var v = nbrs[k].v, e = nbrs[k].e;
        if (done[v]) { continue; }
        var nd = d + weightFn(e);
        if (nd < dist[v]) {
          dist[v] = nd;
          prevN[v] = u;
          prevE[v] = e;
          heap.push(nd, v);
        }
      }
    }
    if (!isFinite(dist[dst])) { return null; }

    var nodePath = [dst], edgePath = [prevE[dst]];
    while (nodePath[nodePath.length - 1] !== src) {
      var cur = nodePath[nodePath.length - 1];
      var p = prevN[cur];
      if (p < 0) { return null; }
      nodePath.push(p);
      if (p !== src) { edgePath.push(prevE[p]); }
    }
    nodePath.reverse();
    edgePath.reverse();
    return { nodes: nodePath, edges: edgePath, cost: dist[dst] };
  }

  /* 枚举路径上的总长 / 暴晒分钟，并还原折线 */
  function stats(path, frameIdx) {
    var len = 0, exposed = 0;
    var ex = state.exposed[frameIdx] || [];
    var unit = state.exposedUnit || 1000;
    for (var i = 0; i < path.edges.length; i++) {
      var eid = path.edges[i];
      var L = state.edges[eid][2];
      len += L;
      exposed += L * ((ex[eid] || 0) / unit);
    }
    var pts = [];
    for (var j = 0; j < path.nodes.length; j++) {
      var xy = state.nodes[path.nodes[j]];
      pts.push([xy[0], xy[1]]);
    }
    return {
      pts: pts,
      length_m: Math.round(len),
      minutes: Math.round(len / state.walkSpeed / 60.0 * 10) / 10,
      sun_minutes: Math.round(exposed / state.walkSpeed / 60.0 * 10) / 10
    };
  }

  /* 主入口：任意两点 + 某一帧 -> 最快 / 阴凉 两条路线 */
  function solve(fromXY, toXY, frameIdx) {
    if (!state.adj) { return { ok: false, reason: '路网数据没加载' }; }
    if (!fromXY || !toXY) { return { ok: false, reason: '请先选起点和终点' }; }

    var s = snap(fromXY[0], fromXY[1]);
    var t = snap(toXY[0], toXY[1]);
    if (!s) { return { ok: false, reason: '起点离校园道路太远（超过 120 米）' }; }
    if (!t) { return { ok: false, reason: '终点离校园道路太远（超过 120 米）' }; }
    if (s.node === t.node) { return { ok: false, reason: '起点和终点是同一个位置，换一个试试' }; }

    var ex = state.exposed[frameIdx] || [];
    var unit = state.exposedUnit || 1000;
    var cf = state.coolFactor;

    var fast = dijkstra(s.node, t.node, function (e) { return state.edges[e][2]; });
    if (!fast) { return { ok: false, reason: '这两个点之间没有连通的道路' }; }
    var cool = dijkstra(s.node, t.node, function (e) {
      return state.edges[e][2] * (1 + cf * ((ex[e] || 0) / unit));
    });
    if (!cool) { cool = fast; }

    var fstat = stats(fast, frameIdx);
    // 相邻两栋楼会算出 5 米的"路线"，那不是产品要回答的问题
    if (fstat.length_m < 40) {
      // 提示语要说清是"沿路长度"还是"两点直线距离"——两者可能差几十米（见 _review/frontend.md F-A5）
      var straight = Math.sqrt(Math.pow(fromXY[0] - toXY[0], 2) + Math.pow(fromXY[1] - toXY[1], 2));
      return { ok: false, reason: '这两点沿路只有 ' + Math.round(fstat.length_m) +
        ' 米（直线约 ' + Math.round(straight) + ' 米），太近了；换两个远一点的地方试试' };
    }

    return {
      ok: true,
      from: s,
      to: t,
      fastest: fstat,
      cool: stats(cool, frameIdx),
      sameRoute: sameEdges(fast.edges, cool.edges)
    };
  }

  function sameEdges(a, b) {
    if (a.length !== b.length) { return false; }
    for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) { return false; } }
    return true;
  }

  return {
    prepare: prepare,
    ready: ready,
    anchors: anchors,
    snap: snap,
    solve: solve,
    _state: state
  };
})();