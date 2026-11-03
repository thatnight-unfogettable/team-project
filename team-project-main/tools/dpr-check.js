/* ============================================================
   凉径 ShadeRoute Lite —— dpr=2 标注定位检查（被 tools/smoke.js 调用）

   背景：js/map.js 的 drawLabels() 曾经漏掉
     ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0)
   于是在 devicePixelRatio = 2 的屏幕上，地名标注按 CSS 像素画到设备
   画布上 → 字号减半、整体缩到左上角。smoke.js 过去把
   devicePixelRatio 固定成 1，这个缺陷完全漏检。

   本文件用一个独立的 vm 沙箱（独立 document / canvas / MAP 状态）
   在 dpr = 2 下真渲染一帧，并用"会记录变换"的伪 2D context 抓
   drawLabels 的 fillText 调用，断言：
     1) 设备画布尺寸 = CSS 尺寸 × 2；
     2) 地名标注确实画出来了；
     3) fillText 的实参仍是 CSS 像素坐标（不是已经乘过 2 的设备坐标）；
     4) fillText 执行时 ctx 的变换是 (2,0,0,2,0,0) ——
        因此设备坐标 = CSS 坐标 × 2，setTransform 生效；
     5) 其余绘制层也统一套了 dpr 变换（防止只修了标注这一层）。

   第 4 条是反证用的红线：把 js/map.js 里那行 setTransform 删掉，
   断言立即变红（见 _work/smoke-dpr-test/ 的反证记录）。

   单独运行：node tools/dpr-check.js   （PASS 退出 0 / FAIL 退出 1）
   ============================================================ */

'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

/* 只加载 map.js 渲染一帧真正需要的文件（数据 + core/proj/map） */
var DPR_FILES = [
  'data/meta.js',
  'data/buildings.js',
  'data/shadows.js',
  'data/routes.js',
  'data/basemap.js',
  'js/core.js',
  'js/proj.js',
  'js/map.js'
];

/* ---------- 伪 Canvas 2D context：记录变换与文字绘制 ---------- */
function makeCtx() {
  var ctx = {
    calls: {},
    transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    stack: [],
    transforms: [],   // 每次 setTransform 的实参（按调用顺序）
    fillTexts: [],    // { text, x, y, font, transform } —— transform 是调用时的快照
    font: '10px sans-serif'
  };

  function bump(name) { ctx.calls[name] = (ctx.calls[name] || 0) + 1; }

  ['clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'closePath',
    'fill', 'stroke', 'drawImage', 'arc', 'setLineDash', 'strokeText',
    'translate', 'rotate', 'scale'].forEach(function (name) {
    ctx[name] = function () { bump(name); };
  });

  ctx.measureText = function (s) {
    bump('measureText');
    return { width: String(s === undefined || s === null ? '' : s).length * 6 };
  };

  ctx.save = function () {
    bump('save');
    ctx.stack.push({
      a: ctx.transform.a, b: ctx.transform.b, c: ctx.transform.c,
      d: ctx.transform.d, e: ctx.transform.e, f: ctx.transform.f
    });
  };

  ctx.restore = function () {
    bump('restore');
    var t = ctx.stack.pop();
    if (t) { ctx.transform = t; }
  };

  ctx.setTransform = function (a, b, c, d, e, f) {
    bump('setTransform');
    ctx.transform = { a: a, b: b, c: c, d: d, e: e, f: f };
    ctx.transforms.push([a, b, c, d, e, f]);
  };

  ctx.fillText = function (text, x, y) {
    bump('fillText');
    var t = ctx.transform;
    ctx.fillTexts.push({
      text: String(text),
      x: x,
      y: y,
      font: ctx.font,
      transform: { a: t.a, b: t.b, c: t.c, d: t.d, e: t.e, f: t.f }
    });
  };

  return ctx;
}

/* ---------- 极简 DOM stub（只够 MAP 用） ---------- */
function makeElement(tag) {
  var node = {
    tagName: String(tag || 'div').toUpperCase(),
    id: '',
    style: {},
    children: [],
    attributes: {},
    className: '',
    textContent: '',
    nodeValue: '',
    value: '',
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
      return child;
    },
    setAttribute: function (k, v) { this.attributes[k] = v; },
    getAttribute: function (k) { return this.attributes[k]; },
    getBoundingClientRect: function () {
      if (this.parentElement && this.parentElement.getBoundingClientRect) {
        return this.parentElement.getBoundingClientRect();
      }
      return { width: 1200, height: 800, left: 0, top: 0 };
    }
  };
  return node;
}

function makeCanvas() {
  var cv = makeElement('canvas');
  cv.getContext = function () { return cv._ctx || (cv._ctx = makeCtx()); };
  return cv;
}

/* ---------- 主检查 ---------- */
function run(options) {
  var opts = options || {};
  var root = opts.root || path.resolve(__dirname, '..');
  var dpr = opts.dpr || 2;
  var checks = [];

  function check(name, cond, detail) {
    checks.push({
      name: name,
      ok: !!cond,
      detail: detail === undefined || detail === null ? '' : String(detail)
    });
  }

  try {
    var sandbox = { console: console };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.document = {
      body: makeElement('body'),
      createElement: function (tag) {
        return String(tag).toLowerCase() === 'canvas' ? makeCanvas() : makeElement(tag);
      },
      getElementById: function () { return null; }
    };
    sandbox.addEventListener = function () {};   // MAP.init 里 addEventListener('resize')
    sandbox.devicePixelRatio = dpr;
    vm.createContext(sandbox);

    for (var i = 0; i < DPR_FILES.length; i++) {
      var rel = DPR_FILES[i];
      var src;
      try {
        src = fs.readFileSync(path.join(root, rel), 'utf8');
      } catch (e) {
        throw new Error('读不到 ' + rel + '：' + e.message);
      }
      vm.runInContext(src, sandbox, { filename: rel });
    }

    if (!sandbox.MAP || typeof sandbox.MAP.init !== 'function') {
      throw new Error('js/map.js 没有挂载 window.MAP');
    }

    // 独立 box：1200×800 CSS 画布 + devicePixelRatio = 2
    var wrapper = makeElement('div');
    wrapper.getBoundingClientRect = function () {
      return { width: 1200, height: 800, left: 0, top: 0 };
    };
    var canvas = makeCanvas();
    canvas.id = 'map';
    canvas.parentElement = wrapper;
    sandbox.MAP.init(canvas);
    var ctx = canvas.getContext('2d');

    var META = sandbox.DATA_META || {};
    var SHADOWS = sandbox.DATA_SHADOWS || [];
    var ROUTES = sandbox.DATA_ROUTES || { frames: [] };
    var BUILDINGS = sandbox.DATA_BUILDINGS || [];
    var BASEMAP = sandbox.DATA_BASEMAP || null;

    var frameIdx = 0;
    (META.frames || []).forEach(function (f, k) {
      if (f && f.t === '14:00') { frameIdx = k; }
    });

    var routeFrame = (ROUTES.frames && ROUTES.frames[frameIdx]) || null;
    if (!routeFrame || !routeFrame.routes || !routeFrame.routes[0]) {
      throw new Error('data/routes.js 缺少第 ' + frameIdx + ' 帧的预计算路线');
    }
    var pair = routeFrame.routes[0];
    var fastPts = pair.fastest && pair.fastest.pts ? pair.fastest.pts : null;
    var coolPts = pair.cool && pair.cool.pts ? pair.cool.pts : null;

    // 真跑一次渲染（和页面首屏同一条代码路径）
    sandbox.MAP.render({
      shadows: SHADOWS[frameIdx] || [],
      buildings: BUILDINGS,
      fastPts: fastPts,
      coolPts: coolPts,
      fromXY: fastPts ? fastPts[0] : null,
      toXY: fastPts ? fastPts[fastPts.length - 1] : null,
      campusRing: (META.campus && META.campus.ring) || null,
      basemap: BASEMAP
    });

    var view = sandbox.PROJ.fit(1200, 800, 28);
    var labels = (BASEMAP && BASEMAP.labels) || [];

    /* --- 1) 画布按设备像素分配 --- */
    var wantW = Math.floor(1200 * dpr);
    var wantH = Math.floor(800 * dpr);
    check('dpr=' + dpr + ' 画布按设备像素分配（' + canvas.width + '×' + canvas.height + ' = CSS 1200×800 × ' + dpr + '）',
      canvas.width === wantW && canvas.height === wantH &&
        canvas.style.width === '1200px' && canvas.style.height === '800px',
      'width=' + canvas.width + ' height=' + canvas.height +
        ' style=' + canvas.style.width + '×' + canvas.style.height);

    /* --- 2) 标注确实画出来了 --- */
    var known = {};
    labels.forEach(function (L) { known[L.n] = true; });
    var labelCalls = ctx.fillTexts.filter(function (call) { return known[call.text]; });
    check('dpr=' + dpr + ' 一帧里画出了地名标注（' + labelCalls.length + ' 条 / 标注表 ' + labels.length + ' 个）',
      labelCalls.length >= 10,
      'fillText 总调用 ' + ctx.fillTexts.length);

    /* --- 3) fillText 实参是 CSS 坐标 --- */
    var coordBad = [];
    labelCalls.forEach(function (call) {
      var hit = labels.some(function (L) {
        return L.n === call.text &&
          Math.abs(view.x(L.x) - call.x) < 0.01 &&
          Math.abs(view.y(L.y) - call.y) < 0.01;
      });
      if (!hit) {
        coordBad.push(call.text + '@(' + Number(call.x).toFixed(1) + ',' + Number(call.y).toFixed(1) + ')');
      }
    });
    check('dpr=' + dpr + ' 标注 fillText 坐标 = CSS 像素坐标（没有被预先乘 ' + dpr + '）',
      labelCalls.length > 0 && coordBad.length === 0,
      coordBad.slice(0, 5).join('; ') || ('全部 ' + labelCalls.length + ' 条对齐'));

    /* --- 4) 标注层变换 = (dpr,0,0,dpr,0,0) —— 反证红线 --- */
    var badTransform = [];
    labelCalls.forEach(function (call) {
      var t = call.transform;
      if (t.a !== dpr || t.d !== dpr || t.b !== 0 || t.c !== 0 || t.e !== 0 || t.f !== 0) {
        badTransform.push(call.text + ' transform=(' +
          [t.a, t.b, t.c, t.d, t.e, t.f].join(',') + ')');
      }
    });
    check('dpr=' + dpr + ' 标注层 transform = (' + dpr + ',0,0,' + dpr + ',0,0)（设备坐标 = CSS 坐标 × ' + dpr + '）',
      labelCalls.length > 0 && badTransform.length === 0,
      badTransform.length
        ? ('期望 a=d=' + dpr + '，实际：' + badTransform.slice(0, 3).join('; '))
        : ('全部 ' + labelCalls.length + ' 条标注变换正确'));

    /* --- 5) 其它绘制层也统一套 dpr 变换（防止只修了标注） --- */
    var dprTransforms = ctx.transforms.filter(function (t) {
      return t[0] === dpr && t[1] === 0 && t[2] === 0 && t[3] === dpr;
    });
    check('dpr=' + dpr + ' 其它绘制层也统一套了 dpr 变换（setTransform（' + dpr + ',0,0,' + dpr + ',0,0) ≥ 9 次）',
      dprTransforms.length >= 9,
      '匹配 ' + dprTransforms.length + ' 次；setTransform 总调用 ' + ctx.transforms.length + ' 次');

    /* --- 6) 标注字号仍是 CSS 字号（不是被 dpr 缩过的） --- */
    var fontSizes = labelCalls.map(function (call) {
      var m = /(\d+(?:\.\d+)?)px/.exec(call.font || '');
      return m ? parseFloat(m[1]) : NaN;
    }).filter(function (v) { return isFinite(v); });
    var minFont = fontSizes.length ? Math.min.apply(Math, fontSizes) : NaN;
    check('dpr=' + dpr + ' 标注字号仍是 CSS 字号（最小 ' + minFont + 'px ≥ 10px，未减半）',
      fontSizes.length > 0 && minFont >= 10,
      '取样 ' + fontSizes.length + ' 条，最小 ' + minFont + 'px');
  } catch (e) {
    check('dpr=' + dpr + ' 标注定位检查可运行（不抛异常）', false,
      e && e.message ? e.message : String(e));
  }

  return { root: root, dpr: dpr, checks: checks };
}

module.exports = { run: run, DPR_FILES: DPR_FILES };

/* ---------- 单独运行 ---------- */
if (require.main === module) {
  var argRoot = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
  var result = run({ root: argRoot, dpr: 2 });
  result.checks.forEach(function (c) {
    console.log((c.ok ? 'PASS  ' : 'FAIL  ') + c.name + (c.detail ? '  [' + c.detail + ']' : ''));
  });
  var bad = result.checks.filter(function (c) { return !c.ok; }).length;
  console.log('--------------------------------------------------');
  console.log('DPR-CHECK: PASS ' + (result.checks.length - bad) + ' / FAIL ' + bad);
  process.exitCode = bad > 0 ? 1 : 0;
}