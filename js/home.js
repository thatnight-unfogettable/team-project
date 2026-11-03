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

  /* ---------- 3. 动效编排 ---------- */
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
