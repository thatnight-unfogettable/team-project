/* ============================================================
   凉径 ShadeRoute Lite —— 地图渲染
   责任：xu
   纯 Canvas 2D 自绘，不用任何地图库、不联网。

   图层顺序（从下到上）：
     1. 地面底色（阳光）+ 100 m 网格
     2. 水系（湖/河，可缺省）
     3. 道路网（主干道 / 校内路 / 服务道 / 步道，四档线型）
     4. 阴影（离屏画布整体叠加，避免重叠处变黑）
     5. 建筑轮廓
     6. 校园边界
     7. 路线（最快 / 阴凉）
     8. 地名标注（楼名 / 湖名 / 路名，带白描边、自动避让）
     9. 起终点标记、比例尺
   ============================================================ */

window.MAP = (function () {
  var state = {
    canvas: null,
    ctx: null,
    cssW: 0,
    cssH: 0,
    dpr: 1,
    view: null,          // 当前视图变换（= fit × 滚轮缩放；见 applyZoom）
    baseView: null,      // PROJ.fit() 的原始适配（zoom = 1 时的视图）
    zoom: 1,             // 滚轮缩放倍数：1 = 初始大小，不允许更小
    focus: null,         // 缩放中心（米坐标；null = bbox 中心）
    iso: false,          // 是否处于立体视图（B：2.5D 体块，见 js/iso.js）
    isoView: null,       // 立体视图的底面投影（比 view 略小，旋转后四角才不出画）
    isoProj: null,       // ISO.make() 的投影器
    sun: null,           // 当前帧太阳 [方位角, 高度角]，立体视图算受光面用
    off: null,           // 阴影离屏画布
    offCtx: null
  };

  var FONT = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif';

  // 路网四档线型：casing = 描边宽，fill = 路面宽（CSS px）
  // 偏粗：画布缩到 1200×800 看约 1800 m 宽，1 px 只有 1.5 m —— 原 5/3/1.8/1.2 在
  // 屏幕上读成了"底纹"，尤其占多数的步道（149/296 段）几乎是隐形的。
  // 现在按 9.0 / 6.6 / 4.4 / 2.2 分档，描边同步加粗加深，路口才不会糊。
  var ROAD_STYLE = {
    main: { casing: 12.6, fill: 9.0, casingColor: 'rgba(98,90,70,0.52)', fillColor: '#fffefa' },
    local: { casing: 9.2, fill: 6.6, casingColor: 'rgba(112,104,84,0.46)', fillColor: '#fefcf4' },
    service: { casing: 6.2, fill: 4.4, casingColor: 'rgba(132,124,104,0.40)', fillColor: '#fcf9ee' },
    path: { casing: 0, fill: 2.2, casingColor: null, fillColor: 'rgba(140,126,98,0.70)', dashed: [5, 4] }
  };

  /* ---------- 滚轮缩放 ----------
     只换 view 的 scale 与中心，view.x/y/unx/uny 的语义不变 —— 于是阴影、路网、
     标注、比例尺、地图点选、规划树拖拽全都不用改。
     ZOOM_MIN = 1 就是"整张校园刚好放进画布"的初始适配：再往下滚一律夹回 1，
     也就是"不能缩小到比原本的小"。 */
  var ZOOM_MIN = 1;
  var ZOOM_MAX = 8;              // 8× 时 1 px ≈ 0.24 m（1200×800 窗口）：楼、树冠、门牌都看得清
  var ZOOM_SENSITIVITY = 0.0015; // 滚轮 deltaY(px) 的指数系数：一格 ≈ 1.16×

  function numv(v, d) {
    var n = Number(v);
    return isFinite(n) ? n : d;
  }

  function clampv(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  /* fit() 的结果 + 缩放倍数 + 中心点 => 新 view（其余字段原样带过去） */
  function makeView(base, zoom, cx, cy) {
    var s = base.scale * zoom;
    return {
      scale: s,
      pad: base.pad,
      width: base.width,
      height: base.height,
      bbox: base.bbox,
      cx: cx,
      cy: cy,
      x: function (mx) { return base.width / 2 + (mx - cx) * s; },
      y: function (my) { return base.height / 2 - (my - cy) * s; },
      unx: function (sx) { return cx + (sx - base.width / 2) / s; },
      uny: function (sy) { return cy - (sy - base.height / 2) / s; }
    };
  }

  /* 按 state.zoom / state.focus 重算 view，顺手更新立体视图的底图与投影器 */
  function applyZoom() {
    var base = state.baseView;
    if (!base) { return; }
    var cx = base.cx, cy = base.cy;
    if (state.zoom > ZOOM_MIN && state.focus) {
      // 中心留在 bbox 内：贴着校园边缘放大时，不会把整张图推出画布
      cx = clampv(state.focus[0], base.bbox[0], base.bbox[2]);
      cy = clampv(state.focus[1], base.bbox[1], base.bbox[3]);
      state.focus = [cx, cy];
    }
    state.view = makeView(base, state.zoom, cx, cy);
    if (window.ISO && window.ISO.fitView) {
      state.isoView = window.ISO.fitView(state.view, state.cssW, state.cssH, window.ISO.FIT_FACTOR);
      state.isoProj = window.ISO.make(state.isoView, state.cssW, state.cssH);
    }
  }

  var redrawPending = false;
  /* 滚轮一帧能来好几次：合并到下一帧再重画（没有 rAF 的环境直接画） */
  function redrawSoon() {
    if (redrawPending) { return; }
    var draw = function () {
      redrawPending = false;
      if (window.APP && window.APP.redraw) { window.APP.redraw(); }
    };
    if (window.requestAnimationFrame) {
      redrawPending = true;
      window.requestAnimationFrame(draw);
    } else {
      draw();
    }
  }

  /* 缩放到 z：夹在 [ZOOM_MIN, ZOOM_MAX]；给了画布坐标 (sx, sy) 就以"光标下的
     地面点"为锚（缩放前后这个点不动），没给就绕当前中心。 */
  function zoomTo(z, sx, sy) {
    var base = state.baseView;
    if (!base) { return state.zoom; }
    var next = clampv(numv(z, state.zoom), ZOOM_MIN, ZOOM_MAX);
    if (Math.abs(next - state.zoom) < 1e-9) { return state.zoom; }
    if (next === ZOOM_MIN) {
      state.zoom = ZOOM_MIN;
      state.focus = null;          // 完全回到 fit()：画布上不留任何偏移
    } else {
      if (typeof sx === 'number' && typeof sy === 'number' && state.view) {
        var ax = state.view.unx(sx), ay = state.view.uny(sy);
        var s = base.scale * next;
        state.focus = [ax - (sx - base.width / 2) / s, ay + (sy - base.height / 2) / s];
      }
      state.zoom = next;
    }
    applyZoom();
    redrawSoon();
    return state.zoom;
  }

  function onWheel(ev) {
    var base = state.baseView;
    if (!base) { return; }
    // Ctrl/⌘ + 滚轮是浏览器自己的缩放（触控板捏合也带 ctrlKey），别抢
    if (ev.ctrlKey || ev.metaKey) { return; }
    if (ev.preventDefault) { ev.preventDefault(); }
    var unit = ev.deltaMode === 1 ? 16 : (ev.deltaMode === 2 ? state.cssH : 1);
    var dy = numv(ev.deltaY, 0) * unit;
    if (!dy) { return; }
    var next = state.zoom * Math.exp(-dy * ZOOM_SENSITIVITY);
    if (state.iso) {
      // 立体视图地面斜过来了，"光标下的点"不好对齐：绕当前中心缩放
      zoomTo(next);
    } else {
      var rect = state.canvas.getBoundingClientRect();
      zoomTo(next, ev.clientX - rect.left, ev.clientY - rect.top);
    }
  }
  function init(canvas) {
    state.canvas = canvas;
    state.ctx = canvas.getContext('2d');
    state.off = document.createElement('canvas');
    state.offCtx = state.off.getContext('2d');
    resize();
    // 滚轮缩放：passive:false 才能 preventDefault（否则整页跟着一起滚）
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', scheduleResize);
  }

  /* resize 会重设两块全屏画布的 width/height（重新分配缓冲）再全量重绘，
     拖动窗口时每个事件都做一次会明显卡顿 —— 合并到下一帧。 */
  var resizeTimer = null;
  function scheduleResize() {
    if (resizeTimer) { return; }
    resizeTimer = setTimeout(function () {
      resizeTimer = null;
      resize();
    }, 80);
  }

  function resize() {
    var c = state.canvas;
    var rect = c.parentElement.getBoundingClientRect();
    // dpr 不设上限时，2560×1440@2x 两块画布要 96.7 MB；封到 2 够清晰也够省（见 F-D5）
    state.dpr = Math.min(2, window.devicePixelRatio || 1);
    state.cssW = Math.max(320, Math.floor(rect.width));
    state.cssH = Math.max(240, Math.floor(rect.height));
    c.width = Math.floor(state.cssW * state.dpr);
    c.height = Math.floor(state.cssH * state.dpr);
    c.style.width = state.cssW + 'px';
    c.style.height = state.cssH + 'px';
    state.off.width = c.width;
    state.off.height = c.height;
    state.baseView = window.PROJ.fit(state.cssW, state.cssH, 28);
    applyZoom();   // 保住当前缩放：改窗口大小不跳回初始大小
    if (window.APP && window.APP.redraw) { window.APP.redraw(); }
  }

  function pathPoly(ctx, ring, view, dpr) {
    ctx.beginPath();
    for (var i = 0; i < ring.length; i++) {
      var px = view.x(ring[i][0]) * dpr;
      var py = view.y(ring[i][1]) * dpr;
      if (i === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
    }
    ctx.closePath();
  }

  /* ---------- 立体视图（2.5D 体块）的共用工具 ----------
     做法：底面图层（网格/水系/路网/阴影/路线）照旧用 view 的米坐标，
     只在 setTransform 里整体绕画布中心转一个角度；楼则按楼高竖直拔起。
     于是坐标系有两套：activeView() 给"贴地"的图层用，projPoint() 给
     既要贴地、又要保持文字正立的东西（标注/起终点/校园名）用。 */
  function activeView() {
    return (state.iso && state.isoView) ? state.isoView : state.view;
  }

  /* 地面图层的变换：平面 = 只有 dpr；立体 = dpr ∘ 绕中心旋转 */
  function setLayerTransform(ctx) {
    var dpr = state.dpr;
    if (state.iso && state.isoProj) {
      var m = state.isoProj.cssMatrix(dpr);
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    } else {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  /* 米坐标 -> 画布 CSS 像素（立体视图下带旋转与高度；平面视图忽略 z） */
  function projPoint(mx, my, z) {
    if (state.iso && state.isoProj) { return state.isoProj.project(mx, my, z || 0); }
    return [state.view.x(mx), state.view.y(my)];
  }

  /* 立体视图的楼：把每栋拔成"顶面 + 朝向观察者的侧面"，从远到近画。
     几何（投影、可见面、受光、排序）全在 js/iso.js，这里只管照着画。 */
  function drawBuildingsIso(buildings, trees) {
    if (!window.ISO || !state.isoProj) { drawBuildings(buildings); return; }
    var ctx = state.ctx, dpr = state.dpr;
    var items = window.ISO.scene(buildings, state.isoProj, state.sun, trees);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineJoin = 'round';
    for (var i = 0; i < items.length; i++) {
      var faces = items[i].faces;
      for (var f = 0; f < faces.length; f++) {
        var face = faces[f], pts = face.pts;
        ctx.beginPath();
        for (var k = 0; k < pts.length; k++) {
          if (k === 0) { ctx.moveTo(pts[k][0], pts[k][1]); } else { ctx.lineTo(pts[k][0], pts[k][1]); }
        }
        ctx.closePath();
        ctx.fillStyle = face.fill;
        ctx.fill();
        // 只给顶面描细边：棱角立得住，侧面描边会糊成一片
        if (face.kind === 'top') {
          ctx.strokeStyle = 'rgba(62,72,90,0.30)';
          ctx.lineWidth = 0.7;
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  /* ---------- 树（纯观感层，不参与阴影/晒度计算） ----------
     位置由 js/trees.js 用固定种子生成；这里只负责画。
     1200 m 跨度下 4 m 树冠只有 1.8 px，所以给一个屏幕最小半径，让它读得出是树。 */
  var TREE_SYM_MIN = 3.0;
  var LEAF_RGB = [104, 146, 96];

  function leafRgb(k) {
    var f = function (v) { return Math.round(Math.min(255, Math.max(0, v * k))); };
    return 'rgb(' + f(LEAF_RGB[0]) + ',' + f(LEAF_RGB[1]) + ',' + f(LEAF_RGB[2]) + ')';
  }

  function drawTrees(trees) {
    if (!trees || !trees.length) { return; }
    var ctx = state.ctx, view = activeView();
    if (!view || !view.scale) { return; }
    var az = (state.sun && state.sun[0] !== undefined) ? state.sun[0] : 180;
    var el = (state.sun && state.sun[1] !== undefined) ? state.sun[1] : 45;
    var sunE = Math.sin(az * Math.PI / 180), sunN = Math.cos(az * Math.PI / 180);
    var sunUp = Math.max(0, Math.min(1, el / 90));

    ctx.save();
    setLayerTransform(ctx);
    // trees 已按 y 排好序：先北后南，南边的树压在北上，俯视图才有层次
    for (var i = 0; i < trees.length; i++) {
      var t = trees[i];
      if (!t) { continue; }
      var cx = view.x(t.x), cy = view.y(t.y);
      var r = Math.max(t.r * view.scale, TREE_SYM_MIN);
      var k = 0.74 + 0.30 * (t.tone === undefined ? 0.5 : t.tone) + 0.10 * sunUp;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = leafRgb(k);
      ctx.fill();
      // 细边：3 px 的圆没有轮廓就是一坨糊点，描一圈立刻能数清"这是一棵棵树"
      ctx.strokeStyle = 'rgba(58,86,56,0.45)';
      ctx.lineWidth = 0.7;
      ctx.stroke();
      // 朝太阳那一侧的受光面
      ctx.beginPath();
      ctx.arc(cx + sunE * r * 0.26, cy - sunN * r * 0.26, r * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = leafRgb(k + 0.34);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ---------- 阴影：先画到离屏画布，再整体半透明贴上来 ---------- */
  function drawShadows(shadowRings) {
    var octx = state.offCtx;
    var dpr = state.dpr;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, state.off.width, state.off.height);
    if (!shadowRings || !shadowRings.length) { return; }

    // 阴影是"铺在地上的多边形"：立体视图下跟地面一起转，只是这里的坐标
    // 已经乘过 dpr（pathPoly 内部乘），所以要用设备像素版的矩阵
    if (state.iso && state.isoProj) {
      var sm = state.isoProj.deviceMatrix(dpr);
      octx.setTransform(sm[0], sm[1], sm[2], sm[3], sm[4], sm[5]);
    }

    octx.fillStyle = '#1d2a45';
    for (var i = 0; i < shadowRings.length; i++) {
      pathPoly(octx, shadowRings[i], activeView(), dpr);
      octx.fill();
    }

    var ctx = state.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.42;
    ctx.drawImage(state.off, 0, 0);
    ctx.restore();
  }

  /* ---------- 建筑 ---------- */
  function drawBuildings(buildings) {
    var ctx = state.ctx, view = state.view, dpr = state.dpr;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    for (var i = 0; i < buildings.length; i++) {
      var b = buildings[i];
      // 越高的楼颜色越深，形成轻微立体感（取色规则在 js/core.js）
      ctx.fillStyle = window.CORE.buildingFill(b.h);
      ctx.strokeStyle = 'rgba(70,80,95,0.55)';
      ctx.lineWidth = 0.8;
      pathPoly(ctx, b.p, view, 1);   // setTransform 已含 dpr，这里用 1
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------- 路线 ---------- */
  function drawRoute(pts, color, width, dashed) {
    if (!pts || pts.length < 2) { return; }
    var ctx = state.ctx, view = activeView(), dpr = state.dpr;
    ctx.save();
    setLayerTransform(ctx);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (dashed) { ctx.setLineDash([7, 5]); }
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var px = view.x(pts[i][0]);
      var py = view.y(pts[i][1]);
      if (i === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
    }
    ctx.stroke();

    // 白色描边，在深色阴影上也看得清
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1, width - 5);
    ctx.globalAlpha = 0.35;
    ctx.stroke();
    ctx.restore();
  }

  function drawEndpoints(fromXY, toXY) {
    var ctx = state.ctx, dpr = state.dpr;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // 圆点与"起/终"两个字保持正立
    [[fromXY, '#38c172', '起'], [toXY, '#ff7a45', '终']].forEach(function (item) {
      var p = item[0];
      if (!p) { return; }
      var pp = projPoint(p[0], p[1], 0), px = pp[0], py = pp[1];
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = item[1];
      ctx.stroke();
      ctx.fillStyle = '#10141c';
      ctx.font = '600 10px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item[2], px, py + 0.5);
    });
    ctx.restore();
  }

  /* ---------- 校门 ----------
     位置来自 core.gatesFromRoads（道路 × 校园边界的交点），这里只负责画：
     白底深框的圆点 + 外推一点的门名牌，立体视图下文字保持正立。 */
  function drawGates(gates, ring) {
    if (!gates || !gates.length) { return; }
    var ctx = state.ctx, dpr = state.dpr;
    var cx = 0, cy = 0;
    if (ring && ring.length) {
      for (var k = 0; k < ring.length; k++) { cx += ring[k][0]; cy += ring[k][1]; }
      cx /= ring.length; cy /= ring.length;
    }
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < gates.length; i++) {
      var gt = gates[i];
      if (!gt) { continue; }
      var pp = projPoint(gt.x, gt.y, 0), px = pp[0], py = pp[1];
      var dx = gt.x - cx, dy = gt.y - cy;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var out = projPoint(gt.x + dx / len * 17, gt.y + dy / len * 17, 0);

      ctx.beginPath();
      ctx.arc(px, py, gt.main ? 4.8 : 3.6, 0, Math.PI * 2);
      ctx.fillStyle = '#fffdf4';
      ctx.fill();
      ctx.lineWidth = gt.main ? 1.8 : 1.2;
      ctx.strokeStyle = gt.main ? '#2f3b52' : '#7a8394';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, py, (gt.main ? 4.8 : 3.6) * 0.38, 0, Math.PI * 2);
      ctx.fillStyle = gt.main ? '#2f3b52' : '#7a8394';
      ctx.fill();

      ctx.font = (gt.main ? '600 ' : '') + '10px ' + FONT;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,253,244,0.92)';
      ctx.strokeText(gt.name, out[0], out[1]);
      ctx.fillStyle = gt.main ? '#2f3b52' : '#5b6474';
      ctx.fillText(gt.name, out[0], out[1]);
    }
    ctx.restore();
  }

  /* ---------- 校园边界 ---------- */
  function drawCampus(ring) {
    if (!ring || ring.length < 3) { return; }
    var ctx = state.ctx, view = activeView(), dpr = state.dpr;
    ctx.save();
    setLayerTransform(ctx);
    pathPoly(ctx, ring, view, 1);
    ctx.strokeStyle = 'rgba(46,110,74,0.75)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([10, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 在边界最北的那个点上写一句范围说明，告诉观众"这就是南校园"
    var top = ring[0];
    for (var i = 1; i < ring.length; i++) {
      if (ring[i][1] > top[1]) { top = ring[i]; }
    }
    var label = '中山大学南校园';
    // 文字必须正立：立体视图下先退回"只有 dpr"的变换，再用投影点定位
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var tp = projPoint(top[0], top[1], 0);
    ctx.font = '600 12px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    var tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.fillRect(tp[0] + 6, tp[1] - 20, tw + 10, 17);
    ctx.fillStyle = 'rgba(46,110,74,0.95)';
    ctx.fillText(label, tp[0] + 11, tp[1] - 5);
    ctx.restore();
  }

  /* ---------- 水系 ---------- */
  function drawWater(water) {
    if (!water || !water.length) { return; }
    var ctx = state.ctx, view = activeView(), dpr = state.dpr;
    ctx.save();
    setLayerTransform(ctx);
    for (var i = 0; i < water.length; i++) {
      var w = water[i];
      if (!w.p || w.p.length < 3) { continue; }
      pathPoly(ctx, w.p, view, 1);
      ctx.fillStyle = w.approx ? 'rgba(126,178,205,0.42)' : 'rgba(116,172,203,0.55)';
      ctx.fill();
      ctx.strokeStyle = w.approx ? 'rgba(96,150,180,0.55)' : 'rgba(78,138,172,0.75)';
      ctx.lineWidth = 1;
      // 示意轮廓用虚线，一眼能看出"这条边界不是测出来的"
      if (w.approx) { ctx.setLineDash([6, 4]); }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  /* ---------- 道路网 ---------- */
  function drawRoads(roads) {
    if (!roads || !roads.length) { return; }
    var ctx = state.ctx, view = activeView(), dpr = state.dpr;

    // 分两遍：先铺所有描边，再铺所有路面。
    // 否则后画的描边会盖住前一条路的路面，路口看着像断了。
    var order = ['path', 'service', 'local', 'main'];
    ctx.save();
    setLayerTransform(ctx);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (var pass = 0; pass < 2; pass++) {
      for (var oi = 0; oi < order.length; oi++) {
        var kind = order[oi];
        var st = ROAD_STYLE[kind];
        if (!st) { continue; }
        if (pass === 0) {
          if (!st.casing) { continue; }
          ctx.strokeStyle = st.casingColor;
          ctx.lineWidth = st.casing;
          ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = st.fillColor;
          ctx.lineWidth = st.fill;
          if (st.dashed) { ctx.setLineDash(st.dashed); } else { ctx.setLineDash([]); }
        }
        for (var i = 0; i < roads.length; i++) {
          var r = roads[i];
          if (r.t !== kind || !r.p || r.p.length < 2) { continue; }
          ctx.beginPath();
          for (var k = 0; k < r.p.length; k++) {
            var px = view.x(r.p[k][0]), py = view.y(r.p[k][1]);
            if (k === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
          }
          ctx.stroke();
        }
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  /* ---------- 地名标注（白描边 + 自动避让） ---------- */
  function drawLabels(labels, view, ctx) {
    if (!labels || !labels.length) { return; }
    var placed = [];   // 已占用的矩形，防压字
    var W = state.cssW, H = state.cssH;

    function hits(x, y, w, h) {
      for (var i = 0; i < placed.length; i++) {
        var r = placed[i];
        if (x < r[0] + r[2] && x + w > r[0] && y < r[1] + r[3] && y + h > r[1]) { return true; }
      }
      return false;
    }

    ctx.save();
    // 与其余 8 层一致：标注坐标是 CSS px，必须先把变换乘上 dpr，否则 dpr>1 时字号减半并错位到左上
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    for (var i = 0; i < labels.length; i++) {
      var L = labels[i];
      if (!L || !L.n) { continue; }
      var isWater = L.k === 'w', isRoad = L.k === 'r';
      var size = isWater ? 12.5 : (isRoad ? 10.5 : 10.5);
      var weight = isWater ? '600 ' : '';
      ctx.font = weight + size + 'px ' + FONT;

      var text = L.n;
      var tw = ctx.measureText(text).width;
      var th = size + 3;
      var pb = projPoint(L.x, L.y, 0);
      var px = pb[0], py = pb[1];

      // 出了画布就不画（省得白算）
      if (px < -60 || px > W + 60 || py < -40 || py > H + 40) { continue; }

      var bx = px - tw / 2 - 2, by = py - th / 2;
      if (hits(bx, by, tw + 4, th)) { continue; }   // 位置被占了，跳过
      placed.push([bx, by, tw + 4, th]);

      // 白描边让字在深色阴影上也读得清
      ctx.strokeStyle = 'rgba(255,253,244,0.92)';
      ctx.lineWidth = 3;
      ctx.strokeText(text, px, py);
      ctx.fillStyle = isWater ? 'rgba(38,96,128,0.95)'
        : (isRoad ? 'rgba(96,88,70,0.9)' : 'rgba(58,62,72,0.9)');
      ctx.fillText(text, px, py);
    }
    ctx.restore();
  }

  /* ---------- 比例尺 ---------- */
  /* ---------- 规划层（治理侧）：规划树 + 树影 + 待种点位 ----------
     只画平面视图（规划交互也只在平面）；几何全在 js/plan.js，这里只管画。
     分两趟：ground = 树影（要压在路上、被楼盖住），marks = 树和编号（压在最上层）。 */
  var PLAN_RGB = [42, 112, 168];       // 蓝：规划树（和装饰树的绿分开）
  var PLAN_BAD_RGB = [198, 60, 48];    // 红：非法位置（楼内/水内/离路太近）
  var PLAN_PEND_RGB = [232, 138, 42];  // 橙：优化推荐待种点位

  function drawCapsuleShape(ctx, view, cap) {
    var ax = view.x(cap.ax), ay = view.y(cap.ay), bx = view.x(cap.bx), by = view.y(cap.by);
    var r = Math.max(cap.r * view.scale, 1.6);
    var ang = Math.atan2(by - ay, bx - ax);
    ctx.beginPath();
    // 胶囊 = 两端半圆 + 直边；用两段 arc 拼，不依赖 ellipse（老浏览器兼容）
    ctx.arc(ax, ay, r, ang + Math.PI / 2, ang + Math.PI * 1.5, false);
    ctx.arc(bx, by, r, ang - Math.PI / 2, ang + Math.PI / 2, false);
    ctx.closePath();
  }

  function planBadge(ctx, x, y, label, color) {
    var bx = x + 7, by = y - 7;
    ctx.beginPath();
    ctx.arc(bx, by, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(24,32,44,0.92)';
    ctx.font = 'bold 9px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(label), bx, by + 0.5);
  }

  function drawPlan(plan, phase) {
    if (!plan || !plan.active || !window.PLAN) { return; }
    var ctx = state.ctx, view = state.view, dpr = state.dpr;
    if (!view) { return; }
    var trees = plan.trees || [], pend = plan.pending || [];
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (phase === 'ground') {
      // 树影：与建筑阴影同一套「胶囊」几何（js/plan.js 算，这里只画）
      if (plan.shadow !== false) {
        ctx.fillStyle = 'rgba(29,42,69,0.26)';
        ctx.strokeStyle = 'rgba(29,42,69,0.38)';
        ctx.lineWidth = 0.8;
        for (var i = 0; i < trees.length; i++) {
          var cap = window.PLAN.shadowCapsule(trees[i], state.sun);
          if (!cap) { continue; }
          drawCapsuleShape(ctx, view, cap);
          ctx.fill();
          // 14:00 树影只有 9 m（约 4 px），不描边几乎看不见 —— 描一圈才知道"影子落在这儿"
          ctx.stroke();
        }
      }
      ctx.restore();
      return;
    }

    // 待种点位：橙色虚线圈 + 排名编号
    for (var q = 0; q < pend.length; q++) {
      var item = pend[q];
      var qx = view.x(item.x), qy = view.y(item.y);
      ctx.beginPath();
      ctx.arc(qx, qy, Math.max(4 * view.scale, 5.5), 0, Math.PI * 2);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(232,138,42,0.95)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.setLineDash([]);
      planBadge(ctx, qx, qy, item.rank, 'rgba(232,138,42,0.95)');
    }

    // 已种的规划树：蓝色实心圆（非法位置显红并打「!」）
    for (var j = 0; j < trees.length; j++) {
      var t = trees[j];
      var cx = view.x(t.x), cy = view.y(t.y);
      var rr = Math.max((t.r || 4) * view.scale, 3.6);
      var legal = t.legal !== false;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.fillStyle = legal ? 'rgba(' + PLAN_RGB.join(',') + ',0.82)' : 'rgba(' + PLAN_BAD_RGB.join(',') + ',0.82)';
      ctx.fill();
      ctx.strokeStyle = legal ? 'rgba(18,60,102,0.9)' : 'rgba(120,20,15,0.95)';
      ctx.lineWidth = legal ? 1.1 : 1.8;
      ctx.stroke();
      if (!legal) { planBadge(ctx, cx, cy, '!', 'rgba(198,60,48,0.95)'); }
    }
    ctx.restore();
  }

  /* 米坐标 -> 画布 CSS 像素（app.js 做拖拽命中用） */
  function toScreen(mx, my) {
    if (!state.view) { return null; }
    if (state.iso && state.isoProj) { return state.isoProj.project(mx, my, 0); }
    return [state.view.x(mx), state.view.y(my)];
  }

  function drawScaleBar() {
    var ctx = state.ctx, dpr = state.dpr, view = activeView();
    // 挑一个"好看刻度"，规则在 js/core.js（可在 Node 里单测）
    var picked = window.CORE.scaleBarMeters(view.scale, 90);
    var px = picked * view.scale;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var x0 = state.cssW - 30 - px, y0 = state.cssH - 26;
    ctx.strokeStyle = 'rgba(16,20,28,0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x0 + px, y0);
    ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0, y0 + 4);
    ctx.moveTo(x0 + px, y0 - 4); ctx.lineTo(x0 + px, y0 + 4);
    ctx.stroke();
    ctx.fillStyle = 'rgba(16,20,28,0.75)';
    ctx.font = '11px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(picked + ' m', x0 + px / 2, y0 - 8);
    ctx.restore();
  }

  /* 屏幕坐标 -> 米坐标（app.js 处理地图点选时用） */
  function toWorld(sx, sy) {
    if (!state.view) { return null; }
    if (state.iso && state.isoProj) { return state.isoProj.unproject(sx, sy); }
    return [state.view.unx(sx), state.view.uny(sy)];
  }

  /* 平面 / 立体视图切换（app.js 的按钮调用；改完立刻重画） */
  function setIso(flag) {
    var on = !!flag;
    if (state.iso === on) { return state.iso; }
    state.iso = on;
    if (window.APP && window.APP.redraw) { window.APP.redraw(); }
    return state.iso;
  }

  function isIso() { return state.iso; }

  /* 正北在屏幕上的角度（度）：立体视图下地面转了 yaw 又压了纵向，
     指北针必须用投影算出来的真实角度，不能直接拿 yaw 用 */
  function northAngle() {
    return (state.iso && state.isoProj) ? state.isoProj.northDeg() : 0;
  }

  /* ---------- 对外：画一帧 ---------- */
  function render(payload) {
    var ctx = state.ctx;
    if (!ctx || !state.view) { return; }
    state.sun = payload.sun || null;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);

    // 地面（阳光色）
    ctx.fillStyle = '#f7efd9';
    ctx.fillRect(0, 0, state.canvas.width, state.canvas.height);

    // 地面网格（每 100 m），给"工程感"
    var view = activeView(), dpr = state.dpr, bbox = window.PROJ.bbox;
    ctx.save();
    setLayerTransform(ctx);
    ctx.strokeStyle = 'rgba(120,125,135,0.16)';
    ctx.lineWidth = 1;
    for (var mx = Math.ceil(bbox[0] / 100) * 100; mx <= bbox[2]; mx += 100) {
      ctx.beginPath(); ctx.moveTo(view.x(mx), view.y(bbox[1])); ctx.lineTo(view.x(mx), view.y(bbox[3])); ctx.stroke();
    }
    for (var my = Math.ceil(bbox[1] / 100) * 100; my <= bbox[3]; my += 100) {
      ctx.beginPath(); ctx.moveTo(view.x(bbox[0]), view.y(my)); ctx.lineTo(view.x(bbox[2]), view.y(my)); ctx.stroke();
    }
    ctx.restore();

    // 水系和道路是"地面的一部分"，必须在阴影之前画 —— 否则影子盖不到路上，
    // 看上去像路浮在阴影上面。
    var base = payload.basemap;
    if (base) {
      drawWater(base.water);
      drawRoads(base.roads);
    }

    drawShadows(payload.shadows);
    // 规划树影：地面层，压在路上、被楼盖住才对
    drawPlan(payload.plan, 'ground');
    if (state.iso && state.isoProj) {
      drawBuildingsIso(payload.buildings || [], payload.trees || []);
    } else {
      // 平面视图：树在楼之前画（楼会盖住贴着它的树冠），但在阴影之后（影子落在树上是对的）
      drawTrees(payload.trees);
      drawBuildings(payload.buildings || []);
    }
    drawCampus(payload.campusRing);
    drawGates(payload.gates, payload.campusRing);
    // 规划树与推荐点位：压在最上层（要能点到、要能看清编号）
    drawPlan(payload.plan, 'marks');
    // 阴凉路线在下、最快路线在上，重叠时能看出区分
    // 线宽跟最粗的主路（9 px）对齐再略宽一点，否则路线会被加粗后的路网淹掉
    drawRoute(payload.coolPts, '#38c172', 9.5, false);
    drawRoute(payload.fastPts, '#ff7a45', 9.5, true);
    // 文字压在最上层，免得被路线和楼盖住
    if (base && base.labels) { drawLabels(base.labels, view, ctx); }
    drawEndpoints(payload.fromXY, payload.toXY);
    drawScaleBar();
  }

  return {
    init: init,
    render: render,
    resize: resize,
    zoom: function () { return state.zoom; },
    setZoom: zoomTo,
    resetZoom: function () { return zoomTo(ZOOM_MIN); },
    ZOOM_MIN: ZOOM_MIN,
    ZOOM_MAX: ZOOM_MAX,
    toWorld: toWorld,
    toScreen: toScreen,
    setIso: setIso,
    isIso: isIso,
    northAngle: northAngle
  };
})();