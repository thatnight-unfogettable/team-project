/* ============================================================
   凉径 ShadeRoute Lite —— 绿色收益模块文案（新增文件）
   约定：所有数字都写成 {token}，由 js/green-ui.js 用计算结果填充。
   文案里出现硬编码数字 = 口径漂移的开始，本条由 tools/smoke-green.js 断言锁住。
   ============================================================ */

window.STRINGS_GREEN = {
  /* 面板 */
  title: '绿色收益',
  tagIdle: '未选择',
  tagWorking: '计算中',
  sectionHeadMode: '本次出行方式',
  sectionHeadParams: '参数（可改，改了就重算）',
  sectionHeadResult: '本次路线的收益',

  actions: {
    walk: '步行',
    bike: '骑行'
  },
  actionHint: {
    walk: '按本站算路速度，不快不慢刚好是算法用的那个速度',
    bike: '校园内多数路段可骑，但部分路段需推行，这里按整段可骑估'
  },

  /* 参数标签 */
  labels: {
    mass: '体重',
    speed: '速度强度',
    baseline: '如果不这么走，改成',
    occupancy: '车内几人',
    route: '按哪条路线算',
    trips: '每周几趟'
  },
  routeOptions: {
    fast: '最快路线',
    cool: '阴凉路线'
  },

  /* 结果 */
  results: {
    co2: '少排放',
    kcal: '净消耗热量',
    minutes: '多花时长',
    perTrip: '这一次',
    perYear: '按每周{trips}趟、一年{weeks}周累计'
  },
  resultUnits: {
    kcal: '大卡',
    co2SmallUnit: '克',
    co2BigUnit: '千克'
  },

  /* 等效换算（明确标"示意"，不能当成实测） */
  equivalents: [
    { id: 'steps', text: '约 {steps} 步' },
    { id: 'apple', text: '相当于 {apple} 克苹果的能量（示意换算）' },
    { id: 'tree', text: '这一次少排的碳，约是一棵树 {tree} 年固碳量的 {treePct}%' },
    { id: 'sitting', text: '同等时长静坐只耗 {resting} 大卡，差值才是"多烧的"' }
  ],

  /* 与站点原有卖点的接口：阴凉路线多走的距离 */
  detour: {
    lead: '阴凉路线比最快路线多走 {extraM} 米：',
    body: '多花 {extraMin} 分钟、净多耗 {extraKcal} 大卡。这部分不换算成"减排"，因为多走路本身不多排碳，也不该拿来凑减排量。',
    none: '这一帧两条路线长度相同，没有"多走"这件事。'
  },

  /* 异常与提示 */
  notices: {
    noRoute: '还没有路线：先在左上选起点终点，或在地图上点两下。',
    samePoint: '起终点相同，没有可计算的行程。',
    precomputeMissing: '没能读到路线长度（页面结构可能被改动）。本模块只读不写，不会影响原有算路。',
    contractBroken: '注意：本站算路速度与本模块假设不一致，时长与热量会整体偏移。'
  },

  /* 口径与来源折叠区 */
  disclaimerHead: '口径与来源（点开看，讲的时候必须带这段）',
  disclaimerBody: [
    '排放因子取自英国政府 {srcName}，{scope}。不是中国本土因子：量级可用，绝对值有地域偏差。',
    '单位严格区分 vehicle.km（一辆车跑一公里）与 passenger.km（已摊到每人），本模块逐条按标注使用，混用会把公交算贵。',
    '步行/骑行按直接排放 0 计；额外食物能耗的间接排放未计入，所以这是"减排上限"而不是"实测替代量"。',
    '热量用 MET 口径：净消耗 = 总消耗 − 同等时长静坐，和运动手表的总消耗口径不同，别拿两边互相核对。',
    'MET 档位本次未能在线核对原始 Compendium 表格（网络受限），参数在界面上可调，结果按量级看。',
    '校园内多数短途本来就不会开车，所以这里的减排量是"假设改乘车"的上限。被评委追问时，这句话要先说。'
  ],

  crossCheck: {
    head: '交叉验证（同一件事两条独立来源）',
    body: '美国 EPA 给典型乘用车 {epaG} g CO2/mile（由 {gal} g/gal ÷ {mpg} mpg 得出），折合 {epaGKm} g/km；英国 DEFRA 的平均小汽车是 {defraGKm} g/km，两者相差 {ratio} 倍——差异来自车队结构（含 SUV 占比）与是否计入甲烷/氧化亚氮，属于口径差异而不是错误。用 g/km 而不是 kg/km，是为了不因取位小数产生 0.2485/0.2486 这种假争议。'
  },

  /* 入口页 */
  home: {
    brand: '凉径 · ShadeRoute Lite',
    back: '返回工具',
    enter: '进入路线对比',
    enterHint: '纯静态、零网络，file:// 双击即用',
    cta: [
      { title: '阴影路线对比', to: 'index.html', text: '同一时刻两条路线：最快与阴凉，暴晒分钟与阴影覆盖一目了然。' },
      { title: '任意两点现场算路', to: 'index.html', text: '53 个校园地名或地图上点两下，浏览器本地跑 Dijkstra，不发请求。' },
      { title: '绿色收益', to: 'index.html', text: '选定步行或骑行后，给出少排的二氧化碳与净消耗的大卡，附来源与口径。' }
    ]
  }
};
