/* ============================================================
   tools/green-ui-cases.js —— 绿色模块的**界面集成**断言
   被 tools/smoke-green.js 调用，不单独运行。

   要证明的不是公式（那部分在 smoke-green.js 里已经锁死），而是两件事：
     1. 新面板真的能在真实页面骨架上建起来、算出来、改出来；
     2. 它对原有页面**零干扰**——原有输出一个字都不变、原有全局与监听器一个都不多。
   做法：同一条数据链跑两个沙箱，一个不带绿色模块当基线，一个带上，逐项对比。
   ============================================================ */

'use strict';

var stubmod = require('./domstub.js');

var SITE_FILES = ['data/meta.js', 'data/buildings.js', 'data/shadows.js', 'data/routes.js',
  'data/graph.js', 'data/basemap.js', 'content/strings.js', 'js/core.js'];
var APP_FILES = ['js/proj.js', 'js/router.js', 'js/map.js', 'js/app.js'];
var GREEN_FILES = ['data/green-factors.js', 'js/green-core.js', 'content/strings-green.js',
  'js/textfx.js', 'js/green-ui.js'];
var SNAPSHOT_IDS = ['fast-len', 'cool-len', 'fast-min', 'cool-min', 'fast-sun', 'cool-sun',
  'fast-shade', 'cool-shade', 'delta', 'route-tag', 'time-label', 'sun-elev', 'pick-hint'];

function withGreen() {
  return SITE_FILES.concat(GREEN_FILES.slice(0, 4)).concat(APP_FILES).concat(GREEN_FILES.slice(4));
}
function snapshot(W) {
  var out = {};
  SNAPSHOT_IDS.forEach(function (id) {
    var n = W.document.getElementById(id);
    out[id] = n ? String(n.textContent) : '(缺节点)';
  });
  out.panelChildren = W.document.getElementById('panel').children.length;
  out.winListeners = (W.__winListeners || []).join(',');
  return out;
}
function diff(a, b) {
  var d = [];
  Object.keys(a).forEach(function (k) {
    if (a[k] !== b[k] && k !== 'panelChildren') { d.push(k + ': ' + a[k] + ' → ' + b[k]); }
  });
  return d;
}
function txt(W, id) {
  var n = W.document.getElementById(id);
  return n ? String(n.textContent) : '(无)';
}
function num(W, id) { return parseFloat(txt(W, id)); }
/* 页面上显示多少米，就用多少米去算期望值——期望值永远由计算层现算，不在测试里写死 */
function expectFor(W, which, actKey, baseId, occ) {
  var D = W.DATA_GREEN, GG = W.GREEN;
  var node = W.document.getElementById(which === 'cool' ? 'cool-len' : 'fast-len');
  var meters = parseFloat(String(node.textContent).replace(/,/g, ''));
  var a = D.activities[actKey], tier = null, bl = null, i;
  for (i = 0; i < a.speeds.length; i++) { if (a.speeds[i].isDefault) { tier = a.speeds[i]; } }
  for (i = 0; i < D.baselines.length; i++) { if (D.baselines[i].id === baseId) { bl = D.baselines[i]; } }
  return {
    meters: meters,
    c: GG.compute({ meters: meters, activity: a, baseline: bl, occupancy: occ,
      massKg: D.defaultMassKg, met: tier.met, speedKmh: tier.kmh,
      tripsPerWeek: 5, weeksPerYear: 32 })
  };
}
function collect(W, rootId, cls) {
  var hits = [];
  (function walk(n) {
    for (var i = 0; i < n.children.length; i++) {
      var c = n.children[i];
      if (c.className === cls) { hits.push(c); }
      walk(c);
    }
  })(W.document.getElementById(rootId) || W.document.getElementById('panel'));
  return hits;
}
function findControl(W, rootId, pred) {
  var hit = null;
  (function walk(n) {
    for (var i = 0; i < n.children.length; i++) {
      var c = n.children[i];
      if (!hit && pred(c)) { hit = c; }
      walk(c);
    }
  })(W.document.getElementById(rootId));
  return hit;
}

function run(ctx) {
  var ok = ctx.ok, read = ctx.read, ROOT = ctx.ROOT;

  var base = stubmod.build({ root: ROOT, html: 'index.html', files: SITE_FILES.concat(APP_FILES) });
  base.fireReady();
  base.W.APP.redraw();
  var baseSnap = snapshot(base.W);

  /* ---------- A. 面板建立 ---------- */
  var g = stubmod.build({ root: ROOT, html: 'index.html', files: withGreen() });
  var buildErr = null;
  try { g.fireReady(); } catch (e) { buildErr = e; }
  ok('注入绿色模块后 DOMContentLoaded 不抛异常', !buildErr, buildErr ? buildErr.message : '');

  var sec = g.REG['green-block'];
  ok('绿色面板被运行时注入到 #panel', !!sec && sec.parentNode === g.panel,
    sec ? ('parent=' + (sec.parentNode && sec.parentNode.id)) : '没建出 #green-block');
  ok('面板紧跟在路线对比块后面（读者看完结论就能往下看收益）',
    !!sec && g.panel.children.indexOf(sec) === g.panel.children.indexOf(g.blockFast) + 1,
    'index=' + g.panel.children.indexOf(sec) + ' 期望=' + (g.panel.children.indexOf(g.blockFast) + 1));

  /* ---------- B. 零干扰：与不带绿色模块的基线逐项对比 ---------- */
  var gSnap = snapshot(g.W);
  ok('原有页面输出文本一字未变（13 个字段全等）', diff(baseSnap, gSnap).length === 0,
    diff(baseSnap, gSnap).join(' | '));
  ok('#panel 子节点只多 1 个（绿色面板自己）',
    gSnap.panelChildren === baseSnap.panelChildren + 1,
    baseSnap.panelChildren + ' → ' + gSnap.panelChildren);
  ok('没有新增任何 window 级监听器（不劫持原有键盘/滚动事件）',
    gSnap.winListeners === baseSnap.winListeners,
    '[' + baseSnap.winListeners + '] → [' + gSnap.winListeners + ']');

  var redrawErr = null;
  try { g.W.APP.redraw(); } catch (e) { redrawErr = e; }
  ok('注入后 APP.redraw() 仍然正常（原有时间轴与重绘链路没断）', !redrawErr,
    redrawErr ? redrawErr.message : '');
  ok('重绘后原有数字仍与基线一致', diff(baseSnap, snapshot(g.W)).length === 0,
    diff(baseSnap, snapshot(g.W)).join(' | '));
  var EXTRA_GLOBALS = ['DATA_GREEN', 'GREEN', 'GREEN_UI', 'TEXTFX', 'STRINGS_GREEN'];
  var baseKeys = Object.keys(base.W), gKeys = Object.keys(g.W);
  var added = gKeys.filter(function (k) { return baseKeys.indexOf(k) < 0; }).sort();
  var overwritten = EXTRA_GLOBALS.filter(function (k) {
    return baseKeys.indexOf(k) >= 0;          // 原有沙箱里不该已经有这些名字
  });
  ok('基线沙箱里本来没有绿色模块的 5 个全局名（不是覆盖别人）', overwritten.length === 0,
    overwritten.join(','));
  ok('绿色模块只新增 DATA_GREEN / GREEN / STRINGS_GREEN / TEXTFX / GREEN_UI 五个全局',
    added.join(',') === EXTRA_GLOBALS.slice().sort().join(','), '新增=' + added.join(','));
  var ORIGIN_KEYS = ['APP', 'CORE', 'MAP', 'ROUTER', 'PROJ', 'STRINGS', 'DATA_META', 'DATA_BUILDINGS',
    'DATA_SHADOWS', 'DATA_ROUTES', 'DATA_GRAPH', 'DATA_BASEMAP'];
  var missing = ORIGIN_KEYS.filter(function (k) { return g.W[k] === undefined; });
  ok('原有 12 个全局在绿色模块加载后全部在位（没被顶掉）', missing.length === 0, missing.join(','));

  /* ---------- C. 面板数字 = 计算层数字 ---------- */
  var exp = expectFor(g.W, 'fast', 'walk', 'car_avg', 1);
  ok('面板读到页面里的真实路线长度', isFinite(exp.meters) && exp.meters > 0, String(exp.meters));
  ok('面板"少排放"与计算层一致（克）',
    Math.abs(num(g.W, 'gn-co2') - exp.c.savedG) < 0.06,
    txt(g.W, 'gn-co2') + ' vs ' + exp.c.savedG.toFixed(1));
  ok('面板"净消耗"与计算层一致（大卡，界面取整）',
    Math.abs(num(g.W, 'gn-kcal') - Math.round(exp.c.netKcal)) < 0.51,
    txt(g.W, 'gn-kcal') + ' vs ' + exp.c.netKcal.toFixed(1));
  ok('面板"多花时长"与计算层一致（分）',
    Math.abs(num(g.W, 'gn-min') - exp.c.minutes) < 0.06,
    txt(g.W, 'gn-min') + ' vs ' + exp.c.minutes.toFixed(1));
  ok('右上角标签写着当前方式与实际米数',
    txt(g.W, 'green-tag').indexOf('步行') === 0 &&
    txt(g.W, 'green-tag').indexOf(String(Math.round(exp.meters))) >= 0, txt(g.W, 'green-tag'));
  var eqText = (function () {
    var uls = collect(g.W, 'green-block', 'gn-eqs');
    return uls.length ? uls[0].children.map(function (x) { return x.textContent; }).join(' | ') : '';
  })();
  ok('换算条目里有步数、苹果示意、年累计三条',
    eqText.indexOf('步') >= 0 && eqText.indexOf('苹果') >= 0 && eqText.indexOf('累计') >= 0,
    eqText.slice(0, 90));
  ok('净消耗条目同时交代了静坐基线（口径写在一行里）',
    eqText.indexOf('静坐') >= 0, eqText.slice(-90));
  var detourText = (function () {
    var ps = collect(g.W, 'green-block', 'gn-detour');
    return ps.length ? ps[0].textContent : '';
  })();
  ok('两条路线长度差的换算里明确写了"不换算成减排"（自己不许夸大）',
    detourText.indexOf('不换算成') >= 0 && detourText.indexOf('减排') >= 0, detourText.slice(0, 100));
  ok('差值条目报了米数与分钟数',
    /\d+ 米/.test(detourText) && /\d+\.\d+ 分钟/.test(detourText), detourText.slice(0, 60));

  /* ---------- D. 控件改动会重算 ---------- */
  var bikeRadio = findControl(g.W, 'green-block', function (c) {
    return c.type === 'radio' && c.value === 'bike';
  });
  ok('找到"骑行"单选控件（是真 radio，不是自造的 div）', !!bikeRadio);
  var before = { co2: num(g.W, 'gn-co2'), min: num(g.W, 'gn-min') };
  if (bikeRadio) { bikeRadio.checked = true; bikeRadio.dispatch('change'); }
  var expBike = expectFor(g.W, 'fast', 'bike', 'car_avg', 1);
  ok('切到骑行后时长变短、热量重算、减排不变（换速度不影响碳）',
    Math.abs(num(g.W, 'gn-min') - expBike.c.minutes) < 0.06 &&
    num(g.W, 'gn-min') < before.min - 1 &&
    Math.abs(num(g.W, 'gn-co2') - before.co2) < 0.01 &&
    Math.abs(num(g.W, 'gn-kcal') - Math.round(expBike.c.netKcal)) < 0.51,
    [txt(g.W, 'gn-min'), txt(g.W, 'gn-kcal'), txt(g.W, 'gn-co2')].join(' / '));
  ok('切到骑行后标签跟着变成"骑行"', txt(g.W, 'green-tag').indexOf('骑行') === 0, txt(g.W, 'green-tag'));
  /* 选中态：JS 打的类名要在 DOM 上真的转移，而且 CSS 里真的有对应规则 */
  var cardCls = (function () {
    var out = {};
    (function walk(n) {
      for (var i = 0; i < n.children.length; i++) {
        var c = n.children[i];
        if (c.type === 'radio' && c.value && c.parentNode) {
          out[c.value] = String(c.parentNode.className);
        }
        walk(c);
      }
    })(g.W.document.getElementById('green-block'));
    return out;
  })();
  ok('选中态写在容器类名上（骑行亮、步行灭），不依赖 :has 支持度',
    /is-on/.test(cardCls.bike) && !/is-on/.test(cardCls.walk),
    'walk=' + cardCls.walk + ' bike=' + cardCls.bike);
  ok('styles-green.css 里确有 .gn-mode-card.is-on 规则（JS 打的类名不是空转）',
    read('styles-green.css').indexOf('.gn-mode-card.is-on') >= 0);
  ok('两个页面的样式都遵守 prefers-reduced-motion',
    read('styles-green.css').indexOf('prefers-reduced-motion') >= 0 &&
    read('styles-home.css').indexOf('prefers-reduced-motion') >= 0);
  var speedSel = g.REG['gn-speed'];
  ok('骑行档位里默认选中 15 km/h 那档',
    !!speedSel && g.W.DATA_GREEN.activities.bike.speeds[parseInt(speedSel.value, 10)].kmh === 15,
    speedSel ? speedSel.value : '没有速度下拉');

  var baseSel = g.REG['gn-baseline'];
  ok('找到对比基准下拉', !!baseSel);
  baseSel.value = 'bus_local';
  baseSel.dispatch('change');
  var expBus = expectFor(g.W, 'fast', 'bike', 'bus_local', null);
  ok('基准换成市内公交后减排按公交因子重算（比小汽车小）',
    Math.abs(num(g.W, 'gn-co2') - expBus.c.savedG) < 0.06 &&
    expBus.c.savedG < expBike.c.savedG,
    txt(g.W, 'gn-co2') + ' vs ' + expBus.c.savedG.toFixed(1));
  ok('基准是 passenger.km 口径时载客人数控件被隐藏（不让人重复摊薄）',
    (function () {
      var occ = g.REG['gn-occ'];
      return !!occ && occ.parentNode && occ.parentNode.style.display === 'none';
    })(), '控件没藏起来');

  baseSel.value = 'car_avg';
  baseSel.dispatch('change');
  var occSel = g.REG['gn-occ'];
  ok('换回小汽车后载客人数控件回来了', !!occSel && occSel.parentNode.style.display !== 'none');
  var solo = num(g.W, 'gn-co2');
  occSel.value = '2';
  occSel.dispatch('change');
  ok('改成 2 人拼车后减排正好减半', Math.abs(num(g.W, 'gn-co2') - solo / 2) < 0.06,
    solo + ' → ' + txt(g.W, 'gn-co2'));

  var routeSel = g.REG['gn-route'];
  routeSel.value = 'cool';
  routeSel.dispatch('change');
  var expCool = expectFor(g.W, 'cool', 'bike', 'car_avg', 2);
  ok('切到阴凉路线后按阴凉的米数重算（米数更长、减排更大）',
    Math.abs(num(g.W, 'gn-co2') - expCool.c.savedG) < 0.06 &&
    expCool.meters > expBike.meters &&
    expCool.c.savedG > expBike.c.savedG / 2,
    txt(g.W, 'gn-co2') + ' vs ' + expCool.c.savedG.toFixed(1) + ' / 米数 ' + expCool.meters);

  /* 手动改页面文本 → 只读机制应当跟着变（模拟原有算路换了结果） */
  var coolLen = g.REG['cool-len'];
  var oldTxt = coolLen.textContent;
  coolLen.textContent = '2,000 米';
  g.W.GREEN_UI.render();
  ok('原有页面数字一变，面板立刻跟着重算（只读 DOM 这条链路成立）',
    Math.abs(num(g.W, 'gn-co2') - 169.84) < 0.5, txt(g.W, 'gn-co2'));
  coolLen.textContent = oldTxt;
  g.W.GREEN_UI.render();

  /* ---------- E. 来源折叠区 ---------- */
  var srcText = (function () {
    var ds = collect(g.W, 'green-block', 'gn-src');
    if (!ds.length) { return ''; }
    var s = [];
    (function collectLi(n) {
      if (n.tagName === 'LI') { s.push(n.textContent); }
      for (var i = 0; i < n.children.length; i++) { collectLi(n.children[i]); }
    })(ds[0]);
    return s.join('\n');
  })();
  ok('免责区列出每条因子的原表出处（含 DEFRA 2024 与行号）',
    srcText.indexOf('DEFRA 2024') >= 0 && srcText.indexOf('第 54 行') >= 0, srcText.slice(0, 80));
  ok('免责区写清两种单位口径与中国差异',
    srcText.indexOf('passenger.km') >= 0 && srcText.indexOf('vehicle.km') >= 0 &&
    srcText.indexOf('中国') >= 0);
  ok('免责区主动承认"减排上限而不是实测替代量"',
    srcText.indexOf('上限') >= 0 && srcText.indexOf('实测替代量') >= 0);
  ok('免责区把 EPA 与 DEFRA 换算成同一单位 g/km 并列（248.5 vs 169.8，相差 1.46 倍）',
    srcText.indexOf('248.5 g/km') >= 0 && srcText.indexOf('169.8 g/km') >= 0 &&
    /相差 1\.46 倍/.test(srcText), (srcText.match(/交叉验证[^\n]*/) || [''])[0].slice(0, 200));
  ok('免责区交代 MET 未能在线核对（诚实而不是装作权威）',
    srcText.indexOf('Compendium') >= 0 || srcText.indexOf('未能在线核对') >= 0);

  /* ---------- F. 降级路径 ---------- */
  var noStore = stubmod.build({ root: ROOT, html: 'index.html', localStorage: false, files: withGreen() });
  var noStoreErr = null;
  try { noStore.fireReady(); } catch (e) { noStoreErr = e; }
  ok('localStorage 不可用时不崩（file:// 或隐私模式）', !noStoreErr, noStoreErr ? noStoreErr.message : '');
  ok('不可用时面板照样建起来', !!noStore.REG['green-block']);

  var noMO = stubmod.build({ root: ROOT, html: 'index.html', mutationObserver: false, files: withGreen() });
  var noMOErr = null;
  try { noMO.fireReady(); } catch (e) { noMOErr = e; }
  ok('没有 MutationObserver 的老环境也能建面板（退回轮询）',
    !noMOErr && !!noMO.REG['green-block'], noMOErr ? noMOErr.message : '');
  /* 轮询必须只注册一次：写成"每次重绘都 setInterval"会越跑越慢，而且看不出来 */
  var moIntervals = noMO.W.__timers.interval;
  ok('退回轮询时只注册 1 个定时器', moIntervals === 1, 'interval=' + moIntervals);
  try { noMO.W.APP.redraw(); noMO.W.APP.redraw(); } catch (e) { /* 只关心定时器数量 */ }
  ok('反复重绘不累积兜底定时器',
    noMO.W.__timers.interval === moIntervals,
    moIntervals + ' → ' + noMO.W.__timers.interval);
  ok('有 MutationObserver 的正常路径完全不注册轮询',
    g.W.__timers.interval === 0, 'interval=' + g.W.__timers.interval);
  var disposeErr = null;
  try { noMO.W.GREEN_UI.dispose(); noMO.W.APP.redraw(); } catch (e) { disposeErr = e; }
  ok('dispose() 后不留半截状态，页面照常重绘', !disposeErr, disposeErr ? disposeErr.message : '');

  var motionOn = stubmod.build({ root: ROOT, html: 'index.html', reducedMotion: false, files: withGreen() });
  var motionErr = null;
  try { motionOn.fireReady(); } catch (e) { motionErr = e; }
  var expMotion = expectFor(motionOn.W, 'fast', 'walk', 'car_avg', 1);
  ok('开着动效跑完一遍不挂起，数字收敛到同一终值',
    !motionErr && Math.abs(num(motionOn.W, 'gn-co2') - expMotion.c.savedG) < 0.06,
    (motionErr ? motionErr.message : txt(motionOn.W, 'gn-co2')) + ' vs ' + expMotion.c.savedG.toFixed(1));
  ok('动效模式下 RAF 被真正调度过（不是空转 stub）',
    motionOn.W.tickers.raf > 0, 'raf=' + motionOn.W.tickers.raf);

  /* ---------- G. 入口页 ---------- */
  var HOME_FILES = ['data/meta.js', 'data/routes.js', 'data/basemap.js', 'data/green-factors.js',
    'js/core.js', 'js/green-core.js', 'js/textfx.js', 'content/strings-green.js', 'js/home.js'];
  var h = null, homeErr = null;
  try {
    h = stubmod.build({ root: ROOT, html: 'home.html', files: HOME_FILES, header: false });
    h.fireReady();
  } catch (e) { homeErr = e; }
  ok('入口页脚本链跑完 boot() 不抛异常', !homeErr,
    homeErr ? homeErr.message + ' @ ' + String(homeErr.stack || '').split('\n')[1] : '');
  if (h && !homeErr) {
    var HW = h.W, M = HW.DATA_META, R = HW.DATA_ROUTES;
    var idx = HW.CORE.pickFrameIndex(M.frames, '14:00');
    var r14 = R.frames[idx].routes[0];
    ok('入口页没有创建 canvas，也没监听 window（纯文字入口）',
      !h.REG['map'] && (HW.__winListeners || []).length === 0,
      'winListeners=' + (HW.__winListeners || []).join(','));
    ok('标题解码完成后是站名（没有乱码残留）',
      txt(h.W, 'h-title') === '凉径 · ShadeRoute Lite', txt(h.W, 'h-title'));
    ok('打字机把结论写全：多走 N 米，少晒 M 分钟',
      /多走 \d+ 米，少晒 \d+\.\d 分钟。$/.test(txt(h.W, 'h-slogan')), txt(h.W, 'h-slogan'));
    ok('入口页"少晒"取自 14:00 帧两条路线的真实差值',
      txt(h.W, 's-save') === (r14.fastest.sun_minutes - r14.cool.sun_minutes).toFixed(1) + ' 分钟',
      txt(h.W, 's-save'));
    ok('入口页"多走"取自两条路线的真实米差',
      txt(h.W, 's-extra') === Math.round(r14.cool.length_m - r14.fastest.length_m) + ' 米',
      txt(h.W, 's-extra'));
    var sf = HW.CORE.shadeMeters(r14.fastest), sc = HW.CORE.shadeMeters(r14.cool);
    ok('入口页阴影覆盖率调用 CORE.shadeMeters（不是写死 6%→35%）',
      txt(h.W, 's-shade') === Math.round(sf.shadePct) + '% → ' + Math.round(sc.shadePct) + '%',
      txt(h.W, 's-shade'));
    ok('入口页暴晒时长两条都报了',
      txt(h.W, 's-sun') === r14.fastest.sun_minutes.toFixed(1) + ' → ' + r14.cool.sun_minutes.toFixed(1),
      txt(h.W, 's-sun'));
    /* 入口页没有 #fast-len（那是工具页的节点），期望米数只能从 routes 数据取 */
    var hg = (function () {
      var D = HW.DATA_GREEN, a = D.activities.walk, tier = null, i;
      for (i = 0; i < a.speeds.length; i++) { if (a.speeds[i].isDefault) { tier = a.speeds[i]; } }
      return HW.GREEN.compute({
        meters: r14.fastest.length_m, activity: a, baseline: D.baselines[0], occupancy: 1,
        massKg: D.defaultMassKg, met: tier.met, speedKmh: tier.kmh,
        tripsPerWeek: 5, weeksPerYear: 32 });
    })();
    ok('入口页减排与计算层一致，且页面米数与工具页 #fast-len 同源',
      Math.abs(num(h.W, 'g-co2') - hg.savedG) < 0.06 &&
      Math.round(r14.fastest.length_m) === Math.round(expectFor(g.W, 'fast', 'walk', 'car_avg', 1).meters),
      txt(h.W, 'g-co2') + ' / routes 米数 ' + r14.fastest.length_m);
    ok('入口页步数 = 米数 ÷ 步幅', txt(h.W, 'g-steps') === Math.round(hg.steps) + ' 步', txt(h.W, 'g-steps'));
    ok('入口页年累计 = 单次 × 每周 5 趟 × 32 周',
      Math.abs(num(h.W, 'g-year') - hg.annualKg) < 0.06, txt(h.W, 'g-year'));
    var btns = (function () {
      var out = [];
      (function walk(n) {
        for (var i = 0; i < n.children.length; i++) {
          var c = n.children[i];
          if (c.tagName === 'BUTTON') { out.push(c); }
          walk(c);
        }
      })(h.REG['h-green']);
      return out;
    })();
    ok('入口页有步行/骑行两个切换按钮', btns.length === 2, '找到 ' + btns.length + ' 个');
    if (btns.length === 2) {
      var kcalWalk = txt(h.W, 'g-kcal');
      btns[1].dispatch('click');
      var bikeC = (function () {
        var D = HW.DATA_GREEN, a = D.activities.bike, tier = a.speeds[1];
        return HW.GREEN.compute({ meters: r14.fastest.length_m, activity: a, baseline: D.baselines[0],
          occupancy: 1, massKg: D.defaultMassKg, met: tier.met, speedKmh: tier.kmh,
          tripsPerWeek: 5, weeksPerYear: 32 });
      })();
      ok('点"骑行"后热量按骑行真实结果改写',
        txt(h.W, 'g-kcal') !== kcalWalk &&
        Math.abs(num(h.W, 'g-kcal') - Math.round(bikeC.netKcal)) < 0.51,
        kcalWalk + ' → ' + txt(h.W, 'g-kcal'));
      ok('点"骑行"后步数条目改成"骑行不计步"（不硬凑步数）',
        txt(h.W, 'g-steps').indexOf('骑行不计步') >= 0, txt(h.W, 'g-steps'));
      ok('点"骑行"后减排不变（步行骑行直接排放都是 0）',
        Math.abs(num(h.W, 'g-co2') - hg.savedG) < 0.06, txt(h.W, 'g-co2'));
      btns[0].dispatch('click');
    }
    ok('跑马灯把底图标注表里的楼名全部铺出来了',
      (function () {
        var uniq = {}, n = 0;
        (HW.DATA_BASEMAP.labels || []).forEach(function (L) { if (!uniq[L.n]) { uniq[L.n] = 1; n += 1; } });
        return h.REG['h-mq'].children.length === n && n >= 20;
      })(), 'children=' + h.REG['h-mq'].children.length);
    ok('轮播提示落了一句真话（≥ 10 字）', txt(h.W, 'h-rot').length > 10, txt(h.W, 'h-rot').slice(0, 40));
    ok('演示日期与校园名取自 data/meta.js',
      txt(h.W, 'h-date') === M.date && txt(h.W, 'h-campus') === M.campus.name,
      txt(h.W, 'h-date') + ' / ' + txt(h.W, 'h-campus'));
    ok('入口页 CTA 指向 index.html',
      h.REG['h-cta'] && h.REG['h-cta'].getAttribute('href') === 'index.html');
    ok('入口页那张卡说的路线名与 ROUTES.pairs 里的真实名字一致',
      txt(h.W, 's-save-note').indexOf(R.pairs[0].name) >= 0, txt(h.W, 's-save-note'));
  }

  /* ---------- H. 页面骨架本身 ---------- */
  ok('index.html 的 id 在桩上齐备（面板依赖的都在）',
    ['card-fast', 'card-cool', 'fast-len', 'cool-len', 'delta', 'panel', 'route-tag']
      .every(function (id) { return !!base.REG[id]; }),
    ['card-fast', 'card-cool', 'fast-len', 'cool-len', 'delta', 'panel', 'route-tag']
      .filter(function (id) { return !base.REG[id]; }).join(','));
  ok('home.html 的 id 齐备（js/home.js 要填的都在）',
    ['h-title', 'h-slogan', 's-save', 's-extra', 's-shade', 's-sun', 'g-co2', 'g-kcal', 'g-steps',
      'g-year', 'h-mq', 'h-rot', 'h-date', 'h-campus', 'h-green', 'h-cta']
      .every(function (id) { return !!h.REG[id]; }),
    ['h-title', 's-save', 'g-co2', 'h-mq', 'h-green', 'h-cta']
      .filter(function (id) { return !h.REG[id]; }).join(','));
  ok('两个页面各自只引自己需要的脚本（入口页不载 app.js，工具页不载 home.js）',
    read('home.html').indexOf('js/app.js') < 0 && read('index.html').indexOf('js/home.js') < 0);

  /* 引用完整性：HTML 里少写一个文件、名字打错一个字母，桩上全是绿的，浏览器里静默坏掉。
     所以把两个页面 src/href 指向的本地文件逐个查存在性（file:// 没有 404 页面提示）。 */
  ['index.html', 'home.html'].forEach(function (page) {
    var html = read(page), miss = [], refs = {};
    var re = /(?:src|href)\s*=\s*"([^"]+)"/g, mm;
    while ((mm = re.exec(html)) !== null) {
      var ref = mm[1];
      if (/^(https?:|data:|mailto:|#)/.test(ref)) { continue; }
      if (refs[ref]) { continue; }
      refs[ref] = 1;
      try { read(ref); } catch (e) { miss.push(ref); }
    }
    var n = Object.keys(refs).length;
    ok(page + ' 引用的 ' + n + ' 个本地文件全部存在', miss.length === 0, miss.join(','));
  });
}

module.exports = { run: run };
