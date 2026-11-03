/* ============================================================
   凉径 ShadeRoute Lite —— 入口页逻辑（新增文件）
   职责：把 data/*.js 的真实数字渲染成动效文本；不改动任何其他页面的行为。
   约束：零依赖、无 import/export、不发请求；动效一律走 js/textfx.js，
         由它统一遵守 prefers-reduced-motion。
   ============================================================ */

(function () {
  'use strict';

  var META = window.DATA_META || {};
  var ROUTES = window.DATA_ROUTES || { pairs: [], frames: [] };
  var BASEMAP = window.DATA_BASEMAP || { labels: [] };
  var DG = window.DATA_GREEN || {};
  var G = window.GREEN || null;
  var FX = window.TEXTFX || null;
  var S = window.STRINGS_GREEN || { home: {} };

  var DEMO_TIME = '14:00';
  var mode = 'walk';
  var timers = [];

  function $(id) { return document.getElementById(id); }
  function txt(id, s) { var n = $(id); if (n) { n.textContent = s; } }

  /* ---------- 1. 取演示帧的真实数字 ---------- */
  function demoNumbers() {
    var idx = window.CORE ? window.CORE.pickFrameIndex(META.frames || [], DEMO_TIME) : -1;
    var out = { idx: idx, ok: false };
    if (idx < 0 || !ROUTES.frames || !ROUTES.frames[idx] || !ROUTES.frames[idx].routes ||
        !ROUTES.frames[idx].routes[0]) {
      return out;
    }
    var r = ROUTES.frames[idx].routes[0];
    var f = r.fastest, c = r.cool;
    if (!f || !c) { return out; }
    var speedMs = (DG.walkSpeedContract && DG.walkSpeedContract.ms) || 1.25;
    var minutes = function (rt) {
      return typeof rt.minutes === 'number' && isFinite(rt.minutes)
        ? rt.minutes : rt.length_m / (speedMs * 60);
    };
    var sf = window.CORE.shadeMeters(f), sc = window.CORE.shadeMeters(c);
    out.t = ROUTES.frames[idx].t || DEMO_TIME;
    out.pairName = (ROUTES.pairs[0] && ROUTES.pairs[0].name) || '';
    out.fastMin = minutes(f);
    out.coolMin = minutes(c);
    out.fastSun = f.sun_minutes;
    out.coolSun = c.sun_minutes;
    out.fastLen = f.length_m;
    out.coolLen = c.length_m;
    out.saveSunMin = out.fastSun - out.coolSun;
    out.extraM = out.coolLen - out.fastLen;
    out.shadeFast = sf ? sf.shadePct : null;
    out.shadeCool = sc ? sc.shadePct : null;
    out.ok = true;
    return out;
  }

  /* ---------- 2. 绿色收益（同一套纯函数，和工具页完全一致） ---------- */
  function greenNumbers(meters) {
    if (!G || !DG.activities || !DG.baselines) { return null; }
    var a = DG.activities[mode];
    var tier = null;
    for (var i = 0; i < a.speeds.length; i++) { if (a.speeds[i].isDefault) { tier = a.speeds[i]; } }
    if (!tier) { tier = a.speeds[0]; }
    var base = null;
    for (var j = 0; j < DG.baselines.length; j++) {
      if (DG.baselines[j].id === DG.defaultBaseline) { base = DG.baselines[j]; }
    }
    if (!base) { base = DG.baselines[0]; }
    return G.compute({
      meters: meters, activity: a, baseline: base, occupancy: base.occupancyDefault,
      massKg: DG.defaultMassKg, met: tier.met, speedKmh: tier.kmh,
      tripsPerWeek: 5, weeksPerYear: 32
    });
  }

  /* ---------- 3. 入口页小地图：现场用 canvas 画，不加载 map.js、不用任何图片 ---------- */
  /* 道路的颜色、虚线规则与分档绘制次序都照 js/map.js 的 ROAD_STYLE / drawRoads：
       - 先铺所有描边再铺所有路面（否则后画的描边会盖住前一条路的路面，路口看着像断了）
       - approx 水面用虚线边
     线宽按缩放比例收窄（缩略图若直接用原来的 5 px，主路会糊成一片）。
     两份常量由 tools/green-ui-cases.js 逐值比对 map.js 源码，防止各自漂移。
     图上写出来的每个数字（道路段数、水面数、标注数、太阳方位、直线距离）都来自数据本身。 */
  var MINI_ROAD_STYLE = {
    main: { casing: 7.0, fill: 5.0, casingColor: 'rgba(146,139,120,0.55)', fillColor: '#fffdf4' },
    local: { casing: 4.6, fill: 3.0, casingColor: 'rgba(152,145,128,0.45)', fillColor: '#fdfaf0' },
    service: { casing: 3.0, fill: 1.8, casingColor: 'rgba(158,151,134,0.35)', fillColor: '#fbf7ea' },
    path: { casing: 0, fill: 1.2, casingColor: null, fillColor: 'rgba(158,146,120,0.55)', dashed: [3, 3] }
  };
  var MINI_ORDER = ['path', 'service', 'local', 'main'];
  var MINI_PAPER = '#f2f0ea';               // = styles.css 的 --map-bg，两页视觉同源
  var MINI_LABEL_TOP = 10;                  // 只点出最重要的 10 个地名，小图不堆字
  var mini = { spot: -1, timer: null, drawn: [] };

  function widthScale(scale) {
    return Math.min(1, Math.max(0.42, scale / 0.55));
  }

  function polyPath(ctx, pts, view) {
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var px = view.x(pts[i][0]), py = view.y(pts[i][1]);
      if (i === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
    }
  }

  /* 白描边再填字：浅图纸上任何底色都能读 */
  function haloText(ctx, s, x, y, color, size, bold) {
    ctx.font = (bold ? '600 ' : '') + size + 'px system-ui, "Microsoft YaHei", sans-serif';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(242,240,234,0.92)';
    ctx.strokeText(s, x, y);
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  }

  /* 起终点：routes.js 里给的是经纬度，必须走 js/proj.js 换米，别在入口页再写一遍投影 */
  function endpoints() {
    var p = (ROUTES.pairs && ROUTES.pairs[0]) || null;
    if (!p || !p.from || !p.to || !window.PROJ || typeof window.PROJ.toXY !== 'function') { return null; }
    var a = window.PROJ.toXY(p.from[0], p.from[1]);
    var b = window.PROJ.toXY(p.to[0], p.to[1]);
    var names = String(p.name || '').split('→');
    return {
      a: a, b: b,
      straight: Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1])),
      from: String(names[0] || '').trim(), to: String(names[1] || '').trim()
    };
  }

  function drawMap() {
    var cv = $('h-map');
    if (!cv || !cv.getContext) { return false; }
    var rect = cv.getBoundingClientRect ? cv.getBoundingClientRect() : null;
    var cssW = Math.max(240, (rect && rect.width) || cv.width || 560);
    var cssH = Math.max(180, (rect && rect.height) || cv.height || 420);
    var dpr = window.devicePixelRatio || 1;
    /* 高分屏：按设备像素分配画布，再整体套 dpr 变换。
       这一步在 js/map.js 上修过一次（标注错位），入口页不能重犯同一个坑。 */
    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(cssH * dpr);
    /* 显示尺寸交给 CSS（width:100% + aspect-ratio），JS 只管设备像素，
       否则内联 px 会把画布钉死，窗口缩放期间就是糊的。 */
    var ctx = cv.getContext('2d');
    if (!ctx) { return false; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!window.CORE || !window.CORE.fitTransform || !META.bbox_m) { return false; }
    var view = window.CORE.fitTransform(META.bbox_m, cssW, cssH, 16);
    var ws = widthScale(view.scale);
    var roads = BASEMAP.roads || [];
    var water = BASEMAP.water || [];
    var labels = (BASEMAP.labels || []).slice(0, MINI_LABEL_TOP);

    /* 纸面 */
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = MINI_PAPER;
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    polyPath(ctx, (META.campus && META.campus.ring) || [], view);
    ctx.closePath();
    ctx.fill();

    /* 水面：approx 一律虚线边 + 半透明，和工具页同一条规则 */
    water.forEach(function (w) {
      var pts = w.p || w.ring || [];
      if (pts.length < 3) { return; }
      polyPath(ctx, pts, view);
      ctx.closePath();
      ctx.fillStyle = 'rgba(96,140,186,0.30)';
      ctx.fill();
      ctx.lineWidth = Math.max(0.8, 1.4 * ws);
      ctx.strokeStyle = 'rgba(70,116,160,0.85)';
      if (w.approx) { ctx.setLineDash([6, 4]); } else { ctx.setLineDash([]); }
      ctx.stroke();
    });
    ctx.setLineDash([]);

    /* 道路：两遍（先全部描边、再全部路面），档内次序 path→main，与 map.js 一致 */
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (var pass = 0; pass < 2; pass++) {
      for (var oi = 0; oi < MINI_ORDER.length; oi++) {
        var kind = MINI_ORDER[oi], st = MINI_ROAD_STYLE[kind];
        if (pass === 0) {
          if (!st.casing) { continue; }
          ctx.strokeStyle = st.casingColor;
          ctx.lineWidth = st.casing * ws;
          ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = st.fillColor;
          ctx.lineWidth = Math.max(0.5, st.fill * ws);
          if (st.dashed) { ctx.setLineDash(st.dashed); } else { ctx.setLineDash([]); }
        }
        for (var i = 0; i < roads.length; i++) {
          var r = roads[i];
          if (r.t !== kind || !r.p || r.p.length < 2) { continue; }
          polyPath(ctx, r.p, view);
          ctx.stroke();
        }
      }
    }
    ctx.setLineDash([]);

    /* 校园边界：与 map.js 一样 2.5 px 虚线 [10,6] */
    if (META.campus && META.campus.ring && META.campus.ring.length > 2) {
      ctx.lineWidth = Math.max(1, 2.5 * ws);
      ctx.strokeStyle = 'rgba(90,104,124,0.9)';
      ctx.setLineDash([10, 6]);
      polyPath(ctx, META.campus.ring, view);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    /* 起终点 + 直线参考线（明确写"直线"，它不是路线几何） */
    var ends = endpoints();
    mini.drawn = [];
    if (ends) {
      ctx.lineWidth = Math.max(1, 1.6 * ws);
      ctx.strokeStyle = 'rgba(255,122,69,0.55)';
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(view.x(ends.a[0]), view.y(ends.a[1]));
      ctx.lineTo(view.x(ends.b[0]), view.y(ends.b[1]));
      ctx.stroke();
      ctx.setLineDash([]);
      [[ends.a, '起', ends.from], [ends.b, '终', ends.to]].forEach(function (e, k) {
        var x = view.x(e[0][0]), y = view.y(e[0][1]);
        ctx.beginPath();
        ctx.arc(x, y, 5.2, 0, Math.PI * 2);
        ctx.fillStyle = k === 0 ? '#ff7a45' : '#38c172';
        ctx.fill();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = '#f2f0ea';
        ctx.stroke();
        haloText(ctx, e[1] + ' ' + e[2], x + 8, y + (k === 0 ? -6 : 14), '#20262f', 11, true);
      });
      var mx = (view.x(ends.a[0]) + view.x(ends.b[0])) / 2;
      var my = (view.y(ends.a[1]) + view.y(ends.b[1])) / 2;
      haloText(ctx, '直线 ' + Math.round(ends.straight).toLocaleString('en-US') + ' m', mx + 6, my,
        '#5b6675', 10, false);
      mini.ends = ends;
    }

    /* 地名：跑马灯之外的第二处"活文字"——spotlight 会轮流点亮其中一个 */
    labels.forEach(function (L, idx) {
      var x = view.x(L.x), y = view.y(L.y);
      var on = idx === mini.spot;
      haloText(ctx, L.n, x, y, on ? '#c2410c' : '#3b4451', on ? 11.5 : 9.5, on);
      mini.drawn.push({ n: L.n, x: x, y: y });
      if (on) {
        ctx.beginPath();
        ctx.arc(x, y - 4, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#ff7a45';
        ctx.fill();
      }
    });

    /* 罗盘：太阳方位角来自演示帧，不是装饰 */
    var idx = window.CORE.pickFrameIndex ? window.CORE.pickFrameIndex(META.frames || [], DEMO_TIME) : -1;
    var sun = (idx >= 0 && META.frames[idx] && META.frames[idx].sun) ? META.frames[idx].sun : null;
    if (sun) {
      var cx = cssW - 46, cy = 46, rad = 21;
      var az = sun[0] * Math.PI / 180;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(90,104,124,0.6)';
      ctx.stroke();
      haloText(ctx, 'N', cx, cy - rad + 11, '#5b6675', 9, false);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.sin(az) * (rad - 4), cy - Math.cos(az) * (rad - 4));
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = '#ffd166';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + Math.sin(az) * (rad - 4), cy - Math.cos(az) * (rad - 4), 3.4, 0, Math.PI * 2);
      ctx.fillStyle = '#ff9f1c';
      ctx.fill();
      haloText(ctx, '日 ' + sun[0].toFixed(1) + '°', cx - rad, cy + rad + 12, '#5b6675', 9.5, false);
    }

    /* 比例尺：固定 100 m，长度由 view.scale 算出来 */
    var barLen = 100 * view.scale;
    var bx = 18, by = cssH - 22;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#3b4451';
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + barLen, by);
    ctx.moveTo(bx, by - 4);
    ctx.lineTo(bx, by + 4);
    ctx.moveTo(bx + barLen, by - 4);
    ctx.lineTo(bx + barLen, by + 4);
    ctx.stroke();
    haloText(ctx, '100 m', bx + barLen / 2 - 14, by - 8, '#3b4451', 9.5, false);

    mini.view = view;
    return true;
  }

  /* 图注：整句都是数据算出来的，改数据不用改文案 */
  function mapCaption() {
    var cap = $('h-map-cap'), note = $('h-map-note');
    if (!cap || !note) { return; }
    var area = META.campus && META.campus.area_m2 ? (META.campus.area_m2 / 1e6).toFixed(2) : '--';
    var idx = window.CORE.pickFrameIndex ? window.CORE.pickFrameIndex(META.frames || [], DEMO_TIME) : -1;
    var sun = (idx >= 0 && META.frames[idx] && META.frames[idx].sun) ? META.frames[idx].sun : null;
    cap.textContent = (META.campus ? META.campus.name : '校园') + ' 缩略 · ' +
      area + ' km² · ' + (BASEMAP.roadCount || (BASEMAP.roads || []).length) + ' 段道路 · ' +
      (BASEMAP.waterCount || (BASEMAP.water || []).length) + ' 处水面 · ' +
      (BASEMAP.labels || []).length + ' 个标注' +
      (sun ? ' · ' + DEMO_TIME + ' 太阳方位 ' + sun[0].toFixed(1) + '°／高度 ' + sun[1].toFixed(1) + '°' : '') +
      (mini.ends ? ' · 起终点直线 ' + Math.round(mini.ends.straight) + ' m' : '');
    note.textContent = '底图与道路全部来自本地 OSM 数据（© OpenStreetMap contributors）；' +
      (BASEMAP.approxWater ? '水面是示意轮廓，不是测绘数据。' : '') +
      ' 虚线只是两点的直线参考，不代表路线长度。';
  }

  /* 轮流点亮一个地名：只在允许动效时开，页面不可见就停 */
  function spotlight() {
    if (mini.timer) { clearInterval(mini.timer); mini.timer = null; }
    if (FX && FX.reduced()) { return; }
    if (!mini.drawn.length) { return; }
    mini.timer = setInterval(function () {
      if (document.hidden) { return; }
      mini.spot = (mini.spot + 1) % MINI_LABEL_TOP;
      drawMap();
    }, 2600);
  }

  /* ---------- 4. 动效编排 ---------- */
  function heroText(d) {
    var kicker = '热浪天走哪条路 · 校园阴影路线决策';
    if (!FX) { txt('h-kicker', kicker); txt('h-slogan', '凉径 ShadeRoute'); return; }
    var title = $('h-title');
    if (title) { FX.scramble(title, '凉径 · ShadeRoute Lite', { stepMs: 24, revealPer: 2 }); }
    FX.typewriter($('h-kicker'), kicker, { speed: 26, delay: 220 });

    var slogan = d.ok
      ? '多走 ' + Math.round(d.extraM) + ' 米，少晒 ' + d.saveSunMin.toFixed(1) + ' 分钟。'
      : '多走一点，少晒一点。';
    FX.typewriter($('h-slogan'), slogan, { speed: 34, delay: FX.reduced() ? 0 : 900 });
  }

  function stats(d) {
    if (!d.ok) {
      ['s-save', 's-extra', 's-shade', 's-sun'].forEach(function (id) { txt(id, '--'); });
      txt('s-save-note', '没读到 ' + DEMO_TIME + ' 帧的示例路线');
      return;
    }
    txt('s-save-note', '分钟（' + d.t + '，' + d.pairName + '）');
    txt('s-extra-note', '米');
    txt('s-extra', Math.round(d.extraM) + ' 米');
    txt('s-shade', Math.round(d.shadeFast) + '% → ' + Math.round(d.shadeCool) + '%');
    txt('s-sun', d.fastSun.toFixed(1) + ' → ' + d.coolSun.toFixed(1));
    if (FX) {
      FX.countUp($('s-save'), d.saveSunMin, { digits: 1, suffix: ' 分钟', dur: FX.reduced() ? 0 : 900 });
    } else {
      txt('s-save', d.saveSunMin.toFixed(1) + ' 分钟');
    }
  }

  function green(d) {
    var meters = d.ok ? d.fastLen : 0;
    var c = greenNumbers(meters);
    txt('h-gt-mode', mode === 'walk' ? '步行' : '骑行');
    if (!c || !c.ok) {
      ['g-co2', 'g-kcal', 'g-steps', 'g-year'].forEach(function (id) { txt(id, '--'); });
      txt('h-gt-note', '没有可用路线长度');
      return;
    }
    txt('h-gt-note', '按 ' + Math.round(c.meters) + ' 米 · ' + c.speedKmh + ' km/h · MET ' + c.met +
      ' · 体重 ' + c.massKg + ' kg · 对比' + '小汽车（平均、单人）');
    var useG = c.savedKg < 1;
    var co2 = (useG ? G.fmt(c.savedG, 1) + ' 克' : G.fmt(c.savedKg, 3) + ' 千克');
    var kcal = G.fmtKcal(c.netKcal) + ' 大卡';
    var steps = mode === 'bike' ? '—（骑行不计步）' : Math.round(c.steps) + ' 步';
    var year = G.fmt(c.annualKg, 1) + ' 千克 CO₂e';
    if (FX) {
      FX.countUp($('g-co2'), useG ? c.savedG : c.savedKg, {
        digits: useG ? 1 : 3, suffix: useG ? ' 克' : ' 千克', dur: FX.reduced() ? 0 : 800 });
      FX.countUp($('g-kcal'), c.netKcal, { digits: c.netKcal < 10 ? 1 : 0, suffix: ' 大卡', dur: FX.reduced() ? 0 : 800 });
      $('g-steps').textContent = steps;
      FX.countUp($('g-year'), c.annualKg, { digits: 1, suffix: ' 千克 CO₂e', dur: FX.reduced() ? 0 : 800 });
    } else {
      txt('g-co2', co2); txt('g-kcal', kcal); txt('g-steps', steps); txt('g-year', year);
    }
    txt('h-gt-src', '因子：DEFRA 2024 官方转换因子（英国）；口径详见工具页「绿色收益 → 口径与来源」。' +
      '这里说的是"假设这段路改成乘车"的上限，不是实测替代量。');
  }

  function ticker() {
    var names = [];
    var seen = {};
    (BASEMAP.labels || []).forEach(function (L) {
      if (!seen[L.n]) { seen[L.n] = 1; names.push(L.n); }
    });
    if (!names.length) { names = ['园东湖', '怀士堂', '岭南学院', '黑石屋']; }
    var track = $('h-mq');
    if (!track) { return; }
    if (FX) { FX.marquee(track, { items: names, speedPxPerSec: 42, staticCount: 7 }); }
    else { track.textContent = names.join(' · '); }
  }

  function rotator() {
    var lines = [
      '纯静态页面：file:// 双击即用，网络面板 0 请求。',
      '阴影由建筑轮廓与太阳方位角/高度角几何求交，演示日 ' + (META.date || '--') + ' 共 ' +
        ((META.frames || []).length) + ' 帧。',
      '结论不是单调的：正午最划算，下午最脏——影子长度决定一切。',
      '碳排与热量都给了来源与单位口径，可当场点开核对。'
    ];
    if (FX) { timers.push(FX.cycle($('h-rot'), lines, { gap: 4800, fade: 1600 })); }
    else { txt('h-rot', lines[0]); }
  }

  function modeSwitch() {
    var n = $('h-gt-mode');
    if (!n) { return; }
    var wrap = document.createElement('span');
    wrap.className = 'gt-switch';
    ['walk', 'bike'].forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = k === 'walk' ? '步行' : '骑行';
      b.className = 'gt-btn' + (k === mode ? ' is-on' : '');
      b.setAttribute('aria-pressed', k === mode ? 'true' : 'false');
      b.addEventListener('click', function () {
        mode = k;
        var kids = wrap.children;
        for (var i = 0; i < kids.length; i++) {
          var on = kids[i].textContent === (k === 'walk' ? '步行' : '骑行');
          kids[i].className = 'gt-btn' + (on ? ' is-on' : '');
          kids[i].setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        var d = demoNumbers();
        green(d);
      });
      wrap.appendChild(b);
    });
    var h2 = $('h-green') && $('h-green').querySelector('h2');
    if (h2) {
      h2.textContent = '这一段路，换成';
      h2.appendChild(wrap);
    }
    n.textContent = '';
  }

  function boot() {
    txt('h-place', '中山大学 · 广州南校园 · ' +
      ((META.campus && META.campus.area_m2 ? (META.campus.area_m2 / 1e6).toFixed(2) : '--')) + ' km²');
    txt('h-date', META.date || '--');
    txt('h-campus', (META.campus && META.campus.name) || '--');
    txt('h-hint', (S.home && S.home.enterHint) || '纯静态、零网络');
    txt('h-cta', (S.home && S.home.enter) || '进入路线对比');

    var d = demoNumbers();
    heroText(d);
    stats(d);
    modeSwitch();
    green(d);
    ticker();
    rotator();

    /* 小地图：先画，再写图注（图注要用到算出来的直线距离），最后开轮流点亮 */
    if (drawMap()) { mapCaption(); spotlight(); }
    else {
      txt('h-map-cap', '这个浏览器不支持 canvas，图先不画，下面的数字仍然有效。');
      txt('h-map-note', '');
    }
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      if (resizeTimer) { clearTimeout(resizeTimer); }
      resizeTimer = setTimeout(function () {
        resizeTimer = null;
        if (drawMap()) { mapCaption(); }
      }, 180);
    });

    /* 太阳随帧位置挪一下（CSS 变量，尊重 reduced-motion） */
    var sun = $('h-sun');
    if (sun && d.ok && META.frames && META.frames[d.idx] && META.frames[d.idx].sun && !FX.reduced()) {
      var elev = META.frames[d.idx].sun[1];
      sun.style.setProperty('--elev', String(elev));
      sun.style.top = (78 - Math.min(70, elev)) + '%';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
