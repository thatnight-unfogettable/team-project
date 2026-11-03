/* ============================================================
   凉径 ShadeRoute Lite —— 绿色出行计算核心（纯函数）
   新增文件。规则与 js/core.js 一致：
     · 不碰 DOM、不发请求、不读系统时钟、不用 import/export（file:// 双击要能跑）
     · 所有输入输出可复算，冒烟测试用 Node 直接调（tools/smoke-green.js）
   ============================================================ */

window.GREEN = (function () {
  'use strict';

  var M_PER_KM = 1000;

  function isNum(n) { return typeof n === 'number' && isFinite(n); }
  function num(n, fb) {
    var v = typeof n === 'string' ? parseFloat(n) : n;
    return isNum(v) ? v : fb;
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* ---------- 1. 时长 ---------- */
  function minutesFor(meters, speedKmh) {
    var m = num(meters, 0), s = num(speedKmh, 0);
    if (m <= 0 || s <= 0) { return 0; }
    return m / (s * 1000 / 60);          // 米 ÷ (米/分钟)
  }

  /* ---------- 2. 热量：两套换算并列，报告口径只用 ACSM 那一条 ---------- */
  /* 口径 A（本模块对外报告用）：kcal/min = MET × 3.5 × kg ÷ 200
     推导：1 MET = 3.5 ml O2/kg/min；1 L O2 ≈ 5 kcal ⇒ kcal/min = MET×3.5×kg/1000×5 */
  function grossKcalByVO2(met, massKg, minutes) {
    var v = num(met, 0) * 3.5 * num(massKg, 0) / 200 * num(minutes, 0);
    return v > 0 ? v : 0;
  }
  /* 口径 B（速算约定）：kcal = MET × kg × 小时，即 "1 MET ≈ 1 kcal/kg/h" */
  function grossKcalByHour(met, massKg, minutes) {
    return num(met, 0) * num(massKg, 0) * num(minutes, 0) / 60;
  }
  /* 两条口径的比值是精确常数 1.05：(3.5/200) ÷ (1/60) = 60×3.5/200 = 1.05。
     也就是说 ACSM 口径比『1 MET ≈ 1 kcal/kg/h』速算口径高整 5%。
     这不是误差而是定义差，所以要写死：谁单方面换了公式，全站热量会整体偏移 5%，
     下面用 drift 常数盯住它，测试里断言它精确等于 0.05。 */
  function kcalMethodDrift(met, massKg, minutes) {
    var a = grossKcalByVO2(met, massKg, minutes), b = grossKcalByHour(met, massKg, minutes);
    if (!(b > 0)) { return 0; }
    return (a - b) / b;
  }
  /* 净消耗 = 总消耗 − 同等时长静坐（健身可报告的"因这次活动多烧的"） */
  function netKcal(met, massKg, minutes, restingMet) {
    var r = num(restingMet, 1.0);
    var gross = grossKcalByVO2(met, massKg, minutes);
    var rest = grossKcalByVO2(r, massKg, minutes);
    return { gross: gross, resting: rest, net: Math.max(0, gross - rest) };
  }

  /* ---------- 3. 碳排放：单位口径是唯一难点 ---------- */
  /* unit == "vehicle.km"     -> 每人排放 = 因子 ÷ 载客人数
     unit == "passenger.km"   -> 因子本身就是每人排放，载客人数不适用
     载客人数没给（undefined/null）→ 用基准自带的默认值；
     给了但不是正数 → 返回 null，不拿 0 去除，也不悄悄换成默认值糊过去。
     未知 unit 一律拒绝，不猜。 */
  function perPersonFactorKg(baseline, occupancy) {
    if (!baseline || !isNum(baseline.kgCO2e)) { return null; }
    if (baseline.unit === 'passenger.km') { return baseline.kgCO2e; }
    if (baseline.unit === 'vehicle.km') {
      var o = (occupancy === undefined || occupancy === null)
        ? num(baseline.occupancyDefault, null)
        : num(occupancy, null);
      if (!(o > 0)) { return null; }
      return baseline.kgCO2e / o;
    }
    return null;
  }
  /* 减少的排放 = 基准每人排放 × 距离 − 本次动作直接排放 × 距离 */
  function savedKg(meters, baseline, occupancy, directKgPerKm) {
    var f = perPersonFactorKg(baseline, occupancy);
    if (f === null) { return null; }
    var km = num(meters, 0) / M_PER_KM;
    var direct = num(directKgPerKm, 0);
    var saved = (f - direct) * km;
    return saved > 0 ? saved : 0;
  }

  /* ---------- 4. 可读性换算（都标"示意"） ---------- */
  function steps(meters, strideM) {
    var st = num(strideM, 0.65);
    if (!(st > 0) || !(meters > 0)) { return 0; }
    return meters / st;
  }
  function appleGrams(kcal, kcalPer100g) {
    var k = num(kcalPer100g, 52);
    return k > 0 ? num(kcal, 0) / k * 100 : 0;
  }
  function treeYears(kgCO2, kgPerTreeYear) {
    return num(kgPerTreeYear, 21.8) > 0 ? num(kgCO2, 0) / num(kgPerTreeYear, 21.8) : 0;
  }
  function annualKg(perTripKg, tripsPerWeek, weeksPerYear) {
    return num(perTripKg, 0) * num(tripsPerWeek, 0) * num(weeksPerYear, 0);
  }

  /* ---------- 5. 主入口：给一条路线算全套收益 ---------- */
  function compute(o) {
    o = o || {};
    var data = o.data || {};
    var meters = num(o.meters, 0);
    var act = o.activity || (data.activities ? data.activities.walk : null);
    var base = o.baseline;
    var massKg = num(o.massKg, num(data.defaultMassKg, 65));
    var speedKmh = num(o.speedKmh, act ? act.defaultSpeedKmh : 4.5);
    var met = num(o.met, 0);
    var out = {
      ok: false, meters: meters, speedKmh: speedKmh, met: met, massKg: massKg,
      minutes: 0, grossKcal: 0, netKcal: 0, restingKcal: 0,
      savedKg: null, savedG: null, steps: 0, appleG: 0, treeYears: 0, annualKg: null,
      warnings: []
    };
    if (!(meters > 0) || !act || !base) {
      out.warnings.push(!act ? '没有指定出行方式（步行/骑行）' : '没有可用路线长度，先选起终点');
      return out;
    }
    var p = perPersonFactorKg(base, o.occupancy);
    if (p === null) {
      out.warnings.push('对比基准单位无法识别（' + base.unit + '），不猜数');
      return out;
    }
    if (!(met > 0)) {
      out.warnings.push('缺少 MET 档位');
      return out;
    }

    out.minutes = minutesFor(meters, speedKmh);
    var kn = netKcal(met, massKg, out.minutes, num(data.restingMet, 1.0));
    out.grossKcal = kn.gross;
    out.restingKcal = kn.resting;
    out.netKcal = kn.net;
    out.drift = kcalMethodDrift(met, massKg, out.minutes);
    out.savedKg = savedKg(meters, base, o.occupancy, act.directKgCO2ePerKm);
    out.savedG = out.savedKg === null ? null : out.savedKg * 1000;
    out.steps = (act.countsSteps === false) ? 0 : steps(meters, act.strideM);
    out.appleG = appleGrams(out.netKcal, data.sources && data.sources.food && data.sources.food.kcalPer100g);
    out.treeYears = out.savedKg === null ? 0 : treeYears(out.savedKg, data.sources && data.sources.tree && data.sources.tree.kgCO2PerYear);
    var t = num(o.tripsPerWeek, 5), w = num(o.weeksPerYear, 32);
    out.tripsPerWeek = t; out.weeksPerYear = w;
    out.annualKg = out.savedKg === null ? null : annualKg(out.savedKg, t, w);

    /* 口径 A 与速算口径 B 天生差整 5%（1.05 倍），这是常数，不是异常，
       所以正常计算时不报警；一旦这个常数变了，说明有人改了公式——那才是真异常。 */
    if (Math.abs(out.drift - 0.05) > 1e-9) {
      out.warnings.push('热量公式与站点口径不一致（偏差 ' + (out.drift * 100).toFixed(2) + '%，应为 5.00%）');
    }
    if (meters > 20000) { out.warnings.push('路线超过 20 km，超出校园场景，结果仅供参考'); }
    if (out.minutes > 240) { out.warnings.push('按所选速度这段要 ' + Math.round(out.minutes) + ' 分钟，可能选错强度'); }

    out.ok = true;
    return out;
  }

  /* ---------- 6. 与站点原有卖点的接口：阴凉路线"多走的那几十米"值多少 ---------- */
  /* 返回多走 Δ 米的额外消耗与额外减排（同一分钟内多走的距离本身减排为 0，
     所以这里只报热量；减排仍按整段路线算，避免"多走 44 米少排 8 g"这种夸大） */
  function extraForDetour(deltaMeters, activity, massKg, met) {
    var d = num(deltaMeters, 0);
    if (!(d > 0) || !activity) { return { extraMeters: d, extraMinutes: 0, extraNetKcal: 0 }; }
    var sp = num(activity.defaultSpeedKmh, 4.5);
    var minutes = minutesFor(d, sp);
    var kn = netKcal(met, massKg, minutes, 1.0);
    return {
      extraMeters: d,
      extraMinutes: minutes,
      extraGrossKcal: kn.gross,
      extraNetKcal: kn.net,
      extraSteps: activity === undefined ? 0 : steps(d, num(activity.strideM, 0.65))
    };
  }

  /* ---------- 7. 与 js/core.js 的常量契约 ---------- */
  function walkSpeedContractOk(coreWalkSpeedMs) {
    var cw = num(coreWalkSpeedMs, null);
    var expected = num(window.DATA_GREEN && window.DATA_GREEN.walkSpeedContract &&
                       window.DATA_GREEN.walkSpeedContract.ms, 1.25);
    if (cw === null) { return { ok: false, reason: 'js/core.js 未暴露 WALK_SPEED' }; }
    return {
      ok: Math.abs(cw - expected) < 1e-9,
      core: cw, expected: expected,
      reason: Math.abs(cw - expected) < 1e-9 ? '' :
        '本站算路速度 ' + cw + ' m/s 与绿色模块假设的 ' + expected + ' m/s 不一致，时长/热量会整体偏移'
    };
  }

  /* ---------- 8. 显示格式化（集中一处，方便锁口径） ---------- */
  function fmt(n, digits) {
    if (!isNum(n)) { return '--'; }
    return n.toFixed(num(digits, 1));
  }
  /* 克数：<1000 g 用 g，否则用 kg，避免出现"0.02 kg"这种读不出量的写法 */
  function fmtCO2(kg) {
    if (!isNum(kg)) { return '--'; }
    return kg < 1 ? fmt(kg * 1000, 1) + ' g' : fmt(kg, 3) + ' kg';
  }
  function fmtKcal(kcal) {
    if (!isNum(kcal)) { return '--'; }
    return fmt(kcal, kcal < 10 ? 1 : 0);
  }
  function fmtMinutes(min) {
    if (!isNum(min)) { return '--'; }
    return min < 60 ? fmt(min, 1) + ' 分' : fmt(min / 60, 1) + ' 小时';
  }

  return {
    minutesFor: minutesFor,
    grossKcalByVO2: grossKcalByVO2,
    grossKcalByHour: grossKcalByHour,
    kcalMethodDrift: kcalMethodDrift,
    netKcal: netKcal,
    perPersonFactorKg: perPersonFactorKg,
    savedKg: savedKg,
    steps: steps,
    appleGrams: appleGrams,
    treeYears: treeYears,
    annualKg: annualKg,
    compute: compute,
    extraForDetour: extraForDetour,
    walkSpeedContract: walkSpeedContractOk,
    fmt: fmt, fmtCO2: fmtCO2, fmtKcal: fmtKcal, fmtMinutes: fmtMinutes,
    /* 供测试断言内部一致性的常量 */
    restingMetDefault: 1.0,
    clamp: clamp
  };
})();
