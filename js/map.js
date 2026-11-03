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
    view: null,          // PROJ.fit() 的结果（平面视图）
    iso: false,          // 是否处于立体视图（B：2.5D 体块，见 js/iso.js）
    isoView: null,       // 立体视图的底面投影（比 view 略小，旋转后四角才不出画）
    isoProj: null,       // ISO.make() 的投影器
    sun: null,           // 当前帧太阳 [方位角, 高度角]，立体视图算受光面用
    off: null,           // 阴影离屏画布
    offCtx: null
  };

  var FONT = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif';

  // 路网四档线型：casing = 描边宽，fill = 路面宽（CSS px）
  var ROAD_STYLE = {
    main: { casing: 7.0, fill: 5.0, casingColor: 'rgba(146,139,120,0.55)', fillColor: '#fffdf4' },
    local: { casing: 4.6, fill: 3.0, casingColor: 'rgba(152,145,128,0.45)', fillColor: '#fdfaf0' },
    service: { casing: 3.0, fill: 1.8, casingColor: 'rgba(158,151,134,0.35)', fillColor: '#fbf7ea' },
    path: { casing: 0, fill: 1.2, casingColor: null, fillColor: 'rgba(158,146,120,0.55)', dashed: [3, 3] }
  };

  function init(canvas) {
    state.canvas = canvas;
    state.ctx = canvas.getContext('2d');
    state.off = document.createElement('canvas');
    state.offCtx = state.off.getContext('2d');
    resize();
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
    state.view = window.PROJ.fit(state.cssW, state.cssH, 28);
    if (window.ISO && window.ISO.fitView) {
      state.isoView = window.ISO.fitView(state.view, state.cssW, state.cssH, window.ISO.FIT_FACTOR);
      state.isoProj = window.ISO.make(state.isoView, state.cssW, state.cssH);
    }
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
  function drawBuildingsIso(buildings) {
    if (!window.ISO || !state.isoProj) { drawBuildings(buildings); return; }
    var ctx = state.ctx, dpr = state.dpr;
    var items = window.ISO.scene(buildings, state.isoProj, state.sun);
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
    ctx.lineWidth = Math.max(1, width - 4);
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
    if (state.iso && state.isoProj) {
      drawBuildingsIso(payload.buildings || []);
    } else {
      drawBuildings(payload.buildings || []);
    }
    drawCampus(payload.campusRing);
    // 阴凉路线在下、最快路线在上，重叠时能看出区分
    drawRoute(payload.coolPts, '#38c172', 7, false);
    drawRoute(payload.fastPts, '#ff7a45', 7, true);
    // 文字压在最上层，免得被路线和楼盖住
    if (base && base.labels) { drawLabels(base.labels, view, ctx); }
    drawEndpoints(payload.fromXY, payload.toXY);
    drawScaleBar();
  }

  return {
    init: init,
    render: render,
    resize: resize,
    toWorld: toWorld,
    setIso: setIso,
    isIso: isIso,
    northAngle: northAngle
  };
})();