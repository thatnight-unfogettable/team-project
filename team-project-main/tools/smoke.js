/* ============================================================
   凉径 ShadeRoute Lite —— 零依赖冒烟测试（Node 18+）
   责任：frontend

   为什么有它：沙箱里开不了浏览器截图，只能用 Node 做
   "数据一致性 + 纯逻辑单元 + 静态约束" 三合一的检查。

   运行：node tools\smoke.js
   退出码：全绿 0，有失败 1
   ============================================================ */

'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.resolve(__dirname, '..');
var FRAMES_EXPECTED = 31;

var pass = 0;
var fail = 0;
var failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log('PASS  ' + name);
    return;
  }
  fail += 1;
  var msg = name + (detail ? '  [' + detail + ']' : '');
  failures.push(msg);
  console.log('FAIL  ' + msg);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/* ---------- 1. 用 vm 把浏览器脚本装进沙箱（window 即全局） ---------- */
function loadSandbox() {
  var sandbox = { console: console };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  var files = [
    'data/meta.js',
    'data/buildings.js',
    'data/shadows.js',
    'data/routes.js',
    'data/graph.js',
    'data/basemap.js',
    'content/strings.js',
    'js/core.js',
    'js/trees.js',
    'js/plan.js'
  ];

  for (var i = 0; i < files.length; i++) {
    var rel = files[i];
    var src;
    try {
      src = read(rel);
    } catch (e) {
      throw new Error('读不到 ' + rel + '：' + e.message);
    }
    vm.runInContext(src, sandbox, { filename: rel });
  }
  return sandbox;
}

/* ---------- 2. 数据前置守卫 ----------
   数据文件缺失 / 半截 / 帧数对不齐时，先给出"该跑什么命令"，
   而不是在后面某条断言里抛 TypeError（过去的变化：build.py 正在写
   data/*.js 时并发跑 smoke，只会看到莫名其妙的 undefined 报错）。
   ------------------------------------------------------------------------ */
var DATA_FILES = [
  'data/meta.js', 'data/buildings.js', 'data/shadows.js',
  'data/routes.js', 'data/graph.js', 'data/basemap.js'
];

function preflight() {
  var problems = [];
  var contents = {};
  var sample = null;

  DATA_FILES.forEach(function (rel) {
    try {
      contents[rel] = read(rel);
    } catch (e) {
      problems.push(rel + ' 不存在或不可读（' + (e.code || e.message) + '）');
      return;
    }
    try {
      new vm.Script(contents[rel], { filename: rel });   // 只做语法解析，不执行
    } catch (e) {
      problems.push(rel + ' 无法解析（' + e.message + '）');
    }
  });

  // 语义检查：帧数非空 + shadows/routes 与 meta.frames 对齐
  var semantic = ['data/meta.js', 'data/shadows.js', 'data/routes.js'];
  var haveAll = semantic.every(function (rel) { return !!contents[rel]; });
  if (haveAll) {
    var g = { console: console };
    g.window = g;
    g.globalThis = g;
    vm.createContext(g);
    semantic.forEach(function (rel) {
      try {
        vm.runInContext(contents[rel], g, { filename: rel });
      } catch (e) {
        problems.push(rel + ' 执行失败（' + e.message + '）');
      }
    });

    var meta = g.DATA_META;
    var shadowFrames = g.DATA_SHADOWS;
    var routesData = g.DATA_ROUTES;
    var frames = meta && meta.frames;
    sample = !!(meta && meta.sample === true);

    if (!frames || !frames.length) {
      problems.push('DATA_META.frames 为空（数据没生成完整）');
    }
    if (!shadowFrames || !shadowFrames.length) {
      problems.push('DATA_SHADOWS 为空（数据没生成完整）');
    } else if (frames && frames.length && shadowFrames.length !== frames.length) {
      problems.push('DATA_SHADOWS 帧数 ' + shadowFrames.length +
        ' != DATA_META.frames ' + frames.length);
    }
    if (!routesData || !routesData.frames || !routesData.frames.length) {
      problems.push('DATA_ROUTES.frames 缺失或为空');
    } else if (frames && frames.length && routesData.frames.length !== frames.length) {
      problems.push('DATA_ROUTES.frames 帧数 ' + routesData.frames.length +
        ' != DATA_META.frames ' + frames.length);
    }
    if (!routesData || !routesData.pairs || !routesData.pairs.length) {
      problems.push('DATA_ROUTES.pairs 为空');
    } else if (routesData.frames && routesData.frames[0] &&
      routesData.frames[0].routes &&
      routesData.frames[0].routes.length !== routesData.pairs.length) {
      problems.push('DATA_ROUTES.frames[0].routes 条数 ' + routesData.frames[0].routes.length +
        ' != pairs ' + routesData.pairs.length);
    }
  }

  return { problems: problems, sample: sample, fileCount: DATA_FILES.length };
}

console.log('凉径 ShadeRoute Lite · smoke test');
console.log('node ' + process.version + ' · root ' + ROOT);
console.log('--------------------------------------------------');

var GUARD = preflight();
if (GUARD.problems.length) {
  console.log('FAIL (guard)  数据前置检查未通过（先修数据，不是代码 bug）');
  GUARD.problems.forEach(function (p) { console.log('  - ' + p); });
  console.log('--------------------------------------------------');
  console.log('SMOKE: PASS 0 / FAIL 1（数据前置守卫）');
  console.log('该跑什么命令：');
  console.log('  python tools/build.py all      # 重新生成 data/{meta,buildings,shadows,routes,graph,basemap}.js');
  console.log('  python tools/build.py sample   # 只想先跑通冒烟时，用示例数据');
  console.log('然后重跑：node tools/smoke.js');
  process.exit(1);
}
if (GUARD.sample) {
  console.log('提示：DATA_META.sample === true —— 当前是示例数据（假），卡片数字只用于演示；');
  console.log('     跑 python tools/build.py all 可换成真实数据。');
}

/* 顶层 try：任何未捕获异常都转成 FAIL (crash) + 异常消息/栈 + 已完成断言数，并以非 0 退出。
   （故意不重排下面几百行的缩进：diff 集中在首尾，review 时不用逐行看。） */
try {

var box = loadSandbox();
var W = box.window;
var CORE = W.CORE;
var META = W.DATA_META;
var BUILDINGS = W.DATA_BUILDINGS;
var SHADOWS = W.DATA_SHADOWS;
var ROUTES = W.DATA_ROUTES;

ok('数据前置守卫通过（' + GUARD.fileCount +
  ' 个 data/*.js 存在且可解析，frames 非空、shadows 帧数一致）', true);

/* --- 2.1 数据契约 --- */
ok('DATA_META / DATA_BUILDINGS / DATA_SHADOWS / DATA_ROUTES 均已挂载',
  !!(META && BUILDINGS && SHADOWS && ROUTES),
  'meta=' + !!META + ' buildings=' + !!BUILDINGS + ' shadows=' + !!SHADOWS + ' routes=' + !!ROUTES);

ok('CORE 已挂载且关键函数齐全',
  !!(CORE && typeof CORE.fitTransform === 'function' &&
    typeof CORE.routeSummary === 'function' &&
    typeof CORE.sunHint === 'function' &&
    typeof CORE.pickFrameIndex === 'function'));

var metaFrames = (META && META.frames) || [];
ok('meta.frames 帧数 = ' + FRAMES_EXPECTED, metaFrames.length === FRAMES_EXPECTED, 'got ' + metaFrames.length);
ok('shadows 帧数 = ' + FRAMES_EXPECTED, SHADOWS.length === FRAMES_EXPECTED, 'got ' + SHADOWS.length);
ok('routes.frames 帧数 = ' + FRAMES_EXPECTED,
  !!(ROUTES && ROUTES.frames) && ROUTES.frames.length === FRAMES_EXPECTED,
  'got ' + ((ROUTES && ROUTES.frames && ROUTES.frames.length) || 0));

var misaligned = [];
for (var i = 0; i < metaFrames.length; i++) {
  var rt = ROUTES.frames[i] && ROUTES.frames[i].t;
  if (rt !== metaFrames[i].t) { misaligned.push(i + '(' + metaFrames[i].t + ' vs ' + rt + ')'); }
}
ok('meta.frames 与 routes.frames 时间对齐', misaligned.length === 0, misaligned.slice(0, 4).join(', '));

/* --- 2.2 阴影几何 --- */
var ringCount = 0;
var ringBad = [];
var coordBad = 0;
for (var f = 0; f < SHADOWS.length; f++) {
  var rings = SHADOWS[f];
  if (!rings || !rings.length) { ringBad.push('帧' + f + ': 空'); continue; }
  for (var r = 0; r < rings.length; r++) {
    var ring = rings[r];
    ringCount += 1;
    if (!ring || ring.length < 3) { ringBad.push('帧' + f + '#' + r + ': ' + (ring ? ring.length : 0) + ' 点'); continue; }
    for (var p = 0; p < ring.length; p++) {
      var pt = ring[p];
      if (!pt || pt.length < 2 ||
        typeof pt[0] !== 'number' || typeof pt[1] !== 'number' ||
        !isFinite(pt[0]) || !isFinite(pt[1])) { coordBad += 1; }
    }
  }
}
ok('每帧阴影环都有 >= 3 个点（共 ' + ringCount + ' 环）', ringBad.length === 0, ringBad.slice(0, 5).join('; '));
ok('阴影坐标均为有限数值', coordBad === 0, coordBad + ' 个坏点');

/* --- 2.3 投影 fitTransform --- */
var bbox = (META && META.bbox_m) || [-600, -500, 600, 500];
var VW = 1440;
var VH = 900;
var PAD = 24;
var t = CORE.fitTransform(bbox, VW, VH, PAD);

ok('fitTransform(1440x900) scale > 0', t && t.scale > 0, 'scale=' + (t && t.scale));

var expectedScale = Math.min((VW - PAD * 2) / (bbox[2] - bbox[0]), (VH - PAD * 2) / (bbox[3] - bbox[1]));
ok('fitTransform 与等比适配公式一致', !!t && Math.abs(t.scale - expectedScale) < 1e-9,
  'got ' + (t && t.scale) + ' want ' + expectedScale);

var corners = [
  [bbox[0], bbox[1]], [bbox[2], bbox[1]],
  [bbox[0], bbox[3]], [bbox[2], bbox[3]]
];
var outOfCanvas = [];
var outOfPad = [];
for (var c = 0; c < corners.length; c++) {
  var px = t.x(corners[c][0]);
  var py = t.y(corners[c][1]);
  if (px < 0 || px > VW || py < 0 || py > VH) { outOfCanvas.push('(' + px.toFixed(1) + ',' + py.toFixed(1) + ')'); }
  if (px < PAD - 1e-6 || px > VW - PAD + 1e-6 || py < PAD - 1e-6 || py > VH - PAD + 1e-6) {
    outOfPad.push('(' + px.toFixed(1) + ',' + py.toFixed(1) + ')');
  }
}
ok('bbox 四角映射落在 1440x900 画布内', outOfCanvas.length === 0, outOfCanvas.join(' '));
ok('bbox 四角留出不小于 pad 的边距', outOfPad.length === 0, outOfPad.join(' '));

// y 轴必须翻转：北（y 大）在上（屏幕 y 小）
ok('y 轴翻转（北在上）', t.y(bbox[3]) < t.y(bbox[1]), 'northY=' + t.y(bbox[3]).toFixed(1) + ' southY=' + t.y(bbox[1]).toFixed(1));

/* --- 2.4 routeSummary 三种 level --- */

// good：阴凉路线多走 300 米（4 分钟）、少晒 7 分钟
var good = CORE.routeSummary(
  { minutes: 12, sun_minutes: 9, length_m: 900 },
  { minutes: 16, sun_minutes: 2, length_m: 1200 });
ok('routeSummary good：level 正确', good.level === 'good', 'level=' + good.level);
ok('routeSummary good：数值与文案正确（多走用米、少晒用一位小数）',
  good.extraMinutes === 4 && good.savedSunMinutes === 7 && good.extraMeters === 300 &&
  good.text.indexOf('多走 300 米') >= 0 && good.text.indexOf('少晒 7.0 分钟') >= 0,
  good.text);

// good 的边界：阴凉路线反而更快
var goodFast = CORE.routeSummary(
  { minutes: 10, sun_minutes: 8, length_m: 800 },
  { minutes: 9, sun_minutes: 1, length_m: 700 });
ok('routeSummary good：阴凉路线更快时不出现负数分钟',
  goodFast.level === 'good' && goodFast.text.indexOf('-') < 0 && goodFast.text.indexOf('更快') >= 0,
  goodFast.text);

// good 的边界：几乎不多走（切片后 14:00 的真实数据：44 米 / 4.0 分钟）
var tiny = CORE.routeSummary(
  { minutes: 14.8, sun_minutes: 14.0, length_m: 1113 },
  { minutes: 15.4, sun_minutes: 10.0, length_m: 1157 });
ok('routeSummary good：演示帧产出「多走 44 米，少晒 4.0 分钟」（不把 0.6 分钟取整成 1）',
  tiny.level === 'good' && tiny.text.indexOf('多走 44 米') >= 0 &&
  tiny.text.indexOf('少晒 4.0 分钟') >= 0 && tiny.text.indexOf('多走 1 分钟') < 0,
  tiny.text);

// 只多走几米时用「几乎不多走」的说法
var tinyM = CORE.routeSummary(
  { minutes: 14.8, sun_minutes: 14.0, length_m: 1113 },
  { minutes: 14.9, sun_minutes: 10.0, length_m: 1116 });
ok('routeSummary good：只多走 3 米时说「几乎不多走」',
  tinyM.level === 'good' && tinyM.text.indexOf('几乎不多走') >= 0, tinyM.text);

// flat：多走 4 分钟但没少晒
var flat = CORE.routeSummary(
  { minutes: 10, sun_minutes: 2, length_m: 750 },
  { minutes: 14, sun_minutes: 2.2, length_m: 1050 });
ok('routeSummary flat：多走但没少晒', flat.level === 'flat' && flat.text.indexOf('优势不明显') >= 0,
  flat.level + ' | ' + flat.text);

// flat：两条路线几乎相同
var same = CORE.routeSummary(
  { minutes: 10, sun_minutes: 2, length_m: 750 },
  { minutes: 10.4, sun_minutes: 1.9, length_m: 780 });
ok('routeSummary flat：差别很小', same.level === 'flat' && same.text.indexOf('差别很小') >= 0,
  same.level + ' | ' + same.text);

// none：没有路线数据
var none1 = CORE.routeSummary(null, { minutes: 1, sun_minutes: 1 });
var none2 = CORE.routeSummary({ minutes: 1, sun_minutes: 1 }, undefined);
ok('routeSummary none：缺数据时 level = none',
  none1.level === 'none' && none2.level === 'none' && none1.text.length > 0,
  none1.level + '/' + none2.level);

/* --- 2.4b shadeMeters（阴影覆盖率） --- */
// 100 米路、暴晒 1 分钟 → 暴晒 1×60×1.25 = 75 米 → 阴影 25 米 = 25%
var sm = CORE.shadeMeters({ length_m: 100, sun_minutes: 1 });
ok('shadeMeters：100m/暴晒1分钟 → 阴影 25 米（25%）',
  !!sm && Math.abs(sm.shadeM - 25) < 1e-6 && Math.abs(sm.shadePct - 25) < 1e-6,
  JSON.stringify(sm));
ok('shadeMeters：暴晒时间超过总长时夹到 0（不出现负阴影）',
  CORE.shadeMeters({ length_m: 100, sun_minutes: 2 }).shadeM === 0,
  String(CORE.shadeMeters({ length_m: 100, sun_minutes: 2 }).shadeM));
ok('shadeMeters：缺数据返回 null',
  CORE.shadeMeters(null) === null && CORE.shadeMeters({ sun_minutes: 1 }) === null &&
  CORE.shadeMeters({ length_m: 0, sun_minutes: 1 }) === null);

/* --- 2.5 sunHint --- */
ok('sunHint：高度角 < 15° 给出低置信度提示',
  CORE.sunHint(10, 90).indexOf('低') >= 0 || CORE.sunHint(10, 90).indexOf('置信度') >= 0,
  CORE.sunHint(10, 90));
ok('sunHint：接近地平线（<= 3°）单独提示',
  CORE.sunHint(2, 90).indexOf('地平线') >= 0, CORE.sunHint(2, 90));
ok('sunHint：高太阳（> 70°）提示几乎无遮挡',
  CORE.sunHint(80, 180).indexOf('天顶') >= 0, CORE.sunHint(80, 180));
ok('sunHint：方位判断（275.5° 应为西）',
  CORE.sunHint(40, 275.5).indexOf('西方') >= 0, CORE.sunHint(40, 275.5));
ok('sunHint：无数据返回空串', CORE.sunHint(null, null) === '');

/* --- 2.6 pickFrameIndex --- */
var times = [];
for (var k = 0; k < metaFrames.length; k++) { times.push(metaFrames[k].t); }

var idx1400 = CORE.pickFrameIndex(metaFrames, '14:00');
var expect1400 = times.indexOf('14:00');
ok('pickFrameIndex([{t}], "14:00") === times.indexOf("14:00")（' + expect1400 + '）',
  idx1400 === expect1400, 'got ' + idx1400);
ok('pickFrameIndex(["t", ...], "14:00") 与对象数组一致',
  CORE.pickFrameIndex(times, '14:00') === expect1400,
  'got ' + CORE.pickFrameIndex(times, '14:00'));
ok('pickFrameIndex 边界：第一帧 -> 0，最后一帧 -> ' + (times.length - 1),
  CORE.pickFrameIndex(times, times[0]) === 0 &&
  CORE.pickFrameIndex(times, times[times.length - 1]) === times.length - 1);
ok('pickFrameIndex 非整点：14:07 取最近的 14:00',
  CORE.pickFrameIndex(times, '14:07') === expect1400, 'got ' + CORE.pickFrameIndex(times, '14:07'));
ok('pickFrameIndex 超范围：23:00 取最后一帧',
  CORE.pickFrameIndex(times, '23:00') === times.length - 1,
  'got ' + CORE.pickFrameIndex(times, '23:00'));
ok('pickFrameIndex 非法输入返回 -1',
  CORE.pickFrameIndex(times, 'abc') === -1 && CORE.pickFrameIndex([], '14:00') === -1);

/* --- 2.7 视觉辅助纯函数 --- */
ok('lowSunBanner：15° 以下返回黄色横幅文案', CORE.lowSunBanner(10).indexOf('15') >= 0, CORE.lowSunBanner(10));
ok('lowSunBanner：15° 及以上返回空串', CORE.lowSunBanner(15.1) === '' && CORE.lowSunBanner(null) === '');
ok('isLowSun：阈值 15°（14.9 真 / 15 假）', CORE.isLowSun(14.9) === true && CORE.isLowSun(15) === false);

ok('compassRotation：275.5 -> 275.5，-10 -> 350',
  CORE.compassRotation(275.5) === 275.5 && CORE.compassRotation(-10) === 350);

var lightBuilding = CORE.buildingFill(6);
var darkBuilding = CORE.buildingFill(60);
function grayOf(rgb) { return parseInt(rgb.replace(/[^0-9,]/g, '').split(',')[0], 10); }
ok('buildingFill：越高的楼颜色越深',
  grayOf(lightBuilding) > grayOf(darkBuilding),
  lightBuilding + ' vs ' + darkBuilding);

ok('scaleBarMeters：按像素宽度挑刻度',
  CORE.scaleBarMeters(1, 90) === 50 && CORE.scaleBarMeters(0.5, 90) === 100 &&
  CORE.scaleBarMeters(2, 90) === 25 && CORE.scaleBarMeters(0, 90) === 10,
  CORE.scaleBarMeters(1, 90) + '/' + CORE.scaleBarMeters(0.5, 90) + '/' + CORE.scaleBarMeters(2, 90));

/* --- 2.75 底图要素（道路 / 水系 / 地名标注） --- */
var BASE = W.DATA_BASEMAP;
ok('data/basemap.js 存在且结构完整',
  !!BASE && Array.isArray(BASE.roads) && Array.isArray(BASE.water) && Array.isArray(BASE.labels),
  BASE ? ('道路 ' + BASE.roads.length + ' / 水面 ' + BASE.water.length + ' / 标注 ' + BASE.labels.length) : '缺文件');

ok('道路全部来自本地 OSM 路网（297 条 way，裁切后 296 段）',
  !!BASE && BASE.sourceWays === 297 && BASE.roads.length > 280,
  BASE && (BASE.sourceWays + ' 条 way -> ' + BASE.roads.length + ' 段'));

var roadKinds = {};
(BASE ? BASE.roads : []).forEach(function (r) { roadKinds[r.t] = (roadKinds[r.t] || 0) + 1; });
ok('道路分成主干道/校内路/服务道/步道四档',
  !!roadKinds.main && !!roadKinds.local && !!roadKinds.service && !!roadKinds.path,
  JSON.stringify(roadKinds));

// 每条路至少两个点、坐标都在画布 bbox 内（画到画布外说明投影错了）
var badRoad = 0, bbm = META.bbox_m;
(BASE ? BASE.roads : []).forEach(function (r) {
  if (!r.p || r.p.length < 2) { badRoad++; return; }
  for (var i = 0; i < r.p.length; i++) {
    var x = r.p[i][0], y = r.p[i][1];
    if (x < bbm[0] - 62 || x > bbm[2] + 62 || y < bbm[1] - 62 || y > bbm[3] + 62) { badRoad++; return; }
  }
});
ok('所有道路坐标都在可视范围内（bbox ±60m 裁剪带）', badRoad === 0, '越界路线 ' + badRoad + ' 条');

// 楼名标注必须落在校园里（否则就是又画到校外去了）
var outsideLabel = 0;
(BASE ? BASE.labels : []).forEach(function (L) {
  if (L.k !== 'b') { return; }
  if (L.x < bbm[0] || L.x > bbm[2] || L.y < bbm[1] || L.y > bbm[3]) { outsideLabel++; }
});
ok('楼名标注全部落在校园 bbox 内', outsideLabel === 0, '越界 ' + outsideLabel + ' 个');

var labelNames = (BASE ? BASE.labels : []).map(function (L) { return L.n; });
ok('楼名标注数量与「有名字的建筑」一致', labelNames.length >= 60,
  labelNames.length + ' 个地名：' + labelNames.slice(0, 6).join('、') + '…');

// 排序契约：重要地标（r=1）必须排在前面，页面按这个顺序抢位置
var firstTier = (BASE ? BASE.labels : []).filter(function (L) { return L.r === 1; }).length;
var tierSorted = true;
for (var li = 0; BASE && li < BASE.labels.length - 1; li++) {
  if (BASE.labels[li].r > BASE.labels[li + 1].r) { tierSorted = false; break; }
}
ok('标注按重要度排好序（页面靠这个顺序防压字）', tierSorted && firstTier >= 10,
  '一级地名 ' + firstTier + ' 个');

// 水系：园东湖是从路网环路反推的示意轮廓，不是 OSM 测绘数据，必须标 approx
var lake = (BASE ? BASE.water : []).filter(function (w) { return w.n === '园东湖'; })[0];
ok('园东湖已画上（从路网环路反推的示意轮廓）', !!lake,
  BASE && (BASE.water.length + ' 处水面'));
if (lake) {
  var lr = lake.p, larea = 0;
  for (var k = 0; k < lr.length - 1; k++) {
    larea += lr[k][0] * lr[k + 1][1] - lr[k + 1][0] * lr[k][1];
  }
  larea = Math.abs(larea) / 2;
  ok('湖面是多边形且面积像湖（5000–40000 m²）', lr.length >= 4 && larea > 5000 && larea < 40000,
    Math.round(larea) + ' m² / ' + lr.length + ' 个顶点');
  ok('湖被明确标记为示意轮廓（approx=true，页面画虚线边）', lake.approx === true,
    'approx=' + lake.approx);
  ok('湖的名字进了标注表（k=w），按湖泊样式排版', (BASE.labels || []).some(function (L) {
    return L.n === '园东湖' && L.k === 'w';
  }));
}

/* --- 2.8 静态约束（不改数据、不联网、语法可解析） --- */
var jsFiles = ['js/core.js', 'js/trees.js', 'js/plan.js', 'js/iso.js', 'js/proj.js', 'js/map.js', 'js/app.js'];
var syntaxBad = [];
for (var s = 0; s < jsFiles.length; s++) {
  try {
    new vm.Script(read(jsFiles[s]), { filename: jsFiles[s] });
  } catch (e) {
    syntaxBad.push(jsFiles[s] + ': ' + e.message);
  }
}
ok('7 个 js 文件语法可解析（等价 node --check）', syntaxBad.length === 0, syntaxBad.join('; '));

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

var coreSrc = stripComments(read('js/core.js'));
ok('core.js 不使用 import/export（file:// 可运行）', !/\b(import|export)\b/.test(coreSrc));
ok('core.js 不碰 DOM（保持纯函数）', coreSrc.indexOf('document.') < 0 && coreSrc.indexOf('XMLHttpRequest') < 0);

var html = read('index.html');
var scriptSrcs = [];
var re = /<script\s+src="([^"]+)"/g;
var mm;
while ((mm = re.exec(html)) !== null) { scriptSrcs.push(mm[1]); }
var coreAt = scriptSrcs.indexOf('js/core.js');
var appAt = scriptSrcs.indexOf('js/app.js');
var projAt = scriptSrcs.indexOf('js/proj.js');
ok('index.html 引入 js/core.js 一次', scriptSrcs.filter(function (x) { return x === 'js/core.js'; }).length === 1,
  scriptSrcs.join(' | '));
ok('js/core.js 在 app.js / proj.js / map.js 之前加载',
  coreAt >= 0 && appAt >= 0 && projAt >= 0 && coreAt < appAt && coreAt < projAt && coreAt < scriptSrcs.indexOf('js/map.js'),
  'core=' + coreAt + ' proj=' + projAt + ' app=' + appAt);

var isoAt = scriptSrcs.indexOf('js/iso.js');
ok('index.html 引入 js/iso.js 一次，且在 map.js 之前',
  scriptSrcs.filter(function (x) { return x === 'js/iso.js'; }).length === 1 &&
  isoAt >= 0 && isoAt < scriptSrcs.indexOf('js/map.js'),
  'iso=' + isoAt + ' map=' + scriptSrcs.indexOf('js/map.js'));

var treesAt = scriptSrcs.indexOf('js/trees.js');
    var planAt = scriptSrcs.indexOf('js/plan.js');
    ok('index.html 引入 js/plan.js 一次，且在 trees.js 之后、app.js 之前',
      scriptSrcs.filter(function (x) { return x === 'js/plan.js'; }).length === 1 &&
      planAt > treesAt && planAt < appAt);

    ok('index.html 引入 js/trees.js 一次，且在 core.js 之后、app.js 之前',
  scriptSrcs.filter(function (x) { return x === 'js/trees.js'; }).length === 1 &&
  treesAt > coreAt && treesAt < appAt,
  'trees=' + treesAt + ' core=' + coreAt + ' app=' + appAt);

var offlineBad = [];
['index.html', 'styles.css'].concat(jsFiles).concat(['content/strings.js']).forEach(function (rel) {
  var src = read(rel);
  if (/https?:\/\//.test(src) || /(cdn\.|unpkg|jsdelivr)/.test(src)) { offlineBad.push(rel); }
});
ok('页面文件无外链/CDN（完全离线）', offlineBad.length === 0, offlineBad.join(', '));

/* --- 2.8c file:// 硬约束（"双击即用"的守护） ---
   file:// 下 fetch/XHR 会被 CORS/协议拒绝，type="module" 也会被拦；
   一旦有人为了"优雅"引入它们，页面在演示现场就打不开了。 */
var jsAll = ['js/core.js', 'js/trees.js', 'js/plan.js', 'js/iso.js', 'js/proj.js', 'js/router.js', 'js/map.js', 'js/app.js'];
var forbiddenTokens = ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'import('];
var fileUrlBad = [];
jsAll.forEach(function (rel) {
  var src = stripComments(read(rel));
  forbiddenTokens.forEach(function (tok) {
    if (src.indexOf(tok) >= 0) { fileUrlBad.push(rel + ' 含 ' + tok); }
  });
});
ok('js/*.js 无 fetch( / XMLHttpRequest / sendBeacon / import(（file:// 双击即用，不发请求）',
  fileUrlBad.length === 0, fileUrlBad.join('; '));

var htmlNoModule = !/type\s*=\s*["']module["']/i.test(html);
var htmlBad = [];
forbiddenTokens.forEach(function (tok) {
  if (html.indexOf(tok) >= 0) { htmlBad.push('index.html 含 ' + tok); }
});
ok('index.html 无 type="module" 也无 fetch( / XHR / import(（file:// 下也能跑）',
  htmlNoModule && htmlBad.length === 0,
  (htmlNoModule ? '' : '存在 type="module"') + (htmlBad.length ? '；' + htmlBad.join('; ') : ''));

/* --- 2.8d dpr=2 标注定位（独立 box 真渲染一帧） ---
   过去 smoke 把 devicePixelRatio 固定为 1，drawLabels 漏 setTransform 的
   缺陷完全漏检。检查逻辑在 tools/dpr-check.js；反证见 _work/smoke-dpr-test/
   （在副本里删掉 map.js 那行 setTransform，本条断言必须变红）。 */
var dprChecker = null;
var dprLoadErr = null;
try {
  dprChecker = require('./dpr-check.js');
} catch (e) {
  dprLoadErr = e;
}
if (dprLoadErr) {
  ok('dpr=2 标注定位检查脚本可加载（tools/dpr-check.js）', false,
    dprLoadErr && dprLoadErr.message ? dprLoadErr.message : String(dprLoadErr));
} else {
  var dprResult = dprChecker.run({ root: ROOT, dpr: 2 });
  dprResult.checks.forEach(function (c) { ok(c.name, c.ok, c.detail); });
  ok('dpr=2 标注定位检查至少产出 4 条断言（防止检查被架空）',
    dprResult.checks.length >= 4, 'checks=' + dprResult.checks.length);
}

/* ---------- 2.9 DOM 集成冒烟：用极简 stub DOM 真跑一遍 proj/map/app ----------
   沙箱开不了浏览器，但渲染路径（MAP.render / APP.render / 新增视觉元素）
   至少要在"没有 DOM 的 Node"里跑一遍，才能把拼错的 id 或未定义变量抓出来。
   ------------------------------------------------------------------------ */
var registry = {};

function makeCtx() {
  var ctx = { calls: {} };
  var names = ['setTransform', 'clearRect', 'fillRect', 'save', 'restore', 'beginPath',
    'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'drawImage', 'arc',
    'setLineDash', 'fillText', 'strokeText', 'measureText'];
  names.forEach(function (n) {
    ctx[n] = function () { ctx.calls[n] = (ctx.calls[n] || 0) + 1; };
  });
  // measureText 要return对象，否则画校园边界标签时会读 undefined.width
  ctx.measureText = function (s) {
    ctx.calls['measureText'] = (ctx.calls['measureText'] || 0) + 1;
    return { width: String(s || '').length * 6 };
  };
  // 记下画了哪些字（用来断言"门名牌 / 树图例"确实落到画布上，而不是只存在于数据里）
  ctx.texts = [];
  ctx.fillText = function (s) {
    ctx.calls['fillText'] = (ctx.calls['fillText'] || 0) + 1;
    ctx.texts.push(String(s));
  };
  return ctx;
}

function makeElement(tag, id) {
  var node = {
    tagName: String(tag || 'div').toUpperCase(),
    id: id || '',
    style: {},
    children: [],
    attributes: {},
    className: '',
    textContent: '',
    nodeValue: '',
    value: '',
    max: '',
    width: 0,
    height: 0,
    parentElement: null,
    _listeners: {},
    addEventListener: function (type, fn) {
      if (!this._listeners[type]) { this._listeners[type] = []; }
      this._listeners[type].push(fn);
    },
    removeEventListener: function () {},
    appendChild: function (child) {
      this.children.push(child);
      child.parentElement = this;
      if (child.id) { registry[child.id] = child; }
      return child;
    },
    setAttribute: function (k, v) { this.attributes[k] = v; },
    getAttribute: function (k) { return this.attributes[k]; },
    getBoundingClientRect: function () { return { width: 1200, height: 800, left: 0, top: 0 }; },
    dispatch: function (type, ev) {
      var list = this._listeners[type] || [];
      var payload = ev || { type: type };
      for (var i = 0; i < list.length; i++) { list[i].call(this, payload); }
    }
  };
  if (id) { registry[id] = node; }
  return node;
}

function makeCanvas() {
  var cv = makeElement('canvas');
  cv.getContext = function () { return cv._ctx || (cv._ctx = makeCtx()); };
  return cv;
}

var doc = makeElement('html');
doc.body = makeElement('body', 'body');
doc.createElement = function (tag) { return String(tag).toLowerCase() === 'canvas' ? makeCanvas() : makeElement(tag); };
doc.createTextNode = function (text) { var n = makeElement('#text'); n.nodeValue = String(text); return n; };
doc.getElementById = function (id) { return registry[id] || null; };

var mapWrap = makeElement('div', 'map-wrap');
makeElement('aside', 'panel');
makeElement('div', 'app');
var mainCanvas = makeCanvas();
mainCanvas.id = 'map';
registry['map'] = mainCanvas;
mainCanvas.parentElement = mapWrap;
var legend = makeElement('div', 'legend');
var compassEl = makeElement('div', 'compass');
var needleEl = makeElement('i', 'compass-needle');
compassEl.appendChild(needleEl);
// 治理侧：种树规划的面板与按钮（app.js 的 init/bind 要拿到它们）
['tab-route', 'tab-plan', 'pane-route', 'pane-plan',
  'plan-count', 'plan-area', 'plan-ratio', 'plan-minutes', 'plan-cost', 'plan-wan',
  'plan-baseline', 'plan-optimize', 'plan-plant-all', 'plan-undo', 'plan-clear',
  'plan-count-input',
  'plan-progress', 'plan-progress-bar', 'plan-progress-text', 'plan-msg',
  'plan-rank', 'plan-rank-block', 'plan-rank-sum', 'plan-rank-note'].forEach(function (id) {
  makeElement('div', id);
});

['time-label', 'time-slider', 'sun-elev', 'sun-az', 'sun-hint',
  'start-select', 'end-select', 'pick-hint', 'route-tag',
  'fast-min', 'fast-sun', 'fast-shade', 'fast-len',
  'cool-min', 'cool-sun', 'cool-shade', 'cool-len',
  'delta', 'demo-date',
  'data-flag', 'notes'].forEach(function (id) { makeElement('div', id); });

// index.html 新增的「示例 A / 示例 B」按钮：stub 里必须存在，否则 app.js
// 的 bind() 拿不到节点，示例切换根本测不到。
var pairAEl = makeElement('button', 'pair-a');
pairAEl.className = 'pair-btn is-on';
pairAEl.setAttribute('data-pair', '0');
pairAEl.setAttribute('aria-pressed', 'true');
pairAEl.textContent = '示例 A';
var pairBEl = makeElement('button', 'pair-b');
pairBEl.className = 'pair-btn';
pairBEl.setAttribute('data-pair', '1');
pairBEl.setAttribute('aria-pressed', 'false');
pairBEl.textContent = '示例 B';

// 「平面 / 立体」视图按钮：index.html 里新增，stub 里也得有，否则
// app.js 的 bind() 拿不到节点，立体视图这条路径完全测不到。
var viewPlanEl = makeElement('button', 'view-plan');
viewPlanEl.className = 'view-btn is-on';
viewPlanEl.setAttribute('data-iso', '0');
viewPlanEl.setAttribute('aria-pressed', 'true');
viewPlanEl.textContent = '平面';
var viewIsoEl = makeElement('button', 'view-iso');
viewIsoEl.className = 'view-btn';
viewIsoEl.setAttribute('data-iso', '1');
viewIsoEl.setAttribute('aria-pressed', 'false');
viewIsoEl.textContent = '立体';

box.document = doc;
box.devicePixelRatio = 1;
// 优化按钮用 setTimeout 把"计算中"先画出来；stub 里直接同步执行
box.setTimeout = function (fn) { fn(); };
box.addEventListener = function () {};

var jsLoadErr = null;
try {
  ['js/trees.js', 'js/plan.js', 'js/iso.js', 'js/proj.js', 'js/router.js', 'js/map.js', 'js/app.js'].forEach(function (rel) {
    vm.runInContext(read(rel), box, { filename: rel });
  });
} catch (e) {
  jsLoadErr = e;
}
ok('proj/map/app 可在 stub DOM 下加载', !jsLoadErr, jsLoadErr ? String(jsLoadErr.message) : '');

var initErr = null;
if (!jsLoadErr) {
  try {
    doc.dispatch('DOMContentLoaded');
  } catch (e) {
    initErr = e;
  }
}
ok('APP.init() 渲染一帧无异常', !jsLoadErr && !initErr,
  initErr ? String(initErr.message) : '');

if (!jsLoadErr && !initErr) {
  var deltaEl = registry['delta'];
  var route14 = ROUTES.frames[idx1400].routes[0];
  var expect14 = CORE.routeSummary(route14.fastest, route14.cool);

  ok('默认帧落在 14:00（时间标签）', registry['time-label'].textContent === '14:00',
    registry['time-label'].textContent);
  ok('结论文案由 core.routeSummary 生成', deltaEl.textContent === expect14.text,
    deltaEl.textContent + ' vs ' + expect14.text);
  ok('结论 level 写到 data-level 属性',
    deltaEl.getAttribute('data-level') === expect14.level,
    String(deltaEl.getAttribute('data-level')));

  // 阴影覆盖率必须落到卡片上，并且阴凉路线确实更高（否则「阴影覆盖翻倍」讲不出来）
  var shadeF14 = CORE.shadeMeters(route14.fastest);
  var shadeC14 = CORE.shadeMeters(route14.cool);
  ok('卡片渲染了最快路线的阴影覆盖率',
    registry['fast-shade'].textContent === CORE.fmtNum(shadeF14.shadePct, 0) + '%',
    registry['fast-shade'].textContent);
  ok('卡片渲染了阴凉路线的阴影覆盖率',
    registry['cool-shade'].textContent === CORE.fmtNum(shadeC14.shadePct, 0) + '%',
    registry['cool-shade'].textContent);
  ok('阴凉路线的阴影覆盖率确实高于最快路线（14:00）',
    shadeC14.shadePct > shadeF14.shadePct,
    shadeF14.shadePct.toFixed(1) + '% vs ' + shadeC14.shadePct.toFixed(1) + '%');
  ok('14:00 结论用「米」表述多走距离',
    deltaEl.textContent.indexOf('米') >= 0, deltaEl.textContent);

  var mapCtx = mainCanvas._ctx;
  ok('画布确实画了地面 / 阴影 / 路线',
    !!mapCtx && mapCtx.calls.fillRect >= 1 && mapCtx.calls.drawImage >= 1 && mapCtx.calls.stroke >= 1,
    mapCtx ? JSON.stringify(mapCtx.calls) : 'no ctx');

  /* --- 2.5D 立体视图（零依赖体块） ---
     默认平面视图必须完全不变（上面那些断言就是守护），这里单独测立体这条路：
     几何可逆、面朝得对、亮度跟太阳走、按钮/指北针同步、切回来不留脏状态。 */
  var ISO = W.ISO;
  var isoOk = !!ISO && typeof ISO.make === 'function' && typeof ISO.scene === 'function';
  ok('js/iso.js 已加载（立体视图的几何模块）', isoOk);

  if (isoOk) {
    var baseView = W.PROJ.fit(1200, 800, 28);
    var isoView = ISO.fitView(baseView, 1200, 800, ISO.FIT_FACTOR);
    ok('立体视图比平面视图略小（旋转后四角不出画）',
      Math.abs(isoView.scale - baseView.scale * ISO.FIT_FACTOR) < 1e-9,
      baseView.scale.toFixed(4) + ' -> ' + isoView.scale.toFixed(4));
    ok('等比缩小时画布中心不动（bbox 中心仍落在 600,400）',
      Math.abs(isoView.x(0) - 600) < 1e-6 && Math.abs(isoView.y(0) - 400) < 1e-6,
      isoView.x(0).toFixed(2) + ',' + isoView.y(0).toFixed(2));

    var prj = ISO.make(isoView, 1200, 800);
    var rtOk = [[120, -80], [-300, 260], [0, 0]].every(function (w) {
      var s = prj.project(w[0], w[1], 0);
      var b = prj.unproject(s[0], s[1]);
      return Math.abs(b[0] - w[0]) < 1e-6 && Math.abs(b[1] - w[1]) < 1e-6;
    });
    ok('投影可逆：屏幕坐标能反解回米坐标（立体下点选依然准）', rtOk);

    var hUp = prj.project(0, 0, 30), hDown = prj.project(0, 0, 0);
    ok('楼高往上拔：30 m 的点比地面点更靠屏幕上方',
      hUp[0] === hDown[0] && hUp[1] < hDown[1],
      hUp[1].toFixed(1) + ' < ' + hDown[1].toFixed(1));

    var sun14 = W.DATA_META.frames[idx1400].sun;
    var items = ISO.scene(W.DATA_BUILDINGS, prj, sun14);
    var faceTotal = 0;
    var sortedOk = true;
    for (var i2 = 0; i2 < items.length; i2++) {
      faceTotal += items[i2].faces.length;
      if (i2 > 0 && items[i2].depth < items[i2 - 1].depth) { sortedOk = false; }
    }
    ok('楼按深度从远到近排（画家算法：近的盖住远的）', items.length > 200 && sortedOk,
      items.length + ' 栋 / ' + faceTotal + ' 个面');
    ok('每栋楼 = 1 个顶面 + 至少 1 个朝向观察者的侧面',
      items.every(function (it) {
        var top = 0, side = 0;
        it.faces.forEach(function (f) { if (f.kind === 'top') { top++; } else { side++; } });
        return top === 1 && side >= 1;
      }));
    ok('所有面都是有限坐标 + 合法颜色（不会画出 NaN 黑块）',
      items.every(function (it) {
        return it.faces.every(function (f) {
          return f.pts.length >= 3 && /^rgb\(/.test(f.fill) && f.pts.every(function (q) {
            return isFinite(q[0]) && isFinite(q[1]);
          });
        });
      }));

    // 一栋 50×50 的方楼：轴对齐 + yaw=-26° 时只有 2 个侧面朝着观察者
    var square = [{ p: [[0, 0], [50, 0], [50, 50], [0, 50]], h: 18 }];
    var sq = ISO.scene(square, prj, sun14);
    ok('方楼只画朝向观察者的侧面（2 面 + 顶面 = 3）',
      sq.length === 1 && sq[0].faces.length === 3, '面数=' + (sq[0] ? sq[0].faces.length : 'n/a'));

    function bright(fill) {
      var m = /rgb\((\d+),(\d+),(\d+)\)/.exec(fill);
      return m ? (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 : NaN;
    }
    function sideAvg(sc) {
      var s = 0, n = 0;
      sc[0].faces.forEach(function (f) { if (f.kind === 'side') { s += bright(f.fill); n++; } });
      return n ? s / n : NaN;
    }
    ok('侧面亮度跟着太阳方位走（太阳在南比在北更亮）',
      sideAvg(ISO.scene(square, prj, [180, 40])) > sideAvg(ISO.scene(square, prj, [0, 40])) + 8,
      sideAvg(ISO.scene(square, prj, [180, 40])).toFixed(1) + ' > ' +
      sideAvg(ISO.scene(square, prj, [0, 40])).toFixed(1));

    function topBright(elev) {
      var faces = ISO.scene(square, prj, [180, elev])[0].faces;
      for (var t = 0; t < faces.length; t++) { if (faces[t].kind === 'top') { return bright(faces[t].fill); } }
      return NaN;
    }
    ok('顶面亮度随太阳高度角变化（正午比清晨亮）', topBright(70) > topBright(5) + 5,
      topBright(70).toFixed(1) + ' > ' + topBright(5).toFixed(1));

    // —— DOM 侧：按钮 / 指北针 / 点选 ——
    var planBtn = registry['view-plan'], isoBtn = registry['view-iso'];
    ok('「平面 / 立体」两个按钮都接上了（index.html + app.js）', !!planBtn && !!isoBtn);
    ok('默认是平面视图', W.MAP.isIso() === false);

    var fillsBefore = (mainCanvas._ctx.calls.fill || 0);
    var textsBefore = (mainCanvas._ctx.calls.fillText || 0);
    isoBtn.dispatch('click');
    var fillsDelta = (mainCanvas._ctx.calls.fill || 0) - fillsBefore;
    var textsDelta = (mainCanvas._ctx.calls.fillText || 0) - textsBefore;
    ok('点「立体」进入体块视图并真的多画了几百个面（+' + fillsDelta + ' 次 fill）',
      W.MAP.isIso() === true && fillsDelta > 400, 'fill+' + fillsDelta);
    ok('立体视图下标注仍然画出来（fillText 有增量，文字没被旋转矩阵带走）',
      textsDelta > 10, 'fillText+' + textsDelta);
    ok('按钮状态同步（aria-pressed / is-on）',
      isoBtn.getAttribute('aria-pressed') === 'true' && String(isoBtn.className).indexOf('is-on') >= 0 &&
      planBtn.getAttribute('aria-pressed') === 'false');
    ok('指北针按投影算出的正北角旋转（不是直接拿 yaw 顶替）',
      registry['compass-needle'].style.transform === 'rotate(' + W.MAP.northAngle().toFixed(1) + 'deg)' &&
      Math.abs(W.MAP.northAngle() - ISO.YAW_DEG) > 1,
      registry['compass-needle'].style.transform + ' | northAngle=' + W.MAP.northAngle().toFixed(1) + '°');

    var centerW = W.MAP.toWorld(600, 400);
    var bx0 = (W.PROJ.bbox[0] + W.PROJ.bbox[2]) / 2;
    var by0 = (W.PROJ.bbox[1] + W.PROJ.bbox[3]) / 2;
    ok('立体视图下点选坐标仍正确（画布中心 = 校园几何中心）',
      Math.abs(centerW[0] - bx0) < 1 && Math.abs(centerW[1] - by0) < 1,
      centerW[0].toFixed(1) + ',' + centerW[1].toFixed(1) + ' vs ' + bx0 + ',' + by0);

    // V 键切换（演示时一个键切视图）
    doc.dispatch('keydown', { key: 'v', target: { tagName: 'BODY' }, preventDefault: function () {} });
    ok('按 V 键能切回平面视图', W.MAP.isIso() === false && planBtn.getAttribute('aria-pressed') === 'true');
    ok('切回平面后指北针复位', registry['compass-needle'].style.transform === 'rotate(0.0deg)',
      registry['compass-needle'].style.transform);

    ok('深链接 #iso 能直开立体视图（其余 hash 一律平面）',
      CORE.wantsIsoView('#iso') === true && CORE.wantsIsoView('#ISO') === true &&
      CORE.wantsIsoView('') === false && CORE.wantsIsoView('#plan') === false);

    /* --- 树（纯观感层） ---
       树是现场用固定种子生成的，不写 data/*.js、不进阴影与晒度计算。
       这里锁四件事：确定性、合法性（别长在楼里/水里/校外）、平面视图真的画了、
       立体视图里树和楼一起排序且树冠存在。 */
    var TR = W.TREES;
    ok('js/trees.js 已加载（树是现场生成的装饰层）',
      !!TR && typeof TR.generate === 'function' && typeof TR.pointInRing === 'function');

    if (TR && typeof TR.generate === 'function') {
      var treeOpts = {
        buildings: W.DATA_BUILDINGS,
        roads: (W.DATA_BASEMAP && W.DATA_BASEMAP.roads) || [],
        water: (W.DATA_BASEMAP && W.DATA_BASEMAP.water) || [],
        campusRing: W.DATA_META.campus.ring
      };
      var treesA = TR.generate(treeOpts);
      var treesB = TR.generate(treeOpts);
      var sameTrees = treesA.length === treesB.length;
      if (sameTrees) {
        for (var ti2 = 0; ti2 < treesA.length; ti2++) {
          var ta = treesA[ti2], tb = treesB[ti2];
          if (ta.x !== tb.x || ta.y !== tb.y || ta.r !== tb.r || ta.h !== tb.h || ta.tone !== tb.tone) {
            sameTrees = false; break;
          }
        }
      }
      ok('树是确定性生成（同一个种子两次完全一致，不会每次刷不一样）', sameTrees,
        treesA.length + ' vs ' + treesB.length);

      var st = TR.generate.stats || {};
      ok('树总数达到上限 ' + TR.LIMIT + '，且行道树与空地树都有份额',
        treesA.length === TR.LIMIT && st.roadTrees > 0 && st.groveTrees > 0,
        'total=' + treesA.length + ' road=' + st.roadTrees + ' grove=' + st.groveTrees);

      var badSize = 0, badIn = 0, badWater = 0, badOut = 0;
      for (var ti3 = 0; ti3 < treesA.length; ti3++) {
        var tt = treesA[ti3];
        if (!(tt.r >= 2.5 && tt.r <= 5.3 && tt.h >= 6.4 && tt.h <= 11.6 && tt.tone >= 0 && tt.tone <= 1)) { badSize++; }
        if (!TR.pointInRing(tt.x, tt.y, W.DATA_META.campus.ring)) { badOut++; }
        for (var bi = 0; bi < W.DATA_BUILDINGS.length; bi++) {
          var bp = W.DATA_BUILDINGS[bi].p;
          if (bp && TR.pointInRing(tt.x, tt.y, bp)) { badIn++; break; }
        }
        for (var wi = 0; wi < treeOpts.water.length; wi++) {
          var wp = treeOpts.water[wi].p;
          if (wp && TR.pointInRing(tt.x, tt.y, wp)) { badWater++; break; }
        }
      }
      ok('每棵树的树冠半径/树高/色阶都在范围内', badSize === 0, '越界 ' + badSize + ' 棵');
      ok('没有一棵树长在楼里（树冠不会糊在墙上）', badIn === 0, '楼内 ' + badIn + ' 棵');
      ok('没有一棵树长在水里', badWater === 0, '水内 ' + badWater + ' 棵');
      ok('树全部落在校园边界内（不会飘到校外）', badOut === 0, '界外 ' + badOut + ' 棵');

      var minGap = Infinity;
      for (var gi = 0; gi < treesA.length; gi++) {
        for (var gj = gi + 1; gj < treesA.length; gj++) {
          var dxx = treesA[gi].x - treesA[gj].x, dyy = treesA[gi].y - treesA[gj].y;
          var dd2 = dxx * dxx + dyy * dyy;
          if (dd2 < minGap) { minGap = dd2; }
        }
      }
      minGap = Math.sqrt(minGap);
      ok('树冠之间保底 ' + TR.MIN_GAP + ' m 间距（不会糊成一坨）',
        minGap >= TR.MIN_GAP - 1e-6, '实际最小 ' + minGap.toFixed(2) + ' m');

      ok('trees.js 不写 data/*、不碰网络与 DOM（只读生成）',
        (function () {
          var src = stripComments(read('js/trees.js'));
          return src.indexOf('DATA_SHADOWS') < 0 && src.indexOf('DATA_ROUTES') < 0 &&
            src.indexOf('document.') < 0 && src.indexOf('fetch(') < 0;
        })());

      // 平面视图：每棵树 = 树冠圆 + 受光面圆；画布上另有起终点 2 个圆、每扇门 2 个圆
      var arcsBefore = mapCtx.calls.arc || 0;
      W.APP.redraw();
      var arcDelta = (mapCtx.calls.arc || 0) - arcsBefore;
      var gateArcs = CORE.gatesFromRoads(W.DATA_BASEMAP.roads, W.DATA_META.campus.ring).length * 2;
      var expectArcs = treesA.length * 2 + 2 + gateArcs;
      ok('平面视图给每棵树画了「树冠 + 受光面」两个圆（真的画了，不是只在数据里）',
        arcDelta === expectArcs, '新增 arc=' + arcDelta + '，期望 ' + expectArcs +
        '（树 ' + treesA.length + '×2 + 起终点 2 + 门 ' + (gateArcs / 2) + '×2）');

      // 立体视图：树进同一个深度排序列表，树冠是以椭圆多边形画的（不是圆）
      var treeIsoView = W.ISO.fitView(W.PROJ.fit(1200, 800, 28), 1200, 800, W.ISO.FIT_FACTOR);
      var treeIsoPrj = W.ISO.make(treeIsoView, 1200, 800);
      var treeItems = W.ISO.scene(W.DATA_BUILDINGS, treeIsoPrj, W.DATA_META.frames[idx1400].sun, treesA);
      var canopy = 0, sortedOk = true, lastDepth = -Infinity;
      for (var ii = 0; ii < treeItems.length; ii++) {
        if (treeItems[ii].depth < lastDepth) { sortedOk = false; }
        lastDepth = treeItems[ii].depth;
        for (var fi = 0; fi < treeItems[ii].faces.length; fi++) {
          if (treeItems[ii].faces[fi].kind === 'tree') { canopy++; }
        }
      }
      ok('立体视图里每棵树都有树冠面（和楼在同一条深度排序链上）',
        canopy === treesA.length, '树冠 ' + canopy + ' / 树 ' + treesA.length);
      ok('立体视图整体按深度从远到近排序（树插在楼之间）', sortedOk);

      ok('图例补了「树」一项（画布上有树，图例不能缺）',
        html.indexOf('lg-tree') >= 0 && read('styles.css').indexOf('.lg-tree') >= 0);
    }

/* --- 种树优化器（治理侧，面 2）---
       这层是"规划演算"：树影按胶囊几何现场算，官方「阴凉 %」一个数字都不改。
       锁五件事：几何对不对、候选点是否合法、优化结果单调/分散/确定、
       成本换算自洽、不写 data/ 不碰网络。 */
    var PL = W.PLAN;
    ok('js/plan.js 已加载（规划树影 + 指标 + 优化器）',
      !!PL && typeof PL.makeContext === 'function' && typeof PL.shadowCapsule === 'function' &&
      typeof PL.cost === 'function' && typeof PL.serialize === 'function');

    if (PL) {
      // 1) 胶囊几何：90° 太阳 → 影子退化成圆；45° → 长度 = h/tan(45°) = h
      var capNoon = PL.shadowCapsule({ x: 0, y: 0, r: 4, h: 9 }, [180, 90]);
      ok('太阳在正上方（90°）时树影退化成一个圆（L=0）',
        !!capNoon && Math.abs(capNoon.len) < 1e-9 && Math.abs(capNoon.bx) < 1e-9 && Math.abs(capNoon.by) < 1e-9);

      var capS = PL.shadowCapsule({ x: 0, y: 0, r: 4, h: 9 }, [180, 45]);
      ok('太阳在南（方位 180°）时影子朝北（by>0、bx=0），与 build.py 的 (-sin, -cos)·L 一致',
        capS.by > 0 && Math.abs(capS.bx) < 1e-9 && Math.abs(capS.len - 9) < 1e-6,
        'cap=(' + capS.bx.toFixed(2) + ',' + capS.by.toFixed(2) + ') len=' + capS.len.toFixed(4));

      ok('太阳低于 3° 时不出树影（和 build.py 的 MIN_SUN_ELEVATION 一致）',
        PL.shadowCapsule({ x: 0, y: 0, r: 4, h: 9 }, [180, 0.5]) === null);

      ok('点判定：树下方与影子中段在影内，背面 5 m 在影外',
        PL.pointInCapsule(0, 0, capS) && PL.pointInCapsule(0, 4, capS) && !PL.pointInCapsule(0, -5, capS));

      // 2) 上下文：路网采样 / 5 m 网格 / 候选池
      var pctx = PL.makeContext({
        buildings: W.DATA_BUILDINGS,
        water: (W.DATA_BASEMAP && W.DATA_BASEMAP.water) || [],
        roads: (W.DATA_BASEMAP && W.DATA_BASEMAP.roads) || [],
        campusRing: W.DATA_META.campus.ring,
        frames: W.DATA_META.frames,
        bbox: W.DATA_META.bbox_m,
        graph: W.DATA_GRAPH,
        blockers: treesA
      });
      var pgeo = pctx.geometry, proad = pctx.road;
      ok('路网采样 = 613 条边 × 每边 4 点 = 2452（与 build.py 的 sampling 同源）',
        proad.nSamples === W.DATA_GRAPH.edges.length * 4 && proad.nSamples === 2452,
        'nSamples=' + proad.nSamples + ' edges=' + proad.edges);
      ok('面积网格是 5 m，且界内格 > 3 万（够细，单棵树不会被量化成 0）',
        pgeo.cell === 5 && pgeo.insideCount > 30000,
        'cell=' + pgeo.cell + ' inside=' + pgeo.insideCount);

      // 3) 基线：用 plan.js 的公式复算官方 14:00 数字，必须对得上
      var idx1400p = -1;
      for (var fp = 0; fp < W.DATA_META.frames.length; fp++) {
        if (W.DATA_META.frames[fp].t === '14:00') { idx1400p = fp; }
      }
      var pbase = pctx.measure([], idx1400p);
      ok('基线复算 = README 的「14:00 阴凉占比 19.9%」（两边公式一致）',
        Math.abs(pbase.ratio * 100 - 19.9) < 0.06, '复算 ' + (pbase.ratio * 100).toFixed(2) + '%');

      // 4) 候选池：两类都有；抽样全部合法
      var pcands = pctx.candidates();
      var nRoadC = 0, nGroveC = 0;
      for (var pc = 0; pc < pcands.length; pc++) {
        if (pcands[pc].kind === 'road') { nRoadC++; } else { nGroveC++; }
      }
      ok('候选池两类都有（行道树位 + 空地），且总量 ≥ 800',
        pcands.length >= 800 && nRoadC >= 100 && nGroveC >= 100,
        'total=' + pcands.length + ' road=' + nRoadC + ' grove=' + nGroveC);

      var badCand = 0;
      for (var pcs = 0; pcs < pcands.length; pcs += Math.max(1, Math.floor(pcands.length / 200))) {
        if (!pctx.legal(pcands[pcs].x, pcands[pcs].y, pcands[pcs].kind).ok) { badCand++; }
      }
      ok('候选点全部合法（抽样 200 个都过 legal，不会推荐一个种不了的点）', badCand === 0, '非法 ' + badCand);

      var bFirst = null;
      for (var bq = 0; bq < W.DATA_BUILDINGS.length; bq++) {
        if (W.DATA_BUILDINGS[bq].p && W.DATA_BUILDINGS[bq].p.length >= 3) { bFirst = W.DATA_BUILDINGS[bq]; break; }
      }
      var bCx = 0, bCy = 0;
      for (var bqr = 0; bqr < bFirst.p.length; bqr++) { bCx += bFirst.p[bqr][0]; bCy += bFirst.p[bqr][1]; }
      bCx /= bFirst.p.length; bCy /= bFirst.p.length;
      var bLegal = pctx.legal(bCx, bCy, 'grove');
      ok('楼中心不能种：legal 拒绝并给出原因', !bLegal.ok && !!bLegal.reason, 'reason=' + bLegal.reason);

      // 5) 单棵 / 多棵：量级与单调性
      // 取最靠校园中心的一个候选：边缘候选的树影会有一大半落在界外，面积天然偏小
      var pC0 = pcands[0], dC0 = Infinity;
      for (var pci = 0; pci < pcands.length; pci++) {
        var ddc = pcands[pci].x * pcands[pci].x + pcands[pci].y * pcands[pci].y;
        if (ddc < dC0) { dC0 = ddc; pC0 = pcands[pci]; }
      }
      var mOne = pctx.measure([pC0], idx1400p);
      ok('一棵树 14:00 的树荫面积在胶囊量级（80–200 m²，5 m 网格）',
        mOne.areaM2 >= 80 && mOne.areaM2 <= 200, 'area=' + Math.round(mOne.areaM2) + ' m²');
      ok('加树后路网阴凉占比只增不减（与建筑阴影取并集，不会重复扣）',
        mOne.ratio >= pbase.ratio - 1e-12,
        (pbase.ratio * 100).toFixed(2) + '% → ' + (mOne.ratio * 100).toFixed(2) + '%');
      var mThree = pctx.measure([pC0, pcands[50], pcands[100]], idx1400p);
      ok('树越多树荫面积越大（单调）', mThree.areaM2 >= mOne.areaM2,
        Math.round(mOne.areaM2) + ' → ' + Math.round(mThree.areaM2) + ' m²');

      // 6) 优化器：20 个点、降序、分散、确定、成本自洽
      var resA = pctx.optimize({ count: 20, areaFrame: idx1400p });
      var resB = pctx.optimize({ count: 20, areaFrame: idx1400p });
      ok('优化选出 20 个点位', resA.picks.length === 20, 'picks=' + resA.picks.length + ' pool=' + resA.pool);

      var rankOk = true, gainDesc = true, posGain = true;
      for (var rk = 0; rk < resA.picks.length; rk++) {
        if (resA.picks[rk].rank !== rk + 1) { rankOk = false; }
        if (!(resA.picks[rk].gainMinutes > 0)) { posGain = false; }
        if (rk > 0 && resA.picks[rk].gainMinutes > resA.picks[rk - 1].gainMinutes + 1e-9) { gainDesc = false; }
      }
      ok('排名连续 1..20、边际增益降序、每点增益 > 0', rankOk && gainDesc && posGain);

      var worstGap = Infinity;
      for (var g1 = 0; g1 < resA.picks.length; g1++) {
        for (var g2 = g1 + 1; g2 < resA.picks.length; g2++) {
          var gcdx = resA.picks[g1].x - resA.picks[g2].x, gcdy = resA.picks[g1].y - resA.picks[g2].y;
          var gd = Math.sqrt(gcdx * gcdx + gcdy * gcdy);
          if (gd < worstGap) { worstGap = gd; }
        }
      }
      ok('20 个点位两两 ≥ ' + PL.MIN_GAP + ' m（分散到多个片区，不挤在一条路上）',
        worstGap >= PL.MIN_GAP - 1e-6, '实际最小 ' + worstGap.toFixed(1) + ' m');

      var samePick = resA.picks.length === resB.picks.length;
      if (samePick) {
        for (var sp = 0; sp < resA.picks.length; sp++) {
          if (resA.picks[sp].x !== resB.picks[sp].x || resA.picks[sp].y !== resB.picks[sp].y) { samePick = false; }
        }
      }
      ok('优化是确定性的（同样输入两次，20 个点位逐个相同）', samePick);

      var wantWan = 20 * PL.COST_PER_TREE / 10000;
      ok('成本换算自洽：预算 = 20 × 单价、每万元 = 总分钟 ÷ 万元数',
        Math.abs(resA.budgetWan - wantWan) < 1e-9 &&
        Math.abs(resA.perWanMinutes - resA.totalMinutes / wantWan) < 1e-9 &&
        resA.costYuan === 20 * PL.COST_PER_TREE,
        '预算 ' + resA.budgetWan + ' 万元 · ' + resA.perWanMinutes.toFixed(2) + ' 分/万元');

      var dayOne = pctx.measureDay([resA.picks[0]]).minutes;
      ok('单棵回归：measureDay(单棵) = 优化器给的边际（±0.02 分）',
        Math.abs(dayOne - resA.picks[0].gainMinutes) < 0.02,
        dayOne.toFixed(3) + ' vs ' + resA.picks[0].gainMinutes.toFixed(3));

      var dayAll = pctx.measureDay(resA.picks).minutes;
      ok('20 棵并集 = 优化器总计（±0.05 分，重叠没有重复计数）',
        Math.abs(dayAll - resA.totalMinutes) < 0.05,
        dayAll.toFixed(3) + ' vs ' + resA.totalMinutes.toFixed(3));

      // 7) 持久化 / 描述
      var rawPlan = PL.serialize([{ x: 1.23, y: 4.56 }, { x: 7, y: 8 }]);
      var backPlan = PL.parse(rawPlan);
      ok('规划结果能存能读（localStorage 序列化 roundtrip）',
        backPlan.length === 2 && backPlan[0].x === 1.2 && backPlan[0].y === 4.6 &&
        backPlan[1].x === 7 && backPlan[1].y === 8);
      ok('坏存档不会炸（乱码 / 空串都返回空数组）',
        PL.parse('{oops').length === 0 && PL.parse('').length === 0 && PL.parse(null).length === 0);

      ok('点位描述带方位（"xx楼东侧 30 m" 或"空地（x, y）"）',
        /侧 |空地/.test(PL.describe(resA.picks[0].x, resA.picks[0].y, W.DATA_BUILDINGS)),
        PL.describe(resA.picks[0].x, resA.picks[0].y, W.DATA_BUILDINGS));

      var psrc = stripComments(read('js/plan.js'));
      ok('plan.js 不写 data/*、不碰网络与 DOM（纯计算层）',
        psrc.indexOf('DATA_SHADOWS') < 0 && psrc.indexOf('DATA_ROUTES') < 0 &&
        psrc.indexOf('fetch(') < 0 && psrc.indexOf('document.') < 0 &&
        psrc.indexOf('localStorage') < 0);
    }

    // 8) 页面接线：页签、面板、口径声明
    ok('页面有「种树规划」页签与面板（tab-plan / pane-plan / 优化按钮）',
      html.indexOf('id="tab-plan"') >= 0 && html.indexOf('id="pane-plan"') >= 0 &&
      html.indexOf('id="plan-optimize"') >= 0 && html.indexOf('id="plan-rank"') >= 0);
    ok('页面明说：含树指标不进官方口径（防"两个数字"被问穿）',
      html.indexOf('不进') >= 0 && html.indexOf('官方「阴凉 %」') >= 0);
    ok('styles.css 有规划面板样式（页签 / 三数字 / 排名表）',
      read('styles.css').indexOf('.plan-metrics') >= 0 &&
      read('styles.css').indexOf('.plan-rank') >= 0 &&
      read('styles.css').indexOf('.tab.is-on') >= 0);

    /* --- 校门（道路 × 校园边界的交点，不是手工塞的坐标） --- */
    var gatesA = CORE.gatesFromRoads(W.DATA_BASEMAP.roads, W.DATA_META.campus.ring);
    var gatesB = CORE.gatesFromRoads(W.DATA_BASEMAP.roads, W.DATA_META.campus.ring);
    ok('校门由「道路 × 校园边界」求交得到（4~8 扇）',
      gatesA.length >= 4 && gatesA.length <= 8, '识别到 ' + gatesA.length + ' 扇：' + gatesA.map(function (g) { return g.name; }).join('/'));
    ok('校门命名不重复（不会出现两个"北门"）',
      (function () {
        var seen = {};
        for (var i = 0; i < gatesA.length; i++) {
          if (seen[gatesA[i].name]) { return false; }
          seen[gatesA[i].name] = 1;
        }
        return true;
      })(), gatesA.map(function (g) { return g.name; }).join('/'));

    var gateNames = gatesA.map(function (g) { return g.name; });
    ok('北门/东门/南门/西门 四个正门都在（和校园图上的四个门对得上）',
      ['北门', '东门', '南门', '西门'].every(function (n) { return gateNames.indexOf(n) >= 0; }),
      gateNames.join('/'));

    ok('每扇门都落在校园边界上（到边界 < 5 m）',
      gatesA.every(function (g) {
        var ring = W.DATA_META.campus.ring, best = Infinity;
        for (var i = 0; i < ring.length; i++) {
          var p = ring[i], q = ring[(i + 1) % ring.length];
          var dx = q[0] - p[0], dy = q[1] - p[1];
          var l2 = dx * dx + dy * dy;
          var t = l2 > 0 ? ((g.x - p[0]) * dx + (g.y - p[1]) * dy) / l2 : 0;
          t = Math.max(0, Math.min(1, t));
          var d = Math.sqrt(Math.pow(g.x - (p[0] + t * dx), 2) + Math.pow(g.y - (p[1] + t * dy), 2));
          if (d < best) { best = d; }
        }
        return best < 5;
      }));

    ok('门名与方位角一致（北 0°、东 90°、顺时针）',
      gatesA.every(function (g) {
        var dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
        var expect = dirs[Math.round(g.az / 45) % 8];
        return g.name.indexOf(expect) === 0;
      }), gatesA.map(function (g) { return g.name + '@' + g.az + '°'; }).join(' '));

    ok('正门走主干道/校内路，便门走服务道/步道（门的大小不是随便定的）',
      gatesA.every(function (g) {
        var mainKinds = ['main', 'local'], sideKinds = ['service', 'path'];
        return g.main ? mainKinds.indexOf(g.kind) >= 0 : sideKinds.indexOf(g.kind) >= 0;
      }), gatesA.map(function (g) { return g.name + ':' + g.kind; }).join(' '));

    ok('校门识别是确定性的（同一份数据两次一致）',
      gatesA.length === gatesB.length && gatesA.every(function (g, i) {
        return g.x === gatesB[i].x && g.y === gatesB[i].y && g.name === gatesB[i].name;
      }));

    ok('画布上真的画了门名牌（不是只算出来没用上）',
      gatesA.every(function (g) { return mapCtx.texts.indexOf(g.name) >= 0; }),
      '画布文字里含门名 ' + gatesA.filter(function (g) { return mapCtx.texts.indexOf(g.name) >= 0; }).length + '/' + gatesA.length);
  }

  var dial = registry['sun-dial'];
  var arrow = registry['sun-arrow'];
  var az14 = W.DATA_META.frames[idx1400].sun[0];
  var el14 = W.DATA_META.frames[idx1400].sun[1];
  ok('罗盘旁已插入太阳方位箭头',
    !!dial && !!arrow && mapWrap.children.indexOf(dial) >= 0 && !!registry['sun-dial-label']);
  ok('箭头角度 = 当前帧方位角（14:00 为 ' + az14 + '°）',
    !!arrow && arrow.style.transform === 'rotate(' + az14 + 'deg)',
    arrow ? arrow.style.transform : 'no arrow');

  var legendItem = registry['lg-building'];
  var legendText = legendItem && legendItem.children[1] ? legendItem.children[1].nodeValue : '';
  ok('图例新增"建筑颜色越深越高"',
    !!legendItem && legend.children.indexOf(legendItem) >= 0 && legendText.indexOf('越深越高') >= 0,
    legendText);

  var banner = registry['low-conf-banner'];
  ok('低置信度横幅默认' + (el14 >= 15 ? '隐藏' : '显示') + '（14:00 高度角 ' + el14 + '°）',
    el14 >= 15 ? (!!banner && banner.className === '' && banner.textContent === '')
               : (!!banner && banner.className === 'show'),
    banner ? banner.className : 'no banner');

  // 借示例数据的一帧临时改成低太阳，验证横幅出现 + 箭头随帧旋转
  var f0 = W.DATA_META.frames[0];
  var t0 = f0.t;
  var az0 = f0.sun[0];
  var backupElev = f0.sun[1];
  f0.sun[1] = 10;
  var slider = registry['time-slider'];
  slider.value = '0';
  slider.dispatch('input');
  ok('高度角 10° 时黄色横幅出现且带帧时间',
    banner.className === 'show' && banner.textContent.indexOf(t0) >= 0 &&
    banner.textContent.indexOf('15') >= 0,
    banner.className + ' | ' + banner.textContent);
  ok('箭头随帧旋转（' + t0 + ' 方位角 ' + az0 + '°）',
    arrow.style.transform === 'rotate(' + az0 + 'deg)', arrow.style.transform);
  f0.sun[1] = backupElev;

  var GRAPH = W.DATA_GRAPH;
  var anchors = (W.ROUTER && W.ROUTER.anchors && W.ROUTER.anchors()) || [];
  ok('起终点下拉已按校园地名填充（' + anchors.length + ' 项）',
    registry['start-select'].children.length >= anchors.length &&
    registry['end-select'].children.length >= anchors.length,
    registry['start-select'].children.length + ' / ' + registry['end-select'].children.length +
    ' vs ' + anchors.length);
  ok('默认真的是「老年人活动中心 → 岭南学院」',
    String(registry['pick-hint'].textContent).indexOf('老年人活动中心') >= 0 &&
    String(registry['pick-hint'].textContent).indexOf('岭南学院') >= 0,
    registry['pick-hint'].textContent);
  ok('数据说明列表已填充（' + (W.STRINGS.notes || []).length + ' 条）',
    registry['notes'].children.length === (W.STRINGS.notes || []).length &&
    registry['notes'].children.length > 0,
    String(registry['notes'].children.length));

  /* --- 2.8 浏览器端即时算路（任意两点） --- */
  ok('graph.js 已加载（' + (GRAPH ? GRAPH.nodes.length : 0) + ' 节点 / ' +
    (GRAPH ? GRAPH.edges.length : 0) + ' 边）',
    !!(GRAPH && GRAPH.nodes && GRAPH.nodes.length > 100 && GRAPH.edges.length > 100),
    GRAPH ? 'ok' : 'no DATA_GRAPH');
  ok('ROUTER 已就绪', !!(W.ROUTER && W.ROUTER.ready && W.ROUTER.ready()));

  var R = W.ROUTER;
  var idxD = CORE.pickFrameIndex(META.frames, '14:00');

  // 关键一致性：现场算出来的两条路线必须和 Python 预计算的一模一样
  var preset = ROUTES.frames[idxD].routes[0];
  var live = R.solve([anchors[0].x, anchors[0].y], [anchors[0].x, anchors[0].y], idxD); // 同点，应报错
  ok('起点=终点时给出友好提示而不是崩',
    !!live && live.ok === false && String(live.reason).length > 0, live && live.reason);

  var fromA = W.PROJ.toXY(ROUTES.pairs[0].from[0], ROUTES.pairs[0].from[1]);
  var toA = W.PROJ.toXY(ROUTES.pairs[0].to[0], ROUTES.pairs[0].to[1]);
  var lv = R.solve(fromA, toA, idxD);
  ok('现场算路可用（14:00 演示起终点）', !!(lv && lv.ok), lv && (lv.reason || 'ok'));
  if (lv && lv.ok) {
    ok('现场算的最快路线与预计算一致（' + lv.fastest.length_m + ' vs ' +
      preset.fastest.length_m + ' 米）',
      lv.fastest.length_m === preset.fastest.length_m,
      'diff=' + (lv.fastest.length_m - preset.fastest.length_m));
    ok('现场算的阴凉路线与预计算一致（' + lv.cool.sun_minutes + ' vs ' +
      preset.cool.sun_minutes + ' 分钟暴晒）',
      Math.abs(lv.cool.sun_minutes - preset.cool.sun_minutes) <= 0.15,
      'diff=' + (lv.cool.sun_minutes - preset.cool.sun_minutes).toFixed(2));
  }

  // 任意两点：换两个完全不同的地名也要能算出来
  var alt = null;
  for (var ia = 0; ia < anchors.length && !alt; ia++) {
    for (var ib = anchors.length - 1; ib >= 0; ib--) {
      if (ia === ib) { continue; }
      var r2 = R.solve([anchors[ia].x, anchors[ia].y], [anchors[ib].x, anchors[ib].y], idxD);
      if (r2.ok && r2.fastest.length_m > 200) { alt = { a: anchors[ia], b: anchors[ib], r: r2 }; break; }
    }
  }
  ok('任意两个地名都能算出路线（' +
    (alt ? alt.a.name + ' → ' + alt.b.name : '无') + '）', !!alt,
    alt ? alt.r.fastest.length_m + ' 米' : '全部失败');
  if (alt) {
    ok('往返对称（A→B 与 B→A 长度相等）',
      Math.abs(alt.r.fastest.length_m -
        R.solve([alt.b.x, alt.b.y], [alt.a.x, alt.a.y], idxD).fastest.length_m) <= 1);
    ok('同一条路线上阴凉版的暴晒分钟 <= 最快版',
      alt.r.cool.sun_minutes <= alt.r.fastest.sun_minutes + 0.05,
      alt.r.cool.sun_minutes + ' vs ' + alt.r.fastest.sun_minutes);
  }

  // 吸附：校内随便一点能吸附，跑到广州塔就该拒绝
  var mid = R.snap(0, 0);
  ok('校园中心点能吸附到道路（' + (mid ? mid.dist.toFixed(1) : '?') + ' 米内）', !!mid);
  ok('离校园 5 公里外的点会被拒绝（不硬算）', R.snap(5000, 5000) === null);
}

/* --- 2.9 校园边界（防"路线跑出校门"这类回归） --- */

function inRing(x, y, ring) {
  var inside = false;
  for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    var xi = ring[i][0], yi = ring[i][1];
    var xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

var CAMPUS = META && META.campus;
ok('meta.campus 存在且名字含「中山大学」',
  !!(CAMPUS && CAMPUS.name && CAMPUS.name.indexOf('中山大学') >= 0 && CAMPUS.name.indexOf('南校园') >= 0),
  CAMPUS ? CAMPUS.name : 'no campus');
ok('校园面积在 1.0~1.4 平方公里之间（实测 1.20）',
  !!CAMPUS && CAMPUS.area_m2 > 1.0e6 && CAMPUS.area_m2 < 1.4e6,
  CAMPUS ? String(CAMPUS.area_m2) : 'no area');
ok('校园边界环点数 >= 3', !!(CAMPUS && CAMPUS.ring && CAMPUS.ring.length >= 3),
  String(CAMPUS && CAMPUS.ring ? CAMPUS.ring.length : 0));

var ring = (CAMPUS && CAMPUS.ring) || [];

// 建筑质心必须全在校园内（数据已按多边形过滤，这里防止过滤被关掉）
var outBuildings = [];
for (var bi = 0; bi < BUILDINGS.length; bi++) {
  var bp = BUILDINGS[bi].p;
  var sx = 0, sy = 0;
  for (var k = 0; k < bp.length; k++) { sx += bp[k][0]; sy += bp[k][1]; }
  if (!inRing(sx / bp.length, sy / bp.length, ring)) { outBuildings.push(BUILDINGS[bi].id); }
}
ok('所有建筑质心都在校园边界内（共 ' + BUILDINGS.length + ' 栋）',
  outBuildings.length === 0, outBuildings.slice(0, 5).join(','));

// 路线采样点必须全在校园内 —— 这正是"终点跑到校外"那次的回归测试
var rOut = [];
for (var fi = 0; fi < ROUTES.frames.length; fi++) {
  var fr = ROUTES.frames[fi];
  for (var pi = 0; pi < fr.routes.length; pi++) {
    ['fastest', 'cool'].forEach(function (key) {
      var rt = fr.routes[pi][key];
      if (!rt || !rt.pts) { return; }
      for (var q = 0; q < rt.pts.length; q++) {
        if (!inRing(rt.pts[q][0], rt.pts[q][1], ring)) {
          rOut.push(fr.t + '#' + pi + key + '@' + q);
        }
      }
    });
  }
}
ok('所有路线的采样点都在校园边界内',
  rOut.length === 0, rOut.slice(0, 5).join(',') + '（共 ' + rOut.length + ' 个越界点）');

// 每个阴影环至少有一个点在校园内（阴影可以被推出边界，但不该整体在界外）
var shadowOut = [];
for (var sf = 0; sf < SHADOWS.length; sf++) {
  for (var sr = 0; sr < SHADOWS[sf].length; sr++) {
    var rp = SHADOWS[sf][sr];
    var any = false;
    for (var rq = 0; rq < rp.length; rq++) {
      if (inRing(rp[rq][0], rp[rq][1], ring)) { any = true; break; }
    }
    if (!any) { shadowOut.push(sf + '#' + sr); }
  }
}
ok('每帧阴影环都与校园范围有交集',
  shadowOut.length === 0, shadowOut.slice(0, 5).join(','));

// 14:00 演示帧的两条路线确实分叉（不是同一条线画两遍）
var idxD = -1;
for (var d = 0; d < META.frames.length; d++) { if (META.frames[d].t === '14:00') { idxD = d; } }
if (idxD >= 0) {
  var pr = ROUTES.frames[idxD].routes[0];
  var fa = pr.fastest.pts, ca = pr.cool.pts;
  var maxDev = 0;
  for (var m = 0; m < ca.length; m++) {
    var best = Infinity;
    for (var n = 0; n < fa.length; n++) {
      var dd = Math.hypot(ca[m][0] - fa[n][0], ca[m][1] - fa[n][1]);
      if (dd < best) { best = dd; }
    }
    if (best > maxDev) { maxDev = best; }
  }
  ok('14:00 两条路线确实分叉（最大偏离 ' + maxDev.toFixed(0) + ' 米 > 20 米）',
    maxDev > 20, 'maxDev=' + maxDev.toFixed(1));
}

/* --- 2.85 全 31 帧 × 2 对起终点：JS 现场算路必须复现 Python 预计算 --- */
if (W.ROUTER && W.ROUTER.ready()) {
  var maxDLen = 0, maxDSun = 0, cmpFrames = 0, cmpBad = 0;
  for (var fp = 0; fp < ROUTES.pairs.length; fp++) {
    var fxy = W.PROJ.toXY(ROUTES.pairs[fp].from[0], ROUTES.pairs[fp].from[1]);
    var txy = W.PROJ.toXY(ROUTES.pairs[fp].to[0], ROUTES.pairs[fp].to[1]);
    for (var ffi = 0; ffi < META.frames.length; ffi++) {
      var pre = ROUTES.frames[ffi] && ROUTES.frames[ffi].routes[fp];
      if (!pre || !pre.fastest) { continue; }
      var got = W.ROUTER.solve(fxy, txy, ffi);
      if (!got.ok) { cmpBad++; continue; }
      cmpFrames++;
      maxDLen = Math.max(maxDLen, Math.abs(got.fastest.length_m - pre.fastest.length_m),
                                  Math.abs(got.cool.length_m - pre.cool.length_m));
      maxDSun = Math.max(maxDSun, Math.abs(got.fastest.sun_minutes - pre.fastest.sun_minutes),
                                  Math.abs(got.cool.sun_minutes - pre.cool.sun_minutes));
    }
  }
  ok('现场算路在全部 ' + cmpFrames + ' 个 帧×起终点 上与 Python 预计算完全一致',
    cmpBad === 0 && maxDLen === 0 && maxDSun <= 0.05,
    '最大差 ' + maxDLen.toFixed(1) + ' 米 / ' + maxDSun.toFixed(2) + ' 分钟，失败 ' + cmpBad + ' 次');

  // 页面卡片上肉眼看到的百分比，必须和文档/PPT 上的「6% → 35%」一字不差
  var sh14 = W.ROUTER.solve(
    W.PROJ.toXY(ROUTES.pairs[0].from[0], ROUTES.pairs[0].from[1]),
    W.PROJ.toXY(ROUTES.pairs[0].to[0], ROUTES.pairs[0].to[1]), idxD);
  if (sh14.ok) {
    var g1 = CORE.shadeMeters(sh14.fastest), g2 = CORE.shadeMeters(sh14.cool);
    ok('14:00 卡片显示「阴影 6% → 35%」（与文档一致）',
      CORE.fmtNum(g1.shadePct, 0) + '%' === '6%' && CORE.fmtNum(g2.shadePct, 0) + '%' === '35%',
      CORE.fmtNum(g1.shadePct, 0) + '% → ' + CORE.fmtNum(g2.shadePct, 0) + '%');
  }
}

/* --- 2.87 地图点选起终点（演示时最出彩的一步，必须锁住） --- */
if (W.ROUTER && W.ROUTER.ready() && anchors.length > 24) {
  // stub 画布是 1200x800、pad 28，和 MAP.init 里那次 fit 一致
  var vw = CORE.fitTransform(META.bbox_m, 1200, 800, 28);
  var clickAt = function (x, y) {
    mainCanvas.dispatch('click', { clientX: vw.x(x), clientY: vw.y(y) });
  };
  var pa = anchors[3], pb = anchors[anchors.length - 3];
  clickAt(pa.x, pa.y);
  var hint1 = String(registry['pick-hint'].textContent);
  clickAt(pb.x, pb.y);
  var hint2 = String(registry['pick-hint'].textContent);
  ok('地图点第一下就设成起点', hint1.indexOf('起点') >= 0, hint1);
  ok('地图点第二下设成终点并更新提示', hint2.indexOf('终点') >= 0, hint2);
  var liveMin = String(registry['fast-min'].textContent);
  ok('地图点选后卡片仍算出了真实数字（不是 --）',
    liveMin !== '--' && liveMin !== '' && !isNaN(parseFloat(liveMin)), liveMin);
  ok('地图点选后标记为「现场计算」', String(registry['route-tag'].textContent) === '现场计算',
    registry['route-tag'].textContent);
}

/* --- 2.88 示例 A / B 切换（预计算）→ 再点地图（现场计算） ---
   页面现在有两条输入路径：按钮/默认 = 查预计算表（#route-tag 显示「预计算」），
   下拉/地图点选 = 浏览器现场算（显示「现场计算」）。这里把两条路径和
   「地图点选后下拉不许变空白」（markSelect 的 selectedIndex 修复）一起锁住。 */
if (!jsLoadErr && !initErr && W.ROUTER && W.ROUTER.ready() && anchors.length > 24) {
  var pairAButton = registry['pair-a'];
  var pairBButton = registry['pair-b'];
  var routeTagEl = registry['route-tag'];
  var startSel = registry['start-select'];
  var endSel = registry['end-select'];
  var sliderEl = registry['time-slider'];
  var pickHintEl = registry['pick-hint'];
  var frameNow = parseInt(sliderEl.value, 10) || 0;
  var routesNow = ROUTES.frames[frameNow].routes;

  var readCards = function () {
    return {
      fastMin: registry['fast-min'].textContent,
      fastSun: registry['fast-sun'].textContent,
      fastLen: registry['fast-len'].textContent,
      fastShade: registry['fast-shade'].textContent,
      coolMin: registry['cool-min'].textContent,
      coolSun: registry['cool-sun'].textContent,
      coolLen: registry['cool-len'].textContent,
      coolShade: registry['cool-shade'].textContent
    };
  };
  // 卡片数字的期望值直接由预计算数据 + 页面同一套格式化函数算出来
  var cardsFor = function (rt) {
    var sf = CORE.shadeMeters(rt.fastest);
    var sc = CORE.shadeMeters(rt.cool);
    return {
      fastMin: CORE.fmtNum(rt.fastest.minutes, 0),
      fastSun: CORE.fmtNum(rt.fastest.sun_minutes, 0),
      fastLen: CORE.fmtNum(rt.fastest.length_m, 0),
      fastShade: CORE.fmtNum(sf.shadePct, 0) + '%',
      coolMin: CORE.fmtNum(rt.cool.minutes, 0),
      coolSun: CORE.fmtNum(rt.cool.sun_minutes, 0),
      coolLen: CORE.fmtNum(rt.cool.length_m, 0),
      coolShade: CORE.fmtNum(sc.shadePct, 0) + '%'
    };
  };
  var sameCards = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
  var showCards = function (c) { return JSON.stringify(c); };

  ok('示例按钮已接好（#pair-a / #pair-b 都在 stub DOM 里且可点）',
    !!(pairAButton && pairBButton));

  // ---- 点「示例 B」：查预计算表 ----
  pairBButton.dispatch('click');
  var cardsB = readCards();
  var expectB = cardsFor(routesNow[1]);
  ok('点「示例 B」→ route-tag = 预计算',
    String(routeTagEl.textContent) === '预计算', routeTagEl.textContent);
  ok('点「示例 B」→ fast/cool 卡片数字 = ROUTES.frames[' + frameNow + '].routes[1]（预计算，逐字段）',
    sameCards(cardsB, expectB),
    '实际 ' + showCards(cardsB) + ' / 期望 ' + showCards(expectB));
  ok('点「示例 B」→ aria-pressed：B=true、A=false，且 B 带 is-on 样式',
    pairBButton.getAttribute('aria-pressed') === 'true' &&
    pairAButton.getAttribute('aria-pressed') === 'false' &&
    String(pairBButton.className).indexOf('is-on') >= 0 &&
    String(pairAButton.className).indexOf('is-on') < 0,
    'A=' + pairAButton.getAttribute('aria-pressed') + ' B=' + pairBButton.getAttribute('aria-pressed'));
  ok('点「示例 B」→ 起终点下拉都选中有效项（selectedIndex >= 0）',
    typeof startSel.selectedIndex === 'number' && startSel.selectedIndex >= 0 &&
    typeof endSel.selectedIndex === 'number' && endSel.selectedIndex >= 0 &&
    startSel.selectedIndex < startSel.children.length &&
    endSel.selectedIndex < endSel.children.length,
    'start=' + startSel.selectedIndex + '/' + startSel.children.length +
    ' end=' + endSel.selectedIndex + '/' + endSel.children.length);
  ok('点「示例 B」→ 提示条显示示例 B 的起终点',
    String(pickHintEl.textContent).indexOf('起点：') >= 0 &&
    String(pickHintEl.textContent).indexOf('终点：') >= 0, pickHintEl.textContent);

  // ---- 点「示例 A」：切回示例 0 ----
  pairAButton.dispatch('click');
  var cardsA = readCards();
  var expectA = cardsFor(routesNow[0]);
  ok('点「示例 A」→ 切回预计算，数字 = ROUTES.frames[' + frameNow + '].routes[0]',
    String(routeTagEl.textContent) === '预计算' && sameCards(cardsA, expectA),
    routeTagEl.textContent + ' | ' + showCards(cardsA) + ' / 期望 ' + showCards(expectA));
  ok('示例 A / 示例 B 的卡片数字确实不同（示例切换不是空操作）',
    !sameCards(cardsA, cardsB), showCards(cardsA) + ' vs ' + showCards(cardsB));
  ok('点「示例 A」→ aria-pressed：A=true、B=false',
    pairAButton.getAttribute('aria-pressed') === 'true' &&
    pairBButton.getAttribute('aria-pressed') === 'false',
    'A=' + pairAButton.getAttribute('aria-pressed') + ' B=' + pairBButton.getAttribute('aria-pressed'));

  // ---- 切回 B，再在地图上点两下 → 现场计算 ----
  pairBButton.dispatch('click');
  ok('再次点「示例 B」→ 回到预计算（按钮状态可反复切换）',
    String(routeTagEl.textContent) === '预计算', routeTagEl.textContent);

  var stubView = CORE.fitTransform(META.bbox_m, 1200, 800, 28);
  var clickWorld = function (x, y) {
    mainCanvas.dispatch('click', { clientX: stubView.x(x), clientY: stubView.y(y) });
  };
  var anchorDist = function (x, y) {
    var best = Infinity;
    for (var ai = 0; ai < anchors.length; ai++) {
      best = Math.min(best, Math.hypot(anchors[ai].x - x, anchors[ai].y - y));
    }
    return best;
  };
  // 特意挑两个离地名锚点 > 55 米的路网节点：这样 app.js 的 nearestAnchorName
  // 会返回「地图选点」，从而走到 markSelect 的"临时项"分支——这正是当初
  // sel.value 写法导致下拉空白的那个分支。
  var graphNodes = (W.DATA_GRAPH && W.DATA_GRAPH.nodes) || [];
  var farPts = [];
  for (var gni = 0; gni < graphNodes.length && farPts.length < 2; gni++) {
    var nxy = Array.isArray(graphNodes[gni])
      ? [graphNodes[gni][0], graphNodes[gni][1]]
      : [graphNodes[gni].x, graphNodes[gni].y];
    if (!nxy || !isFinite(nxy[0]) || !isFinite(nxy[1])) { continue; }
    var snapped = W.ROUTER.snap(nxy[0], nxy[1]);
    if (!snapped) { continue; }
    if (anchorDist(snapped.x, snapped.y) <= 55) { continue; }   // 要触发「地图选点」
    if (farPts.length &&
      Math.hypot(farPts[0][0] - snapped.x, farPts[0][1] - snapped.y) < 80) { continue; }
    farPts.push([snapped.x, snapped.y]);
  }
  ok('找到两个离地名锚点 > 55 米的路网节点（用于触发「地图选点」分支）',
    farPts.length === 2,
    farPts.map(function (p) { return '(' + p[0].toFixed(0) + ',' + p[1].toFixed(0) + ')'; }).join(' '));

  if (farPts.length === 2) {
    clickWorld(farPts[0][0], farPts[0][1]);
    clickWorld(farPts[1][0], farPts[1][1]);
    ok('示例切换后在地图上点两下 → route-tag = 现场计算',
      String(routeTagEl.textContent) === '现场计算', routeTagEl.textContent);

    // markSelect 回归：地图点选（尤其"地图选点"临时项）后下拉不许空白
    var startOpt = startSel.children[startSel.selectedIndex];
    var endOpt = endSel.children[endSel.selectedIndex];
    ok('地图点选后 start-select selectedIndex >= 0（不是 -1/空白）',
      typeof startSel.selectedIndex === 'number' && startSel.selectedIndex >= 0 &&
      startSel.selectedIndex < startSel.children.length,
      'selectedIndex=' + startSel.selectedIndex + ' / ' + startSel.children.length +
      ' 当前项=' + (startOpt ? startOpt.textContent : 'undefined'));
    ok('地图点选后 end-select selectedIndex >= 0（不是 -1/空白）',
      typeof endSel.selectedIndex === 'number' && endSel.selectedIndex >= 0 &&
      endSel.selectedIndex < endSel.children.length,
      'selectedIndex=' + endSel.selectedIndex + ' / ' + endSel.children.length +
      ' 当前项=' + (endOpt ? endOpt.textContent : 'undefined'));
    ok('地图点选走的是「地图选点」临时项（markSelect 自定义分支被覆盖）',
      !!startOpt && !!endOpt &&
      startOpt.textContent === '地图选点' && endOpt.textContent === '地图选点' &&
      String(pickHintEl.textContent).indexOf('地图选点') >= 0,
      'start=' + (startOpt && startOpt.textContent) + ' end=' + (endOpt && endOpt.textContent) +
      ' hint=' + pickHintEl.textContent);
    ok('地图点选后卡片仍是现场算的真实数字（不是 --）',
      String(registry['fast-min'].textContent) !== '--' &&
      String(registry['cool-min'].textContent) !== '--' &&
      !isNaN(parseFloat(registry['fast-min'].textContent)),
      registry['fast-min'].textContent + ' / ' + registry['cool-min'].textContent);
  }

  // ---- 键盘焦点保护：SELECT 里按方向键不能"换选项 + 切时间"双动作 ----
  var frameBeforeKey = parseInt(sliderEl.value, 10) || 0;
  doc.dispatch('keydown', {
    key: 'ArrowRight', target: { tagName: 'SELECT' }, preventDefault: function () {}
  });
  ok('焦点在 SELECT 时方向键不切时间（不再"换选项 + 切时间"双动作）',
    (parseInt(sliderEl.value, 10) || 0) === frameBeforeKey,
    'before=' + frameBeforeKey + ' after=' + sliderEl.value);
  doc.dispatch('keydown', {
    key: 'ArrowRight', target: { tagName: 'BODY' }, preventDefault: function () {}
  });
  ok('焦点不在表单控件时方向键仍能切时间（焦点保护没有把功能一起关掉）',
    (parseInt(sliderEl.value, 10) || 0) === Math.min(META.frames.length - 1, frameBeforeKey + 1),
    'before=' + frameBeforeKey + ' after=' + sliderEl.value);
}

} catch (e) {
  // 任何未捕获异常都在这里收口：不让 Node 直接甩一段 TypeError 栈就退出
  fail += 1;
  var crashText = e && e.message ? e.message : String(e);
  failures.push('(crash) ' + crashText);
  console.log('--------------------------------------------------');
  console.log('FAIL (crash)  ' + crashText);
  if (e && e.stack) {
    console.log('异常栈：');
    console.log(e.stack);
  }
  console.log('崩溃前已完成断言：PASS ' + pass + ' / FAIL ' + (fail - 1));
  console.log('提示：先确认数据完整（python tools/build.py all），再跑 node tools/smoke.js。');
}

/* ---------- 2.11 规划模式集成冒烟（stub DOM 真点一遍） ---------- */
/* ---------- 2.10 规划模式集成冒烟：页签 / 点种 / 撤销 / 优化 / 一键全种 / 视图互斥 ----------
   沙箱没有浏览器，所以这里用同一个 stub DOM 真点一遍：
   tab-plan → 地图点一下种树 → 撤销 → 优化（setTimeout 打平）→ 一键全种 → 切立体会被拦。 */
(function () {
  var plTabsOk = !!(registry['tab-plan'] && registry['pane-plan'] && registry['plan-optimize']);
  ok('规划面板元素都在 stub DOM 里（页签 / 面板 / 4 个按钮）',
    plTabsOk && !!(registry['plan-plant-all'] && registry['plan-undo'] && registry['plan-clear'] &&
      registry['plan-rank'] && registry['plan-msg']));
  if (!plTabsOk) { return; }

  var planMap = W.MAP;
  var canvasEl = registry['map'];
  var baseArcs0 = (canvasEl._ctx && canvasEl._ctx.calls.arc) || 0;

  // 1) 切到「种树规划」页签：面板显示、路线面板隐藏
  registry['tab-plan'].dispatch('click', { type: 'click' });
  ok('点「种树规划」页签：规划面板显示、路线面板隐藏、页签高亮',
    registry['pane-plan'].hidden === false && registry['pane-route'].hidden === true &&
    String(registry['tab-plan'].className).indexOf('is-on') >= 0 &&
    String(registry['tab-route'].className).indexOf('is-on') < 0);

  // 2) 在地图上点一个合法候选点 → 种下一棵
  var scr = planMap.toScreen(pC0.x, pC0.y);
  canvasEl.dispatch('click', { type: 'click', clientX: scr[0], clientY: scr[1] });
  ok('规划模式下点地图空地 → 种下 1 棵（面板计数与花费同步）',
    registry['plan-count'].textContent === '1 棵' &&
    registry['plan-cost'].textContent === '3,000' &&
    Number(registry['plan-area'].textContent) > 0,
    'count=' + registry['plan-count'].textContent + ' area=' + registry['plan-area'].textContent + ' m²');

  // 3) 撤销 → 回到 0 棵
  registry['plan-undo'].dispatch('click', { type: 'click' });
  ok('点「撤销」→ 回到 0 棵（快照栈真的存了上一状态）',
    registry['plan-count'].textContent === '0 棵' && Number(registry['plan-area'].textContent) === 0);

  // 4) 优化：stub 的 setTimeout 打平，同步跑完
  registry['plan-optimize'].dispatch('click', { type: 'click' });
  var rankLis = registry['plan-rank'].children || [];
  ok('点「优化」→ 出 20 个点位、排名表 20 行、一键全种按钮解锁',
    rankLis.length === 20 && registry['plan-plant-all'].disabled === false &&
    String(registry['plan-msg'].textContent).indexOf('每万元') >= 0,
    'rows=' + rankLis.length + ' msg=' + String(registry['plan-msg'].textContent).slice(0, 40));

  // 5) 一键全种 → 20 棵、6 万元，画布上真的多画了 20 个蓝圈
  var arcsBeforePlant = (canvasEl._ctx.calls.arc || 0);
  registry['plan-plant-all'].dispatch('click', { type: 'click' });
  var arcsAfterPlant = (canvasEl._ctx.calls.arc || 0);
  ok('点「一键全种下」→ 20 棵 / 6 万元，且画布上真画了 20 个规划树圆圈',
    registry['plan-count'].textContent === '20 棵' &&
    registry['plan-cost'].textContent === '60,000' &&
    (arcsAfterPlant - arcsBeforePlant) >= 20,
    'count=' + registry['plan-count'].textContent + ' 新增 arc=' + (arcsAfterPlant - arcsBeforePlant));

  ok('种下 20 棵后面板三个数字都成了真实值（面积 / 占比 / 分钟）',
    Number(registry['plan-area'].textContent) > 0 &&
    parseFloat(registry['plan-ratio'].textContent) >= 19.9 &&
    parseFloat(registry['plan-minutes'].textContent) > 0,
    'area=' + registry['plan-area'].textContent + ' ratio=' + registry['plan-ratio'].textContent +
    '% minutes=' + registry['plan-minutes'].textContent);

  // 6) 规划模式下切立体：必须被拦住（树影/拖拽都对不上）
  registry['view-iso'].dispatch('click', { type: 'click' });
  ok('规划模式下点「立体」被拦住：仍是平面视图，并给出提示（不静默失效）',
    planMap.isIso() === false && String(registry['plan-msg'].textContent).indexOf('平面') >= 0,
    'iso=' + planMap.isIso() + ' msg=' + String(registry['plan-msg'].textContent).slice(0, 30));

  // 7) 切回「路线对比」：规划面板收起，地图不再画规划层
  // 地图重画本来就会画 520 棵装饰树（每棵 2 个圆）+ 2 个起终点 + 每扇门 2 个圆；
  // "没画规划层"的判据是：这次重画的 arc 数正好等于纯路线视图该有的数，没有多出 20 个规划树圆。
  var gateArcsDom = CORE.gatesFromRoads(W.DATA_BASEMAP.roads, W.DATA_META.campus.ring).length * 2;
  var expectPlainArcs = treesA.length * 2 + 2 + gateArcsDom;
  var arcsBeforeRoute = (canvasEl._ctx.calls.arc || 0);
  registry['tab-route'].dispatch('click', { type: 'click' });
  var arcsAfterRoute = (canvasEl._ctx.calls.arc || 0);
  ok('切回「路线对比」→ 规划面板收起、不再画规划树（只画纯路线视图该有的圆）',
    registry['pane-route'].hidden === false && registry['pane-plan'].hidden === true &&
    (arcsAfterRoute - arcsBeforeRoute) === expectPlainArcs,
    '新增 arc=' + (arcsAfterRoute - arcsBeforeRoute) + '，期望 ' + expectPlainArcs);

  // 8) 清空：回到 0 棵
  registry['tab-plan'].dispatch('click', { type: 'click' });
  registry['plan-clear'].dispatch('click', { type: 'click' });
  ok('点「清空」→ 0 棵、0 元、排名表收起',
    registry['plan-count'].textContent === '0 棵' &&
    registry['plan-cost'].textContent === '0' &&
    registry['plan-rank-block'].hidden === true);
})();

/* ---------- 3. 汇总 ---------- */
console.log('--------------------------------------------------');
console.log('SMOKE: PASS ' + pass + ' / FAIL ' + fail);
if (fail > 0) {
  console.log('失败项：');
  failures.forEach(function (x) { console.log('  - ' + x); });
  process.exitCode = 1;
} else {
  console.log('全部通过。');
}