/*
 * engine.js — Boricua 旅行 Agent 生成引擎
 * ---------------------------------------------------------
 * 纯函数模块：不依赖 DOM，可在浏览器（window.TripEngine）与
 * Node（module.exports）两种环境下运行，便于单元测试。
 *
 * 能力清单：
 *  - 月相计算（生物湾观赏条件推理）
 *  - 行程编排（偏好 × 出行关系 × 预算 → 逐日行程）
 *  - 预算模型（机票/住宿/项目/交通/餐饮/机动金，自动优化到预算内）
 *  - 预订项生成与三档比价
 *  - 打包清单 / 场景话术 / 雨天备选的内容生成
 *  - 自然语言意图解析（assistantReply → 编辑操作）
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TripEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * 常量与知识库
   * ------------------------------------------------------------------ */

  const MOON_SYNODIC = 29.530588853;            // 朔望月（天）
  const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // 已知新月时刻

  // 出发城市 → 纽约/圣胡安往返机票参考价（USD / 人，含随身行李）
  const FLIGHT_TABLE = {
    纽约: 318, 波士顿: 306, 华盛顿: 322, 芝加哥: 352, 亚特兰大: 296,
    洛杉矶: 432, 旧金山: 448, 西雅图: 462, 丹佛: 402, 迈阿密: 252,
    休斯顿: 378, 达拉斯: 366, 费城: 312, 奥兰多: 288,
  };
  const FLIGHT_DEFAULT = 382;

  // 住宿三档（每晚每房，USD）
  const HOTEL_TIERS = [
    { id: "economy", name: "轻省 · 精品民宿", perNight: 95,  note: "位置灵活 · 含自助早餐" },
    { id: "comfort", name: "舒适 · 海滨酒店", perNight: 168, note: "步行近海滩 · 带泳池" },
    { id: "premium", name: "精品 · 度假酒店", perNight: 286, note: "海景房 · 礼宾服务" },
  ];

  // 餐饮档位（每人每天，USD）
  const FOOD_TIERS = { economy: 42, comfort: 56, premium: 74 };

  // 活动库：tag 取值 culture / food / photo / nature / beach / night
  const ACTIVITIES = [
    { id: "old-town",    name: "圣胡安老城步行",     tags: ["culture", "photo"], cost: 0,  part: "am",   effort: 1, location: "San Juan", desc: "彩色街巷与蓝石街道，上午光线最出片" },
    { id: "el-morro",    name: "莫罗城堡 El Morro",  tags: ["culture", "photo"], cost: 10, part: "am",   effort: 2, location: "San Juan", desc: "始于 1539 年的西班牙堡垒，海岬草坪视野开阔" },
    { id: "paseo",       name: "Paseo de la Princesa", tags: ["culture", "photo"], cost: 0, part: "pm", effort: 1, location: "San Juan", desc: "沿海步道一直走到老城墙，日落前光线柔和" },
    { id: "food-tour",   name: "老城美食漫步",       tags: ["food", "culture"], cost: 65, part: "pm",   effort: 1, location: "San Juan", desc: "mofongo、炸鳕鱼球与本地咖啡，含 6 个试吃点" },
    { id: "rum",         name: "Bacardí 朗姆酒厂",   tags: ["culture", "food"], cost: 15, part: "pm",   effort: 1, location: "Cataño", desc: "老城渡轮 15 分钟可达，含品尝与调酒课选项" },
    { id: "salsa",       name: "La Placita 萨尔萨之夜", tags: ["night", "culture", "food"], cost: 18, part: "night", effort: 2, location: "Santurce", desc: "本地人聚集的广场夜市，周四至周日最热闹" },
    { id: "yunque",      name: "埃尔云克雨林徒步",   tags: ["nature"], cost: 10, part: "am", effort: 3, location: "El Yunque", desc: "热带雨林步道与 La Mina 瀑布，需提前预约入园" },
    { id: "luquillo",    name: "Luquillo 海滩与小吃亭", tags: ["beach", "food"], cost: 0, part: "pm", effort: 1, location: "Luquillo", desc: "海边小吃亭 kiosks 一条街，游泳后补充能量" },
    { id: "culebra",     name: "Flamenco Beach 浮潜", tags: ["beach", "photo"], cost: 12, part: "am", effort: 2, location: "Culebra", desc: "常年入选全球十佳海滩，上午人少水清" },
    { id: "snorkel",     name: "Culebra 浮潜小团",   tags: ["beach", "nature"], cost: 65, part: "pm", effort: 2, location: "Culebra", desc: "含装备与救生衣，海龟与珊瑚区" },
    { id: "bio-bay",     name: "Laguna Grande 生物湾皮划艇", tags: ["night", "nature"], cost: 68, part: "night", effort: 2, location: "Fajardo", desc: "荧光浮游生物夜航，月光影响可见度" },
    { id: "mosquito-bay", name: "Mosquito Bay 生物湾", tags: ["night", "nature"], cost: 85, part: "night", effort: 2, location: "Vieques", desc: "公认全球最亮的生物湾之一，船程前往" },
    { id: "cayo",        name: "Icacos 岛帆船一日",  tags: ["beach", "photo"], cost: 95, part: "am",   effort: 2, location: "Fajardo", desc: "双体帆船出海，含浮潜与岛上停留" },
    { id: "rincon",      name: "Rincón 日落观景",    tags: ["beach", "photo"], cost: 0,  part: "pm",   effort: 1, location: "Rincón", desc: "西海岸冲浪小镇，号称加勒比最美日落" },
    { id: "coffee",      name: "咖啡庄园导览",       tags: ["culture", "food", "nature"], cost: 38, part: "am", effort: 1, location: "Adjuntas", desc: "看阿拉比卡种植、处理与杯测" },
    { id: "lechon",      name: "Guavate 烤乳猪大道", tags: ["food", "culture"], cost: 25, part: "pm", effort: 1, location: "Cayey", desc: "山间连排 lechoneras，本地周末仪式感" },
    { id: "camuy",       name: "卡穆伊洞穴公园",     tags: ["nature"], cost: 20, part: "am", effort: 2, location: "Camuy", desc: "北美最大地下洞穴系统之一，雨天也可前往" },
    { id: "sailing",     name: "日落帆船巡航",       tags: ["photo", "night", "beach"], cost: 75, part: "pm", effort: 1, location: "San Juan", desc: "老城海港出发，含饮品与海上日落" },
    { id: "museo",       name: "波多黎各艺术博物馆", tags: ["culture"], cost: 12, part: "flex", effort: 1, location: "Santurce", desc: "拉美现当代艺术收藏，雨天友好" },
    { id: "casa-blanca", name: "Casa Blanca 历史宅邸", tags: ["culture"], cost: 5, part: "flex", effort: 1, location: "San Juan", desc: "波塞隆家族旧居，庭院与海景" },
    { id: "surf",        name: "Isabela 冲浪课",     tags: ["beach", "nature"], cost: 80, part: "am", effort: 3, location: "Isabela", desc: "1.5 小时教练课含冲浪板" },
  ];
  const ACTIVITY_MAP = Object.fromEntries(ACTIVITIES.map((a) => [a.id, a]));

  /* ------------------------------------------------------------------ *
   * 日程模板库（按天），tags 用于偏好匹配；cost 为该天付费项目合计
   * ------------------------------------------------------------------ */

  const ARCHETYPES = {
    arrival: {
      id: "arrival", name: "抵达与初见", tags: ["arrival"],
      title: "先认识彩色的圣胡安", subtitle: "步行友好 · 适应节奏 · 日落收尾", pace: "轻松",
      cost: 0, effort: 1, drive: false, island: false, highlight: false, rainy: false,
      note: "老城石板路不适合拖大件行李，建议先寄存或入住后再开始步行。",
      items: [
        ["14:30", "抵达 SJU，前往 Condado", "预留 40–60 分钟取行李与叫车", "接送"],
        ["17:00", "Paseo de la Princesa 慢走", "沿海步道走到老城墙，光线柔和", ""],
        ["19:00", "老城晚餐", "本地菜入门：mofongo 与海鲜", "餐厅"],
      ],
    },
    departure: {
      id: "departure", name: "咖啡与返程", tags: ["departure"],
      title: "用一杯咖啡和海风告别", subtitle: "弹性上午 · 伴手礼 · 机场返程", pace: "收尾",
      cost: 0, effort: 1, drive: false, island: false, highlight: false, rainy: false,
      note: "SJU 安检高峰波动较大，建议预留至少 2 小时办理登机手续。",
      items: [
        ["09:30", "海边早餐", "不安排固定项目，给行李与交通留弹性", ""],
        ["11:30", "返回酒店取行李", "再次确认航班动态与航站楼", "航班"],
        ["13:00", "前往 SJU 机场", "完成还车后进入航站楼", ""],
      ],
    },
    "old-town": {
      id: "old-town", name: "老城与莫罗城堡", tags: ["culture", "food", "photo"],
      title: "在彩色街巷里走一天", subtitle: "上午城堡 · 午后老城 · 晚餐从简", pace: "适中",
      cost: 75, effort: 2, drive: false, island: false, highlight: false, rainy: false,
      note: "莫罗城堡的草坪在上午顺光，建议把拍照放在前半段。",
      items: [
        ["08:30", "El Morro 莫罗城堡", "海岬草坪与炮台，提前线上买票", "项目"],
        ["11:30", "老城街巷漫步", "蓝石街道与彩绘阳台，避开正午暴晒", ""],
        ["13:00", "本地午餐", "老城经典 mofongo 或海鲜饭", "餐厅"],
        ["15:30", "Bacardí 朗姆酒厂", "渡轮 15 分钟跨海湾，含品酒", "项目"],
        ["19:00", "老城晚餐", "选一家有露台的本地菜", "餐厅"],
      ],
    },
    rainforest: {
      id: "rainforest", name: "埃尔云克雨林", tags: ["nature", "beach"],
      title: "在热带雨林里降温", subtitle: "自驾建议 · 防滑鞋 · 下午海边收尾", pace: "适度",
      cost: 10, effort: 3, drive: true, island: false, highlight: false, rainy: false,
      note: "部分步道与道路会因天气临时关闭，出发前需再次查询官方开放状态。",
      items: [
        ["08:00", "取车前往 El Yunque", "从圣胡安出发约 50–70 分钟", "租车"],
        ["09:40", "雨林步道与 La Mina 瀑布", "入园需提前预约，按开放情况调整停留点", "项目"],
        ["14:00", "Luquillo 海滩与小吃亭", "用轻松的海边傍晚结束当天", ""],
        ["17:30", "返回 Condado", "天黑前回到市区，错峰车流", ""],
      ],
    },
    culebra: {
      id: "culebra", name: "Culebra 跳岛", tags: ["beach", "photo", "nature"],
      title: "把一天留给透明的海", subtitle: "早起出发 · Ceiba 乘船 · 需预订", pace: "重点日",
      cost: 77, effort: 2, drive: true, island: true, highlight: false, rainy: true,
      note: "客运渡轮从 Ceiba 出发，不在圣胡安；官方建议提前 1 小时到达，登船前 10 分钟停止办理。",
      items: [
        ["06:30", "前往 Ceiba 码头", "驾车约 1–1.5 小时，留足停车时间", "导航"],
        ["09:00", "渡轮前往 Culebra", "示例班次，出行前以官方时刻为准", "船票"],
        ["10:30", "Flamenco Beach 浮潜", "上午海滩相对舒适，注意防晒与海况", "项目"],
        ["15:00", "码头附近补给", "返程船票通常售出后不退款", ""],
        ["17:30", "返回 Ceiba", "渡轮班次有限，预留排队时间", ""],
      ],
    },
    vieques: {
      id: "vieques", name: "Vieques 夜宿", tags: ["night", "beach", "nature"],
      title: "去最亮的生物湾过夜", subtitle: "留宿离岛 · 野马海滩 · 星空", pace: "重点日",
      cost: 165, effort: 2, drive: false, island: true, highlight: true, rainy: false,
      note: "Vieques 岛上租车选择少，建议抵达后叫车或预订接送；生物湾门票需提前在官网购买。",
      items: [
        ["07:30", "前往 Ceiba 码头", "提前 1 小时到达，办理登船", "船票"],
        ["09:00", "渡轮前往 Vieques", "约 1 小时航程", ""],
        ["10:30", "野马海滩与自由活动", "岛上野马是标志景观，注意保持距离", ""],
        ["17:30", "Mosquito Bay 生物湾集合", "天黑后出发，皮划艇夜航", "预订"],
        ["21:00", "离岛夜宿", "建议至少留宿一晚，次日再返回", "酒店"],
      ],
    },
    biobay: {
      id: "biobay", name: "生物湾之夜", tags: ["night", "nature"],
      title: "等待海面亮起来", subtitle: "白天留白 · 夜间皮划艇 · 月相提示", pace: "晚间",
      cost: 68, effort: 2, drive: true, island: false, highlight: true, rainy: true,
      note: "发光强度受月相、天气和水质影响，任何商家都无法保证肉眼效果。",
      items: [
        ["10:30", "Fajardo 海岸自由活动", "给前一天早起留出恢复时间", ""],
        ["15:00", "Seven Seas 海滩", "浅滩浮潜与吊床时间", ""],
        ["17:30", "项目集合与安全说明", "核对集合点、服装要求与退改政策", "项目"],
        ["19:30", "Laguna Grande 生物湾", "选择小团皮划艇体验，减少等待", "预订"],
      ],
    },
    "east-coast": {
      id: "east-coast", name: "东海岸慢游", tags: ["beach", "photo", "nature"],
      title: "把节奏放慢给海岸", subtitle: "Loíza 文化 · Luquillo 海滩 · 不赶路", pace: "轻松",
      cost: 0, effort: 1, drive: true, island: false, highlight: false, rainy: false,
      note: "Loíza 是非洲裔波多黎各文化重镇，周日有街头鼓乐与美食摊位。",
      items: [
        ["09:30", "Loíza 海岸文化路线", "从音乐、街区与小吃认识当地文化", "导航"],
        ["13:00", "Luquillo 海滩", "避开正午最晒时段，保留自由活动", ""],
        ["16:00", "海滩小吃亭下午茶", "kiosks 的炸鱼与果汁", "餐厅"],
        ["18:30", "返回 Condado", "日落前回程，错峰晚餐", ""],
      ],
    },
    rincon: {
      id: "rincon", name: "西海岸日落", tags: ["photo", "beach", "culture"],
      title: "追一场世界级日落", subtitle: "自驾横穿 · 冲浪小镇 · 灯塔", pace: "适度",
      cost: 0, effort: 2, drive: true, island: false, highlight: false, rainy: false,
      note: "从圣胡安到 Rincón 约 2 小时车程，回程走山路，建议日落前 30 分钟抵达观景点。",
      items: [
        ["09:00", "出发前往西海岸", "途经山区，路况以导航实时为准", "租车"],
        ["11:00", "Rincón 冲浪小镇", "逛灯塔与手工市集", ""],
        ["13:00", "海边午餐", "海鲜卷与本地果汁", "餐厅"],
        ["16:30", "日落观景点占位", "灯塔附近的观景平台视野最好", ""],
        ["19:00", "返程圣胡安", "夜路驾驶注意安全", ""],
      ],
    },
    "food-day": {
      id: "food-day", name: "美食环线", tags: ["food", "culture", "nature"],
      title: "用一天吃懂这座岛", subtitle: "咖啡庄园 · 山里烤乳猪 · 甜品收尾", pace: "轻松",
      cost: 63, effort: 1, drive: true, island: false, highlight: false, rainy: true,
      note: "Guavate 的 lechoneras 周末最热闹，周一至周三部分摊位休息，建议提前确认。",
      items: [
        ["08:30", "出发前往咖啡庄园", "山区车程约 1 小时", "租车"],
        ["10:00", "咖啡庄园导览与杯测", "看阿拉比卡种植与处理", "项目"],
        ["12:30", "Guavate 烤乳猪大道", "本地式午餐，配木薯与米饭", "餐厅"],
        ["16:00", "返回圣胡安", "下午可补一个老城甜品店", ""],
        ["19:00", "La Placita 夜市晚餐", "周中较安静，周末有现场音乐", "餐厅"],
      ],
    },
    "rain-day": {
      id: "rain-day", name: "雨天替代方案", tags: ["culture", "food"],
      title: "下雨也有好去处", subtitle: "室内路线 · 美食 · 老城遮雨", pace: "轻松",
      cost: 17, effort: 1, drive: false, island: false, highlight: false, rainy: true,
      note: "波多黎各阵雨通常来得快去得也快，备选方案按'室内优先'编排。",
      items: [
        ["10:00", "波多黎各艺术博物馆", "拉美现当代艺术，室内参观", "项目"],
        ["12:30", "老城午餐", "老建筑内的本地餐厅", "餐厅"],
        ["14:30", "Casa Blanca 与老城骑楼", "沿骑楼步行，基本不淋雨", ""],
        ["16:30", "朗姆酒厂室内场次", "含品酒，雨天经典项目", "项目"],
        ["19:00", "晚餐与甜品", "视雨势就近解决", "餐厅"],
      ],
    },
    sailing: {
      id: "sailing", name: "帆船日落巡航", tags: ["photo", "night", "beach"],
      title: "从海上告别这一天", subtitle: "白天留白 · 帆船日落 · 老城夜景", pace: "轻松",
      cost: 75, effort: 1, drive: false, island: false, highlight: false, rainy: true,
      note: "帆船项目对天气敏感，遇大风浪船公司会调整时间或退款，出发前留意通知。",
      items: [
        ["10:30", "老城自由活动", "购物与咖啡馆时间，弹性安排", ""],
        ["14:00", "Condado 海滩午休", "游泳、躺平或冲浪观察", ""],
        ["17:00", "日落帆船集合", "老城海港出发，提前 20 分钟到", "项目"],
        ["19:30", "下船晚餐", "港口附近的本地菜", "餐厅"],
      ],
    },
    "beach-easy": {
      id: "beach-easy", name: "海滩放空日", tags: ["beach", "photo"],
      title: "哪里都不赶的一天", subtitle: "就近海滩 · 吊床 · 海鲜晚餐", pace: "轻松",
      cost: 0, effort: 1, drive: false, island: false, highlight: false, rainy: true,
      note: "留白是行程的一部分：不安排任何需要准点集合的项目。",
      items: [
        ["09:30", "Condado 或 Ocean Park 海滩", "步行可达，带上午餐与水", ""],
        ["12:00", "海滩午餐", "餐车与小吃亭最地道", "餐厅"],
        ["15:00", "吊床与读书时间", "海边树荫下休息", ""],
        ["17:30", "日落散步", "沿海步道走到老城方向", ""],
        ["19:00", "海鲜晚餐", "视当日营业情况推荐", "餐厅"],
      ],
    },
  };

  // 偏好 → 可用日程模板（含权重）
  const PREF_TO_ARCHETYPES = {
    慢节奏:   ["beach-easy", "east-coast", "old-town", "sailing"],
    自然探索: ["rainforest", "east-coast", "camuy", "beach-easy"],
    跳岛浮潜: ["culebra", "vieques", "sailing", "east-coast"],
    在地文化: ["old-town", "food-day", "rincon", "sailing"],
    夜间体验: ["biobay", "vieques", "sailing", "salsa-night"],
    拍照打卡: ["old-town", "rincon", "culebra", "sailing", "east-coast"],
  };

  const PARTY_HINTS = {
    朋友: "朋友出行节奏偏快，重要项目尽量安排在上午，晚餐多留社交时间",
    情侣: "情侣出行会保留一个日落或晚餐场景，节奏更松弛",
    独自: "独自出行优先选择小团与向导项目，住宿选有公共空间的民宿",
    家庭: "家庭出行会避开强度大的徒步，海滩与轻松项目优先，注意儿童安全",
  };

  /* ------------------------------------------------------------------ *
   * 工具函数
   * ------------------------------------------------------------------ */

  const round5 = (n) => Math.round(n / 5) * 5;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  function parseDates(startStr, endStr) {
    const s = new Date(`${startStr}T12:00:00`);
    const e = new Date(`${endStr}T12:00:00`);
    const valid = !Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime());
    if (!valid) return { days: 5, label: "日期待定", start: null, end: null };
    const days = clamp(Math.round((e - s) / 86400000) + 1, 1, 7);
    const label = `${s.getMonth() + 1}月${s.getDate()}日–${e.getMonth() + 1}月${e.getDate()}日`;
    return { days, label, start: s, end: e };
  }

  /** 月相计算：给定日期字符串，返回月龄、照明度与生物湾建议 */
  function lunarPhase(dateStr) {
    const t = new Date(`${dateStr}T12:00:00`).getTime();
    const daysSinceEpoch = (t - KNOWN_NEW_MOON) / 86400000;
    const age = ((daysSinceEpoch % MOON_SYNODIC) + MOON_SYNODIC) % MOON_SYNODIC;
    const illum = Math.round(0.5 * (1 - Math.cos((2 * Math.PI * age) / MOON_SYNODIC)) * 100);
    let name;
    if (age < 1.85) name = "新月";
    else if (age < 7.38) name = "娥眉月";
    else if (age < 9.22) name = "上弦月";
    else if (age < 14.76) name = "盈凸月";
    else if (age < 16.62) name = "满月";
    else if (age < 22.15) name = "亏凸月";
    else if (age < 25.79) name = "下弦月";
    else name = "残月";
    const bright = Math.abs(age - 14.765) <= 3.5;
    const dark = Math.abs(age - 29.53) <= 3.5 || age <= 3.5;
    const advice = bright
      ? "行程靠近满月，生物湾发光会明显变弱，已优先安排白天项目，或建议把生物湾改到黑暗窗口"
      : dark
      ? "月暗窗口，生物湾观赏条件处于最佳区间"
      : "月光中等，生物湾可见度尚可，建议选择小团并避开云量大的时段";
    return {
      age: +age.toFixed(1), illum, name, bright, dark, advice,
      bioBayScore: dark ? "最佳" : bright ? "较弱" : "中等",
    };
  }

  function flightPrice(departure) {
    return round5(FLIGHT_TABLE[departure] || FLIGHT_DEFAULT);
  }

  function roomsFor(people, party) {
    if (party === "家庭") return Math.max(1, Math.ceil(people / 3));
    return Math.max(1, Math.ceil(people / 2));
  }

  function archetypeById(id) {
    return ARCHETYPES[id] || ARCHETYPES["beach-easy"];
  }

  /** 某日程是否为“必须保留”的重点日（夜间体验 / 跳岛偏好下） */
  function isHighlight(day) {
    return Boolean(day.highlight);
  }

  /* ------------------------------------------------------------------ *
   * 行程编排
   * ------------------------------------------------------------------ */

  /** 根据偏好为“中间日”打分排序，选出 count 个不重复的日程 */
  function pickMiddleDays(preferences, count, budgetPerPerson, moon) {
    if (count <= 0) return [];
    const prefs = preferences.slice(0, 3);
    const scored = [];
    Object.keys(ARCHETYPES).forEach((id) => {
      const day = ARCHETYPES[id];
      if (id === "arrival" || id === "departure") return;
      let score = 0;
      prefs.forEach((p, i) => {
        const list = PREF_TO_ARCHETYPES[p] || [];
        if (list.includes(id)) score += 4 - i;
      });
      // 夜间体验偏好：始终保留生物湾类日程
      if (prefs.includes("夜间体验") && (id === "biobay" || id === "vieques")) score += 5;
      if (prefs.includes("跳岛浮潜") && (id === "culebra" || id === "vieques")) score += 3;
      if (prefs.includes("慢节奏") && id === "beach-easy") score += 2;
      if (day.cost > budgetPerPerson * 0.2) score -= 2; // 预算敏感
      if (moon.bright && id === "biobay") score -= 3;   // 满月窗口降权
      if (moon.dark && id === "biobay") score += 3;
      scored.push({ id, score, order: day.cost ? 1 : 0 });
    });
    scored.sort((a, b) => b.score - a.score || b.order - a.order);
    const chosen = [];
    const usedRegions = [];

    // 偏好签名日保底：自然探索→雨林，夜间体验→生物湾，跳岛→Culebra
    const musts = [];
    if (prefs.includes("自然探索")) musts.push("rainforest");
    if (prefs.includes("夜间体验")) musts.push("biobay");
    if (prefs.includes("跳岛浮潜")) musts.push("culebra");
    musts.slice(0, count).forEach((id) => { chosen.push(id); usedRegions.push(islandKind(id)); });

    const tagsOverlap = (id) => {
      if (!chosen.length) return 0;
      const last = ARCHETYPES[chosen[chosen.length - 1]];
      const cur = ARCHETYPES[id];
      return (last.tags || []).filter((t) => (cur.tags || []).includes(t)).length;
    };
    scored.forEach(({ id, score }) => {
      if (score < 0 || chosen.includes(id)) return;
      if (chosen.length >= count) return;
      // 相邻同类日程：离岛日与离岛日隔开
      const sameAsLast = usedRegions.length && usedRegions[usedRegions.length - 1] === islandKind(id) && islandKind(id) !== null;
      if (sameAsLast && chosen.length < count && score <= 7) {
        const alt = scored.find((s) => !chosen.includes(s.id) && s.id !== id && islandKind(s.id) !== islandKind(id) && s.score >= 0);
        if (alt) { chosen.push(alt.id); usedRegions.push(islandKind(alt.id)); return; }
      }
      // 标签多样性：与上一天高度重叠且有替代时让位
      if (tagsOverlap(id) >= 2 && chosen.length < count) {
        const alt = scored.find((s) => !chosen.includes(s.id) && s.id !== id && tagsOverlap(s.id) < 2 && s.score >= 0);
        if (alt) { chosen.push(alt.id); usedRegions.push(islandKind(alt.id)); return; }
      }
      chosen.push(id);
      usedRegions.push(islandKind(id));
    });
    // 若 count 未满，用海滩放空日 / 老城补位
    const fillers = ["beach-easy", "old-town", "east-coast"];
    for (const f of fillers) {
      if (chosen.length >= count) break;
      if (!chosen.includes(f)) { chosen.push(f); usedRegions.push(islandKind(f)); }
    }
    return chosen.slice(0, count);
  }

  function islandKind(id) {
    return id === "culebra" || id === "vieques" ? "island" : id === "rainforest" || id === "food-day" || id === "rincon" ? "west" : null;
  }

  /**
   * 预算拟合：给定日程与输入，返回 { budget, warnings, plan }。
   * 收敛顺序：① 酒店降档 ② 餐饮降档 ③ 迭代替换付费项目为免费海滩日
   * ④ 预算富余时升级酒店 ⑤ 仍超支时如实提示差额。
   */
  function computeFit(daysPlan, input) {
    const days = daysPlan.length;
    const dateInfo = parseDates(input.start, input.end);
    const flight = flightPrice(input.departure);
    const limit = clamp(Number(input.budgetLimit) || 1500, 400, 10000);
    const warnings = [];
    const plan = daysPlan.map((d) => ({ ...d }));

    const compute = (tier, foodKey) => {
      const nights = Math.max(1, dateInfo.days - 1);
      const rooms = roomsFor(input.people, input.party);
      const perPersonHotel = Math.round((tier.perNight * nights * rooms) / input.people);
      const perPersonActivities = round5(sum(plan.map((d) => d.cost)));
      const carDays = plan.filter((d) => d.drive).length;
      const islandDays = plan.filter((d) => d.island).length;
      const perPersonTransport = Math.round(
        (carDays * 48) / input.people + islandDays * 10 + 28 / input.people
      );
      const perPersonFood = FOOD_TIERS[foodKey] * days;
      const subtotal = flight + perPersonHotel + perPersonActivities + perPersonTransport + perPersonFood;
      const buffer = Math.max(40, Math.round(subtotal * 0.08));
      return { flight, hotel: perPersonHotel, activities: perPersonActivities, transport: perPersonTransport, food: perPersonFood, buffer, total: subtotal + buffer, tier, foodKey };
    };

    let tier = HOTEL_TIERS[1];
    let foodKey = "comfort";
    let budget = compute(tier, foodKey);
    let guard = 0;
    while (budget.total > limit * 1.02 && guard < 6) {
      guard += 1;
      const idx = HOTEL_TIERS.findIndex((t) => t.id === tier.id);
      if (idx > 0) {
        tier = HOTEL_TIERS[idx - 1];
        warnings.push(`为匹配预算，酒店已从「${HOTEL_TIERS[idx].name}」调整为「${tier.name}」`);
        budget = compute(tier, foodKey);
        continue;
      }
      if (foodKey === "premium") { foodKey = "comfort"; warnings.push("餐饮预留已调整为舒适档"); budget = compute(tier, foodKey); continue; }
      if (foodKey === "comfort") { foodKey = "economy"; warnings.push("餐饮预留已调整为轻省档"); budget = compute(tier, foodKey); continue; }
      break;
    }
    guard = 0;
    while (budget.total > limit * 1.02 && guard < 8) {
      guard += 1;
      const di = plan.findIndex((d) => d.cost > 40 && !d.highlight && d.id !== "arrival" && d.id !== "departure");
      if (di < 0) break;
      warnings.push(`已把「${plan[di].name}」调整为免费的海滩放空日，以控制总预算`);
      plan[di] = { ...ARCHETYPES["beach-easy"] };
      budget = compute(tier, foodKey);
    }
    if (budget.total > limit * 1.02) {
      warnings.push(`已尽量压缩（机票与住宿属于刚性支出），仍超出预算约 $${budget.total - limit}；建议上调预算或缩短天数`);
    }
    return { budget, warnings, plan };
  }

  /** 根据输入的旅行意图构建完整行程对象（含预算与预订项） */
  function buildTrip(input) {
    const dateInfo = parseDates(input.start, input.end);
    const days = dateInfo.days;
    const moon = lunarPhase(input.start);
    const flight = flightPrice(input.departure);
    const budgetLimit = clamp(Number(input.budgetLimit) || 1500, 400, 10000);

    // 1) 编排中间日
    const middleIds = pickMiddleDays(input.preferences, days - 2, budgetLimit, moon);
    const plan = [
      ARCHETYPES.arrival,
      ...middleIds.map(archetypeById),
      ARCHETYPES.departure,
    ];

    // 2) 预算模型：先按舒适档试算，再向预算收敛（降档 / 替换付费项目 / 富余升级）
    const fit = computeFit(plan, input);
    const planFinal = fit.plan;
    const budget = fit.budget;
    const warnings = fit.warnings;

    // 3) 汇总文案
    const summary = summarize(input, planFinal, dateInfo, moon);

    // 4) 预订项与比价
    const bookings = buildBookings(input, planFinal, budget, days);

    const trip = {
      input: { ...input, budgetLimit },
      meta: { dateLabel: dateInfo.label, days, moon, warnings, summary, partyHint: PARTY_HINTS[input.party] || "" },
      days: planFinal,
      budget,
      bookings,
      edits: [],
    };
    return trip;
  }

  function summarize(input, plan, dateInfo, moon) {
    const prefs = input.preferences.slice(0, 3).join("、") || "轻松旅行";
    const highlights = plan.filter((d) => d.highlight || d.island || d.id === "rainforest").map((d) => d.name).slice(0, 3);
    const highlightText = highlights.length ? `，其中 ${highlights.join("、")} 会是最有记忆点的部分` : "";
    const moonText = moon.bioBayScore !== "中等" ? `，月相判断生物湾体验${moon.bioBayScore}` : "";
    return `${dateInfo.label}，${input.people} 人从 ${input.departure} 出发，${prefs}是这条路线的主线${highlightText}${moonText}；行程按天给出时间与交通安排，重要项目提前锁定，其余保留弹性。`;
  }

  /* ------------------------------------------------------------------ *
   * 预订与比价
   * ------------------------------------------------------------------ */

  function buildBookings(input, plan, budget, daysCount) {
    const island = plan.some((d) => d.island);
    const hasRainforest = plan.some((d) => d.id === "rainforest");
    const nights = Math.max(1, daysCount || parseDates(input.start, input.end).days) - 1;

    const books = [];
    books.push({
      type: "航班",
      title: `${input.departure}往返圣胡安`,
      desc: "优先直飞 · 含随身行李 · 时间友好",
      price: budget.flight,
      state: "可预订",
      options: [
        { name: "推荐 · 时间友好直飞", desc: "可免费改签一次 · 含随身行李", price: budget.flight },
        { name: "轻省 · 红眼或经停", desc: "价格更低 · 退改受限", price: round5(budget.flight * 0.82) },
        { name: "精品 · 舒适舱", desc: "优先选座 · 含托运行李", price: round5(budget.flight * 1.35) },
      ],
    });
    books.push({
      type: "酒店",
      title: `Condado 连住 ${Math.max(1, nights)} 晚`,
      desc: `${budget.tier.name} · ${budget.tier.note}`,
      price: budget.hotel,
      state: "3 个选项",
      options: [
        { name: "推荐 · 当前档位", desc: budget.tier.note, price: budget.hotel },
        { name: "轻省 · 相邻街区民宿", desc: "步行 10 分钟 · 公共空间更热闹", price: round5(budget.hotel * 0.78) },
        { name: "精品 · 海景升级", desc: "高层海景 · 含度假村设施", price: round5(budget.hotel * 1.3) },
      ],
    });
    // 重点项目：取行程里最贵的一个付费项目做三档比价
    const featured = plan
      .flatMap((d) => (d.items || []))
      .map((item) => ({ name: item[1], action: item[3], cost: activityCost(item[1]) }))
      .filter((x) => x.cost > 0)
      .sort((a, b) => b.cost - a.cost)[0];
    if (featured) {
      books.push({
        type: "项目",
        title: featured.name,
        desc: "小团体验 · 提前锁定 · 关注退改条款",
        price: featured.cost,
        state: "建议提前订",
        options: [
          { name: "推荐 · 兼顾时间与规则", desc: "可免费调整一次 · 条件清晰 · 评价稳定", price: featured.cost },
          { name: "轻省 · 基础场次", desc: "价格更低 · 不可退 · 需自行确认集合点", price: round5(featured.cost * 0.78) },
          { name: "精品 · 私人小团", desc: "人数更少 · 包含装备 · 改期更灵活", price: round5(featured.cost * 1.35) },
        ],
      });
    }
    if (island) {
      books.push({
        type: "交通",
        title: "Ceiba ↔ 离岛渡轮",
        desc: "官方渠道 · 往返 · 以实时班次为准",
        price: 10,
        state: "查看班次",
        options: [
          { name: "标准往返", desc: "官方票价 · 售出后一般不退款", price: 10 },
          { name: "早班保障", desc: "最早班次 · 减少排队", price: 12 },
        ],
      });
    }
    if (hasRainforest || plan.some((d) => d.drive)) {
      books.push({
        type: "租车",
        title: "SJU 机场取还",
        desc: "紧凑型 SUV · 基础险另计",
        price: Math.max(40, round5((plan.filter((d) => d.drive).length * 48) / input.people)),
        state: "2 个选项",
        options: [
          { name: "紧凑型 SUV", desc: "山路与海滩路况兼顾", price: Math.max(40, round5((plan.filter((d) => d.drive).length * 48) / input.people)) },
          { name: "升级四驱", desc: "雨林小路更稳妥", price: Math.max(48, round5((plan.filter((d) => d.drive).length * 62) / input.people)) },
        ],
      });
    }
    return books;
  }

  function activityCost(name) {
    const hit = ACTIVITIES.find((a) => a.name === name || name.includes(a.name));
    return hit ? hit.cost : 0;
  }

  /* ------------------------------------------------------------------ *
   * 内容生成：打包清单 / 话术 / 雨天备选
   * ------------------------------------------------------------------ */

  function seasonOf(startStr) {
    const m = startStr ? new Date(`${startStr}T12:00:00`).getMonth() + 1 : 1;
    return m >= 11 || m <= 4 ? "dry" : "wet";
  }

  function packingList(trip) {
    const tags = new Set();
    trip.days.forEach((d) => (d.tags || []).forEach((t) => tags.add(t)));
    const season = seasonOf(trip.input.start);
    const items = [
      "护照 / 政府签发的带照片证件（复印件与电子版各一份）",
      "手机与充电宝（导航与翻译依赖手机）",
      "防晒霜 SPF50+ 与防晒帽",
      "驱蚊液（黄昏与雨林必备）",
    ];
    if (tags.has("beach")) items.push("泳衣两套 · 防水手机袋 · 沙滩巾", "水鞋或凉拖（岩石海滩）");
    if (tags.has("nature")) items.push("防滑运动鞋 · 速干衣 · 小雨衣", "徒步水壶（建议 1L+）");
    if (tags.has("night")) items.push("防蚊长袖与长裤（生物湾夜航）", "头灯或小手电（暗光环境）");
    if (tags.has("photo")) items.push("运动相机或防水壳", "存储卡与备用电池");
    if (tags.has("food")) items.push("肠胃药与常用药", "湿巾（路边摊点餐后使用）");
    if (season === "wet") items.push("折叠伞或轻便雨衣", "速干衣物（阵雨常见）");
    else items.push("轻薄外套（空调与夜间海风）");
    items.push("美元现金小额（渡轮、小摊与停车）", "信用卡（主流场所通用）");
    return items;
  }

  function phrases(scenario) {
    const bank = {
      cancel: {
        title: "英文退改话术",
        intro: "给预订渠道发邮件或打电话时可参考：",
        items: [
          ["申请取消", "Hi, I booked [项目/日期] under the name [姓名]. I need to cancel and would like to know the refund policy. Please confirm any change fees. Thank you."],
          ["申请改期", "I'd like to reschedule my [项目] from [原日期] to [新日期]. Could you let me know if that's possible and whether there are any fees?"],
          ["天气原因", "The forecast shows heavy rain/wind on [日期]. Given the conditions, could we move or cancel without penalty?"],
        ],
      },
      order: {
        title: "点餐与问路（西语速成）",
        intro: "圣胡安老城与本地餐厅常用：",
        items: [
          ["点餐", "¿Me puede recomendar algo típico? — 能推荐本地特色吗？"],
          ["确认", "La cuenta, por favor. — 请结账。"],
          ["问路", "¿Dónde está la plaza? — 广场在哪里？"],
          ["感谢", "¡Gracias! Muy amable. — 谢谢！你真好。"],
        ],
      },
      taxi: {
        title: "打车与码头（西语）",
        intro: "打车、买船票时的关键词：",
        items: [
          ["打车", "¿Me lleva al aeropuerto, por favor? — 请送我去机场。"],
          ["买船票", "Dos boletos a Culebra, por favor. — 两张去 Culebra 的船票。"],
          ["时间", "¿A qué hora sale el próximo ferry? — 下一班渡轮几点？"],
          ["价格", "¿Cuánto cuesta? — 多少钱？"],
        ],
      },
      emergency: {
        title: "紧急情况（英文）",
        intro: "紧急情况请直接拨打 911；以下句子可帮你在现场沟通：",
        items: [
          ["求助", "I need help. Please call 911."],
          ["位置", "I'm at [地点/地标]. I need an ambulance / the police."],
          ["证件丢失", "I lost my passport. Can you direct me to the police station?"],
        ],
      },
    };
    return bank[scenario] || bank.order;
  }

  function rainPlan() {
    return {
      title: "雨天替代方案",
      items: [
        ["10:00", "波多黎各艺术博物馆", "拉美现当代艺术，室内参观", "项目"],
        ["12:30", "老城午餐", "老建筑内的本地餐厅", "餐厅"],
        ["14:30", "Casa Blanca 与老城骑楼", "沿骑楼步行，基本不淋雨", ""],
        ["16:30", "朗姆酒厂室内场次", "含品酒，雨天经典项目", "项目"],
        ["19:00", "晚餐与甜品", "视雨势就近解决", "餐厅"],
      ],
    };
  }

  /* ------------------------------------------------------------------ *
   * 编辑操作（纯函数：输入 trip，输出新 trip）
   * ------------------------------------------------------------------ */

  function cloneTrip(trip) {
    return JSON.parse(JSON.stringify(trip));
  }

  function applyEdit(trip, edit) {
    const next = cloneTrip(trip);
    const days = next.days;
    const idx = edit.day != null ? clamp(edit.day, 0, days.length - 1) : -1;
    switch (edit.op) {
      case "swap": {
        if (idx < 0) break;
        const arch = archetypeById(edit.arch);
        if (!arch) break;
        days[idx] = { ...arch, replacedFrom: days[idx].name };
        break;
      }
      case "add": {
        const arch = archetypeById(edit.arch);
        if (arch && days.length < 7) days.splice(days.length - 1, 0, { ...arch });
        break;
      }
      case "remove": {
        if (days.length > 2 && idx > 0 && idx < days.length - 1) days.splice(idx, 1);
        break;
      }
      case "budget": {
        const limit = clamp((Number(next.input.budgetLimit) || 1500) + (edit.delta || 0), 400, 10000);
        next.input.budgetLimit = limit;
        break;
      }
      default:
        break;
    }
    // 重新拟合预算（酒店/餐饮降档 + 付费项目替换）并重建预订项
    const fit = computeFit(next.days, next.input);
    next.days = fit.plan;
    next.budget = fit.budget;
    next.bookings = buildBookings(next.input, next.days, fit.budget, next.days.length);
    next.meta.warnings = fit.warnings;
    next.meta.days = next.days.length;
    next.meta.dateLabel = parseDates(next.input.start, next.input.end).label;
    next.meta.summary = summarize(next.input, next.days, parseDates(next.input.start, next.input.end), lunarPhase(next.input.start));
    if (!Array.isArray(next.edits)) next.edits = [];
    next.edits.push(edit);
    return next;
  }

  /* ------------------------------------------------------------------ *
   * 聊天引擎：自然语言 → {reply, cards, edits}
   * ------------------------------------------------------------------ */

  function answer(text, trip) {
    const t = String(text || "").trim().toLowerCase();
    if (!t) return { reply: "想怎么调整？可以试试：把某天换成海滩、降低预算、增加 Culebra，或者问我打包清单。" };

    // —— 目的地与背景知识类 ——
    if (t.includes("身份") || t.includes("签证") || t.includes("证件") || t.includes("绿卡") || t.includes("公民")) {
      return { reply: "波多黎各是美国领地，从美国本土前往通常属于境内旅行；但你的文件要求取决于具体身份状态（如 F-1、OPT、H-1B）。请携带政府签发的带照片证件，并就个案向学校 DSO 或移民律师核验——这里不提供法律结论。" };
    }
    if (t.includes("渡轮") || t.includes("船") || t.includes("ceiba") || t.includes("码头")) {
      return { reply: "前往 Culebra 与 Vieques 的客运渡轮从 Ceiba 出发，不是圣胡安。官方建议提前 1 小时到达，登船前 10 分钟停止办理；船票售出后一般不退款。已为你在行程里预留了驾车与停车时间。" };
    }
    if (t.includes("月相") || t.includes("月光") || t.includes("月亮") || t.includes("生物湾")) {
      const moon = lunarPhase(trip.input.start);
      return { reply: `行程出发日（${trip.meta.dateLabel}）月相为${moon.name}，月亮照明度约 ${moon.illum}%。${moon.advice}。生物湾体验判断：${moon.bioBayScore}。` };
    }
    if (t.includes("小费") || t.includes("支付") || t.includes("付钱") || t.includes("现金")) {
      return { reply: "圣胡安普遍接受信用卡；小费习惯与美国本土接近，餐厅 15–20%，导游与司机按服务量给。渡轮、小摊和停车常只收现金，建议备 $100 左右小额。" };
    }
    if (t.includes("下雨") || t.includes("台风") || t.includes("飓风") || t.includes("暴雨") || t.includes("雨天")) {
      const idx = middleDayIndex(trip, true);
      if (idx == null) return { reply: "这次行程比较短，没有适合替换的户外日。阵雨一般来得快去得也快，建议随身带一把折叠伞。" };
      return { reply: `已把第 ${idx + 1} 天替换为雨天替代路线：艺术博物馆、老城骑楼与朗姆酒厂都是室内项目，基本不受降雨影响。`, cards: { type: "timeline", title: "雨天替代方案", items: rainPlan().items }, edits: [{ op: "swap", day: idx, arch: "rain-day" }] };
    }
    if (t.includes("天气") || t.includes("温度") || t.includes("热") || t.includes("冷")) {
      return { reply: "当前版本未接入实时天气数据。波多黎各全年温暖（约 26–32°C），12 月–4 月相对干爽，5 月–10 月阵雨较多——我会按出发季节调整打包清单。真到出行时，以当地气象服务为准。" };
    }

    // —— 行程调整类 ——
    if ((t.includes("海滩") || t.includes("沙滩") || t.includes("躺平")) && !t.includes("雨林")) {
      const target = targetIndex(t, trip);
      const idx = target != null ? target : middleDayIndex(trip, false) ?? Math.min(trip.days.length - 2, 2);
      const arch = pickBeachArchetype(trip, idx);
      return {
        reply: `已把第 ${idx + 1} 天换成「${arch.name}」：${arch.subtitle}。${arch.note}`,
        edits: [{ op: "swap", day: idx, arch: arch.id }],
      };
    }
    if (t.includes("雨林") || t.includes("徒步") || t.includes("yunque")) {
      const target = targetIndex(t, trip);
      const idx = target != null ? target : middleDayIndex(trip, false) ?? Math.min(trip.days.length - 2, 1);
      return { reply: `已把第 ${idx + 1} 天换成「埃尔云克雨林」：上午雨林步道，下午 Luquillo 海滩收尾。入园需要提前预约，自驾约 50–70 分钟。`, edits: [{ op: "swap", day: idx, arch: "rainforest" }] };
    }
    if (t.includes("culebra") || t.includes("库莱布拉") || t.includes("跳岛")) {
      if (trip.days.some((d) => d.id === "culebra")) {
        return { reply: "Culebra 已经在行程里。我可以把它升级为留宿一晚（Vieques 式），或再增加一个离岛日——告诉我你的偏好？" };
      }
      const edits = trip.days.length < 6 ? [{ op: "swap", day: Math.min(trip.days.length - 2, 2), arch: "culebra" }] : [{ op: "swap", day: 2, arch: "culebra" }];
      return { reply: "已把跳岛日排进行程：早上从 Ceiba 乘船去 Culebra，Flamenco Beach 浮潜，傍晚返回。渡轮需要提前订，官方建议提前 1 小时到码头。", edits };
    }
    if (t.includes("增加") || t.includes("加一天") || t.includes("多一天") || t.includes("延长")) {
      if (trip.days.length >= 7) return { reply: "行程已经到 7 天上限。想加的话建议改出发/返程日期，天数变长后我会重新编排节奏。" };
      const edits = [{ op: "add", arch: "beach-easy" }];
      return { reply: "已在行程中增加一个海滩放空日，节奏更宽松。如果希望换成 Culebra 或生物湾，直接告诉我。" , edits };
    }
    if (t.includes("删") || t.includes("去掉") || t.includes("不要")) {
      const idx = targetIndex(t, trip);
      if (idx == null || trip.days.length <= 2) return { reply: "至少保留抵达与返程两天；想缩短行程请调整日期范围。" };
      return { reply: `已移除第 ${idx + 1} 天「${trip.days[idx].name}」，其余日程保持不变。`, edits: [{ op: "remove", day: idx }] };
    }
    if (t.includes("预算") || t.includes("降价") || t.includes("省钱") || t.includes("降低") || t.includes("超") || t.includes("贵")) {
      const m = t.match(/(\d+)\s*美元|\$\s*(\d+)/);
      const delta = m ? Number(m[1] || m[2]) : 150;
      return {
        reply: `正在按人均减少 $${delta} 重新优化：优先调整酒店档位与餐饮预留，保留所有重点项目。完成后我会把新的预算明细同步到「预算明细」页。`,
        edits: [{ op: "budget", delta: -delta }],
      };
    }

    // —— 内容生成类 ——
    if (t.includes("打包") || t.includes("行李") || t.includes("带什么") || t.includes("清单")) {
      return { reply: "根据你的行程（海滩、雨林与夜航项目）和出发季节，我生成了这份打包清单：", cards: { type: "list", title: "打包清单", items: packingList(trip) } };
    }
    if (t.includes("话术") || t.includes("退改") || t.includes("英文") || t.includes("取消")) {
      return { reply: "给你一份可以直接复制使用的英文退改话术：", cards: { type: "phrases", title: "英文退改话术", items: phrases("cancel").items } };
    }
    if (t.includes("西语") || t.includes("西班牙语") || t.includes("点餐")) {
      return { reply: "几句本地西语，点餐问路够用了：", cards: { type: "phrases", title: "点餐与问路", items: phrases("order").items } };
    }
    if (t.includes("紧急") || t.includes("911") || t.includes("求助")) {
      return { reply: "紧急情况请直接拨打 911（本地接警）。这几句英文能在现场帮你沟通：", cards: { type: "phrases", title: "紧急情况", items: phrases("emergency").items } };
    }
    if (t.includes("航班") || t.includes("延误") || t.includes("准点")) {
      return { reply: "当前是估算数据，不接入实时航班状态。出发当天请以航司 App 或机场大屏为准；建议为 SJU 安检预留至少 2 小时。" };
    }
    if (t.includes("你好") || t.includes("hi") || t.includes("hello") || t.includes("嗨")) {
      return { reply: `你好！我是你的波多黎各行程助手。当前行程 ${trip.meta.days} 天、人均 $${trip.budget.total.toLocaleString()}。可以让我换某一天的安排、调整预算，或生成打包清单和话术。` };
    }

    // —— 兜底 ——
    return {
      reply: "我理解你的意思，但当前版本还没覆盖这个操作。你可以试试：把某天换成海滩或雨林、降低预算、增加 Culebra、生成打包清单、生成英文话术、查月相或渡轮信息。",
    };
  }

  /* 从聊天文本中解析目标天序号（第 N 天 / day N / 具体日期），解析不到返回 null */
  function targetIndex(text, trip) {
    const m = String(text).match(/第\s*([一二三四五六七1234567])\s*天|day\s*([1-7])/i);
    if (m) {
      const c = m[1];
      const n = c && /\d/.test(c) ? Number(c) : "一二三四五六七".indexOf(c || "") + 1;
      return clamp(n - 1, 0, trip.days.length - 1);
    }
    const dm = String(text).match(/(\d{1,2})月(\d{1,2})日/);
    if (dm && trip.input.start) {
      const s = new Date(`${trip.input.start}T12:00:00`);
      const target = new Date(s.getFullYear(), Number(dm[1]) - 1, Number(dm[2]));
      const idx = Math.round((target - s) / 86400000);
      if (idx >= 0 && idx < trip.days.length) return idx;
    }
    return null;
  }

  /** 找一个适合替换的中间日（默认取最后一个非抵达/返程的户外日） */
  function middleDayIndex(trip, preferEffort) {
    const mids = [];
    for (let i = 1; i < trip.days.length - 1; i += 1) mids.push(i);
    if (!mids.length) return null;
    if (preferEffort) {
      const idx = mids.filter((i) => trip.days[i].effort >= 2 || trip.days[i].island).pop();
      if (idx != null) return idx;
    }
    return mids[mids.length - 1];
  }

  function pickBeachArchetype(trip, idx) {
    const islandOk = !trip.days.some((d) => d.id === "culebra" || d.id === "vieques");
    if (islandOk && trip.days.length >= 4) return ARCHETYPES.culebra;
    if (!trip.days.some((d) => d.id === "east-coast")) return ARCHETYPES["east-coast"];
    return ARCHETYPES["beach-easy"];
  }

  /* ------------------------------------------------------------------ *
   * 分享编码：把输入 + 编辑历史压缩进 URL hash
   * ------------------------------------------------------------------ */

  function encodeTrip(trip) {
    const payload = { input: trip.input, edits: trip.edits || [] };
    try {
      return btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    } catch (e) {
      return "";
    }
  }

  function decodeTrip(hash) {
    if (!hash) return null;
    try {
      const b64 = hash.replace(/-/g, "+").replace(/_/g, "/");
      const json = decodeURIComponent(escape(atob(b64)));
      const payload = JSON.parse(json);
      if (!payload || !payload.input) return null;
      return payload;
    } catch (e) {
      return null;
    }
  }

  /* ------------------------------------------------------------------ *
   * 导出
   * ------------------------------------------------------------------ */

  return {
    buildTrip,
    applyEdit,
    answer,
    lunarPhase,
    packingList,
    phrases,
    rainPlan,
    parseDates,
    encodeTrip,
    decodeTrip,
    flightPrice,
    roomsFor,
    ACTIVITIES,
    ARCHETYPES,
    HOTEL_TIERS,
    FLIGHT_TABLE,
    PREF_TO_ARCHETYPES,
    PARTY_HINTS,
  };
});
