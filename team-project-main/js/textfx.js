/* ============================================================
   凉径 ShadeRoute Lite —— 动态文本效果库（新增文件，独立可用）
   零依赖、无 import/export、file:// 双击可跑、不发任何请求。
   所有效果都必须遵守 prefers-reduced-motion：
     用户关了动效 -> 直接落终值，不留半截动画，也不留 JS 定时器。
   ============================================================ */

window.TEXTFX = (function () {
  'use strict';

  var raf = (typeof window.requestAnimationFrame === 'function')
    ? function (f) { return window.requestAnimationFrame(f); }
    : function (f) { return setTimeout(function () { f(Date.now()); }, 16); };
  var caf = (typeof window.cancelAnimationFrame === 'function')
    ? function (h) { return window.cancelAnimationFrame(h); }
    : function (h) { return clearTimeout(h); };

  function reduced() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }
  function setText(el, s) {
    if (!el) { return; }
    if ('textContent' in el) { el.textContent = s; }
    else { el.innerText = s; }   /* 兼容测试里的极简 DOM stub */
  }
  function setHTML(el, s) {
    if (!el) { return; }
    if ('innerHTML' in el) { el.innerHTML = s; }
    else { el._html = s; }
  }

  /* ---------- 1. 打字机 ---------- */
  function typewriter(el, text, opts) {
    opts = opts || {};
    text = String(text == null ? '' : text);
    if (reduced() || opts.speed === 0) {
      setText(el, text);
      if (opts.onDone) { opts.onDone(); }
      return { stop: function () {} };
    }
    var speed = opts.speed || 42;           // ms/字
    var delay = opts.delay || 0;
    var caret = opts.caret === false ? '' : (opts.caret || '▌');
    var i = 0, timer = null, done = false;

    function tick() {
      var shown = text.slice(0, i);
      setHTML(el, escapeHtml(shown) + '<span class="tx-caret">' + caret + '</span>');
      if (i >= text.length) {
        if (!done) {
          done = true;
          setHTML(el, escapeHtml(text));   // 收尾把光标摘掉，避免停在闪烁态
          if (opts.onDone) { opts.onDone(); }
        }
        return;
      }
      i += 1;
      timer = setTimeout(tick, speed);
    }
    timer = setTimeout(tick, delay);
    return {
      stop: function () { if (timer) { clearTimeout(timer); } },
      skip: function () { this.stop(); setText(el, text); if (opts.onDone) { opts.onDone(); } }
    };
  }

  /* ---------- 2. 乱码解码（scramble / decode） ---------- */
  var POOL = '零壹贰叁肆伍陆柒捌玖拾百年日月火水木金土凉径阴影路线☼☾';
  function scramble(el, finalText, opts) {
    opts = opts || {};
    finalText = String(finalText == null ? '' : finalText);
    if (reduced()) { setText(el, finalText); if (opts.onDone) { opts.onDone(); } return { stop: function () {} }; }
    var pool = opts.pool || POOL;
    var stepMs = opts.stepMs || 26;
    var revealPer = opts.revealPer || 2;    // 每 N 帧多确定 1 个字符
    var frame = 0, locked = 0, timer = null;
    var chars = finalText.split('');

    function rnd() { return pool.charAt(Math.floor(Math.random() * pool.length)); }
    function tick() {
      var out = '';
      for (var k = 0; k < chars.length; k++) {
        var c = chars[k];
        if (k < locked || c === ' ' || c === '·' || c === '.') { out += c; }
        else { out += rnd(); }
      }
      setText(el, out);
      frame += 1;
      if (frame % revealPer === 0) { locked += 1; }
      if (locked >= chars.length) {
        clearInterval(timer);
        setText(el, finalText);
        if (opts.onDone) { opts.onDone(); }
        return;
      }
    }
    timer = setInterval(tick, stepMs);
    return { stop: function () { clearInterval(timer); }, skip: function () { this.stop(); setText(el, finalText); } };
  }

  /* ---------- 3. 数字滚动 ---------- */
  /* opts: {from, dur, digits, prefix, suffix, decimals}；reduced 或 dur=0 直接落终值 */
  function countUp(el, to, opts) {
    opts = opts || {};
    var target = (typeof to === 'number' && isFinite(to)) ? to : null;
    var digits = opts.digits == null ? 1 : opts.digits;
    var pre = opts.prefix || '', suf = opts.suffix || '';
    if (target === null) { setText(el, '--'); return { stop: function () {} }; }
    var render = function (v) { setText(el, pre + v.toFixed(digits) + suf); };
    if (reduced() || !opts.dur) { render(target); return { stop: function () {} }; }

    var from = opts.from == null ? 0 : opts.from;
    var t0 = null, handle = null;
    function step(ts) {
      if (t0 === null) { t0 = ts || Date.now(); }
      var p = ((ts || Date.now()) - t0) / opts.dur;
      if (p >= 1) { render(target); return; }
      var eased = 1 - Math.pow(1 - p, 3);      // easeOutCubic
      render(from + (target - from) * eased);
      handle = raf(step);
    }
    handle = raf(step);
    return { stop: function () { if (handle) { caf(handle); } } };
  }

  /* ---------- 4. 文案轮播（提示语轮换，不打断阅读） ---------- */
  function cycle(el, list, opts) {
    opts = opts || {};
    list = list || [];
    if (!list.length) { return { stop: function () {} }; }
    if (reduced() || opts.rotate === false) { setText(el, list[0]); return { stop: function () {} }; }
    var i = 0, gap = opts.gap || 4200, timer = null;
    timer = setInterval(function () {
      i = (i + 1) % list.length;
      if (opts.fade) { fadeTo(el, list[i], opts.fade); } else { setText(el, list[i]); }
    }, gap);
    return { stop: function () { clearInterval(timer); } };
  }
  function fadeTo(el, text, ms) {
    var steps = Math.max(1, Math.round(ms / 40)), k = 0;
    el.style.opacity = '1';
    var t = setInterval(function () {
      k += 1;
      if (k >= steps) { clearInterval(t); setText(el, text); el.style.opacity = '1'; return; }
      el.style.opacity = (k < steps / 2) ? String(1 - k / (steps / 2)) : String((k - steps / 2) / (steps / 2));
      if (k === Math.round(steps / 2)) { setText(el, text); }
    }, 40);
  }

  /* ---------- 5. 进场可见后再触发（避免首屏堆动画） ---------- */
  function whenInView(el, fn, rootMargin) {
    if (!el) { return; }
    var IO = window.IntersectionObserver;
    if (!IO) { fn(); return; }
    try {
      var io = new IO(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) { fn(); io.disconnect(); break; }
        }
      }, { rootMargin: rootMargin || '0px 0px -10% 0px' });
      io.observe(el);
    } catch (e) { fn(); }
  }

  /* ---------- 6. 横向跑马灯（楼名滚动条） ---------- */
  /* 用 transform 位移，不用 scrollLeft；reduced 时静止显示前几项 */
  function marquee(track, opts) {
    opts = opts || {};
    if (!track) { return { stop: function () {} }; }
    var items = opts.items || [];
    track.innerHTML = '';
    if (!items.length) { return { stop: function () {} }; }
    var frag = [];
    for (var i = 0; i < items.length; i++) {
      var s = document.createElement('span');
      s.className = 'mq-item';
      s.textContent = items[i];
      track.appendChild(s);
      frag.push(s);
    }
    if (reduced()) {
      track.className += ' mq-static';
      for (var j = opts.staticCount || 8; j < frag.length; j++) { frag[j].style.display = 'none'; }
      return { stop: function () {} };
    }
    /* 复制一份做无缝衔接 */
    var n = frag.length;
    for (var k = 0; k < n; k++) { track.appendChild(frag[k].cloneNode(true)); }
    var speed = opts.speedPxPerSec || 46;
    var x = 0, half = 0, last = null, handle = null;
    function loop(ts) {
      if (last === null) { last = ts; }
      var dt = Math.min(0.1, (ts - last) / 1000);
      last = ts;
      if (!half) { half = track.scrollWidth / 2 || track.offsetWidth / 2; }
      x -= speed * dt;
      if (half && -x >= half) { x += half; }
      track.style.transform = 'translate3d(' + x.toFixed(1) + 'px,0,0)';
      handle = raf(loop);
    }
    handle = raf(loop);
    return {
      stop: function () { if (handle) { caf(handle); } },
      setSpeed: function (v) { speed = v; }
    };
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return {
    reduced: reduced,
    typewriter: typewriter,
    scramble: scramble,
    countUp: countUp,
    cycle: cycle,
    whenInView: whenInView,
    marquee: marquee,
    escapeHtml: escapeHtml
  };
})();
