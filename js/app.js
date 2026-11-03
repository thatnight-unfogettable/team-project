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
  var BASEMAP = window.DATA_BASEMAP || null;
  var S = window.STRINGS || {};
  var CORE = window.CORE;

  var state = {
    frame: 0,
    pair: 0,
    userPicked: false, // 用户是否自己选了起终点（下拉/地图点选）；false = 用预计算示例
    fromXY: null,      // 起点（米坐标），null = 用预计算示例
    toXY: null,        // 终点（米坐标）
    fromName: '',
    toName: '',
    pickNext: 'from',  // 下一次地图点击设起点还是终点
    routeMsg: '',      // 算不出路线时的提示
    ready: false,
    // ---- 治理侧：种树规划（面 2）----
    planMode: false,       // 是否在「种树规划」页签
    planTrees: [],         // 已种的规划树 [{x,y,r,h,legal}]
    planPending: [],       // 优化推荐的待种点位 [{x,y,rank,gainMinutes,desc}]
    planOptimized: null,   // 上一次优化的完整结果
    planUndo: [],          // 撤销栈（JSON 快照）
    planCtx: null,         // PLAN.makeContext() 的结果
    planBusy: false,       // 优化计算中
    planLoaded: false,     // 本地存档是否已读
    planDragIdx: -1,       // 正在拖第几棵
    planDragMoved: false,  // 这次拖动是否真的移动过
    planJustDragged: false // 刚拖完：随后的 click 不要当成"再种一棵"
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
    两条输入路径，各有各的用途：
    1) 用户自己选了起终点（下拉 / 地图点选）→ 浏览器端 ROUTER 现场算，支持任意两点；
    2) 没选点（默认 / 点了示例 A、示例 B）→ 直接用 build.py 预计算的示例路线，瞬时切换。
       实测两条路径在 62 个「帧 × 示例起终点」上结果完全一致（tools/smoke.js 有断言），
       所以"预计算"与"现场算"可以放心并存，不会出现两套数字。
  */
  function currentRoutes() {
    var i = state.frame;
    state.routeMsg = '';

    if (state.userPicked) {
      return solveLive(i);
    }

    var routeFrame = (ROUTES.frames && ROUTES.frames[i]) || null;
    var pairData = routeFrame && routeFrame.routes ? routeFrame.routes[state.pair] : null;
    if (pairData && pairData.fastest) {
      return { fastest: pairData.fastest, cool: pairData.cool, live: false,
               fromXY: pairData.fastest.pts[0],
               toXY: pairData.fastest.pts[pairData.fastest.pts.length - 1] };
    }

    // 预计算缺失（老数据）→ 退回现场算
    return solveLive(i);
  }

  function solveLive(i) {
    if (!window.ROUTER || !window.ROUTER.ready() || !state.fromXY || !state.toXY) {
      return { fastest: null, cool: null, live: true };
    }
    var live = window.ROUTER.solve(state.fromXY, state.toXY, i);
    if (live.ok) {
      return { fastest: live.fastest, cool: live.cool, live: true,
               fromXY: live.from.x === undefined ? null : [live.from.x, live.from.y],
               toXY: [live.to.x, live.to.y] };
    }
    state.routeMsg = live.reason || '';
    return { fastest: null, cool: null, live: true, msg: state.routeMsg };
  }

  /* ---------- 树：只生成一次（固定种子，确定性），之后每帧复用 ---------- */
  function treeList() {
    if (state.trees) { return state.trees; }
    if (!window.TREES || !window.TREES.generate) { state.trees = []; return state.trees; }
    try {
      state.trees = window.TREES.generate({
        buildings: BUILDINGS,
        roads: (BASEMAP && BASEMAP.roads) || [],
        water: (BASEMAP && BASEMAP.water) || [],
        campusRing: (META.campus && META.campus.ring) || null
      }) || [];
    } catch (e) {
      // 树是装饰层：生成失败也不能把整张图带崩
      state.trees = [];
    }
    return state.trees;
  }

  /* ---------- 校门：道路与校园边界的交点，只算一次 ---------- */
  function gateList() {
    if (state.gates) { return state.gates; }
    var ring = (META.campus && META.campus.ring) || null;
    state.gates = (CORE.gatesFromRoads && BASEMAP && BASEMAP.roads)
      ? CORE.gatesFromRoads(BASEMAP.roads, ring) : [];
    return state.gates;
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
      sun: fr.sun || null,
      fastPts: fastPts,
      coolPts: coolPts,
      fromXY: cur.fromXY || null,
      toXY: cur.toXY || null,
      campusRing: (META.campus && META.campus.ring) || null,
      basemap: BASEMAP,
      trees: treeList(),
      gates: gateList(),
      plan: {
        active: state.planMode,
        trees: state.planTrees,
        pending: state.planPending,
        shadow: true
      }
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

    // 规划页签的数字：只在规划模式刷新（measure 是毫秒级但没必要每帧都算）
    if (state.planMode) { updatePlanPanel(); }
  }

  /* ---------- 平面 / 立体视图 ----------
     立体视图 = 2.5D 体块（几何在 js/iso.js，画法在 js/map.js），
     零依赖、不联网、不读模型文件。这里只负责按钮状态与指北针。 */
  function setViewIso(on) {
    // 规划模式只支持平面视图：切立体先拦一下（否则树影与拖拽命中都对不上）
    if (on && state.planMode) {
      planSay(PLAN_TAB_NOTE);
      return;
    }
    var iso = false;
    if (window.MAP && window.MAP.setIso) { iso = !!window.MAP.setIso(!!on); }
    syncViewButtons(iso);
  }

  function syncViewButtons(iso) {
    if (el.viewPlan) {
      el.viewPlan.className = 'view-btn' + (iso ? '' : ' is-on');
      el.viewPlan.setAttribute('aria-pressed', iso ? 'false' : 'true');
    }
    if (el.viewIso) {
      el.viewIso.className = 'view-btn' + (iso ? ' is-on' : '');
      el.viewIso.setAttribute('aria-pressed', iso ? 'true' : 'false');
    }
    // 地面转了 yaw 又压了纵向之后，"屏幕上方"不再等于正北：
    // 指北针角度必须用投影算（MAP.northAngle），不能直接拿 yaw 顶替
    var deg = 0;
    if (iso && window.MAP && window.MAP.northAngle) { deg = window.MAP.northAngle(); }
    if (el.compassNeedle) { el.compassNeedle.style.transform = 'rotate(' + deg.toFixed(1) + 'deg)'; }
    if (el.compass) {
      var cls = String(el.compass.className || '').replace(/\s*is-iso\b/g, '');
      el.compass.className = cls + (iso ? ' is-iso' : '');
    }
  }

  /* ---------- 交互 ---------- */
  function bind() {
    el.slider.addEventListener('input', function () {
      state.frame = parseInt(this.value, 10) || 0;
      render();
    });

    if (el.pairA) { el.pairA.addEventListener('click', function () { selectPair(0); }); }
    if (el.pairB) { el.pairB.addEventListener('click', function () { selectPair(1); }); }
    if (el.viewPlan) { el.viewPlan.addEventListener('click', function () { setViewIso(false); }); }
    if (el.viewIso) { el.viewIso.addEventListener('click', function () { setViewIso(true); }); }

    // ---- 治理侧：种树规划 ----
    if (el.tabRoute) { el.tabRoute.addEventListener('click', function () { planSetMode(false); }); }
    if (el.tabPlan) { el.tabPlan.addEventListener('click', function () { planSetMode(true); }); }
    if (el.planOptimize) { el.planOptimize.addEventListener('click', planOptimize); }
    if (el.planPlantAll) { el.planPlantAll.addEventListener('click', planPlantAll); }
    if (el.planUndo) { el.planUndo.addEventListener('click', planUndoLast); }
    if (el.planClear) { el.planClear.addEventListener('click', planClear); }

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
      // 规划模式：按下已有树 = 开始拖；拖完的 click 不再种新树
      canvas.addEventListener('pointerdown', function (ev) {
        if (!state.planMode) { return; }
        var p = planPx(ev);
        var idx = planTreeAt(p[0], p[1]);
        if (idx < 0) { return; }
        planSnapshot();
        state.planDragIdx = idx;
        state.planDragMoved = false;
        if (canvas.setPointerCapture) { try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* 老浏览器 */ } }
      });
      canvas.addEventListener('pointermove', function (ev) {
        if (!state.planMode || state.planDragIdx < 0) { return; }
        var t = state.planTrees[state.planDragIdx];
        var pw = planWorld(ev);
        if (!t || !pw) { return; }
        t.x = Math.round(pw[0] * 10) / 10;
        t.y = Math.round(pw[1] * 10) / 10;
        var pctx = planCtx();
        t.legal = pctx ? pctx.legal(t.x, t.y, t.kind || 'road').ok : true;
        state.planDragMoved = true;
        render();
      });
      canvas.addEventListener('pointerup', function () {
        if (state.planDragIdx < 0) { return; }
        state.planDragIdx = -1;
        if (state.planDragMoved) {
          state.planJustDragged = true;   // 紧接着的 click 不要当成"再种一棵"
          planRevalidate();
          planSave();
          planRefresh();
        }
      });
      canvas.addEventListener('contextmenu', function (ev) {
        if (!state.planMode) { return; }
        ev.preventDefault();
        var p = planPx(ev);
        planDeleteAt(p[0], p[1]);
      });

      canvas.addEventListener('click', function (ev) {
        if (state.planMode) {
          if (state.planJustDragged) { state.planJustDragged = false; return; }
          var pw = planWorld(ev);
          if (pw) { planPlace(pw[0], pw[1]); }
          return;
        }
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
      // 焦点在原生控件（下拉/滑块/输入框）里时，方向键应交给控件自己处理，否则会“换选项 + 切时间”双动作
      var tag = e.target && e.target.tagName;
      if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') { return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      // V：平面 / 立体视图来回切（演示时按一个键就行）
      if (e.key === 'v' || e.key === 'V') {
        setViewIso(!(window.MAP && window.MAP.isIso && window.MAP.isIso()));
      }
      // P：路线 / 种树规划 页签来回切
      if (e.key === 'p' || e.key === 'P') { planSetMode(!state.planMode); }
      // Ctrl/Cmd + Z：撤销（只在规划模式下拦）
      if (state.planMode && (e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        planUndoLast();
      }
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
    state.userPicked = true;   // 用户自己选过点 → 之后一律现场算，不再套用示例
    if (which === 'from') {
      state.fromXY = xy; state.fromName = name;
      markSelect(el.startSelect, name);
    } else {
      state.toXY = xy; state.toName = name;
      markSelect(el.endSelect, name);
    }
    updatePairButtons();
    updatePickHint();
    render();
  }

  /* 下拉框里尽量选中同名项；找不到（地图点选）就加一个临时项 */
  function markSelect(sel, name) {
    if (!sel) { return; }
    var opts = sel.options || sel.children || [];
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].textContent === name) { sel.selectedIndex = i; return; }
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
    // 临时项 option.value 写的是 '-1'，用 sel.value 设会匹配不到任何项 → selectedIndex = -1（下拉变空白）
    sel.selectedIndex = customIdx;
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

  /* ---------- 示例 A / 示例 B ---------- */
  function pairAt(i) {
    var pairs = (ROUTES && ROUTES.pairs) || [];
    return pairs[i] || null;
  }

  function selectPair(i) {
    var p = pairAt(i);
    if (!p) { return; }
    state.pair = i;
    state.userPicked = false;   // 回到预计算示例
    state.routeMsg = '';
    if (window.PROJ && window.PROJ.toXY) {
      var fxy = window.PROJ.toXY(p.from[0], p.from[1]);
      var txy = window.PROJ.toXY(p.to[0], p.to[1]);
      var list = (window.ROUTER && window.ROUTER.anchors()) || [];
      var a = nearestAnchorTo(list, fxy);
      var b = nearestAnchorTo(list, txy);
      var names = String(p.name || '').split('→');
      state.fromXY = [fxy[0], fxy[1]];
      state.toXY = [txy[0], txy[1]];
      state.fromName = (a && a.name) || (names[0] || '').trim() || '起点';
      state.toName = (b && b.name) || (names[1] || '').trim() || '终点';
      markSelect(el.startSelect, state.fromName);
      markSelect(el.endSelect, state.toName);
    }
    updatePairButtons();
    updatePickHint();
    render();
  }

  /* 按钮状态与标题（标题显示这一组示例的真实起终点） */
  function updatePairButtons() {
    var btns = [el.pairA, el.pairB];
    for (var i = 0; i < btns.length; i++) {
      var btn = btns[i];
      if (!btn) { continue; }
      var on = (i === state.pair) && !state.userPicked;
      btn.className = 'pair-btn' + (on ? ' is-on' : '');
      if (btn.setAttribute) { btn.setAttribute('aria-pressed', on ? 'true' : 'false'); }
      var p = pairAt(i);
      if (p && p.name) { btn.title = p.name; }
    }
  }

/* ================= 治理侧：种树规划（面 2） =================
     口径（已冻结，README §7.13）：
       - 官方「阴凉 % / 少晒 x 分钟」仍然只算建筑阴影，本模块一个字都不改它；
       - 这里所有数字都是"规划演算"，面板上明确标注；
       - 计算全在 js/plan.js（纯函数，smoke 可直接测），本段只管状态、DOM 与指针交互。 */

  function planAPI() { return window.PLAN || null; }

  /* 规划上下文：建筑/水/路/边界/路网 + 已有装饰树（当碰撞体），只构建一次 */
  function planCtx() {
    if (state.planCtx) { return state.planCtx; }
    var P = planAPI();
    if (!P) { return null; }
    try {
      state.planCtx = P.makeContext({
        buildings: BUILDINGS,
        water: (BASEMAP && BASEMAP.water) || [],
        roads: (BASEMAP && BASEMAP.roads) || [],
        campusRing: (META.campus && META.campus.ring) || null,
        frames: META.frames || [],
        bbox: META.bbox_m || null,
        graph: GRAPH,
        blockers: treeList()
      });
    } catch (e) {
      state.planCtx = null;
      planSay('规划模块初始化失败：' + (e && e.message ? e.message : e));
    }
    return state.planCtx;
  }

  function planSay(text) { if (el.planMsg) { el.planMsg.textContent = text || ''; } }

  function planSnapshot() {
    var snap = [];
    for (var i = 0; i < state.planTrees.length; i++) { snap.push([state.planTrees[i].x, state.planTrees[i].y]); }
    state.planUndo.push(JSON.stringify(snap));
    if (state.planUndo.length > 40) { state.planUndo.shift(); }
    if (el.planUndo) { el.planUndo.disabled = false; }
  }

  /* 从 [[x,y],...] 恢复规划树（撤销 / 读本地存档共用） */
  function planRestoreList(list) {
    var P = planAPI();
    if (!P) { return; }
    state.planTrees = [];
    for (var i = 0; i < list.length; i++) {
      state.planTrees.push({ x: list[i][0], y: list[i][1], r: P.TREE_R, h: P.TREE_H, kind: 'road', legal: true });
    }
    planRevalidate();
    planSave();
    planRefresh();
  }

  /* 重新判定每棵树的合法性（拖动后 / 载入后）：非法的不计入统计，地图上显红。
     按树自己的来路判定：行道树位允许离楼 2 m，空地树要 6 m（见 plan.js 的 legal） */
  function planRevalidate() {
    var ctx = planCtx();
    for (var i = 0; i < state.planTrees.length; i++) {
      var t = state.planTrees[i];
      t.legal = ctx ? ctx.legal(t.x, t.y, t.kind || 'road').ok : true;
    }
  }

  /* localStorage 持久化：file:// 下部分浏览器会禁，禁了就静默降级成内存 */
  function planSave() {
    var P = planAPI();
    if (!P) { return; }
    try { window.localStorage.setItem(P.STORE_KEY, P.serialize(state.planTrees)); } catch (e) { /* 忽略 */ }
  }

  function planLoad() {
    if (state.planLoaded) { return; }
    state.planLoaded = true;
    var P = planAPI();
    if (!P) { return; }
    var list = [];
    try { list = P.parse(window.localStorage.getItem(P.STORE_KEY)); } catch (e) { list = []; }
    if (!list.length) { return; }
    var out = [];
    for (var i = 0; i < list.length; i++) { out.push([list[i].x, list[i].y]); }
    planRestoreList(out);
  }

  /* 页签切换 */
  function planSetMode(on) {
    state.planMode = !!on;
    if (el.tabRoute) {
      el.tabRoute.className = 'tab' + (state.planMode ? '' : ' is-on');
      el.tabRoute.setAttribute('aria-selected', state.planMode ? 'false' : 'true');
    }
    if (el.tabPlan) {
      el.tabPlan.className = 'tab' + (state.planMode ? ' is-on' : '');
      el.tabPlan.setAttribute('aria-selected', state.planMode ? 'true' : 'false');
    }
    if (el.paneRoute) { el.paneRoute.hidden = state.planMode; }
    if (el.panePlan) { el.panePlan.hidden = !state.planMode; }
    if (state.planMode) {
      // 规划只在平面视图：从立体进来就先退回平面
      if (window.MAP && window.MAP.isIso && window.MAP.isIso()) { setViewIso(false); }
      planCtx();
      planLoad();
      planRevalidate();
      planSay(state.planTrees.length
        ? '已载入上次的 ' + state.planTrees.length + ' 棵树（可撤销 / 清空）。'
        : '点地图空地种树；点「优化」让系统挑 20 个最划算的点位。');
    }
    render();
  }

  /* 当前帧的三个数字：树荫面积 / 路网阴凉占比（含树）/ 阴凉路段分钟 */
  function planMetrics() {
    var ctx = planCtx();
    if (!ctx) { return null; }
    return { cur: ctx.measure(state.planTrees, state.frame), base: ctx.measure([], state.frame) };
  }

  var PLAN_TAB_NOTE = '规划模式只在平面视图：先点「平面」或切回「路线对比」页签。';

  function updatePlanPanel() {
    var P = planAPI();
    var n = state.planTrees.length;
    var trees = n * (P ? P.COST_PER_TREE : 3000);
    if (el.planCount) { el.planCount.textContent = n + ' 棵'; }
    if (el.planCost) { el.planCost.textContent = trees.toLocaleString('zh-CN'); }
    if (el.planWan) { el.planWan.textContent = (trees / 10000).toFixed(1); }

    var m = planMetrics();
    if (m) {
      if (el.planArea) { el.planArea.textContent = String(Math.round(m.cur.areaM2)); }
      if (el.planRatio) { el.planRatio.textContent = (m.cur.ratio * 100).toFixed(1); }
      if (el.planMinutes) { el.planMinutes.textContent = m.cur.minutes.toFixed(1); }
      if (el.planBaseline) {
        el.planBaseline.textContent = '建筑阴影基线 ' + (m.base.ratio * 100).toFixed(1) + '%';
      }
    }
    if (el.planUndo) { el.planUndo.disabled = !state.planUndo.length; }
    if (el.planClear) { el.planClear.disabled = n === 0 && !state.planPending.length; }
    if (el.planPlantAll) { el.planPlantAll.disabled = !state.planPending.length; }
  }

  /* 规划面板改动后统一重画（地图 + 面板） */
  function planRefresh() {
    render();
    if (state.planMode) { updatePlanPanel(); }
  }

  /* ---------- 指针交互 ---------- */

  function planPx(ev) {
    var canvas = el.canvas;
    var rect = canvas.getBoundingClientRect();
    return [ev.clientX - rect.left, ev.clientY - rect.top];
  }

  /* 屏幕命中：14 px 内算点中某棵规划树 */
  function planTreeAt(sx, sy) {
    if (!window.MAP || !window.MAP.toScreen) { return -1; }
    var best = -1, bestD = 14;
    for (var i = 0; i < state.planTrees.length; i++) {
      var s = window.MAP.toScreen(state.planTrees[i].x, state.planTrees[i].y);
      if (!s) { continue; }
      var d = Math.sqrt(Math.pow(s[0] - sx, 2) + Math.pow(s[1] - sy, 2));
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function planWorld(ev) {
    var canvas = el.canvas;
    if (!canvas || !window.MAP || !window.MAP.toWorld) { return null; }
    var p = planPx(ev);
    return window.MAP.toWorld(p[0], p[1]);
  }

  function planPlace(wx, wy) {
    var ctx = planCtx(), P = planAPI();
    if (!ctx || !P) { return; }
    // 手动种的树按「行道树」那套较宽的规则判（离楼 2 m 即可）：校园里贴墙补一行树是常规做法
    var legal = ctx.legal(wx, wy, 'road');
    if (!legal.ok) { planSay('这里种不了：' + legal.reason + '。'); return; }
    planSnapshot();
    state.planTrees.push({
      x: Math.round(wx * 10) / 10, y: Math.round(wy * 10) / 10,
      r: P.TREE_R, h: P.TREE_H, kind: 'road', legal: true
    });
    state.planPending = [];
    planSave();
    planRefresh();
    planSay('种下第 ' + state.planTrees.length + ' 棵（' + P.COST_PER_TREE.toLocaleString('zh-CN') + ' 元）。');
  }

  function planDeleteAt(sx, sy) {
    var idx = planTreeAt(sx, sy);
    if (idx < 0) { return; }
    planSnapshot();
    state.planTrees.splice(idx, 1);
    planSave();
    planRefresh();
    planSay('删掉一棵，剩 ' + state.planTrees.length + ' 棵。');
  }

  function planUndoLast() {
    if (!state.planUndo.length) { return; }
    var raw = state.planUndo.pop();
    var list = [];
    try { list = JSON.parse(raw) || []; } catch (e) { list = []; }
    planRestoreList(list);
    planSay('已撤销。');
  }

  function planClear() {
    if (!state.planTrees.length && !state.planPending.length) { return; }
    planSnapshot();
    state.planTrees = [];
    state.planPending = [];
    state.planOptimized = null;
    if (el.planRankBlock) { el.planRankBlock.hidden = true; }
    if (el.planRank) { el.planRank.innerHTML = ''; }
    planSave();
    planRefresh();
    planSay('已清空。');
  }

  /* ---------- 优化：选 20 个「每万元遮阴分钟」最高的点位 ---------- */
  function planOptimize() {
    var ctx = planCtx();
    if (!ctx || state.planBusy) { return; }
    state.planBusy = true;
    if (el.planOptimize) { el.planOptimize.disabled = true; }
    if (el.planProgress) { el.planProgress.hidden = false; }
    if (el.planProgressBar) { el.planProgressBar.style.width = '0%'; }
    if (el.planProgressText) { el.planProgressText.textContent = '0 / 20'; }
    planSay('正在跑 31 帧 × 候选池……');
    var t0 = (window.performance && window.performance.now) ? window.performance.now() : Date.now();

    // 先让浏览器把「计算中」画出来，再同步算（实测约 0.2 s，桌面上不用 Worker）
    window.setTimeout(function () {
      var res = null;
      try {
        res = ctx.optimize({
          count: 20,
          areaFrame: state.frame,
          onProgress: function (k, n) {
            if (el.planProgressBar) { el.planProgressBar.style.width = (k / n * 100).toFixed(0) + '%'; }
            if (el.planProgressText) { el.planProgressText.textContent = k + ' / ' + n; }
          }
        });
      } catch (e) {
        planSay('优化失败：' + (e && e.message ? e.message : e));
      }
      var ms = ((window.performance && window.performance.now) ? window.performance.now() : Date.now()) - t0;
      state.planBusy = false;
      if (el.planOptimize) { el.planOptimize.disabled = false; }
      if (el.planProgress) { el.planProgress.hidden = true; }

      if (!res || !res.picks.length) { planSay('没找到有效点位（数据异常？）。'); return; }
      state.planOptimized = res;
      var P = planAPI();
      state.planPending = [];
      for (var i = 0; i < res.picks.length; i++) {
        var p = res.picks[i];
        state.planPending.push({
          x: p.x, y: p.y, rank: p.rank, gainMinutes: p.gainMinutes, kind: p.kind,
          desc: P.describe(p.x, p.y, BUILDINGS)
        });
      }
      planRenderRank(res);
      planRefresh();
      planSay('选出 ' + res.picks.length + ' 个点位：日累计 +' + res.totalMinutes.toFixed(0) +
        ' 分钟阴凉路段，每万元 ' + res.perWanMinutes.toFixed(1) + ' 分钟（' + Math.round(ms) + ' ms 算完）。');
    }, 30);
  }

  function planRenderRank(res) {
    if (!el.planRank) { return; }
    el.planRank.innerHTML = '';
    var perWanEach = (planAPI() ? planAPI().COST_PER_TREE : 3000) / 10000;
    for (var i = 0; i < res.picks.length; i++) {
      var p = res.picks[i];
      var li = document.createElement('li');
      var no = document.createElement('i');
      no.textContent = String(p.rank);
      var nm = document.createElement('b');
      nm.textContent = p.desc || planAPI().describe(p.x, p.y, BUILDINGS);
      var gm = document.createElement('span');
      gm.textContent = '+' + p.gainMinutes.toFixed(1) + ' 分/日';
      var pw = document.createElement('em');
      pw.textContent = (p.gainMinutes / perWanEach).toFixed(1) + ' 分/万元';
      li.appendChild(no); li.appendChild(nm); li.appendChild(gm); li.appendChild(pw);
      el.planRank.appendChild(li);
    }
    if (el.planRankBlock) { el.planRankBlock.hidden = false; }
    if (el.planRankSum) {
      el.planRankSum.textContent = '合计 +' + res.totalMinutes.toFixed(0) + ' 分/日 · ' + res.budgetWan.toFixed(0) + ' 万元';
    }
    if (el.planRankNote) {
      el.planRankNote.textContent = '每万元 = 日累计阴凉分钟 ÷ ' + res.budgetWan.toFixed(1) +
        ' 万元；按边际增益排序，两两 ≥ 30 m。点「一键全种下」后可继续逐棵拖动调位置。';
    }
  }

  function planPlantAll() {
    if (!state.planPending.length) { return; }
    var P = planAPI(), ctx = planCtx();
    if (!P) { return; }
    planSnapshot();
    var added = 0;
    for (var i = 0; i < state.planPending.length; i++) {
      var p = state.planPending[i];
      // 按点位自己的来路判（行道树位 / 空地两套规则不同，见 plan.js 的 legal）
      if (ctx && !ctx.legal(p.x, p.y, p.kind || 'road').ok) { continue; }
      state.planTrees.push({ x: p.x, y: p.y, r: P.TREE_R, h: P.TREE_H, kind: p.kind || 'road', legal: true });
      added++;
    }
    state.planPending = [];
    planSave();
    planRefresh();
    planSay('种下 ' + added + ' 棵，现在可以逐棵拖动对比。');
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
    el.pairA = $('pair-a');
    el.pairB = $('pair-b');
    el.viewPlan = $('view-plan');
    el.viewIso = $('view-iso');
    el.compass = $('compass');
    el.compassNeedle = $('compass-needle');
    // ---- 治理侧：种树规划 ----
    el.tabRoute = $('tab-route');
    el.tabPlan = $('tab-plan');
    el.paneRoute = $('pane-route');
    el.panePlan = $('pane-plan');
    el.planCount = $('plan-count');
    el.planArea = $('plan-area');
    el.planRatio = $('plan-ratio');
    el.planMinutes = $('plan-minutes');
    el.planCost = $('plan-cost');
    el.planWan = $('plan-wan');
    el.planBaseline = $('plan-baseline');
    el.planOptimize = $('plan-optimize');
    el.planPlantAll = $('plan-plant-all');
    el.planUndo = $('plan-undo');
    el.planClear = $('plan-clear');
    el.planProgress = $('plan-progress');
    el.planProgressBar = $('plan-progress-bar');
    el.planProgressText = $('plan-progress-text');
    el.planMsg = $('plan-msg');
    el.planRank = $('plan-rank');
    el.planRankBlock = $('plan-rank-block');
    el.planRankSum = $('plan-rank-sum');
    el.planRankNote = $('plan-rank-note');

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
    updatePairButtons();

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
    syncViewButtons(window.MAP && window.MAP.isIso ? window.MAP.isIso() : false);
    // 深链接：#iso 直接打开立体视图（截图 / 分享 / 答辩现场都能一条链接直开）
    if (window.location && CORE.wantsIsoView && CORE.wantsIsoView(window.location.hash)) {
      setViewIso(true);
    }
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