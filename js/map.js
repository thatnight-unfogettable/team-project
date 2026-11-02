/* ============================================================
   凉径 ShadeRoute Lite —— 地图渲染
   责任：xu
   纯 Canvas 2D 自绘，不用任何地图库、不联网。

   图层顺序：
     1. 地面底色（阳光）
     2. 阴影（离屏画布整体叠加，避免重叠处变黑）
     3. 建筑轮廓
     4. 路线（最快 / 阴凉）
     5. 起终点标记、比例尺
   ============================================================ */

window.MAP = (function () {
  var state = {
    canvas: null,
    ctx: null,
    cssW: 0,
    cssH: 0,
    dpr: 1,
    view: null,          // PROJ.fit() 的结果
    off: null,           // 阴影离屏画布
    offCtx: null
  };

  function init(canvas) {
    state.canvas = canvas;
    state.ctx = canvas.getContext('2d');
    state.off = document.createElement('canvas');
    state.offCtx = state.off.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    var c = state.canvas;
    var rect = c.parentElement.getBoundingClientRect();
    state.dpr = window.devicePixelRatio || 1;
    state.cssW = Math.max(320, Math.floor(rect.width));
    state.cssH = Math.max(240, Math.floor(rect.height));
    c.width = Math.floor(state.cssW * state.dpr);
    c.height = Math.floor(state.cssH * state.dpr);
    c.style.width = state.cssW + 'px';
    c.style.height = state.cssH + 'px';
    state.off.width = c.width;
    state.off.height = c.height;
    state.view = window.PROJ.fit(state.cssW, state.cssH, 28);
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

  /* ---------- 阴影：先画到离屏画布，再整体半透明贴上来 ---------- */
  function drawShadows(shadowRings) {
    var octx = state.offCtx;
    var dpr = state.dpr;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, state.off.width, state.off.height);
    if (!shadowRings || !shadowRings.length) { return; }

    octx.fillStyle = '#1d2a45';
    for (var i = 0; i < shadowRings.length; i++) {
      pathPoly(octx, shadowRings[i], state.view, dpr);
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
    var ctx = state.ctx, view = state.view, dpr = state.dpr;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    var ctx = state.ctx, view = state.view, dpr = state.dpr;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    [[fromXY, '#38c172', '起'], [toXY, '#ff7a45', '终']].forEach(function (item) {
      var p = item[0];
      if (!p) { return; }
      var px = view.x(p[0]), py = view.y(p[1]);
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
    var ctx = state.ctx, view = state.view, dpr = state.dpr;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    ctx.font = '600 12px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    var tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.fillRect(view.x(top[0]) + 6, view.y(top[1]) - 20, tw + 10, 17);
    ctx.fillStyle = 'rgba(46,110,74,0.95)';
    ctx.fillText(label, view.x(top[0]) + 11, view.y(top[1]) - 5);
    ctx.restore();
  }

  /* ---------- 比例尺 ---------- */
  function drawScaleBar() {
    var ctx = state.ctx, dpr = state.dpr, view = state.view;
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
    return [state.view.unx(sx), state.view.uny(sy)];
  }

  /* ---------- 对外：画一帧 ---------- */
  function render(payload) {
    var ctx = state.ctx;
    if (!ctx || !state.view) { return; }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);

    // 地面（阳光色）
    ctx.fillStyle = '#f7efd9';
    ctx.fillRect(0, 0, state.canvas.width, state.canvas.height);

    drawShadows(payload.shadows);

    // 地面网格（每 100 m），给"工程感"
    var view = state.view, dpr = state.dpr, bbox = window.PROJ.bbox;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = 'rgba(120,125,135,0.16)';
    ctx.lineWidth = 1;
    for (var mx = Math.ceil(bbox[0] / 100) * 100; mx <= bbox[2]; mx += 100) {
      ctx.beginPath(); ctx.moveTo(view.x(mx), view.y(bbox[1])); ctx.lineTo(view.x(mx), view.y(bbox[3])); ctx.stroke();
    }
    for (var my = Math.ceil(bbox[1] / 100) * 100; my <= bbox[3]; my += 100) {
      ctx.beginPath(); ctx.moveTo(view.x(bbox[0]), view.y(my)); ctx.lineTo(view.x(bbox[2]), view.y(my)); ctx.stroke();
    }
    ctx.restore();

    drawBuildings(payload.buildings || []);
    drawCampus(payload.campusRing);
    // 阴凉路线在下、最快路线在上，重叠时能看出区分
    drawRoute(payload.coolPts, '#38c172', 7, false);
    drawRoute(payload.fastPts, '#ff7a45', 7, true);
    drawEndpoints(payload.fromXY, payload.toXY);
    drawScaleBar();
  }

  return {
    init: init,
    render: render,
    resize: resize,
    toWorld: toWorld
  };
})();