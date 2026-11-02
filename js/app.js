/* ============================================================
   凉径 ShadeRoute Lite —— 应用逻辑
   责任：jiang
   职责：时间轴驱动、路线数据切换、对比卡片、文案提示

   纯逻辑（投影 / 路线摘要 / 太阳文案 / 选帧 / 太阳方位箭头角度）都在
   js/core.js，这里只负责 DOM 与状态，方便 Node 单测（tools/smoke.js）。
   ============================================================ */

window.APP = (function () {
  var META = window.DATA_META || {};
  var BUILDINGS = window.DATA_BUILDINGS || [];
  var SHADOWS = window.DATA_SHADOWS || [];
  var ROUTES = window.DATA_ROUTES || { pairs: [], frames: [] };
  var GRAPH = window.DATA_GRAPH || null;
  var S = window.STRINGS || {};
  var CORE = window.CORE;

  var state = {
    frame: 0,
    pair: 0,
    fromXY: null,      // 起点（米坐标），null = 用预计算示例
    toXY: null,        // 终点（米坐标）
    fromName: '',
    toName: '',
    pickNext: 'from',  // 下一次地图点击设起点还是终点
    routeMsg: '',      // 算不出路线时的提示
    ready: false
  };

  var el = {};

  function $(id) { return document.getElementById(id); }

  /* ---------- 工具 ---------- */

  function frameCount() {
    return CORE.frameCount(META, SHADOWS);
  }

  function pickDefaultFrame() {
    // 默认落在 14:00（太阳最毒）附近；没有可用帧就退回第一帧
    var i = CORE.pickFrameIndex(META.frames || [], '14:00');
    return i < 0 ? 0 : i;
  }

  /* ---------- 演示用视觉补充 ----------
     不修改 index.html 的既有结构，全部运行时插入：
       1. 右上角罗盘旁：太阳方位箭头，随当前帧方位角旋转
       2. 页面顶部：太阳高度角 < 15° 时的黄色低置信度横幅
       3. 图例：补一条"建筑颜色越深越高"
     ---------------------------------------------------------- */
  function ensureVisuals() {
    var wrap = $('map-wrap');
    if (wrap && !$('sun-dial')) {
      var dial = document.createElement('div');
      dial.id = 'sun-dial';
      dial.title = '太阳方位：箭头指向太阳所在方向';
      var arrow = document.createElement('i');
      arrow.id = 'sun-arrow';
      var label = document.createElement('span');
      label.id = 'sun-dial-label';
      label.textContent = '--';
      dial.appendChild(arrow);
      dial.appendChild(label);
      wrap.appendChild(dial);
      el.sunArrow = arrow;
      el.sunDialLabel = label;
    }

    var banner = $('low-conf-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'low-conf-banner';
      banner.setAttribute('role', 'status');
      document.body.appendChild(banner);
    }
    el.banner = banner;

    var legend = $('legend');
    if (legend && !$('lg-building')) {
      var item = document.createElement('span');
      item.id = 'lg-building';
      var swatch = document.createElement('i');
      swatch.className = 'lg lg-bld';
      item.appendChild(swatch);
      item.appendChild(document.createTextNode('建筑颜色越深越高'));
      legend.appendChild(item);
    }
  }

  /* 每帧刷新：箭头角度 + 低置信度横幅 */
  function updateSunVisuals(fr) {
    var az = fr.sun ? fr.sun[0] : null;
    var elev = fr.sun ? fr.sun[1] : null;

    if (el.sunArrow) {
      el.sunArrow.style.transform = 'rotate(' + CORE.compassRotation(az === null ? 0 : az).toFixed(1) + 'deg)';
    }
    if (el.sunDialLabel) {
      el.sunDialLabel.textContent = az === null ? '--' : CORE.fmtNum(az, 0) + '°';
    }
    if (el.banner) {
      var warn = CORE.lowSunBanner(elev);
      if (warn) {
        el.banner.textContent = fr.t + ' · ' + warn;
        el.banner.className = 'show';
      } else {
        el.banner.textContent = '';
        el.banner.className = '';
      }
    }
  }

  /* ---------- 当前起终点 + 当前帧 -> 两条路线 ---------- */
  /*
    优先用浏览器端 ROUTER 现场算（支持任意两点）；
    万一 graph.js 没生成（老数据），退回预计算的两对示例路线。
  */
  function currentRoutes() {
    var i = state.frame;
    state.routeMsg = '';

    if (window.ROUTER && window.ROUTER.ready() && state.fromXY && state.toXY) {
      var live = window.ROUTER.solve(state.fromXY, state.toXY, i);
      if (live.ok) {
        return { fastest: live.fastest, cool: live.cool, live: true,
                 fromXY: live.from.x === undefined ? null : [live.from.x, live.from.y],
                 toXY: [live.to.x, live.to.y] };
      }
      state.routeMsg = live.reason || '';
      return { fastest: null, cool: null, live: true, msg: state.routeMsg };
    }

    var routeFrame = (ROUTES.frames && ROUTES.frames[i]) || null;
    var pairData = routeFrame && routeFrame.routes ? routeFrame.routes[state.pair] : null;
    if (pairData && pairData.fastest) {
      return { fastest: pairData.fastest, cool: pairData.cool, live: false,
               fromXY: pairData.fastest.pts[0],
               toXY: pairData.fastest.pts[pairData.fastest.pts.length - 1] };
    }
    return { fastest: null, cool: null, live: false };
  }

  /* ---------- 渲染一帧 ---------- */
  function render() {
    var i = state.frame;
    var frames = META.frames || [];
    var fr = frames[i] || { t: '--:--', sun: [0, 0] };
    var cur = currentRoutes();

    var fastest = cur.fastest;
    var cool = cur.cool;
    var fastPts = fastest ? fastest.pts : null;
    var coolPts = cool ? cool.pts : null;

    window.MAP.render({
      shadows: SHADOWS[i] || [],
      buildings: BUILDINGS,
      fastPts: fastPts,
      coolPts: coolPts,
      fromXY: cur.fromXY || null,
      toXY: cur.toXY || null,
      campusRing: (META.campus && META.campus.ring) || null
    });

    // ---- 顶部时间与太阳 ----
    el.timeLabel.textContent = fr.t;
    var az = fr.sun ? fr.sun[0] : null;
    var elev = fr.sun ? fr.sun[1] : null;
    el.sunElev.textContent = CORE.fmtNum(elev, 1);
    el.sunAz.textContent = CORE.fmtNum(az, 0);
    el.sunHint.textContent = CORE.sunHint(elev, az);
    updateSunVisuals(fr);

    // ---- 路线卡片 ----
    el.fastMin.textContent = fastest ? CORE.fmtNum(fastest.minutes, 0) : '--';
    el.fastSun.textContent = fastest ? CORE.fmtNum(fastest.sun_minutes, 0) : '--';
    el.coolMin.textContent = cool ? CORE.fmtNum(cool.minutes, 0) : '--';
    el.coolSun.textContent = cool ? CORE.fmtNum(cool.sun_minutes, 0) : '--';
    if (el.fastLen) { el.fastLen.textContent = fastest ? CORE.fmtNum(fastest.length_m, 0) : '--'; }
    if (el.coolLen) { el.coolLen.textContent = cool ? CORE.fmtNum(cool.length_m, 0) : '--'; }

    // 阴影覆盖率：比「暴晒分钟」更直观，也和首页 slogan 的「米」口径一致
    var shadeF = CORE.shadeMeters(fastest);
    var shadeC = CORE.shadeMeters(cool);
    el.fastShade.textContent = shadeF ? CORE.fmtNum(shadeF.shadePct, 0) + '%' : '--';
    el.coolShade.textContent = shadeC ? CORE.fmtNum(shadeC.shadePct, 0) + '%' : '--';

    // 三种情况（good / flat / none）的文案逻辑在 js/core.js
    var summary = CORE.routeSummary(fastest, cool);
    el.delta.textContent = cur.msg ? ('⚠ ' + cur.msg) : summary.text;
    el.delta.setAttribute('data-level', cur.msg ? 'none' : summary.level);

    if (el.routeTag) {
      el.routeTag.textContent = cur.live ? '现场计算' : '预计算';
    }
  }

  /* ---------- 交互 ---------- */
  function bind() {
    el.slider.addEventListener('input', function () {
      state.frame = parseInt(this.value, 10) || 0;
      render();
    });

    el.startSelect.addEventListener('change', function () {
      var a = anchorAt(parseInt(this.value, 10));
      if (a) { setEndpoint('from', [a.x, a.y], a.name); }
    });
    el.endSelect.addEventListener('change', function () {
      var a = anchorAt(parseInt(this.value, 10));
      if (a) { setEndpoint('to', [a.x, a.y], a.name); }
    });

    // 地图点选：第一下起点，第二下终点，之后循环
    var canvas = el.canvas;
    if (canvas) {
      canvas.addEventListener('click', function (ev) {
        if (!window.MAP || !window.MAP.toWorld) { return; }
        var rect = canvas.getBoundingClientRect();
        var p = window.MAP.toWorld(ev.clientX - rect.left, ev.clientY - rect.top);
        if (!p) { return; }
        var snapped = window.ROUTER && window.ROUTER.snap(p[0], p[1]);
        if (!snapped) {
          el.pickHint.textContent = '这里离校园道路太远（超过 120 米），请点在道路附近。';
          return;
        }
        var which = state.pickNext;
        setEndpoint(which, [snapped.x, snapped.y], nearestAnchorName(snapped.x, snapped.y));
        state.pickNext = (which === 'from') ? 'to' : 'from';
      });
    }

    // 键盘 ←/→ 切时间（演示时很有用）
    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { step(-1); }
      if (e.key === 'ArrowRight') { step(1); }
    });
  }

  /* ---------- 起终点 ---------- */
  function anchorAt(idx) {
    var list = (window.ROUTER && window.ROUTER.anchors()) || [];
    return (idx >= 0 && idx < list.length) ? list[idx] : null;
  }

  function nearestAnchorName(x, y) {
    var list = (window.ROUTER && window.ROUTER.anchors()) || [];
    var best = null, bestD = Infinity;
    for (var i = 0; i < list.length; i++) {
      var d = Math.sqrt(Math.pow(list[i].x - x, 2) + Math.pow(list[i].y - y, 2));
      if (d < bestD) { bestD = d; best = list[i]; }
    }
    return (best && bestD <= 45) ? best.name : '地图选点';
  }

  function setEndpoint(which, xy, name) {
    if (which === 'from') {
      state.fromXY = xy; state.fromName = name;
      markSelect(el.startSelect, name);
    } else {
      state.toXY = xy; state.toName = name;
      markSelect(el.endSelect, name);
    }
    updatePickHint();
    render();
  }

  /* 下拉框里尽量选中同名项；找不到（地图点选）就加一个临时项 */
  function markSelect(sel, name) {
    if (!sel) { return; }
    var opts = sel.options || sel.children || [];
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].textContent === name) { sel.value = String(i); return; }
    }
    var customIdx = -1;
    for (var j = 0; j < opts.length; j++) {
      if (opts[j].textContent === '地图选点') { customIdx = j; }
    }
    if (customIdx < 0) {
      var opt = document.createElement('option');
      opt.value = '-1';
      opt.textContent = '地图选点';
      sel.appendChild(opt);
      customIdx = opts.length - 1;
    }
    sel.value = String(customIdx);
  }

  function updatePickHint() {
    if (!el.pickHint) { return; }
    if (!state.fromXY || !state.toXY) {
      el.pickHint.textContent = '也可以直接在地图上点两下：第一下设为起点，第二下设为终点。';
      return;
    }
    el.pickHint.textContent = '起点：' + (state.fromName || '？') +
      '　→　终点：' + (state.toName || '？') + '（在地图上点两下可重选）';
  }

  function step(delta) {
    var n = frameCount();
    state.frame = Math.min(n - 1, Math.max(0, state.frame + delta));
    el.slider.value = state.frame;
    render();
  }

  /* 默认起终点：取预计算的示例路线两端，换成最近的同名建筑 */
  function defaultEndpoints(list) {
    var pairs = (ROUTES && ROUTES.pairs) || [];
    if (pairs.length && window.PROJ && window.PROJ.toXY) {
      var a = nearestAnchorTo(list, window.PROJ.toXY(pairs[0].from[0], pairs[0].from[1]));
      var b = nearestAnchorTo(list, window.PROJ.toXY(pairs[0].to[0], pairs[0].to[1]));
      if (a && b && a !== b) { return { from: a, to: b }; }
    }
    if (list.length >= 2) { return { from: list[0], to: list[1] }; }
    return null;
  }

  function nearestAnchorTo(list, xy) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < list.length; i++) {
      var d = Math.sqrt(Math.pow(list[i].x - xy[0], 2) + Math.pow(list[i].y - xy[1], 2));
      if (d < bestD) { bestD = d; best = list[i]; }
    }
    return best;
  }

  /* ---------- 初始化 ---------- */
  function init() {
    el.timeLabel = $('time-label');
    el.slider = $('time-slider');
    el.sunElev = $('sun-elev');
    el.sunAz = $('sun-az');
    el.sunHint = $('sun-hint');
    el.pickHint = $('pick-hint');
    el.routeTag = $('route-tag');
    el.canvas = $('map');
    el.startSelect = $('start-select');
    el.endSelect = $('end-select');
    el.fastLen = $('fast-len');
    el.coolLen = $('cool-len');
    el.fastMin = $('fast-min');
    el.fastSun = $('fast-sun');
    el.fastShade = $('fast-shade');
    el.coolMin = $('cool-min');
    el.coolSun = $('cool-sun');
    el.coolShade = $('cool-shade');
    el.delta = $('delta');
    el.demoDate = $('demo-date');
    el.place = $('place');
    el.dataFlag = $('data-flag');
    el.notes = $('notes');

    var n = frameCount();
    if (!n) {
      document.body.innerHTML = '<pre style="color:#f66;padding:24px">没有数据。先运行：\n' +
        '  python tools/build.py sample\n然后刷新本页。</pre>';
      return;
    }

    el.slider.max = String(n - 1);
    state.frame = pickDefaultFrame();
    el.slider.value = state.frame;

    // 起终点下拉（校园里有名字的建筑，来自 data/graph.js）
    if (GRAPH && window.ROUTER) { window.ROUTER.prepare(GRAPH); }
    var anchorList = (window.ROUTER && window.ROUTER.anchors()) || [];
    if (el.startSelect && el.endSelect && anchorList.length) {
      anchorList.forEach(function (a, idx) {
        [el.startSelect, el.endSelect].forEach(function (sel) {
          var opt = document.createElement('option');
          opt.value = String(idx);
          opt.textContent = a.name;
          sel.appendChild(opt);
        });
      });
      // 默认取演示路线那两端（按坐标找最近的同名建筑）
      var dflt = defaultEndpoints(anchorList);
      if (dflt) {
        state.fromXY = [dflt.from.x, dflt.from.y];
        state.toXY = [dflt.to.x, dflt.to.y];
        state.fromName = dflt.from.name;
        state.toName = dflt.to.name;
        markSelect(el.startSelect, dflt.from.name);
        markSelect(el.endSelect, dflt.to.name);
      }
    }

    el.demoDate.textContent = META.date || '--';
    // 首屏写明"这就是校园范围"，避免被问"你这算的是整个海珠区吗"
    if (META.campus && META.campus.name && el.place) {
      var km2 = (META.campus.area_m2 || 0) / 1e6;
      el.place.textContent = '中山大学 · 广州南校园' +
        (km2 > 0 ? '（' + km2.toFixed(2) + ' km²，已按官方校园边界裁切）' : '');
    }
    if (META.sample) {
      el.dataFlag.textContent = '当前是示例数据（假）。跑完 tools/build.py all 后换真实数据。';
    }

    // 数据说明
    (S.notes || []).forEach(function (line) {
      var li = document.createElement('li');
      li.textContent = line;
      el.notes.appendChild(li);
    });

    ensureVisuals();
    updatePickHint();

    window.MAP.init($('map'));
    bind();
    state.ready = true;
    render();
  }

  return {
    init: init,
    redraw: function () { if (state.ready) { render(); } },
    step: step
  };
})();

document.addEventListener('DOMContentLoaded', function () {
  window.APP.init();
});