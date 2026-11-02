/* ============================================================
   凉径 ShadeRoute Lite —— 浏览器控制台自检脚本
   ============================================================
   用途：不用截图、不用开发者工具翻 DOM，粘一次就能确认
        「数据加载了没 / 画布画了没 / 数字对不对」。

   怎么用：
     1. 双击 index.html（或拖进浏览器）打开页面
     2. 按 F12 打开开发者工具，切到 Console（控制台）
     3. 把这个文件的内容整段粘进去，回车
     4. 看到「自检通过」就说明一切正常；有 ❌ 的话把它整段发出来

   这段代码不改动页面任何东西，只读。
   ============================================================ */
(function () {
  'use strict';

  var out = [];
  var fails = 0;

  function line(ok, msg, extra) {
    if (!ok) { fails++; }
    out.push((ok ? '✅ ' : '❌ ') + msg + (extra ? '   → ' + extra : ''));
  }

  var W = window;
  var META = W.DATA_META || {};
  var BUILDINGS = W.DATA_BUILDINGS || [];
  var SHADOWS = W.DATA_SHADOWS || [];
  var ROUTES = W.DATA_ROUTES || {};
  var CORE = W.CORE;

  /* ---- 1. 数据是否加载 ---- */
  line(!!META.date, '演示日期已加载', META.date);
  line(!!META.frames && META.frames.length > 0, '时间帧已加载', (META.frames || []).length + ' 帧');
  line(BUILDINGS.length > 0, '建筑数据已加载', BUILDINGS.length + ' 栋');
  line(SHADOWS.length > 0, '阴影数据已加载', SHADOWS.length + ' 帧');
  line(!!ROUTES.frames && ROUTES.frames.length > 0, '路线数据已加载', (ROUTES.frames || []).length + ' 帧');
  line(!!CORE, '逻辑核心 CORE 已加载');

  /* ---- 1.5 校园边界：确认画的就是中山大学南校园 ---- */
  function inRing(x, y, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) { inside = !inside; }
    }
    return inside;
  }
  var CP = META.campus;
  line(!!(CP && CP.name), '校园范围已加载', CP ? CP.name : '缺失');
  if (CP && CP.ring && CP.ring.length >= 3) {
    line(true, '校园面积', ((CP.area_m2 || 0) / 1e6).toFixed(2) + ' km²');
    var outside = 0;
    for (var bi = 0; bi < BUILDINGS.length; bi++) {
      var bp = BUILDINGS[bi].p, sx = 0, sy = 0;
      for (var k = 0; k < bp.length; k++) { sx += bp[k][0]; sy += bp[k][1]; }
      if (!inRing(sx / bp.length, sy / bp.length, CP.ring)) { outside++; }
    }
    line(outside === 0, '所有建筑都在校园边界内（校外建筑已剔除）',
      outside + ' 栋在界外 / 共 ' + BUILDINGS.length + ' 栋');
    var rOut = 0;
    (ROUTES.frames || []).forEach(function (f) {
      f.routes.forEach(function (p) {
        ['fastest', 'cool'].forEach(function (key) {
          var pts = p[key] && p[key].pts;
          if (!pts) { return; }
          pts.forEach(function (q) { if (!inRing(q[0], q[1], CP.ring)) { rOut++; } });
        });
      });
    });
    line(rOut === 0, '所有路线都在校园边界内（没有跑出校门）', rOut + ' 个越界点');
  }

  if (!CORE || !META.frames) {
    out.push('');
    out.push('数据没加载全，后面的检查跳过。先确认是用 index.html 打开的（不是直接打开 js 文件）。');
    console.log('%c凉径自检', 'font-weight:bold', '\n' + out.join('\n'));
    return;
  }

  /* ---- 2. 帧时间轴 ---- */
  var times = META.frames.map(function (f) { return f.t; });
  line(times[0] === '07:00', '首帧是 07:00', times[0]);
  line(times[times.length - 1] === '17:00', '末帧是 17:00', times[times.length - 1]);
  line(META.frames.length === 31, '共 31 帧', String(META.frames.length));

  var idx14 = CORE.pickFrameIndex(META.frames, '14:00');
  line(idx14 >= 0, '默认帧（14:00）能找到', '第 ' + idx14 + ' 帧，太阳高度 ' +
    META.frames[idx14].sun[1] + '°');

  /* ---- 3. 画布是否真的画了东西 ---- */
  var canvas = document.getElementById('map');
  if (!canvas) {
    line(false, '找不到 id=map 的画布');
  } else {
    line(canvas.width > 0 && canvas.height > 0, '画布尺寸正常', canvas.width + ' × ' + canvas.height);
    var ctx = canvas.getContext('2d');
    var sample = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    var colors = {}, painted = 0;
    for (var i = 0; i < sample.length; i += 4 * 97) {   // 抽样，别卡死浏览器
      var key = sample[i] + ',' + sample[i + 1] + ',' + sample[i + 2];
      if (!colors[key]) { colors[key] = 1; painted++; }
    }
    line(painted > 8, '画布上画出了多种颜色（不是空白）', painted + ' 种取样颜色');
  }

  /* ---- 4. 页面上的数字是否与数据一致 ---- */
  function txt(id) {
    var n = document.getElementById(id);
    return n ? (n.textContent || '').trim() : null;
  }

  var R = W.ROUTER;
  var GRAPH = W.DATA_GRAPH;
  var anchors = (R && R.anchors && R.anchors()) || [];
  line(!!(GRAPH && GRAPH.nodes), '路网已加载（可查任意两点）',
    GRAPH ? (GRAPH.nodes.length + ' 节点 / ' + GRAPH.edges.length + ' 边 / ' +
             GRAPH.exposed.length + ' 帧') : '缺 data/graph.js');
  line(!!(R && R.ready && R.ready()), '浏览器端算路引擎就绪');
  line(anchors.length > 20, '可选地名数量', anchors.length + ' 个');

  var cur = parseInt((document.getElementById('time-slider') || {}).value, 10) || 0;

  if (R && R.ready && R.ready() && anchors.length) {
    // ① 页面当前显示的起终点：从下拉框反查坐标，再用引擎自己算一遍
    var selA = document.getElementById('start-select');
    var selB = document.getElementById('end-select');
    var ai = parseInt(selA && selA.value, 10);
    var bi = parseInt(selB && selB.value, 10);
    var A = (ai >= 0 && anchors[ai]) ? anchors[ai] : null;
    var B = (bi >= 0 && anchors[bi]) ? anchors[bi] : null;
    if (A && B) {
      line(true, '当前起终点', A.name + ' → ' + B.name);
      var lv = R.solve([A.x, A.y], [B.x, B.y], cur);
      line(!!(lv && lv.ok), '任意两点算路可用',
        lv && (lv.reason || (lv.fastest.length_m + ' 米 / ' + lv.fastest.minutes + ' 分钟')));
      if (lv && lv.ok) {
        line(txt('fast-min') === String(Math.round(lv.fastest.minutes)) ||
             txt('fast-min') === CORE.fmtNum(lv.fastest.minutes, 0),
          '页面「最快」分钟数与引擎一致', txt('fast-min') + ' vs ' + lv.fastest.minutes);
        line(txt('cool-min') === String(Math.round(lv.cool.minutes)) ||
             txt('cool-min') === CORE.fmtNum(lv.cool.minutes, 0),
          '页面「阴凉」分钟数与引擎一致', txt('cool-min') + ' vs ' + lv.cool.minutes);
        var s1 = CORE.shadeMeters(lv.fastest), s2 = CORE.shadeMeters(lv.cool);
        line(txt('fast-shade') === CORE.fmtNum(s1.shadePct, 0) + '%',
          '页面「最快」阴影覆盖率一致', txt('fast-shade') + ' vs ' + s1.shadePct.toFixed(1) + '%');
        line(txt('cool-shade') === CORE.fmtNum(s2.shadePct, 0) + '%',
          '页面「阴凉」阴影覆盖率一致', txt('cool-shade') + ' vs ' + s2.shadePct.toFixed(1) + '%');
        line(txt('delta') === CORE.routeSummary(lv.fastest, lv.cool).text,
          '底部结论文字与引擎一致', txt('delta'));

        // ② 和 Python 预计算的示例路线对拍（只在示例起终点上做）
        var idx14 = CORE.pickFrameIndex(META.frames, '14:00');
        var preset = ROUTES.frames[idx14] && ROUTES.frames[idx14].routes[0];
        if (preset && preset.fastest && cur === idx14) {
          var dm = Math.abs(lv.fastest.length_m - preset.fastest.length_m);
          line(dm <= 2, '现场算路与预计算一致（差 ' + dm + ' 米）',
            lv.fastest.length_m + ' vs ' + preset.fastest.length_m + ' 米');
        }
      }
    } else {
      line(true, '当前起终点由地图点选（跳过下拉反查）');
    }

    // ③ 随机抽 6 对地名，确认"任意两点"真的都能算
    var tried = 0, okCount = 0, maxLen = 0;
    for (var s = 0; s < anchors.length && tried < 6; s += 7) {
      var a2 = anchors[s], b2 = anchors[(s + 23) % anchors.length];
      if (a2 === b2) { continue; }
      tried++;
      var rr = R.solve([a2.x, a2.y], [b2.x, b2.y], cur);
      if (rr.ok) { okCount++; maxLen = Math.max(maxLen, rr.fastest.length_m); }
    }
    line(okCount === tried, '随机抽查 ' + tried + ' 对地名全部算得出路线',
      okCount + '/' + tried + '，最长 ' + maxLen + ' 米');

    // ④ 边界：同一地点、校外远处
    var same = R.solve([anchors[0].x, anchors[0].y], [anchors[0].x, anchors[0].y], cur);
    line(same.ok === false, '起点=终点时给出提示', same.reason);
    line(R.snap(5000, 5000) === null, '离校园很远的点会被拒绝');
  }

  /* ---- 4.5 底图要素：道路 / 水系 / 地名标注 ---- */
  var BASE = window.DATA_BASEMAP || null;
  line(!!BASE, '底图数据已加载（data/basemap.js）',
    BASE ? (BASE.roads.length + ' 段道路 / ' + BASE.labels.length + ' 个地名') : '没加载到');
  if (BASE) {
    var kinds = {};
    BASE.roads.forEach(function (r) { kinds[r.t] = (kinds[r.t] || 0) + 1; });
    line(!!(kinds.main && kinds.local && kinds.service && kinds.path),
      '道路分四档线型（主干 / 校内 / 服务 / 步道）', JSON.stringify(kinds));

    var junk = BASE.labels.filter(function (L) {
      return /^[\d\s\-]+$/.test(L.n) || /^(东区|西区|南区|北区)\d*$/.test(L.n);
    });
    line(junk.length === 0, '地名里没有编号型垃圾值（572 / 东区3180 之类）',
      junk.length + ' 个');

    // 画布上真的画了字吗：看画布的"非背景像素"里有没有深色文字像素
    var cv = document.getElementById('map');
    var drawnLabels = 0;
    if (cv && cv.getContext) {
      var c2d = cv.getContext('2d');
      var img = c2d.getImageData(0, 0, cv.width, cv.height).data;
      var dark = 0;
      for (var pi = 0; pi < img.length; pi += 4 * 97) {     // 抽样，别把浏览器卡死
        if (img[pi] < 110 && img[pi + 1] < 110 && img[pi + 2] < 120) { dark++; }
      }
      drawnLabels = dark;
    }
    line(drawnLabels > 0, '画布上确实画上了深色文字/线条（抽样像素检查）',
      drawnLabels + ' 个深色采样点');

    line(BASE.water.length > 0, '水系数据：' + (BASE.water.length ? BASE.water.length + ' 处水面' : '暂无（OSM 抓取受阻，见 README）'),
      BASE.water.map(function (w) { return w.n; }).join('、'));
  }

  /* ---- 5. 打印摘要（这段可以直接念给老师听，或截图） ---- */
  var curMeta = META.frames[cur] || {};
  out.push('');
  out.push('—— 当前画面 ——');
  out.push('  时间：' + (curMeta.t || '?') + '    太阳高度：' +
    (curMeta.sun ? curMeta.sun[1].toFixed(1) : '?') + '°    方位：' +
    (curMeta.sun ? curMeta.sun[0].toFixed(1) : '?') + '°');
  var shown = (typeof lv !== 'undefined' && lv && lv.ok) ? lv : null;
  if (shown) {
    var f2 = shown.fastest, c2 = shown.cool;
    var a = CORE.shadeMeters(f2), b = CORE.shadeMeters(c2);
    out.push('  最快路线：' + f2.minutes.toFixed(0) + ' 分钟，暴晒 ' + f2.sun_minutes.toFixed(0) +
      ' 分钟，阴影覆盖 ' + a.shadePct.toFixed(0) + '%（' + a.shadeM.toFixed(0) + ' 米 / ' +
      a.lengthM.toFixed(0) + ' 米）');
    out.push('  阴凉路线：' + c2.minutes.toFixed(0) + ' 分钟，暴晒 ' + c2.sun_minutes.toFixed(0) +
      ' 分钟，阴影覆盖 ' + b.shadePct.toFixed(0) + '%（' + b.shadeM.toFixed(0) + ' 米 / ' +
      b.lengthM.toFixed(0) + ' 米）');
    out.push('  结论：' + CORE.routeSummary(f2, c2).text);
  } else {
    out.push('  （当前由地图点选，引擎复算未取到数据，直接看页面卡片即可）');
  }

  out.push('');
  out.push(fails === 0 ? '自检通过：' + out.length + ' 项全部正常 ✅' : '有 ' + fails + ' 项异常 ❌');

  var banner = fails === 0 ? 'color:#0a0;font-weight:bold' : 'color:#c00;font-weight:bold';
  console.log('%c凉径 ShadeRoute 自检', banner, '\n' + out.join('\n'));
  return out.join('\n');
})();