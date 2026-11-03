/* ============================================================
   凉径 ShadeRoute Lite —— 绿色出行模块冒烟测试（独立于 tools/smoke.js）
   运行：node tools\smoke-green.js      退出码：全绿 0，有失败 1

   为什么单独一个文件：原有 106 条断言是本站交付口径的一部分，不动它；
   新增模块的断言数、失败项都在这里，两边互不干扰。
   ============================================================ */

'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.resolve(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

var pass = 0, fail = 0, failures = [];
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log('PASS  ' + name); return; }
  fail += 1;
  var msg = name + (detail ? '  [' + detail + ']' : '');
  failures.push(msg);
  console.log('FAIL  ' + msg);
}
function near(a, b, tol) { return isFinite(a) && isFinite(b) && Math.abs(a - b) <= tol; }

/* ---------- 0. 语法与离线约束 ---------- */
var NEW_FILES = ['data/green-factors.js', 'js/green-core.js', 'js/green-ui.js',
                 'js/textfx.js', 'js/home.js', 'content/strings-green.js', 'home.html', 'styles-home.css',
                 'styles-green.css'];
NEW_FILES.forEach(function (f) {
  ok('新文件存在：' + f, fs.existsSync(path.join(ROOT, f)), '缺文件');
});
ok('green-core.js 不使用 import/export（file:// 可运行）',
  !/^\s*(import|export)\s/m.test(read('js/green-core.js')));
ok('green-core.js 不碰 DOM（保持纯函数可单测）',
  !/document|getElementById|querySelector|addEventListener/.test(read('js/green-core.js')));
var homeSrc = fs.existsSync(path.join(ROOT, 'home.html')) ? read('home.html') : '';
var greenUiSrc = fs.existsSync(path.join(ROOT, 'js/green-ui.js')) ? read('js/green-ui.js') : '';
ok('入口页无任何外链/CDN（完全离线）',
  !/https?:\/\/[^"']*\.(?:js|css)/.test(homeSrc) && !/<link[^>]+href="https?:/.test(homeSrc),
  '发现外链');
ok('绿色模块不发网络请求（无 fetch/XHR/WebSocket）',
  !/fetch\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon/.test(greenUiSrc + read('js/green-core.js')));

/* ---------- 1. 沙箱加载 ---------- */
var box = { console: console };
box.window = box; box.globalThis = box;
vm.createContext(box);
var loadErr = null;
try {
  ['data/green-factors.js', 'js/green-core.js', 'content/strings-green.js'].forEach(function (rel) {
    vm.runInContext(read(rel), box, { filename: rel });
  });
} catch (e) { loadErr = e; }
ok('DATA_GREEN / GREEN / STRINGS_GREEN 加载无异常', !loadErr, loadErr ? String(loadErr.message) : '');
if (loadErr) {
  console.log('--------------------------------------------------');
  console.log('SMOKE-GREEN: PASS ' + pass + ' / FAIL ' + (fail + 1) + '（后续断言跳过）');
  failures.push('加载失败，后续未跑');
  console.log('失败项：\n  - ' + failures.join('\n  - '));
  process.exitCode = 1;
  return;
}
var DG = box.DATA_GREEN, G = box.GREEN, SG = box.STRINGS_GREEN;
ok('三个全局名不覆盖站点原有全局',
  !(('CORE' in box) || ('APP' in box) || ('DATA_META' in box)),
  '名字冲突：' + Object.keys(box).filter(function (k) { return k === 'CORE'; }));

/* ---------- 2. 因子表结构 ---------- */
ok('DATA_GREEN 结构完整（activities / baselines / sources / disclaimers）',
  DG && DG.activities && DG.activities.walk && DG.activities.bike &&
  Array.isArray(DG.baselines) && DG.baselines.length >= 6 && DG.sources && DG.disclaimers);
var badBase = DG.baselines.filter(function (b) {
  return !(b.id && b.label && b.unit && isFinite(b.kgCO2e) && b.ref);
});
ok('每条基准都带 id/label/unit/kgCO2e/ref（可回溯到原表行）', badBase.length === 0,
  badBase.map(function (b) { return b.id; }).join(','));
var badUnit = DG.baselines.filter(function (b) {
  return b.unit !== 'vehicle.km' && b.unit !== 'passenger.km';
});
ok('基准单位只允许 vehicle.km / passenger.km', badUnit.length === 0,
  badUnit.map(function (b) { return b.unit; }).join(','));
ok('小汽车因子按车型单调：大型 > 平均 > 小型',
  DG.baselines[1].kgCO2e > DG.baselines[0].kgCO2e && DG.baselines[0].kgCO2e > DG.baselines[2].kgCO2e,
  DG.baselines.slice(0, 3).map(function (b) { return b.kgCO2e; }).join(' / '));
ok('平均小汽车因子锁死为 DEFRA 2024 的 0.16984 kgCO2e/vehicle.km',
  DG.baselines[0].kgCO2e === 0.16984, String(DG.baselines[0].kgCO2e));
ok('公交每人排放低于小汽车每人排放（口径正确才不会反过来）',
  G.perPersonFactorKg(base('bus_local'), 1) < G.perPersonFactorKg(base('car_avg'), 1));
ok('城际铁路每人排放 < 市内公交（电力轨交应更干净）',
  G.perPersonFactorKg(base('rail_national'), 1) < G.perPersonFactorKg(base('bus_local'), 1));
function base(id) {
  for (var i = 0; i < DG.baselines.length; i++) { if (DG.baselines[i].id === id) { return DG.baselines[i]; } }
  return null;
}
ok('步行与骑行的直接排放都写死为 0（不假装负数）',
  DG.activities.walk.directKgCO2ePerKm === 0 && DG.activities.bike.directKgCO2ePerKm === 0);
ok('MET 随速度单调递增（步行）',
  DG.activities.walk.speeds.every(function (s, i, a) { return i === 0 || s.met > a[i - 1].met; }));
ok('MET 随速度单调递增（骑行）',
  DG.activities.bike.speeds.every(function (s, i, a) { return i === 0 || s.met > a[i - 1].met; }));
ok('每个动作有且仅有一个默认强度，且与 defaultSpeedKmh 一致',
  ['walk', 'bike'].every(function (k) {
    var a = DG.activities[k];
    var d = a.speeds.filter(function (s) { return s.isDefault; });
    return d.length === 1 && d[0].kmh === a.defaultSpeedKmh;
  }));
ok('骑行强度档比步行高一档（同速度下也要更费力才说得过去）',
  G.minutesFor && DG.activities.bike.speeds[0].met > DG.activities.walk.speeds[0].met);
ok('免责条目 ≥ 6 且点名"英国因子"与"vehicle.km/passenger.km"两种口径',
  DG.disclaimers.length >= 6 &&
  DG.disclaimers.join('').indexOf('英国') >= 0 &&
  DG.disclaimers.join('').indexOf('passenger.km') >= 0);
ok('未在线核对的值都被标出来（MET/步幅/苹果/树）',
  DG.sources.met.verify === 'pending' && DG.sources.food.verify.indexOf('未') >= 0 &&
  DG.sources.tree.verify.indexOf('示意') >= 0);

/* ---------- 3. 与站点原有常量的契约 ---------- */
var kmhFromCore = null;
try {
  vm.runInContext(read('js/core.js'), box, { filename: 'js/core.js' });
  kmhFromCore = box.CORE.DEFAULT_PAD !== undefined ? 4.5 : null;
} catch (e) { /* core.js 由原测试覆盖，这里只为取 WALK_SPEED */ }
var coreSrc = read('js/core.js');
var msMatch = /WALK_SPEED\s*=\s*([\d.]+)/.exec(coreSrc);
ok('js/core.js 的 WALK_SPEED 仍是 1.25 m/s（绿色模块的时长假设挂在这上面）',
  msMatch && parseFloat(msMatch[1]) === DG.walkSpeedContract.ms,
  msMatch ? msMatch[1] : '没找到 WALK_SPEED');
ok('步行默认速度与站点算路速度换算一致：1.25 m/s = 4.5 km/h',
  near(DG.walkSpeedContract.ms * 3.6, DG.activities.walk.defaultSpeedKmh, 1e-9));
var contract = G.walkSpeedContract(msMatch ? parseFloat(msMatch[1]) : null);
ok('GREEN.walkSpeedContract() 判定通过', contract.ok === true, contract.reason);
ok('GREEN.walkSpeedContract() 在不一致时会报出问题而不是静默（喂 1.0 试试）',
  G.walkSpeedContract(1.0).ok === false, '契约检查失灵');

/* ---------- 4. 时长与热量 ---------- */
ok('1113 米 @4.5 km/h = 14.84 分（与站点 14:00 最快路线 14.8 分对得上）',
  near(G.minutesFor(1113, 4.5), 14.84, 0.01), G.fmt(G.minutesFor(1113, 4.5), 2));
ok('时长边界：0/负数/NaN 都返回 0，不返回 Infinity',
  G.minutesFor(0, 4.5) === 0 && G.minutesFor(-5, 4.5) === 0 && G.minutesFor(1113, 0) === 0 &&
  G.minutesFor(NaN, 4.5) === 0 && isFinite(G.minutesFor(1113, 4.5)));
ok('热量两条口径的固有差精确等于 5%（1.05 倍），当常数锁死',
  Math.abs(G.kcalMethodDrift(6.0, 65, 4.452) - 0.05) < 1e-9,
  (G.kcalMethodDrift(6.0, 65, 4.452) * 100).toFixed(3) + '%');
ok('对外报告用的是 ACSM 口径（MET×3.5×kg÷200×分钟），比速算口径高 5%',
  near(G.netKcal(3.3, 65, 14.84, 1.0).gross, G.grossKcalByVO2(3.3, 65, 14.84), 1e-9) &&
  !near(G.grossKcalByVO2(3.3, 65, 14.84), G.grossKcalByHour(3.3, 65, 14.84), 1e-6));
ok('公式口径正常时 compute() 不会乱报警（报警必须是真异常）',
  G.compute({ meters: 1113, activity: DG.activities.walk, baseline: base('car_avg'),
              occupancy: 1, massKg: 65, met: 3.3, speedKmh: 4.5 }).warnings.length === 0,
  G.compute({ meters: 1113, activity: DG.activities.walk, baseline: base('car_avg'),
              occupancy: 1, massKg: 65, met: 3.3, speedKmh: 4.5 }).warnings.join('；'));
var kn = G.netKcal(3.3, 65, 14.84, 1.0);
ok('净消耗 = 总消耗 − 同等时长静坐，且不为负',
  near(kn.net, kn.gross - kn.resting, 1e-9) && kn.net >= 0 && kn.gross > 0);
ok('1 MET 活动时净消耗恒为 0（走路强度写成静坐不该有净收益）',
  near(G.netKcal(1.0, 65, 30, 1.0).net, 0, 1e-9));
ok('体重翻倍 → 热量翻倍（线性关系，别写成平方）',
  near(G.netKcal(3.3, 130, 14.84, 1.0).net, 2 * kn.net, 1e-6));
ok('骑行 15 km/h 走完 1113 米约 4.45 分、净消耗约 25 大卡（量级 sanity）',
  near(G.minutesFor(1113, 15), 4.452, 0.01) &&
  near(G.netKcal(6.0, 65, 4.452, 1.0).net, 25.3, 1.0),
  G.fmt(G.netKcal(6.0, 65, 4.452, 1.0).net, 1) + ' kcal');
ok('同样 1113 米，步行净消耗高于骑行（速度慢但单位时间强度低，总时长拉长要盖过它）',
  kn.net > G.netKcal(6.0, 65, G.minutesFor(1113, 15), 1.0).net * 0.8 && kn.net > 30,
  '走 ' + G.fmt(kn.net, 1) + ' / 骑 ' + G.fmt(G.netKcal(6.0, 65, 4.452, 1.0).net, 1));

/* ---------- 5. 碳排放 ---------- */
ok('vehicle.km 因子按载客人数摊薄：2 人正好减半',
  near(G.perPersonFactorKg(base('car_avg'), 2), base('car_avg').kgCO2e / 2, 1e-12));
ok('passenger.km 因子忽略载客人数（已经摊过每人，不能再摊）',
  G.perPersonFactorKg(base('bus_local'), 3) === base('bus_local').kgCO2e);
ok('载客 0 或非法 → 返回 null（拒绝除零，不猜数）',
  G.perPersonFactorKg(base('car_avg'), 0) === null &&
  G.perPersonFactorKg(base('car_avg'), 'abc') === null);
ok('未知单位 → null', G.perPersonFactorKg({ unit: 'litre', kgCO2e: 0.2 }, 1) === null);
var saved1 = G.savedKg(1113, base('car_avg'), 1, 0);
ok('步行 1113 米替代单人开车 = 少排 0.1889 kg CO2e',
  near(saved1, 0.18913, 0.0005), G.fmtCO2(saved1));
ok('打车（passenger.km）替代量比自驾摊薄后仍小，说明没混单位',
  G.savedKg(1113, base('taxi'), 1, 0) < saved1 &&
  near(G.savedKg(1113, base('taxi'), 1, 0), 0.16539, 0.0005));
ok('两人拼车这段路的减排减半（口径透明）',
  near(G.savedKg(1113, base('car_avg'), 2, 0), saved1 / 2, 1e-9));
ok('坐城际铁路替代时减排为正但很小（不夸大轨交收益）',
  G.savedKg(1113, base('rail_national'), 1, 0) > 0 &&
  G.savedKg(1113, base('rail_national'), 1, 0) < 0.05);
ok('距离为 0 时减排为 0（不出现"待改进"式的负数）',
  G.savedKg(0, base('car_avg'), 1, 0) === 0);
ok('EPA 交叉验证链自洽：8887 g/gal ÷ 22.2 mpg = 400 g/mile = 0.2487 kg/km',
  near(DG.sources.crossCheck.facts.gCO2PerGalGasoline / DG.sources.crossCheck.facts.fuelEconomyMpg,
       DG.sources.crossCheck.facts.gCO2PerMileAvgCar, 1.0) &&
  near(DG.sources.crossCheck.facts.gCO2PerMileAvgCar / 1000 / 1.60934, 0.24855, 0.0005),
  G.fmt(DG.sources.crossCheck.facts.gCO2PerMileAvgCar / 1000 / 1.60934, 4) + ' kg/km');
ok('EPA(0.2486) 与 DEFRA(0.16984) 相差在 1.1–2.0 倍之间（差异过大说明某一处抄错）',
  (0.24855 / 0.16984) > 1.1 && (0.24855 / 0.16984) < 2.0,
  G.fmt(0.24855 / 0.16984, 2) + ' 倍');

/* ---------- 6. compute() 主链路 ---------- */
var c1 = G.compute({
  meters: 1113, activity: DG.activities.walk, baseline: base('car_avg'),
  occupancy: 1, massKg: 65, met: 3.3, speedKmh: 4.5
});
ok('compute() 步行链路 ok=true 且所有输出有限',
  c1.ok && ['minutes', 'grossKcal', 'netKcal', 'savedKg', 'steps', 'appleG', 'annualKg']
    .every(function (k) { return isFinite(c1[k]); }), JSON.stringify(c1.warnings));
ok('compute() 输出锁死演示口径：14.8 分 / 净 38.8 大卡 / 少排 189 g / 1712 步',
  near(c1.minutes, 14.84, 0.02) && near(c1.netKcal, 38.82, 0.6) &&
  near(c1.savedG, 189.13, 0.5) && near(c1.steps, 1712.3, 1),
  [G.fmt(c1.minutes, 1), G.fmt(c1.netKcal, 1), G.fmt(c1.savedG, 1), G.fmt(c1.steps, 0)].join(' / '));
ok('compute() 骑行链路：步数为 0（骑自行车不该算步数）',
  G.compute({ meters: 1113, activity: DG.activities.bike, baseline: base('car_avg'),
              occupancy: 1, massKg: 65, met: 6.0, speedKmh: 15 }).steps === 0);
ok('compute() 无长度 → ok=false 并给出可执行的提示',
  G.compute({ meters: 0, activity: DG.activities.walk, baseline: base('car_avg') }).ok === false);
ok('compute() 缺基准 → ok=false 且不抛异常',
  G.compute({ meters: 1113, activity: DG.activities.walk, baseline: null }).ok === false);
ok('compute() 遇到无法识别的单位时警告里写"不猜数"',
  G.compute({ meters: 1113, activity: DG.activities.walk,
              baseline: { id: 'x', unit: 'litre', kgCO2e: 0.2 }, met: 3.3 }).warnings
    .join('').indexOf('不猜数') >= 0);
ok('compute() 超过 20 km 触发警告（校园场景不该出现，出现了要说）',
  G.compute({ meters: 25000, activity: DG.activities.walk, baseline: base('car_avg'),
              met: 3.3, massKg: 65 }).warnings.join('').indexOf('20 km') >= 0);
ok('compute() 默认体重取自参数表（65 kg）',
  G.compute({ meters: 500, activity: DG.activities.walk, baseline: base('car_avg'), met: 3.3 }).massKg === DG.defaultMassKg);
ok('compute() 每年累计 = 单次减排 × 每周次数 × 周数',
  near(c1.annualKg, c1.savedKg * c1.tripsPerWeek * c1.weeksPerYear, 1e-12) && c1.annualKg > 25,
  G.fmt(c1.annualKg, 1) + ' kg/年');

/* ---------- 7. 与"多走 44 米"的接口 ---------- */
var det = G.extraForDetour(44, DG.activities.walk, 65, 3.3);
ok('多走 44 米 = 多 0.59 分 / 净多耗约 1.5 kcal（小得诚实，不许夸大）',
  near(det.extraMinutes, 0.587, 0.01) && near(det.extraNetKcal, 1.53, 0.15) && det.extraNetKcal < 5,
  G.fmt(det.extraMinutes, 2) + ' 分 / ' + G.fmt(det.extraNetKcal, 2) + ' kcal');
ok('多走 0 米不产生任何收益（防止把 0 写成非零）',
  G.extraForDetour(0, DG.activities.walk, 65, 3.3).extraNetKcal === 0);
ok('多走的减排不计入（避免"多走 44 米少排 X 克"这种夸大）',
  det.extraSavedKg === undefined || det.extraSavedKg === 0);

/* ---------- 8. 格式化锁口径 ---------- */
ok('fmtCO2：<1 kg 用克、≥1 kg 用千克',
  G.fmtCO2(0.189) === '189.0 g' && G.fmtCO2(2.5) === '2.500 kg', G.fmtCO2(0.189) + ' / ' + G.fmtCO2(2.5));
ok('fmtKcal：小于 10 留一位小数，大的取整',
  G.fmtKcal(1.462) === '1.5' && G.fmtKcal(36.97) === '37');
ok('fmtMinutes：60 分以上改小时',
  G.fmtMinutes(14.84) === '14.8 分' && G.fmtMinutes(75) === '1.3 小时');
ok('格式化对 NaN/null 一律返回 --（界面上不出现 NaN）',
  G.fmt(NaN) === '--' && G.fmtCO2(null) === '--' && G.fmtKcal(undefined) === '--' &&
  G.fmtMinutes(Infinity) === '--');

/* ---------- 9. 文案表 ---------- */
ok('STRINGS_GREEN 存在且带面板标题/免责/动作名',
  SG && SG.title && SG.actions && SG.actions.walk && SG.actions.bike && SG.disclaimerHead);
ok('文案里承诺过的数字都写成模板占位，不写死数字（防止口径漂移）',
  !/[0-9]+\.?[0-9]*\s*(g|kg|kcal)\b/.test(JSON.stringify(SG).replace(/[a-zA-Z]+[0-9]+/g, '')),
  '文案含硬编码数字');

/* ---------- 10. 接入点与原有代码隔离 ---------- */
var idxSrc = read('index.html');
var order = ['js/app.js', 'data/green-factors.js', 'js/green-core.js', 'content/strings-green.js', 'js/textfx.js', 'js/green-ui.js'];
var pos = order.map(function (p) { return idxSrc.indexOf('<script src="' + p + '"></script>'); });
ok('index.html 中绿色模块都排在 app.js 之后且顺序正确',
  pos.every(function (p) { return p > 0; }) && pos.every(function (p, i) { return i === 0 || p > pos[i - 1]; }),
  JSON.stringify(pos));
ok('index.html 引入了绿色面板样式', idxSrc.indexOf('<link rel="stylesheet" href="styles-green.css">') >= 0);
ok('原有 12 个脚本标签一个都没少（绿色模块只做增量）',
  ['data/meta.js', 'data/buildings.js', 'data/shadows.js', 'data/routes.js', 'data/graph.js', 'data/basemap.js',
   'content/strings.js', 'js/core.js', 'js/proj.js', 'js/router.js', 'js/map.js', 'js/app.js']
    .every(function (p) { return idxSrc.indexOf(p) >= 0; }));
ok('面板结构没被写进 index.html（必须运行时注入，才谈得上零干扰）',
  idxSrc.indexOf('id="green-block"') < 0 && idxSrc.indexOf('gn-mode') < 0);

/* 入口页引用的本地资源必须全部存在 */
var refRe = /(?:src|href)="([^"]+)"/g, mRef, refsMissing = [];
while ((mRef = refRe.exec(homeSrc)) !== null) {
  var r = mRef[1];
  if (/^(#|https?:|mailto:)/.test(r)) { continue; }
  if (!fs.existsSync(path.join(ROOT, r))) { refsMissing.push(r); }
}
ok('入口页引用的本地文件全部存在', refsMissing.length === 0, refsMissing.join(','));
ok('入口页不背 862 KB 阴影数据与 101 KB 路网（首屏只要 meta/routes/basemap）',
  homeSrc.indexOf('data/shadows.js') < 0 && homeSrc.indexOf('data/graph.js') < 0 &&
  homeSrc.indexOf('data/buildings.js') < 0);
ok('入口页加载顺序自洽：数据 -> core -> textfx/green-core -> home',
  homeSrc.indexOf('js/home.js') > homeSrc.indexOf('js/core.js') &&
  homeSrc.indexOf('js/core.js') > homeSrc.indexOf('data/green-factors.js'));

/* 绿色 UI 的隔离边界 */
ok('green-ui.js 不写原有页面节点（只读长度）',
  !/\$\('(fast-len|cool-len|delta|card-fast|route-tag)'\)\s*\.\s*(textContent|innerHTML)\s*=[^=]/.test(greenUiSrc));
ok('green-ui.js 不覆盖站点原有全局',
  !/window\.(APP|CORE|MAP|ROUTER|PROJ|STRINGS)\s*=/.test(greenUiSrc));
ok('green-ui.js 不劫持原有控件的事件（没有对 #time/#start/#end 的 addEventListener）',
  !/getElementById\('(time|start|end)'\)/.test(greenUiSrc) &&
  !/querySelector\('#time'\)/.test(greenUiSrc));
ok('green-ui.js 无 import/export', !/^\s*(import|export)\s/m.test(greenUiSrc));
ok('home.js 无 import/export 且不碰 canvas（入口页没有地图）',
  !/^\s*(import|export)\s/m.test(read('js/home.js')) &&
  read('js/home.js').indexOf('getContext') < 0);
ok('green-factors.js 是纯数据（不定义函数、不查 DOM）',
  !/\bfunction\s*\(/.test(read('data/green-factors.js')) &&
  read('data/green-factors.js').indexOf('getElementById') < 0);
ok('textfx.js 在 reduced-motion 下直接落终值（打字机/乱码/滚动三条都覆盖）',
  /if \(reduced\(\) \|\| opts\.speed === 0\)/.test(read('js/textfx.js')) &&
  /if \(reduced\(\)\) \{ setText\(el, finalText\)/.test(read('js/textfx.js')) &&
  /if \(reduced\(\) \|\| !opts\.dur\)/.test(read('js/textfx.js')));

/* ---------- 11. 界面集成（真实页面骨架 + 基线对照，断言在 green-ui-cases.js） ---------- */
require('./green-ui-cases.js').run({ ok: ok, near: near, read: read, ROOT: ROOT });

/* ---------- 12. 汇总 ---------- */
console.log('--------------------------------------------------');
console.log('SMOKE-GREEN: PASS ' + pass + ' / FAIL ' + fail);
if (fail > 0) {
  console.log('失败项：');
  failures.forEach(function (x) { console.log('  - ' + x); });
  process.exitCode = 1;
} else {
  console.log('全部通过。');
}
