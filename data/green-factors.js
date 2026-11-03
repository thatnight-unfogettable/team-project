/* ============================================================
   凉径 ShadeRoute Lite —— 绿色出行参数表（数据，不含逻辑）
   新增文件，不改动 data/ 下任何原有文件。

   设计原则（和本站"不夸大"的口径纪律一致）：
     1. 每个因子都带 unit / ref / source，能回溯到原始表格的行；
     2. 单位严格区分 vehicle.km 与 passenger.km —— 混用会把公交算贵 1 倍；
     3. 无法在线核对的值一律标 verify:"pending"，并在界面上可调、在免责里点名；
     4. 直接排放：步行/骑行为 0；额外食物能耗的间接排放**不计入**，只做说明。
   ============================================================ */

window.DATA_GREEN = {
  version: "2026-11-03",
  /* 因子来源。DEFRA = 英国政府 2024 年官方温室气体转换因子（Scope 1，含反应性气体 RM）。
     地域差异必须向用户说清：中国大陆的车队结构与电网不同，这里按公开因子近似。 */
  sources: {
    transport: {
      name: "UK BEIS/DEFRA/DSU 政府温室气体转换因子 2024（Condensed set v1.1）",
      url: "https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2024",
      sheet: "Passenger vehicles",
      scope: "Scope 1，kg CO2e，含 RM（CH4/N2O 折算）",
      retrieved: "2026-11-03",
      caveat: "英国因子；中国车队/载客结构不同，量级可用，绝对值有偏差"
    },
    crossCheck: {
      name: "US EPA 典型乘用车尾气排放（用于交叉验证，不参与计算）",
      url: "https://www.epa.gov/greenvehicles/greenhouse-gas-emissions-typical-passenger-vehicle",
      facts: { gCO2PerGalGasoline: 8887, gCO2PerMileAvgCar: 400, fuelEconomyMpg: 22.2 },
      derived: "400 g/mile = 8887 ÷ 22.2；折合 248.5 g CO2/km（单车、仅尾气；1 mile = 1609.34 m）",
      note: "EPA 口径比 DEFRA 的 0.16984 高约 46%，因为含 SUV 占比与仅尾气不含 RM 的不同假设"
    },
    met: {
      name: "Compendium of Physical Activities（Ainsworth 等，2011 修订版）典型档位",
      verify: "pending",
      note: "本次会话网络受限，未能打开原表逐条核对；因此 MET 在界面上可调，且只用于量级估算",
      formula: "kcal/min = MET × 3.5 × 体重kg ÷ 200（摄氧-热量换算，1 L O2 ≈ 5 kcal）"
    },
    food: {
      name: "苹果（可食部）能量",
      kcalPer100g: 52,
      verify: "文献常见值，未核原始成分表"
    },
    tree: {
      name: "成年树一年固碳量（示意换算）",
      kgCO2PerYear: 21.8,
      verify: "示意值，仅用于可读性换算"
    }
  },

  /* 出行动作：直接排放 0，能量消耗由 MET 决定 */
  activities: {
    walk: {
      label: "步行",
      directKgCO2ePerKm: 0,
      /* 默认速度 = 本站算路常量 CORE.WALK_SPEED = 1.25 m/s = 4.5 km/h，不另起炉灶 */
      defaultSpeedKmh: 4.5,
      speeds: [
        { kmh: 3.2, met: 2.5, label: "3.2 km/h 慢走" },
        { kmh: 4.0, met: 3.0, label: "4.0 km/h 散步" },
        { kmh: 4.5, met: 3.3, label: "4.5 km/h 本站算路速度", isDefault: true },
        { kmh: 5.5, met: 4.3, label: "5.5 km/h 快走" }
      ],
      countsSteps: true,
      strideM: 0.65,
      strideNote: "步幅按 1.65 m 身高 × 0.4 估，仅用于步数换算"
    },
    bike: {
      label: "骑行",
      directKgCO2ePerKm: 0,
      defaultSpeedKmh: 15,
      speeds: [
        { kmh: 12, met: 4.0, label: "12 km/h 休闲骑" },
        { kmh: 15, met: 6.0, label: "15 km/h 校园通勤", isDefault: true },
        { kmh: 19, met: 8.0, label: "19 km/h 认真骑" },
        { kmh: 22, met: 10.0, label: "22 km/h 锻炼强度" }
      ],
      countsSteps: false,
      campusNote: "南校园部分路段禁骑/需推行，本表按整段可骑估算，实际以现场为准"
    }
  },

  /* 对比基准（"如果不这么走/骑，改成坐车"）。unit 必须逐条读清楚。 */
  baselines: [
    { id: "car_avg", label: "小汽车（平均）", unit: "vehicle.km", kgCO2e: 0.16984,
      ref: "Passenger vehicles 表 · Cars (by size) · Average car · km · 第 54 行",
      occupancyDefault: 1, occupancyOptions: [1, 1.5, 2, 3] },
    { id: "car_large", label: "小汽车（大型）", unit: "vehicle.km", kgCO2e: 0.20729,
      ref: "Cars (by size) · Large car · km · 第 52 行",
      occupancyDefault: 1, occupancyOptions: [1, 1.5, 2, 3] },
    { id: "car_small", label: "小汽车（小型）", unit: "vehicle.km", kgCO2e: 0.13994,
      ref: "Cars (by size) · Small car · km · 第 48 行",
      occupancyDefault: 1, occupancyOptions: [1, 1.5, 2, 3] },
    { id: "motorbike_avg", label: "摩托车（平均）", unit: "vehicle.km", kgCO2e: 0.11367,
      ref: "Motorbike · Average · km · 第 66 行",
      occupancyDefault: 1, occupancyOptions: [1, 2] },
    { id: "taxi", label: "出租车", unit: "passenger.km", kgCO2e: 0.14861,
      ref: "Taxis · Regular taxi · passenger.km", occupancyDefault: null, occupancyOptions: null },
    { id: "bus_local", label: "公交（市内）", unit: "passenger.km", kgCO2e: 0.12999,
      ref: "Bus · Local bus (not London) · passenger.km", occupancyDefault: null, occupancyOptions: null },
    { id: "coach", label: "长途大巴", unit: "passenger.km", kgCO2e: 0.02717,
      ref: "Coach · passenger.km", occupancyDefault: null, occupancyOptions: null },
    { id: "rail_national", label: "城际铁路", unit: "passenger.km", kgCO2e: 0.03546,
      ref: "Rail · National rail · passenger.km", occupancyDefault: null, occupancyOptions: null },
    { id: "tram", label: "轻轨/有轨电车", unit: "passenger.km", kgCO2e: 0.0286,
      ref: "Rail · Light rail and tram · passenger.km", occupancyDefault: null, occupancyOptions: null }
  ],

  /* 默认基准：校园内"打车/家里开车送"是最真实的反事实，不是大巴 */
  defaultBaseline: "car_avg",
  defaultMassKg: 65,
  massOptions: [45, 55, 65, 75, 85, 95],

  /* 健身口径：净消耗 = 总消耗 − 同等时长静坐（1 MET） */
  restingMet: 1.0,
  litersO2PerKcal: 5.0,
  kcalPerKgPerHour: 1.0,   // 1 MET ≈ 1 kcal/kg/h，用于交叉验证上面那条换算

  /* 站点原有常量的一致性约束：改了这里必须同步 js/core.js 的 WALK_SPEED */
  walkSpeedContract: { ms: 1.25, kmh: 4.5, coreConstant: "WALK_SPEED" },

  disclaimers: [
    "排放因子为英国政府 2024 官方值（Scope 1，含 RM），非中国本土因子；量级可用，绝对值有地域偏差。",
    "vehicle.km 与 passenger.km 是两种口径：前者是「一辆车跑一公里」，后者已经摊到每人。本表逐条标注。",
    "步行/骑行按直接排放 0 计。额外食物能耗带来的间接排放（文献典型 0.005–0.035 kg CO2e/人公里）未计入。",
    "MET 档位本次未能在线核对 Compendium 原表（网络受限），参数在界面上可调，结果按量级看。",
    "净消耗热量按「减去同等时长静坐 1 MET」口径，和运动手表的总消耗口径不同，别拿两边对不上号。",
    "校园内多数短途本就不会开车，这里的「减少排放」是**假设改乘车**的上限，不是实测替代量。"
  ]
};
