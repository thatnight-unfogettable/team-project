/* ============================================================
   凉径 ShadeRoute Lite —— 2.5D 体块视图（立体视图）
   责任：xu
   用现有 data/*.js 的轮廓 + 楼高，在 Canvas 2D 上手算轴测投影，
   不引 three.js、不读模型文件、不发任何请求 —— 仍然是"双击即用"的纯静态页。

   做法（一路 2D，没有 WebGL）：
     1. 地面：把平面视图整体绕画布中心旋转一个 yaw（矩阵交给 ctx.setTransform），
        所以路网 / 阴影 / 路线 / 网格全部沿用原来的画法，只是"斜过来铺在地上"；
     2. 楼：每栋的轮廓按楼高沿屏幕竖直方向拔起，画"顶面 + 朝向观察者的侧面"，
        侧面亮度 = 外法线与太阳方位的点积（背光面偏冷偏暗），顶面偏亮；
     3. 排序：画家算法，按轮廓在屏幕上的深度（y）从远到近画，近的盖住远的。
   可单测的纯函数：make / fitView / scene / faceFill / zone（点选反解）。
   ============================================================ */

window.ISO = (function () {
  var DEG = Math.PI / 180;

  var YAW_DEG = -26;        // 地面旋转角（负 = 逆时针）；让校园斜着铺，像轴测图
  var VERTICAL = 3.2;       // 高度放大系数：1200 m 跨度下按真实比例 12 m 楼只有 5 px，看不出体积
  var COMPRESS = 0.80;      // 地面纵向压缩（斜二测观感）；楼高不压
  var FIT_FACTOR = 0.82;    // 旋转后外接框比原 bbox 大，等比缩一点防四角被裁
  var AMBIENT = 0.34;       // 背光面亮度下限（0=全黑，1=全亮）
  var TOP_LIGHT = 0.55;     // 顶面基础亮度随太阳高度角上升的部分

  function num(v, d) {
    var n = Number(v);
    return isFinite(n) ? n : d;
  }

  function clamp01(v) {
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }

  /* 在 CORE.fitTransform 的结果上再乘一个等比缩放（围绕画布中心）。
     旋转后 bbox 的四角会跑出画布，所以立体视图用略小的 scale。 */
  function fitView(base, cssW, cssH, factor) {
    var f = num(factor, FIT_FACTOR);
    var cw = num(cssW, 1) / 2, ch = num(cssH, 1) / 2;
    return {
      scale: num(base && base.scale, 1) * f,
      factor: f,
      x: function (mx) { return cw + (base.x(mx) - cw) * f; },
      y: function (my) { return ch + (base.y(my) - ch) * f; },
      unx: function (sx) { return base.unx(cw + (sx - cw) / f); },
      uny: function (sy) { return base.uny(ch + (sy - ch) / f); }
    };
  }

  /* 投影器：米坐标(+高) -> 画布 CSS 像素 */
  function make(view, cssW, cssH, opts) {
    opts = opts || {};
    var yawDeg = num(opts.yaw, YAW_DEG);
    var yaw = yawDeg * DEG;
    var cos = Math.cos(yaw), sin = Math.sin(yaw);
    var cx = num(cssW, 1) / 2, cy = num(cssH, 1) / 2;
    var scale = num(view.scale, 1);
    var zScale = scale * num(opts.vertical, VERTICAL);
    // 地面在屏幕纵向压扁一点（斜投影/斜二测的观感），楼高不压 —— 立体感主要来自这一项
    var compress = num(opts.compress, COMPRESS);

    // 绕画布中心旋转 + 纵向压缩后的仿射平移项（CSS px 空间）
    var tx = cx - cx * cos + cy * sin;
    var ty = cy - compress * (cx * sin + cy * cos);

    function project(mx, my, z) {
      var gx = view.x(mx) - cx, gy = view.y(my) - cy;
      var zz = num(z, 0) * zScale;
      return [cx + gx * cos - gy * sin, cy + compress * (gx * sin + gy * cos) - zz];
    }

    /* 屏幕 -> 地面米坐标（z=0 的反解，地图点选要用） */
    function unproject(sx, sy) {
      var rx = num(sx, 0) - cx;
      var ry = (num(sy, 0) - cy) / compress;
      var dx = rx * cos + ry * sin;
      var dy = -rx * sin + ry * cos;
      return [view.unx(cx + dx), view.uny(cy + dy)];
    }

    return {
      yawDeg: yawDeg,
      cos: cos,
      sin: sin,
      cx: cx,
      cy: cy,
      scale: scale,
      compress: compress,
      zScale: zScale,
      project: project,
      unproject: unproject,
      /* 正北在屏幕上的角度（度，0=屏幕上，顺时针为正）。
         地面纵向压缩后它不等于 -yaw，必须按投影算：atan2(sin, compress·cos)。 */
      northDeg: function () {
        return Math.atan2(sin, compress * cos) * 180 / Math.PI;
      },
      /* 给"输入 CSS px"的图层用：setTransform(...cssMatrix(dpr)) */
      cssMatrix: function (dpr) {
        var d = num(dpr, 1);
        return [d * cos, d * compress * sin, -d * sin, d * compress * cos, d * tx, d * ty];
      },
      /* 给"输入已是设备 px"的离屏画布用（阴影层） */
      deviceMatrix: function (dpr) {
        var d = num(dpr, 1);
        return [cos, compress * sin, -sin, compress * cos, d * tx, d * ty];
      }
    };
  }

  function ringArea(ring) {
    var a = 0;
    for (var i = 0; i < ring.length; i++) {
      var p = ring[i], q = ring[(i + 1) % ring.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }

  /* 楼体颜色：底色沿用 core.buildingFill（越高的楼越深），
     再按受光程度调亮度 —— 照到太阳的面偏暖亮，背光面偏冷暗。 */
  function baseRgb(h) {
    var s = (window.CORE && window.CORE.buildingFill) ? window.CORE.buildingFill(h) : '';
    var m = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(String(s));
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [176, 178, 182];
  }

  function faceFill(h, tone, isTop) {
    var b = baseRgb(h);
    var t = clamp01(tone);
    var shade = 1 - t;                       // 背光度
    // 屋顶最亮且偏暖，侧面按受光程度压暗、背光偏冷蓝。
    // 注意亮度必须是"乘"出来的：一旦改成整体加亮，低太阳时楼顶反而更亮（smoke 抓过）。
    var k = isTop ? (0.80 + 0.32 * t) : (0.28 + 0.66 * t);
    var r = b[0] * k - 5 * shade + (isTop ? 10 : 0);
    var g = b[1] * k - 1 * shade + (isTop ? 6 : 0);
    var bl = b[2] * k + 14 * shade + (isTop ? -8 : 0);
    return 'rgb(' + Math.round(Math.min(255, Math.max(0, r))) + ',' +
      Math.round(Math.min(255, Math.max(0, g))) + ',' +
      Math.round(Math.min(255, Math.max(0, bl))) + ')';
  }

  /* 一棵"最小可辨识"的树在屏幕上的半径（CSS px）。1200 m 跨度、0.34 px/m 的比例下，
     真实 4 m 树冠只有 1.4 px，照实画就是一堆灰点 —— 所以给个符号下限，让它读得出是树。 */
  var TREE_MIN_PX = 2.6;
  var LEAF = [104, 146, 96];   // 树叶底色（和米黄地面、灰楼都拉开）

  /* 一帧要画的全部楼面：按深度从远到近排好，map.js 只负责照着画 */
  function scene(buildings, iso, sun, trees) {
    var list = buildings || [];
    var az = num(sun && sun[0], 180) * DEG;
    var elev = num(sun && sun[1], 45);
    var sunE = Math.sin(az);                 // 太阳方向（水平）东向分量
    var sunN = Math.cos(az);                 // 北向分量
    var topTone = clamp01(TOP_LIGHT + (1 - TOP_LIGHT) * Math.sin(clamp01(elev / 90) * 90 * DEG));

    var items = [];
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      var ring = b && b.p;
      if (!ring || ring.length < 3) { continue; }
      var h = num(b.h, 12);

      var pts = [], sumY = 0;
      for (var k = 0; k < ring.length; k++) {
        var q = iso.project(ring[k][0], ring[k][1], 0);
        pts.push(q);
        sumY += q[1];
      }

      var faces = [];
      var flip = ringArea(ring) < 0 ? -1 : 1;   // 轮廓绕向决定外法线朝哪边
      for (var e = 0; e < ring.length; e++) {
        var p0 = ring[e], p1 = ring[(e + 1) % ring.length];
        var dx = p1[0] - p0[0], dy = p1[1] - p0[1];
        var len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.05) { continue; }
        var nx = flip * dy / len;
        var ny = flip * (-dx) / len;
        // 旋转后法线的屏幕 y 分量 > 0 才是朝着观察者的面
        if (nx * iso.sin - ny * iso.cos <= 0) { continue; }
        var lit = clamp01(nx * sunE + ny * sunN);
        var tone = AMBIENT + (1 - AMBIENT) * lit;
        faces.push({
          kind: 'side',
          fill: faceFill(h, tone, false),
          pts: [pts[e], pts[(e + 1) % ring.length],
            iso.project(p1[0], p1[1], h), iso.project(p0[0], p0[1], h)]
        });
      }

      // 顶面最后画：无论侧面怎么排，屋顶都应该在最上面
      var top = [];
      for (var k2 = 0; k2 < ring.length; k2++) {
        top.push(iso.project(ring[k2][0], ring[k2][1], h));
      }
      faces.push({ kind: 'top', fill: faceFill(h, topTone, true), pts: top });

      items.push({ h: h, depth: sumY / pts.length, faces: faces });
    }

    // ---- 树：和楼进同一个列表一起排序，近处的树才会盖住远处的楼 ----
    var tl = trees || [];
    var sunUp = clamp01(elev / 90);
    for (var ti = 0; ti < tl.length; ti++) {
      var t = tl[ti];
      if (!t) { continue; }
      var rEff = Math.max(num(t.r, 4), TREE_MIN_PX / iso.scale);
      var hh = num(t.h, 8), tone = clamp01(num(t.tone, 0.5));
      var b0 = iso.project(t.x, t.y, 0);
      var bTop = iso.project(t.x, t.y, hh * 0.42);
      var halfW = Math.max(0.6, 0.5 * iso.scale);
      var k = 0.74 + 0.30 * tone + 0.10 * sunUp;     // 每棵树深浅不同，整片叶子随太阳高度提亮
      var tfaces = [
        {
          kind: 'trunk',
          fill: 'rgb(96,78,60)',
          pts: [[b0[0] - halfW, b0[1]], [b0[0] + halfW, b0[1]],
            [bTop[0] + halfW * 0.8, bTop[1]], [bTop[0] - halfW * 0.8, bTop[1]]]
        },
        { kind: 'tree', fill: rgbScale(LEAF, k), pts: ellipsePts(t.x, t.y, rEff, hh, iso, 14, 0, 0) },
        { kind: 'treeLit', fill: rgbScale(LEAF, k + 0.34), pts: ellipsePts(t.x, t.y, rEff * 0.5, hh, iso, 12, sunE * rEff * 0.22, sunN * rEff * 0.22) }
      ];
      items.push({ h: hh, depth: b0[1], faces: tfaces });
    }

    items.sort(function (a, b) { return a.depth - b.depth; });
    return items;
  }

  /* 地平面上的圆盘，按投影摊成椭圆（地面被压扁，圆也跟着扁）。
     顺序：树冠阴影面 -> 受光面，靠 order 保证后者压在前者上面。 */
  function ellipsePts(cx, cy, r, z, iso, seg, ox, oy) {
    var pts = [];
    for (var i = 0; i < seg; i++) {
      var th = i / seg * Math.PI * 2;
      pts.push(iso.project(cx + ox + Math.cos(th) * r, cy + oy + Math.sin(th) * r, z));
    }
    return pts;
  }

  function rgbScale(base, k) {
    var r = Math.round(Math.min(255, Math.max(0, base[0] * k)));
    var g = Math.round(Math.min(255, Math.max(0, base[1] * k)));
    var b = Math.round(Math.min(255, Math.max(0, base[2] * k)));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  return {
    YAW_DEG: YAW_DEG,
    VERTICAL: VERTICAL,
    COMPRESS: COMPRESS,
    FIT_FACTOR: FIT_FACTOR,
    AMBIENT: AMBIENT,
    fitView: fitView,
    make: make,
    scene: scene,
    faceFill: faceFill,
    ringArea: ringArea
  };
})();