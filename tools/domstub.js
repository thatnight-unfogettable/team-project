/* ============================================================
   tools/domstub.js —— 按真实 HTML 建树的极简 DOM 桩（Node/vm 用）
   只服务 tools/smoke-green.js 的界面集成断言，不参与浏览器运行。

   为什么解析真实 HTML 而不是手搓 id 列表：
     手搓的骨架会和页面脱节，脱节的后果不是测试报错，而是**测试全绿但页面是坏的**。
     比如面板要插到 #card-fast 所在 section 的后面、入口页要在 section 里找 h2 ——
     这些父子/兄弟关系只有照真 HTML 建树才测得到。
   只覆盖本站实际用到的 API：
     createElement / createTextNode / getElementById / querySelector('#id'|'tag'|'.cls'|'A B')
     appendChild / insertBefore / removeChild / setAttribute / getBoundingClientRect
     textContent / innerHTML(赋值即清空) / children / parentNode / nextSibling / firstChild
     value / checked / type / disabled 等 HTML 属性同步成同名 property
     dispatch(type) 是测试专用：触发 change/click，不模拟事件冒泡。
   ============================================================ */

'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var VOID = {};
['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'keygen', 'link', 'meta',
  'param', 'source', 'track', 'wbr'].forEach(function (t) { VOID[t] = 1; });

/* 这些属性在真实 DOM 里同时也是同名 property，脚本直接读 property */
var PROP_KEYS = ['value', 'type', 'name', 'max', 'min', 'step', 'href', 'title', 'target',
  'rel', 'placeholder', 'id', 'disabled', 'checked', 'selected'];

function makeCtxStub() {
  var m = [1, 0, 0, 1, 0, 0], stack = [], c = { texts: [] };
  c.font = '10px sans-serif';
  c.fillStyle = c.strokeStyle = '';
  c.lineWidth = 1; c.globalAlpha = 1;
  c.textAlign = c.textBaseline = c.lineJoin = '';
  c.setTransform = function (a, b, cc, d, e, f) { m = [a, b, cc, d, e, f]; };
  c.save = function () { stack.push(m.slice()); };
  c.restore = function () { if (stack.length) { m = stack.pop(); } };
  ['clearRect', 'fillRect', 'strokeRect', 'beginPath', 'moveTo', 'lineTo', 'closePath',
    'fill', 'stroke', 'drawImage', 'arc', 'setLineDash', 'quadraticCurveTo', 'bezierCurveTo',
    'rect', 'clip', 'translate', 'scale', 'rotate'].forEach(function (n) {
      c[n] = function () {};
    });
  c.fillText = c.strokeText = function (s, x, y) {
    c.texts.push({ n: String(s), dev: [x * m[0] + m[4], y * m[3] + m[5]], a: m[0], font: String(c.font) });
  };
  c.measureText = function (s) { return { width: String(s).length * 6 }; };
  c.createLinearGradient = c.createRadialGradient = function () {
    return { addColorStop: function () {} };
  };
  return c;
}

function parseAttrs(raw) {
  var out = {}, re = /([a-zA-Z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'`=<>]+))|([a-zA-Z_:][\w:.-]+)/g, m;
  while ((m = re.exec(raw)) !== null) {
    var k, v;
    if (m[1] !== undefined) {
      k = m[1];
      v = m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : (m[5] !== undefined ? m[5] : ''));
    } else {
      k = m[6]; v = '';                     // 布尔属性：checked / disabled
    }
    out[k] = v;
  }
  return out;
}

function buildStub(opts) {
  opts = opts || {};
  var ROOT = opts.root;
  var CSS_W = opts.width || 1200, CSS_H = opts.height || 800;
  var REG = {};

  function findDesc(node, tagName) {
    for (var i = 0; i < node.children.length; i++) {
      var ch = node.children[i];
      if (ch.tagName === String(tagName).toUpperCase()) { return ch; }
      var hit = findDesc(ch, tagName);
      if (hit) { return hit; }
    }
    return null;
  }
  function findClass(node, cls) {
    for (var i = 0; i < node.children.length; i++) {
      var ch = node.children[i];
      if ((' ' + ch.className + ' ').indexOf(' ' + cls + ' ') >= 0) { return ch; }
      var hit = findClass(ch, cls);
      if (hit) { return hit; }
    }
    return null;
  }
  function qs(node, sel) {
    sel = String(sel || '').trim();
    if (!sel || !node) { return null; }
    if (sel.indexOf(' ') >= 0) {                       /* 只支持 "A B"：一个祖先 + 一个后代 */
      var parts = sel.split(/\s+/);
      var a = qs(node, parts[0]);
      return a ? findDesc(a, parts[parts.length - 1]) : null;
    }
    if (sel.charAt(0) === '#') { return REG[sel.slice(1)] || null; }
    if (sel.charAt(0) === '.') { return findClass(node, sel.slice(1)); }
    return findDesc(node, sel);
  }

  function mkEl(tag, attrs) {
    attrs = attrs || {};
    var node = {
      tagName: String(tag || 'div').toUpperCase(), className: '',
      children: [], attributes: {}, _ls: {}, _text: '',
      style: { setProperty: function (k, v) { this[k] = v; } },
      parentNode: null, parentElement: null,
      width: 0, height: 0, disabled: false, checked: false, selected: false,
      value: '', type: '', name: '', id: '', href: '', title: '', max: '', min: '', step: '',
      appendChild: function (ch) {
        this.children.push(ch); ch.parentNode = this; ch.parentElement = this;
        if (ch.id) { REG[ch.id] = ch; }
        return ch;
      },
      insertBefore: function (ch, ref) {
        var i = ref ? this.children.indexOf(ref) : -1;
        if (i < 0) { return this.appendChild(ch); }
        this.children.splice(i, 0, ch);
        ch.parentNode = this; ch.parentElement = this;
        if (ch.id) { REG[ch.id] = ch; }
        return ch;
      },
      removeChild: function (ch) {
        var i = this.children.indexOf(ch);
        if (i >= 0) { this.children.splice(i, 1); ch.parentNode = null; }
        return ch;
      },
      setAttribute: function (k, v) {
        this.attributes[k] = String(v);
        if (k === 'id') { this.id = String(v); REG[this.id] = this; }
        else if (k === 'class') { this.className = String(v); }
        else if (PROP_KEYS.indexOf(k) >= 0) { this[k] = String(v); }
      },
      getAttribute: function (k) { return this.attributes[k]; },
      hasAttribute: function (k) { return this.attributes[k] !== undefined; },
      getBoundingClientRect: function () { return { width: CSS_W, height: CSS_H, left: 0, top: 0 }; },
      querySelector: function (sel) { return qs(node, sel); },
      querySelectorAll: function (sel) {
        /* 本站只需要"有没有"，不要求全部；返回单个命中包成数组 */
        var hit = qs(node, sel);
        return hit ? [hit] : [];
      },
      addEventListener: function (t, f) { (this._ls[t] = this._ls[t] || []).push(f); },
      removeEventListener: function (t, f) {
        var a = this._ls[t] || [], i = a.indexOf(f);
        if (i >= 0) { a.splice(i, 1); }
      },
      dispatch: function (t, ev) {
        var list = (this._ls[t] || []).slice(), self = this;
        for (var i = 0; i < list.length; i++) { list[i].call(self, ev || { type: t }); }
      }
    };
    Object.defineProperty(node, 'nextSibling', {
      get: function () {
        var p = this.parentNode;
        if (!p) { return null; }
        var i = p.children.indexOf(this);
        return i >= 0 ? (p.children[i + 1] || null) : null;
      }
    });
    Object.defineProperty(node, 'firstChild', { get: function () { return this.children[0] || null; } });
    Object.defineProperty(node, 'textContent', {
      get: function () {
        if (this.children.length) {
          var s = this._text;
          for (var i = 0; i < this.children.length; i++) { s += this.children[i].textContent; }
          return s;
        }
        return this._text;
      },
      set: function (v) { this._text = String(v); this.children.length = 0; this._html = ''; }
    });
    Object.defineProperty(node, 'innerHTML', {
      get: function () { return this._html || ''; },
      set: function (v) { this._html = String(v); this.children.length = 0; this._text = ''; }
    });

    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      node.attributes[k] = v;
      if (k === 'id') { node.id = v; REG[v] = node; }
      else if (k === 'class') { node.className = v; }
      else if (v === '' && (k === 'checked' || k === 'disabled' || k === 'selected')) { node[k] = true; }
      else if (PROP_KEYS.indexOf(k) >= 0) { node[k] = v; }
    });
    return node;
  }

  function mkCanvas(attrs) {
    var cv = mkEl('canvas', attrs);
    cv._c = makeCtxStub();
    cv.getContext = function () { return cv._c; };
    return cv;
  }

  /* ---------- 建树 ---------- */
  var html = fs.readFileSync(path.join(ROOT, opts.html), 'utf8');
  var doc = mkEl('html');
  var stack = [doc];
  var re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"])*)>|([^<]+)/gi;
  var m, scriptBodies = 0;
  while ((m = re.exec(html)) !== null) {
    if (m[0].charAt(0) !== '<') {
      var t = m[0].replace(/\s+/g, ' ');
      if (t.trim()) { stack[stack.length - 1]._text += t; }
      continue;
    }
    if (m[0].charAt(1) === '!' || m[0].charAt(1) === '?' || m[0].charAt(1) === '/') {
      if (m[0].charAt(1) === '/') {                     /* 闭合标签 */
        var want = String(m[1]).toUpperCase();
        for (var si = stack.length - 1; si > 0; si--) {
          if (stack[si].tagName === want) { stack.length = si; break; }
        }
      }
      continue;                                          /* 注释 / doctype */
    }
    var tag = String(m[2]).toLowerCase();
    var attrs = parseAttrs(m[3] || '');
    var raw = m[3] || '';
    var selfClose = /\/\s*$/.test(raw);
    var isRawText = tag === 'script' || tag === 'style';
    var node = tag === 'canvas' ? mkCanvas(attrs) : mkEl(tag, attrs);
    stack[stack.length - 1].appendChild(node);
    if (isRawText) {                                     /* 脚本/样式体不建树 */
      scriptBodies += 1;
      var close = tag === 'script' ? '</script>' : '</style>';
      var at = html.toLowerCase().indexOf(close, re.lastIndex);
      if (at > 0) { re.lastIndex = at + close.length; }
      continue;
    }
    if (!VOID[tag] && !selfClose) { stack.push(node); }
  }
  var body = qs(doc, 'body');
  if (!body) { body = mkEl('body'); doc.appendChild(body); }
  body.id = 'body'; REG.body = body;
  doc.body = body;

  doc.createElement = function (t) {
    return String(t).toLowerCase() === 'canvas' ? mkCanvas() : mkEl(t);
  };
  doc.createTextNode = function (s) { var n = mkEl('#text'); n._text = String(s); return n; };
  doc.getElementById = function (id) { return REG[id] || null; };
  doc.querySelector = function (sel) { return qs(doc, sel); };
  doc.querySelectorAll = function (sel) { var hit = qs(doc, sel); return hit ? [hit] : []; };
  doc.readyState = 'complete';
  doc.addEventListener = function (t, f) { (doc._ls[t] = doc._ls[t] || []).push(f); };
  doc.removeEventListener = function (t, f) {
    var a = doc._ls[t] || [], i = a.indexOf(f);
    if (i >= 0) { a.splice(i, 1); }
  };
  doc.dispatch = function (t, ev) {
    var list = (doc._ls[t] || []).slice();
    for (var i = 0; i < list.length; i++) { list[i].call(doc, ev || { type: t }); }
  };

  var W = { console: console };
  W.window = W; W.globalThis = W;
  W.document = doc;
  W.devicePixelRatio = opts.dpr || 1;
  W.innerWidth = CSS_W; W.innerHeight = CSS_H;
  W.navigator = { userAgent: 'node-domstub', language: 'zh-CN' };
  /* 默认按"减少动态效果"跑：动效直接落终值，测试里不留挂起的动画循环 */
  W.matchMedia = function (q) {
    return { matches: opts.reducedMotion === false ? false : /prefers-reduced-motion/.test(q), media: q };
  };
  W.tickers = { raf: 0 };
  var vnow = 0;
  /* 同步执行回调，让 countUp 一类动画在一次调用内收敛；
     句柄固定返回 0，免得上层把"已排队"当成"还在排队"而永久跳过重算。 */
  W.requestAnimationFrame = function (f) { vnow += 16; W.tickers.raf += 1; f(vnow); return 0; };
  W.cancelAnimationFrame = function () {};
  W.__timers = { timeout: 0, interval: 0 };
  W.setTimeout = function () { W.__timers.timeout += 1; return W.__timers.timeout; };
  W.clearTimeout = function () {};
  W.setInterval = function () { W.__timers.interval += 1; return W.__timers.interval; };
  W.clearInterval = function () {};
  W.MutationObserver = opts.mutationObserver === false ? undefined : function (cb) {
    this.observe = function () {};
    this.disconnect = function () {};
    this.takeRecords = function () { return []; };
    this._cb = cb;
  };
  if (opts.localStorage !== false) {
    var mem = {};
    W.localStorage = {
      getItem: function (k) { return mem[k] === undefined ? null : mem[k]; },
      setItem: function (k, v) { mem[k] = String(v); },
      removeItem: function (k) { delete mem[k]; }
    };
  }
  W.__winListeners = [];
  W.addEventListener = function (t) { W.__winListeners.push(t); };
  W.removeEventListener = function () {};
  vm.createContext(W);

  var out = {
    W: W, doc: doc, REG: REG, mkEl: mkEl, mkCanvas: mkCanvas, qs: qs,
    ids: Object.keys(REG),
    panel: REG.panel || null,
    blockFast: REG['card-fast'] ? REG['card-fast'].parentNode : null,
    rawTextTags: scriptBodies,
    htmlTags: (html.match(/<[a-zA-Z]/g) || []).length
  };
  (opts.files || []).forEach(function (rel) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), W, { filename: rel });
  });
  out.load = function (rel) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), W, { filename: rel });
  };
  out.fireReady = function () { doc.dispatch('DOMContentLoaded'); };
  return out;
}

module.exports = { build: buildStub, ctxStub: makeCtxStub };
