/* ============================================================
   凉径 ShadeRoute Lite —— 绿色收益面板（UI 层，新增文件）
   责任边界：
     · 只**读**原有页面里的路线长度（#fast-len / #cool-len），不写、不劫持原有事件；
     · 所有控件与容器都在运行时注入，index.html 只多一行 <script>；
     · 计算全在 js/green-core.js（纯函数），这里只管渲染。
   依赖：window.DATA_GREEN / window.GREEN / window.STRINGS_GREEN / window.TEXTFX
   ============================================================ */

window.GREEN_UI = (function () {
  'use strict';

  var KEY = 'shaderoute.green.v1';
  var state = {
    activity: 'walk',
    route: 'fast',
    speedIdx: null,      // 每个动作内的档位下标
    massKg: null,
    baselineId: null,
    occupancy: null,
    tripsPerWeek: 5,
    last: {}             // 上一次渲染的数值，给数字滚动当起点
  };
  var refs = {};
  var pending = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (html != null) { n.innerHTML = html; }
    return n;
  }
  function text(node, s) { if (node) { node.textContent = s; } }
  function store(k, v) {
    try {
      if (v === undefined) { return window.localStorage.getItem(k); }
      window.localStorage.setItem(k, v);
    } catch (e) { /* file:// 或隐私模式下不可用，忽略：不影响功能 */ }
  }
  function fill(tpl, map) {
    return String(tpl).replace(/\{(\w+)\}/g, function (_, k) {
      return map[k] == null ? '--' : String(map[k]);
    });
  }

  /* ---------- 数据可达性 ---------- */
  function depsReady() {
    return !!(window.DATA_GREEN && window.GREEN && window.STRINGS_GREEN && window.TEXTFX);
  }
  function activity() { return window.DATA_GREEN.activities[state.activity]; }
  function baseline() {
    var list = window.DATA_GREEN.baselines, id = state.baselineId || window.DATA_GREEN.defaultBaseline;
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { return list[i]; } }
    return list[0];
  }
  function speedTier() {
    var a = activity(), list = a.speeds;
    var idx = state.speedIdx == null ? defaultTierIdx(a) : state.speedIdx;
    idx = Math.max(0, Math.min(list.length - 1, idx));
    return list[idx];
  }
  function defaultTierIdx(a) {
    for (var i = 0; i < a.speeds.length; i++) { if (a.speeds[i].isDefault) { return i; } }
    return 0;
  }

  /* ---------- 从原有页面读路线长度（只读） ---------- */
  function readMeters(which) {
    var node = which === 'cool' ? $('cool-len') : $('fast-len');
    if (!node) { return { ok: false, reason: 'precomputeMissing' }; }
    var raw = String(node.textContent || '').replace(/,/g, '').trim();
    var v = parseFloat(raw);
    if (!isFinite(v) || v <= 0 || raw === '--') { return { ok: false, reason: 'noRoute' }; }
    return { ok: true, meters: v };
  }

  /* ---------- 构建 ---------- */
  function build() {
    var cardFast = $('card-fast');
    var host = cardFast && cardFast.parentElement;          // .block#路线对比
    if (!host) { return false; }

    var sec = el('section', 'block gn-block');
    sec.id = 'green-block';

    var head = el('div', 'block-head');
    var h2 = el('h2'); text(h2, window.STRINGS_GREEN.title);
    refs.tag = el('output', 'gn-tag'); refs.tag.id = 'green-tag'; text(refs.tag, window.STRINGS_GREEN.tagIdle);
    head.appendChild(h2); head.appendChild(refs.tag);
    sec.appendChild(head);

    /* —— 方式选择：真 radio，键盘可达，不自己造焦点管理 —— */
    var fs1 = el('fieldset', 'gn-mode');
    var lg1 = el('legend'); text(lg1, window.STRINGS_GREEN.sectionHeadMode);
    fs1.appendChild(lg1);
    refs.modeCards = {};
    ['walk', 'bike'].forEach(function (k) {
      var a = window.DATA_GREEN.activities[k];
      var lab = el('label', 'gn-mode-card');
      var inp = el('input');
      inp.type = 'radio'; inp.name = 'gn-mode'; inp.value = k;
      inp.checked = (k === state.activity);
      var box = el('span', 'gn-mc-body');
      var nameEl = el('span', 'gn-mc-name', window.STRINGS_GREEN.actions[k]);
      var subEl = el('span', 'gn-mc-sub', a.defaultSpeedKmh + ' km/h');
      box.appendChild(nameEl); box.appendChild(subEl);
      lab.appendChild(inp); lab.appendChild(box);
      fs1.appendChild(lab);
      refs.modeCards[k] = { input: inp, sub: subEl, label: lab };
      inp.addEventListener('change', function () {
        state.activity = inp.value;
        state.speedIdx = null;
        syncModeCards();
        syncModeSubtitles();
        rebuildSpeeds();
        schedule();
      });
    });
    sec.appendChild(fs1);

    /* —— 参数 —— */
    var fs2 = el('fieldset', 'gn-params');
    var lg2 = el('legend'); text(lg2, window.STRINGS_GREEN.sectionHeadParams);
    fs2.appendChild(lg2);

    refs.routeSel = makeSelect('route', window.STRINGS_GREEN.labels.route, [
      { v: 'fast', t: window.STRINGS_GREEN.routeOptions.fast },
      { v: 'cool', t: window.STRINGS_GREEN.routeOptions.cool }
    ], function (v) { state.route = v; schedule(); });
    fs2.appendChild(refs.routeSel.wrap);

    refs.speedSel = el('div', 'gn-field');            // 内容由 rebuildSpeeds() 填
    fs2.appendChild(refs.speedSel);

    refs.massSel = makeSelect('mass', window.STRINGS_GREEN.labels.mass,
      window.DATA_GREEN.massOptions.map(function (m) {
        return { v: String(m), t: m + ' kg' };
      }), function (v) { state.massKg = parseFloat(v); schedule(); });
    fs2.appendChild(refs.massSel.wrap);

    refs.baseSel = makeSelect('baseline', window.STRINGS_GREEN.labels.baseline,
      window.DATA_GREEN.baselines.map(function (b) {
        return { v: b.id, t: b.label + '（' + b.unit + ' ' + b.kgCO2e + '）' };
      }), function (v) { state.baselineId = v; syncOccupancy(); schedule(); });
    fs2.appendChild(refs.baseSel.wrap);

    refs.occWrap = el('div', 'gn-field gn-occ');
    fs2.appendChild(refs.occWrap);

    refs.tripsSel = makeSelect('trips', window.STRINGS_GREEN.labels.trips,
      [3, 5, 7, 14].map(function (n) { return { v: String(n), t: String(n) }; }),
      function (v) { state.tripsPerWeek = parseFloat(v); schedule(); });
    fs2.appendChild(refs.tripsSel.wrap);

    sec.appendChild(fs2);

    /* —— 结果 —— */
    var res = el('div', 'gn-results');
    res.setAttribute('aria-live', 'polite');
    res.setAttribute('role', 'status');
    refs.co2 = makeStat('co2', window.STRINGS_GREEN.results.co2);
    refs.kcal = makeStat('kcal', window.STRINGS_GREEN.results.kcal);
    refs.min = makeStat('min', window.STRINGS_GREEN.results.minutes);
    res.appendChild(refs.co2.wrap); res.appendChild(refs.kcal.wrap); res.appendChild(refs.min.wrap);
    refs.eqs = el('ul', 'gn-eqs');
    res.appendChild(refs.eqs);
    refs.detour = el('p', 'gn-detour');
    res.appendChild(refs.detour);
    refs.notice = el('p', 'gn-notice');
    res.appendChild(refs.notice);
    refs.warn = el('p', 'gn-warn');
    res.appendChild(refs.warn);
    sec.appendChild(res);

    /* —— 来源与免责（折叠，讲的时候能当场点开）—— */
    sec.appendChild(buildSources());

    host.parentNode.insertBefore(sec, host.nextSibling);
    return true;
  }

  function makeStat(id, label) {
    var wrap = el('div', 'gn-stat gn-stat-' + id);
    var b = el('b'); b.id = 'gn-' + id; text(b, '--');
    var s = el('span', 'gn-stat-label'); text(s, label);
    wrap.appendChild(s); wrap.appendChild(b);
    return { wrap: wrap, num: b };
  }

  function makeSelect(id, label, opts, onChange) {
    var wrap = el('label', 'gn-field');
    var span = el('span', 'gn-field-label'); text(span, label);
    var sel = el('select'); sel.id = 'gn-' + id;
    for (var i = 0; i < opts.length; i++) {
      var o = el('option'); o.value = opts[i].v; o.textContent = opts[i].t;
      sel.appendChild(o);
    }
    wrap.appendChild(span); wrap.appendChild(sel);
    sel.addEventListener('change', function () { onChange(sel.value); });
    return { wrap: wrap, sel: sel };
  }

  function rebuildSpeeds() {
    var a = activity(), S = window.STRINGS_GREEN;
    refs.speedSel.innerHTML = '';
    var lab = el('span', 'gn-field-label'); text(lab, S.labels.speed);
    var sel = el('select'); sel.id = 'gn-speed';
    for (var i = 0; i < a.speeds.length; i++) {
      var o = el('option'); o.value = String(i); o.textContent = a.speeds[i].label;
      sel.appendChild(o);
    }
    sel.value = String(state.speedIdx == null ? defaultTierIdx(a) : state.speedIdx);
    sel.addEventListener('change', function () { state.speedIdx = parseInt(sel.value, 10); schedule(); });
    refs.speedSel.appendChild(lab); refs.speedSel.appendChild(sel);
    syncModeSubtitles();
  }

  /* 选中态同时写成类名：:has() 在老浏览器里整块高亮会消失，
     靠 JS 打类名才不依赖选择器支持度。 */
  function syncModeCards() {
    ['walk', 'bike'].forEach(function (k) {
      var c = refs.modeCards[k];
      if (!c || !c.label) { return; }
      var on = k === state.activity;
      c.label.className = 'gn-mode-card' + (on ? ' is-on' : '');
      c.input.checked = on;
    });
  }

  function syncModeSubtitles() {
    var S = window.STRINGS_GREEN;
    ['walk', 'bike'].forEach(function (k) {
      var c = refs.modeCards[k];
      if (c) { text(c.sub, (S.actionHint[k] || '') ); }
    });
  }

  function syncOccupancy() {
    var b = baseline(), S = window.STRINGS_GREEN;
    refs.occWrap.innerHTML = '';
    if (!b.occupancyOptions) {
      refs.occWrap.style.display = 'none';
      state.occupancy = null;
      return;
    }
    refs.occWrap.style.display = '';
    if (state.occupancy == null) { state.occupancy = b.occupancyDefault; }
    var lab = el('span', 'gn-field-label'); text(lab, S.labels.occupancy);
    var sel = el('select'); sel.id = 'gn-occ';
    for (var i = 0; i < b.occupancyOptions.length; i++) {
      var o = el('option'); o.value = String(b.occupancyOptions[i]);
      o.textContent = b.occupancyOptions[i] + ' 人';
      sel.appendChild(o);
    }
    sel.value = String(state.occupancy);
    sel.addEventListener('change', function () { state.occupancy = parseFloat(sel.value); schedule(); });
    refs.occWrap.appendChild(lab); refs.occWrap.appendChild(sel);
  }

  function buildSources() {
    var S = window.STRINGS_GREEN, D = window.DATA_GREEN;
    var det = el('details', 'gn-src');
    var sum = el('summary'); text(sum, S.disclaimerHead);
    det.appendChild(sum);
    var ul = el('ul', 'gn-src-list');
    var body = S.disclaimerBody.map(function (line) {
      return fill(line, { srcName: D.sources.transport.name, scope: D.sources.transport.scope });
    });
    var cc = S.crossCheck;
    var f = D.sources.crossCheck.facts;
    /* 以数据表里存的 EPA 口径值为准，不在 UI 里重算一遍分子：
       同一件事有两个来源就会漂移（gCO2PerMileAvgCar 是 EPA 公布的 400 g/mile）。 */
    var epaPerKm = f.gCO2PerMileAvgCar / 1609.34;      // g/mile ÷ m/mile = g/m ≡ kg/km
    var defra = (function () {
      for (var i = 0; i < D.baselines.length; i++) {
        if (D.baselines[i].id === D.defaultBaseline) { return D.baselines[i].kgCO2e; }
      }
      return null;
    })();
    if (defra !== null) {
      body.push(fill(cc.head + '：' + cc.body, {
        epaG: f.gCO2PerMileAvgCar, gal: f.gCO2PerGalGasoline, mpg: f.fuelEconomyMpg,
        epaGKm: window.GREEN.fmt(epaPerKm * 1000, 1), defraGKm: window.GREEN.fmt(defra * 1000, 1),
        ratio: window.GREEN.fmt(epaPerKm / defra, 2)
      }));
    }
    D.baselines.forEach(function (b) {
      body.push('因子出处：' + b.label + ' = ' + b.kgCO2e + ' kg CO2e/' + b.unit +
        '（DEFRA 2024 · ' + b.ref + '）');
    });
    var seen = {};
    body.concat(D.disclaimers).forEach(function (line) {
      if (seen[line]) { return; }                  // 同一条只列一次
      seen[line] = 1;
      var li = el('li'); text(li, line); ul.appendChild(li);
    });
    det.appendChild(ul);
    return det;
  }

  /* ---------- 渲染 ---------- */
  function animate(ref, value, opts) {
    var from = state.last[ref.num.id];
    window.TEXTFX.countUp(ref.num, value, {
      dur: opts.dur == null ? 420 : opts.dur,
      digits: opts.digits == null ? 1 : opts.digits,
      suffix: opts.suffix || '',
      from: isFinite(from) ? from : 0
    });
    state.last[ref.num.id] = value;
  }

  function render() {
    if (!depsReady()) { return; }
    var S = window.STRINGS_GREEN, G = window.GREEN, D = window.DATA_GREEN;
    var rd = readMeters(state.route);

    if (!rd.ok) {
      text(refs.notice, S.notices[rd.reason] || S.notices.noRoute);
      refs.notice.style.display = '';
      animate(refs.co2, null, {}); animate(refs.kcal, null, {}); animate(refs.min, null, {});
      refs.co2.num.textContent = '--'; refs.kcal.num.textContent = '--'; refs.min.num.textContent = '--';
      refs.eqs.innerHTML = ''; text(refs.detour, '');
      window.TEXTFX.scramble(refs.tag, S.tagIdle, { stepMs: 30, revealPer: 1 });
      return;
    }
    refs.notice.style.display = 'none';

    var a = activity(), tier = speedTier(), b = baseline();
    var mass = state.massKg == null ? D.defaultMassKg : state.massKg;
    var c = G.compute({
      meters: rd.meters, activity: a, baseline: b, occupancy: state.occupancy,
      massKg: mass, met: tier.met, speedKmh: tier.kmh, tripsPerWeek: state.tripsPerWeek,
      weeksPerYear: 32
    });

    if (!c.ok) {
      text(refs.notice, (c.warnings || []).join('；') || S.notices.noRoute);
      refs.notice.style.display = '';
      return;
    }

    /* 减排量：小于 1 kg 用克 */
    var useG = c.savedKg < 1;
    animate(refs.co2, useG ? c.savedG : c.savedKg, {
      digits: useG ? 1 : 3, suffix: ' ' + (useG ? S.resultUnits.co2SmallUnit : S.resultUnits.co2BigUnit)
    });
    animate(refs.kcal, c.netKcal, { digits: c.netKcal < 10 ? 1 : 0, suffix: ' ' + S.resultUnits.kcal });
    animate(refs.min, c.minutes, { digits: 1, suffix: ' 分' });

    /* 等效换算 */
    var eqs = [];
    var map = {
      steps: Math.round(c.steps),
      apple: Math.round(c.appleG),
      tree: window.GREEN.fmt(c.treeYears, 2),
      treePct: Math.round(c.treeYears * 100),
      resting: window.GREEN.fmt(c.restingKcal, 1),
      trips: c.tripsPerWeek, weeks: c.weeksPerYear
    };
    S.equivalents.forEach(function (e) {
      if (e.id === 'steps' && (!c.steps)) { return; }        // 骑行不报步数
      eqs.push(fill(e.text, map));
    });
    eqs.push(fill(S.results.perYear, map) + '　≈ ' + window.GREEN.fmt(c.annualKg, 1) + ' ' + S.resultUnits.co2BigUnit);
    refs.eqs.innerHTML = '';
    eqs.forEach(function (line) { var li = el('li'); text(li, line); refs.eqs.appendChild(li); } );

    /* 阴凉路线"多走的那点距离" */
    var fast = readMeters('fast'), cool = readMeters('cool');
    if (fast.ok && cool.ok) {
      var d = cool.meters - fast.meters;
      if (Math.abs(d) < 0.5) {
        text(refs.detour, S.detour.none);
      } else {
        var ex = G.extraForDetour(Math.abs(d), a, mass, tier.met);
        text(refs.detour, fill(S.detour.lead, { extraM: Math.round(Math.abs(d)) }) +
          fill(S.detour.body, {
            extraMin: G.fmt(ex.extraMinutes, 2),
            extraKcal: G.fmt(ex.extraNetKcal, 2)
          }));
      }
    } else {
      text(refs.detour, '');
    }

    /* 计算层给出的警告（超距、强度与时长不匹配、单位不认识等） */
    var warns = (c.warnings || []).slice();
    text(refs.warn, warns.join('　·　'));
    refs.warn.style.display = warns.length ? '' : 'none';

    window.TEXTFX.scramble(refs.tag,
      S.actions[state.activity] + ' · ' + Math.round(rd.meters) + ' m',
      { stepMs: 24, revealPer: 2 });

    persist();
  }

  function persist() {
    try {
      store(KEY, JSON.stringify({
        activity: state.activity, route: state.route, speedIdx: state.speedIdx,
        massKg: state.massKg, baselineId: state.baselineId, occupancy: state.occupancy,
        tripsPerWeek: state.tripsPerWeek
      }));
    } catch (e) {}
  }
  function restore() {
    var raw = store(KEY);
    if (!raw) { return; }
    try {
      var o = JSON.parse(raw);
      ['activity', 'route', 'speedIdx', 'massKg', 'baselineId', 'occupancy', 'tripsPerWeek'].forEach(function (k) {
        if (o[k] !== undefined && o[k] !== null) { state[k] = o[k]; }
      });
      if (state.activity === 'drive') { state.activity = 'walk'; }
    } catch (e) {}
  }

  /* ---------- 观察原有页面的数字变化（不劫持任何原有事件） ---------- */
  var pollTimer = null;
  function watchRoute() {
    var nodes = [$('fast-len'), $('cool-len'), $('delta')].filter(Boolean);
    if (!nodes.length) { return; }
    if (window.MutationObserver) {
      /* app.js 每次重绘都会重写这几个节点的文本，观察它就够了，不需要轮询 */
      var mo = new window.MutationObserver(function () { schedule(); });
      nodes.forEach(function (n) {
        mo.observe(n, { childList: true, characterData: true, subtree: true });
      });
      refs.mo = mo;
      return;
    }
    pollTimer = setInterval(schedule, 900);   // 只在没有 MutationObserver 的老环境兜底
  }

  function schedule() {
    if (pending) { return; }
    pending = window.requestAnimationFrame
      ? window.requestAnimationFrame(function () { pending = null; render(); })
      : setTimeout(function () { pending = null; render(); }, 16);
  }

  /* ---------- 头部"入口"返回链接（运行时插入，不动 index.html 结构） ---------- */
  function injectHomeLink() {
    var header = document.querySelector && document.querySelector('#panel header');
    if (!header || $('gn-home-link')) { return; }
    var a = el('a', 'gn-home-link');
    a.id = 'gn-home-link';
    a.href = 'home.html';
    a.textContent = '← ' + window.STRINGS_GREEN.home.back;
    header.insertBefore(a, header.firstChild);
  }

  function init() {
    if (!depsReady()) { return false; }
    if (!$('card-fast')) { return false; }        // 非路径计算页（如入口页）不加载
    restore();
    if (!build()) { return false; }
    var bsel = refs.baseSel && refs.baseSel.sel;
    if (bsel) { bsel.value = state.baselineId || window.DATA_GREEN.defaultBaseline; }
    var rsel = refs.routeSel && refs.routeSel.sel;
    if (rsel) { rsel.value = state.route; }
    var msel = refs.massSel && refs.massSel.sel;
    if (msel && state.massKg != null) { msel.value = String(state.massKg); }
    var tsel = refs.tripsSel && refs.tripsSel.sel;
    if (tsel) { tsel.value = String(state.tripsPerWeek); }
    syncModeCards();
    rebuildSpeeds();
    syncOccupancy();
    injectHomeLink();
    watchRoute();
    schedule();
    return true;
  }

  return {
    init: init,
    render: render,
    schedule: schedule,
    state: state,
    readMeters: readMeters,
    depsReady: depsReady,
    /* 卸载：停掉兜底轮询与观察器。页面本身不需要，留给测试与热重载用 */
    dispose: function () {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (refs.mo) { try { refs.mo.disconnect(); } catch (e) {} refs.mo = null; }
    }
  };
})();

document.addEventListener('DOMContentLoaded', function () {
  window.GREEN_UI.init();
});
