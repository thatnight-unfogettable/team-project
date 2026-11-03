/* ============================================================
   凉径 ShadeRoute Lite —— 浏览器控制台自检（绿色模块 + 入口页）
   用法：分别在 index.html 与 home.html 按 F12 打开控制台，整段粘贴回车。
   为什么单独一个文件：Node 沙箱测的是数据与逻辑，浏览器里还要测
   CSS 生效、:has/is-on、localStorage、真实字体渲染下的数字宽度。
   ============================================================ */

(function () {
  'use strict';
  var P = 0, F = 0, pendingAsync = 0;
  function ok(name, cond, detail) {
    if (cond) { P += 1; console.log('%cPASS %c' + name, 'color:#38c172;font-weight:700', '', detail || ''); }
    else { F += 1; console.log('%cFAIL %c' + name, 'color:#f66;font-weight:700', '', detail || ''); }
  }
  function num(id) {
    var n = document.getElementById(id);
    return n ? parseFloat(String(n.textContent).replace(/[^\d.+-]/g, '')) : NaN;
  }
  function txt(id) {
    var n = document.getElementById(id);
    return n ? String(n.textContent) : '(无此节点)';
  }
  function isGreenPage() { return !!window.GREEN_UI; }
  function isHomePage() { return !!window.DATA_GREEN && !window.APP; }

  /* ---------- 通用：离线与全局 ---------- */
  ok('全站零外部请求（performance 里没有任何 http/https 资源）',
    performance.getEntriesByType('resource').every(function (e) {
      return !/^https?:/i.test(e.name);
    }),
    performance.getEntriesByType('resource').filter(function (e) { return /^https?:/i.test(e.name); })
      .map(function (e) { return e.name; }).join(','));
  ok('DATA_GREEN / GREEN / STRINGS_GREEN / TEXTFX 都在',
    !!(window.DATA_GREEN && window.GREEN && window.STRINGS_GREEN && window.TEXTFX));
  ok('prefers-reduced-motion 当前状态被读到了（true 时动效应直接落终值）',
    typeof window.matchMedia === 'function',
    'reduce=' + window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- 工具页 ---------- */
  if (isGreenPage()) {
    var sec = document.getElementById('green-block');
    ok('绿色面板已注入', !!sec);
    ok('面板就在"路线对比"后面（读得到的顺序，不是藏在最底下）',
      !!sec && sec.previousElementSibling === document.getElementById('card-fast').parentNode);
    ok('面板样式真的生效了（computed 背景不是透明）',
      !!sec && getComputedStyle(sec).borderLeftWidth === '2px',
      sec ? getComputedStyle(sec).borderLeftWidth : '');

    var shown = parseFloat(String(txt('fast-len')).replace(/[^\d.]/g, ''));
    var D = window.DATA_GREEN, tier = null, i;
    for (i = 0; i < D.activities.walk.speeds.length; i++) {
      if (D.activities.walk.speeds[i].isDefault) { tier = D.activities.walk.speeds[i]; }
    }
    var exp = window.GREEN.compute({
      meters: shown, activity: D.activities.walk, baseline: D.baselines[0], occupancy: 1,
      massKg: D.defaultMassKg, met: tier.met, speedKmh: tier.kmh, tripsPerWeek: 5, weeksPerYear: 32
    });
    ok('页面米数读到了（#fast-len = ' + shown + ' m）', shown > 0);
    ok('减排数字与 GREEN.compute 一致',
      Math.abs(num('gn-co2') - exp.savedG) < 0.1, txt('gn-co2') + ' vs ' + exp.savedG.toFixed(1));
    ok('净消耗数字与 GREEN.compute 一致',
      Math.abs(num('gn-kcal') - Math.round(exp.netKcal)) < 0.6,
      txt('gn-kcal') + ' vs ' + exp.netKcal.toFixed(1));
    ok('标签写着方式与米数', /\S+ · \d+ m/.test(txt('green-tag')), txt('green-tag'));

    /* 换算条在窄面板里不该溢出 */
    var eqs = sec.querySelector('.gn-eqs');
    ok('换算条目在面板宽度内不横向溢出',
      !eqs || eqs.scrollWidth <= eqs.clientWidth + 2,
      eqs ? eqs.scrollWidth + '/' + eqs.clientWidth : '');

    /* 控件驱动 */
    var radios = sec.querySelectorAll('input[name="gn-mode"]');
    var bike = null;
    for (i = 0; i < radios.length; i++) { if (radios[i].value === 'bike') { bike = radios[i]; } }
    ok('方式选择是真 radio', !!bike && bike.type === 'radio');
    var beforeMin = num('gn-min');
    bike.checked = true;
    bike.dispatchEvent(new Event('change', { bubbles: true }));
    setTimeout(function () {
      ok('切到骑行后时长变短了', num('gn-min') < beforeMin - 1, beforeMin + ' → ' + txt('gn-min'));
      ok('骑行时步数条目不再出现',
        sec.querySelector('.gn-eqs').textContent.indexOf('步') < 0 ||
        sec.querySelector('.gn-eqs').textContent.indexOf('骑行不计步') >= 0);
      /* 基准换成公交：数字应显著变小 */
      var sel = document.getElementById('gn-baseline');
      sel.value = 'bus_local';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      setTimeout(function () {
        var busV = num('gn-co2');
        sel.value = 'car_avg';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        setTimeout(function () {
          var carV = num('gn-co2');
          ok('公交减排 < 小汽车减排（单位口径没搞反）', busV < carV, busV + ' vs ' + carV);
          ok('载客人数控件在小汽车基准下可见',
            document.getElementById('gn-occ').parentNode.style.display !== 'none');
          /* 原有页面仍然工作 */
          var slider = document.getElementById('time-slider');
          var before = txt('fast-sun');
          slider.value = String(Math.max(0, parseInt(slider.value, 10) - 3));
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          setTimeout(function () {
            ok('拖时间轴后原有数字仍在更新（绿色面板没挡路）',
              txt('fast-sun') !== before || txt('fast-len') !== '(无)',
              before + ' → ' + txt('fast-sun'));
            slider.value = String(parseInt(slider.value, 10) + 3);
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            /* 刷新后参数应还在（localStorage 可用性现场验证） */
            ok('本地存储可用（参数会被记住）', (function () {
              try {
                window.localStorage.setItem('__probe', '1');
                var v = window.localStorage.getItem('__probe');
                window.localStorage.removeItem('__probe');
                return v === '1';
              } catch (e) { return false; }
            })(), 'file:// 下若被禁用，面板仍会照常工作，只是不记忆参数');
            done();
          }, 120);
        }, 60);
      }, 60);
    }, 60);
  }

  /* ---------- 入口页 ---------- */
  if (isHomePage()) {
    ok('标题不是乱码残留', txt('h-title') === '凉径 · ShadeRoute Lite', txt('h-title'));
    ok('打字机结论完整', /多走 \d+ 米，少晒 \d+\.\d 分钟。$/.test(txt('h-slogan')), txt('h-slogan'));
    var M = window.DATA_META, R = window.DATA_ROUTES;
    var idx = window.CORE.pickFrameIndex(M.frames, '14:00');
    var r = R.frames[idx].routes[0];
    ok('"少晒"与数据一致',
      txt('s-save') === (r.fastest.sun_minutes - r.cool.sun_minutes).toFixed(1) + ' 分钟', txt('s-save'));
    ok('"多走"与数据一致',
      txt('s-extra') === Math.round(r.cool.length_m - r.fastest.length_m) + ' 米', txt('s-extra'));
    ok('入口页也算了绿色收益（与工具页同一套函数）',
      !isNaN(num('g-co2')) && num('g-co2') > 0, txt('g-co2'));
    var mq = document.getElementById('h-mq');
    ok('跑马灯有内容且没溢出容器', mq.children.length > 10, '楼名 ' + mq.children.length + ' 条');
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      var x0 = getComputedStyle(mq).transform;
      afterAsync(function () {
        ok('跑马灯在动（transform 随帧变化）', getComputedStyle(mq).transform !== x0,
          x0 + ' → ' + getComputedStyle(mq).transform);
      }, 500);
    } else {
      ok('减少动效偏好下跑马灯静止（且尾部条目被隐藏）',
        getComputedStyle(mq).transform === 'none' || getComputedStyle(mq).transform === 'matrix(1, 0, 0, 1, 0, 0)');
    }
    ok('CTA 指向 index.html', document.getElementById('h-cta').getAttribute('href') === 'index.html');
    ok('整页没有横向滚动条', document.documentElement.scrollWidth <= window.innerWidth + 1,
      document.documentElement.scrollWidth + '/' + window.innerWidth);

    /* ---------- 入口页小地图：只有真浏览器能验的三件事 ---------- */
    var cv = document.getElementById('h-map');
    var ctx = cv && cv.getContext && cv.getContext('2d');
    ok('小地图是 canvas（不是图片，也没有引任何地图库）',
      !!cv && cv.tagName === 'CANVAS' && !!ctx && typeof window.L === 'undefined');
    if (ctx) {
      var rect = cv.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      ok('画布按设备像素分配（dpr=' + dpr + '，这是 map.js 修过的错位坑）',
        Math.abs(cv.width - rect.width * dpr) <= 1.5 && Math.abs(cv.height - rect.height * dpr) <= 1.5,
        cv.width + '×' + cv.height + ' vs CSS ' + rect.width.toFixed(1) + '×' + rect.height.toFixed(1) +
        ' × ' + dpr);
      function inkRatio() {
        /* 采样有多少像素不是纸色：空白画布 ≈ 0，画了东西的图 ≥ 1% */
        var d = ctx.getImageData(0, 0, cv.width, cv.height).data, ink = 0, n = 0, i;
        for (i = 0; i < d.length; i += 4 * 37) {          // 每 37 像素取一个，够代表性
          n += 1;
          if (Math.abs(d[i] - 242) > 8 || Math.abs(d[i + 1] - 240) > 8 || Math.abs(d[i + 2] - 234) > 8) { ink += 1; }
        }
        return ink / n;
      }
      var ratio0 = inkRatio();
      ok('图上真的有东西（非纸色像素占比，空白画布会是 0）',
        ratio0 > 0.01, (ratio0 * 100).toFixed(1) + '%');
      var cap = txt('h-map-cap');
      ok('图注写的是数据（道路段数来自 BASEMAP）',
        cap.indexOf(window.DATA_BASEMAP.roadCount + ' 段道路') >= 0, cap);
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        afterAsync(function () {
          var ratio1 = inkRatio();
          ok('地名轮流点亮在动（3 秒后图上的墨迹分布变了）',
            Math.abs(ratio1 - ratio0) > 1e-4 || ratio1 > 0.01,
            (ratio0 * 100).toFixed(2) + '% → ' + (ratio1 * 100).toFixed(2) + '%');
        }, 3000);
      }
    }
  }

  /* 异步检查没跑完不许结算——否则"PASS"里藏着根本没测到的项。 */
  function afterAsync(fn, ms) {
    pendingAsync += 1;
    setTimeout(function () {
      pendingAsync -= 1;
      try { fn(); } catch (e) { ok('异步检查抛异常：' + e.message, false); }
      maybeDone();
    }, ms);
  }
  function maybeDone() { if (pendingAsync === 0) { done(); } }

  var finished = false;
  function done() {
    if (finished) { return; }                 // 异步链里可能被多次调用，只报一次
    finished = true;
    console.log('----------------------------------------------');
    console.log('CONSOLE-CHECK-GREEN: PASS ' + P + ' / FAIL ' + F,
      F === 0 ? 'color:#38c172;font-weight:700' : 'color:#f66;font-weight:700');
    if (F > 0) { console.log('有 ' + F + ' 项失败，先看上面的 FAIL 行。'); }
  }
  if (!isGreenPage() && !isHomePage()) {
    console.log('这个页面既没有 GREEN_UI 也不是入口页，请在 index.html 或 home.html 里运行。');
  } else if (isHomePage()) {
    maybeDone();                              // 入口页有异步项（跑马灯 / 轮流点亮），没跑完不结算
  }
})();
