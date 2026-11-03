/* ============================================================
   凉径 ShadeRoute Lite —— 可测试纯逻辑核心
   责任：frontend（js/core.js）

   为什么单独一层：沙箱里开不了浏览器截图，只能靠 Node 做单元级验证
   （见 tools/smoke.js）。所以把"输入 -> 输出"的纯函数集中到这里：
   不碰 DOM、不发请求、不读系统时钟。

   约束：不用 import/export（file:// 双击要能跑），统一挂 window.CORE。
   ============================================================ */

window.CORE = (function () {
  'use strict';

  var DEFAULT_PAD = 24;
  var LOW_SUN_ELEV = 15;   // 太阳高度角 < 15° 判为低置信度（README 技术要点第 4 条）
  var NICE_METERS = [10, 20, 25, 50, 100, 200, 250, 500];
  var WALK_SPEED = 1.25;   // m/s，必须与 tools/build.py 的 WALK_SPEED 一致：
                           // 阴影米数 = 路线长度 - 暴晒分钟 × 60 × WALK_SPEED

  /* ---------------- 小工具 ---------------- */

  function isNum(n) {
    return typeof n === 'number' && isFinite(n);
  }

  function num(n, fallback) {
    var v = typeof n === 'string' ? parseFloat(n) : n;
    return isNum(v) ? v : fallback;
  }

  function fmtNum(n, digits) {
    if (!isNum(n)) { return '--'; }
    return n.toFixed(digits === undefined ? 1 : digits);
  }

  /* 方位角归一到 [0, 360)：数据里偶尔会多给或少给 360 */
  function normAz(az) {
    var v = num(az, 0);
    return ((v % 360) + 360) % 360;
  }

  /* 方位角 -> 四个主轴方向（0°=北，90°=东，180°=南，270°=西） */
  function azimuthDir(az) {
    var a = normAz(az);
    if (a >= 315 || a < 45) { return '北'; }
    if (a < 135) { return '东'; }
    if (a < 225) { return '南'; }
    return '西';
  }

  /* ---------------- 1. 投影：米坐标 -> 画布像素 ---------------- */
  /*
     bbox = [minX, minY, maxX, maxY]（米，x=东，y=北）
     等比缩放 + 居中 + 四边留 pad；返回的 x()/y() 里 y 轴翻转（北在上）。
   */
  function fitTransform(bbox, cssWidth, cssHeight, pad) {
    var box = (bbox && bbox.length === 4) ? bbox : [-600, -500, 600, 500];
    var minX = box[0], minY = box[1], maxX = box[2], maxY = box[3];
    var bw = maxX - minX;
    var bh = maxY - minY;
    var w = num(cssWidth, 0);
    var h = num(cssHeight, 0);
    var p = num(pad, DEFAULT_PAD);
    var availW = Math.max(1, w - p * 2);
    var availH = Math.max(1, h - p * 2);
    var scale = Math.min(availW / bw, availH / bh);
    var cx = (minX + maxX) / 2;
    var cy = (minY + maxY) / 2;

    return {
      scale: scale,
      pad: p,
      width: w,
      height: h,
      bbox: [minX, minY, maxX, maxY],
      cx: cx,
      cy: cy,
      /* 米坐标 -> 屏幕坐标 */
      x: function (mx) { return w / 2 + (mx - cx) * scale; },
      y: function (my) { return h / 2 - (my - cy) * scale; },
      /* 屏幕坐标 -> 米坐标（地图点选取起点/终点要用） */
      unx: function (sx) { return cx + (sx - w / 2) / scale; },
      uny: function (sy) { return cy - (sy - h / 2) / scale; }
    };
  }

  /* ---------------- 2. 路线对比摘要 ---------------- */
  /*
     输入两套路线（minutes / sun_minutes / length_m），输出统一的结论：
       level = "good"  阴凉路线值得走（换来明显少晒）
       level = "flat"  两条路线差别不大 / 阴凉路线只是多走路
       level = "none"  该帧没有可用路线数据
   */

  /* 一条路线里有多少米走在阴影里。
     数据里只存了 length_m 和 sun_minutes，所以用步行速度反推：
       暴晒米数 = 暴晒分钟 × 60 × 步行速度(m/s)
       阴影米数 = 总长 - 暴晒米数（夹到 [0, 总长]，防止数据轻微不一致时出负数）*/
  function shadeMeters(route) {
    if (!route) { return null; }
    var len = num(route.length_m, null);
    var sunMin = num(route.sun_minutes, null);
    if (len === null || sunMin === null || len <= 0) { return null; }
    var exposed = sunMin * 60 * WALK_SPEED;
    var shade = Math.max(0, Math.min(len, len - exposed));
    return {
      lengthM: len,
      exposedM: len - shade,
      shadeM: shade,
      shadePct: 100 * shade / len
    };
  }

  function routeSummary(fastest, cool) {
    if (!fastest || !cool) {
      return {
        extraMinutes: null,
        savedSunMinutes: null,
        extraMeters: null,
        shadeFastPct: null,
        shadeCoolPct: null,
        level: 'none',
        text: '该时段没有可用路线数据（太阳已落或路网不足）。'
      };
    }

    var extra = num(cool.minutes, 0) - num(fastest.minutes, 0);
    var saved = num(fastest.sun_minutes, 0) - num(cool.sun_minutes, 0);
    var extraM = num(cool.length_m, 0) - num(fastest.length_m, 0);
    var sf = shadeMeters(fastest);
    var sc = shadeMeters(cool);
    var head;
    var level;

    // 用「米」而不是「分钟」说多走多少：0.6 分钟的差别取整后会变成 1 分钟，
    // 和页面上的精确数字打架；44 米既准确又直观（也是首页 slogan 的口径）。
    if (saved > 0.5) {
      level = 'good';
      if (extra < -0.5) {
        head = '阴凉路线反而更快，还少晒 ' + fmtNum(saved, 1) + ' 分钟。';
      } else if (extraM >= 5) {
        head = '多走 ' + fmtNum(extraM, 0) + ' 米，少晒 ' + fmtNum(saved, 1) + ' 分钟。';
      } else {
        head = '几乎不多走（' + fmtNum(Math.max(0, extraM), 0) + ' 米），少晒 ' +
          fmtNum(saved, 1) + ' 分钟。';
      }
    } else if (extra > 0.5) {
      level = 'flat';
      head = '此时段阴凉路线优势不明显（多走 ' + fmtNum(extra, 0) + ' 分钟，少晒 ' +
        fmtNum(Math.max(0, saved), 1) + ' 分钟）。';
    } else {
      level = 'flat';
      head = '两条路线差别很小，走哪条都行。';
    }

    return {
      extraMinutes: extra,
      savedSunMinutes: saved,
      extraMeters: extraM,
      shadeFastPct: sf ? sf.shadePct : null,
      shadeCoolPct: sc ? sc.shadePct : null,
      level: level,
      text: head
    };
  }

  /* ---------------- 3. 太阳提示文案 ---------------- */
  function sunHint(elev, az) {
    var e = num(elev, null);
    if (e === null) { return ''; }
    if (e <= 3) { return '太阳接近地平线，阴影拉得很长，此时数据置信度低。'; }
    if (e < LOW_SUN_ELEV) { return '太阳很低，阴影会拉长数倍；真实阴影受树和远山影响更大。'; }
    if (e > 70) { return '太阳接近天顶，阴影最短，路面几乎无遮挡。'; }

    var dir = azimuthDir(az);
    if (dir === '西') {
      return '太阳在西方，西侧的楼开始挡光，东侧反而变亮。';
    }
    var to = dir === '东' ? '西' : dir === '南' ? '北' : '南';
    return '太阳在' + dir + '方，阴影朝' + to + '侧延伸。';
  }

  /* ---------------- 4. 时间文本 -> 帧下标 ---------------- */
  function parseMinutes(t) {
    if (typeof t !== 'string') { return null; }
    var m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(t);
    if (!m) { return null; }
    var hh = parseInt(m[1], 10);
    var mm = parseInt(m[2], 10);
    if (hh > 23 || mm > 59) { return null; }
    return hh * 60 + mm;
  }

  function frameTime(fr) {
    if (typeof fr === 'string') { return fr; }
    if (fr && typeof fr.t === 'string') { return fr.t; }
    return null;
  }

  /*
     帧数组可以是 [{t:"14:00"}] 也可以是 ["14:00"]；
     精确命中返回该下标，否则返回时间上最接近的一帧；空数组/非法时间返回 -1。
   */
  function pickFrameIndex(frames, hhmm) {
    if (!frames || !frames.length) { return -1; }
    var target = parseMinutes(hhmm);
    if (target === null) { return -1; }

    var best = -1;
    var bestDiff = Infinity;
    for (var i = 0; i < frames.length; i++) {
      var m = parseMinutes(frameTime(frames[i]));
      if (m === null) { continue; }
      var d = Math.abs(m - target);
      if (d < bestDiff) { bestDiff = d; best = i; }
      if (d === 0) { return i; }
    }
    return best;
  }

  function frameCount(meta, shadows) {
    var n = meta && meta.frames && meta.frames.length;
    if (n) { return n; }
    return (shadows && shadows.length) || 0;
  }

  /* ---------------- 5. 视觉辅助（也是纯函数） ---------------- */

  /* 低置信度：太阳高度角 < 15° 时返回提示文案，否则返回空串 */
  function isLowSun(elev) {
    var e = num(elev, null);
    return e !== null && e < LOW_SUN_ELEV;
  }

  function lowSunBanner(elev) {
    if (!isLowSun(elev)) { return ''; }
    var e = num(elev, 0);
    // 14.96° 四舍五入成 "15.0°" 再配「低于 15°」会自相矛盾，这种情况多留一位小数
    var shown = (LOW_SUN_ELEV - e) < 0.05 ? e.toFixed(2) : fmtNum(e, 1);
    return '太阳高度角 ' + shown + '°，低于 ' + LOW_SUN_ELEV +
      '°：阴影被拉长，高度误差被几何放大，本帧阴影仅供参考。';
  }

  /* 太阳方位箭头：0°=北（向上），顺时针为正，故 CSS rotate(az) 即可 */
  function compassRotation(az) {
    return normAz(az);
  }

  /* 建筑填充色：越高的楼颜色越深（h 单位米，60 m 封顶） */
  function buildingFill(h) {
    var t = Math.min(1, Math.max(0, num(h, 12) / 60));
    var g = Math.round(176 - t * 56);
    return 'rgb(' + g + ',' + (g + 2) + ',' + (g + 6) + ')';
  }

  /* 视图深链接：#iso 直接打开立体视图（截图/分享/答辩都用得上）。
     放 core 里是为了能在 Node 里单测，不用起浏览器 */
  function wantsIsoView(hash) {
    return String(hash || '').toLowerCase().indexOf('iso') >= 0;
  }

  /* 比例尺：从"好看刻度"里挑一个不超过目标像素宽度的最大米数 */
  function scaleBarMeters(scale, targetPx) {
    var s = num(scale, 0);
    var px = num(targetPx, 90);
    if (!(s > 0)) { return NICE_METERS[0]; }
    var meters = px / s;
    var picked = NICE_METERS[0];
    for (var i = 0; i < NICE_METERS.length; i++) {
      if (NICE_METERS[i] <= meters) { picked = NICE_METERS[i]; }
    }
    return picked;
  }

  return {
    DEFAULT_PAD: DEFAULT_PAD,
    LOW_SUN_ELEV: LOW_SUN_ELEV,

    fitTransform: fitTransform,
    routeSummary: routeSummary,
    shadeMeters: shadeMeters,
    sunHint: sunHint,
    pickFrameIndex: pickFrameIndex,
    frameCount: frameCount,
    isLowSun: isLowSun,
    lowSunBanner: lowSunBanner,
    compassRotation: compassRotation,
    azimuthDir: azimuthDir,
    buildingFill: buildingFill,
    wantsIsoView: wantsIsoView,
    scaleBarMeters: scaleBarMeters,
    fmtNum: fmtNum
  };
})();