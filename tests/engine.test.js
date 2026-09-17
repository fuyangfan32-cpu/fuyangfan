/*
 * engine.test.js — 生成引擎单元测试
 * 运行方式：node tests/engine.test.js
 * 覆盖：月相计算 / 行程编排 / 预算拟合 / 编辑操作 / 聊天意图 / 内容生成 / 分享编码
 */
"use strict";
const assert = require("assert");
const E = require("../engine.js");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

const BASE = { departure: "纽约", start: "2026-10-09", end: "2026-10-13", people: 2, party: "情侣", budgetLimit: 1500, preferences: ["慢节奏", "自然探索", "在地文化"] };

console.log("月相计算");
test("已知满月日期应判为 bright 并提示生物湾偏弱", () => {
  // 2026-10-26 为满月（照明度接近 100%）
  const moon = E.lunarPhase("2026-10-26");
  assert.ok(moon.illum >= 90, `照明度应较高，实际 ${moon.illum}`);
  assert.strictEqual(moon.bright, true);
  assert.ok(moon.advice.includes("满月"));
});
test("新月窗口应判为 dark 且生物湾最佳", () => {
  const moon = E.lunarPhase("2026-10-10");
  assert.strictEqual(moon.dark, true);
  assert.strictEqual(moon.bioBayScore, "最佳");
});
test("月龄应落在 [0, 29.53) 区间", () => {
  for (const d of ["2026-01-01", "2026-06-15", "2026-12-31"]) {
    const m = E.lunarPhase(d);
    assert.ok(m.age >= 0 && m.age < 29.54, `${d} 月龄 ${m.age}`);
    assert.ok(m.illum >= 0 && m.illum <= 100);
  }
});

console.log("行程编排");
test("5 天行程 = 抵达 + 3 中间日 + 返程，且包含首尾", () => {
  const trip = E.buildTrip(BASE);
  assert.strictEqual(trip.days.length, 5);
  assert.strictEqual(trip.days[0].id, "arrival");
  assert.strictEqual(trip.days[4].id, "departure");
  assert.strictEqual(trip.edits.length, 0);
});
test("夜间体验偏好应包含生物湾类日程", () => {
  const trip = E.buildTrip({ ...BASE, preferences: ["夜间体验"] });
  assert.ok(trip.days.some((d) => d.id === "biobay" || d.id === "vieques"), "应含 biobay 或 vieques");
});
test("相邻日程不应出现两个离岛日", () => {
  const trip = E.buildTrip({ ...BASE, preferences: ["跳岛浮潜", "拍照打卡"], budgetLimit: 2500 });
  for (let i = 1; i < trip.days.length - 1; i += 1) {
    const prev = trip.days[i - 1], cur = trip.days[i];
    assert.ok(!(prev.island && cur.island), `第 ${i} 与 ${i + 1} 天不应连续离岛`);
  }
});
test("2 天短行程只保留抵达与返程", () => {
  const trip = E.buildTrip({ ...BASE, start: "2026-10-09", end: "2026-10-10" });
  assert.strictEqual(trip.days.length, 2);
});

console.log("预算拟合");
test("预算总和 = 分项之和（机票+住宿+项目+交通+餐饮+机动金）", () => {
  const trip = E.buildTrip(BASE);
  const parts = [trip.budget.flight, trip.budget.hotel, trip.budget.activities, trip.budget.transport, trip.budget.food, trip.budget.buffer];
  assert.strictEqual(parts.reduce((a, b) => a + b, 0), trip.budget.total);
});
test("常规预算应落在预算上限附近或以内（允许 +2% 容差）", () => {
  const trip = E.buildTrip(BASE);
  assert.ok(trip.budget.total <= trip.input.budgetLimit * 1.02, `total ${trip.budget.total} 应 ≤ ${trip.input.budgetLimit * 1.02}`);
});
test("极紧预算应如实提示超支而非伪造低价", () => {
  const trip = E.buildTrip({ ...BASE, departure: "洛杉矶", people: 1, party: "独自", budgetLimit: 800 });
  if (trip.budget.total > 800) {
    assert.ok(trip.meta.warnings.some((w) => w.includes("超出")), "应包含超支提示");
  }
});
test("预算富余时保持舒适档不自动升级", () => {
  const trip = E.buildTrip({ ...BASE, budgetLimit: 3000, departure: "迈阿密" });
  assert.strictEqual(trip.budget.tier.id, "comfort");
});
test("降低预算编辑会真实改写预算并保留提示", () => {
  const trip = E.buildTrip(BASE);
  const r = E.answer("帮我把人均预算降低 150 美元", trip);
  let next = trip;
  (r.edits || []).forEach((ed) => { next = E.applyEdit(next, ed); });
  assert.strictEqual(next.input.budgetLimit, 1350);
  const parts = [next.budget.flight, next.budget.hotel, next.budget.activities, next.budget.transport, next.budget.food, next.budget.buffer];
  assert.strictEqual(parts.reduce((a, b) => a + b, 0), next.budget.total);
});

console.log("编辑操作");
test("swap 会把指定天替换为海滩日并留下 replacedFrom 标记", () => {
  const trip = E.buildTrip(BASE);
  const next = E.applyEdit(trip, { op: "swap", day: 1, arch: "beach-easy" });
  assert.strictEqual(next.days[1].id, "beach-easy");
  assert.ok(next.days[1].replacedFrom);
  assert.strictEqual(next.edits.length, 1);
});
test("add 在返程日前插入一天且不超过 7 天上限", () => {
  const trip = E.buildTrip(BASE);
  let next = trip;
  for (let i = 0; i < 6; i += 1) next = E.applyEdit(next, { op: "add", arch: "beach-easy" });
  assert.ok(next.days.length <= 7);
});
test("remove 不允许删除抵达日或返程日", () => {
  const trip = E.buildTrip(BASE);
  const next = E.applyEdit(trip, { op: "remove", day: 0 });
  assert.strictEqual(next.days[0].id, "arrival");
});

console.log("聊天意图");
test("海滩意图返回可执行的 swap 编辑", () => {
  const trip = E.buildTrip(BASE);
  const r = E.answer("把第二天换成海滩", trip);
  assert.ok(r.edits && r.edits.length === 1 && r.edits[0].op === "swap");
});
test("雨天意图返回 rain-day 与时间线卡片", () => {
  const trip = E.buildTrip(BASE);
  const r = E.answer("如果下雨，重新安排当天行程", trip);
  assert.ok(r.edits && r.edits[0].arch === "rain-day");
  assert.strictEqual(r.cards.type, "timeline");
});
test("打包清单意图返回 list 卡片", () => {
  const trip = E.buildTrip(BASE);
  const r = E.answer("出海需要带什么？", trip);
  assert.strictEqual(r.cards.type, "list");
  assert.ok(r.cards.items.length >= 6);
});
test("话术意图返回 phrases 卡片", () => {
  const trip = E.buildTrip(BASE);
  const r = E.answer("生成英文退改话术", trip);
  assert.strictEqual(r.cards.type, "phrases");
  assert.ok(r.cards.items.length >= 3);
});
test("身份问题给出合规提示且不构成法律结论", () => {
  const trip = E.buildTrip(BASE);
  const r = E.answer("我持 F-1 签证可以去吗", trip);
  assert.ok(r.reply.includes("DSO") || r.reply.includes("移民律师"));
  assert.ok(r.reply.includes("不提供法律结论") || r.reply.includes("不构成法律意见"));
});
test("未知输入优雅兜底并给出可尝试的操作", () => {
  const trip = E.buildTrip(BASE);
  const r = E.answer("今天晚饭吃什么", trip);
  assert.ok(r.reply.includes("你可以试试"));
});
test("第 N 天定位：明确指定某天时替换该天", () => {
  const trip = E.buildTrip(BASE);
  const r = E.answer("把第 3 天换成海滩", trip);
  assert.strictEqual(r.edits[0].day, 2); // 0-based
});

console.log("内容生成");
test("打包清单按季节与活动标签生成", () => {
  const trip = E.buildTrip(BASE);
  const wet = E.packingList({ ...trip, input: { ...trip.input, start: "2026-07-01" } });
  const dry = E.packingList(trip);
  assert.notStrictEqual(wet.length, 0);
  assert.notStrictEqual(dry.length, 0);
});
test("话术库四个场景均可取", () => {
  for (const s of ["cancel", "order", "taxi", "emergency"]) {
    assert.ok(E.phrases(s).items.length >= 2, s);
  }
});

console.log("分享编码");
test("encode → decode 往返一致", () => {
  const trip = E.buildTrip(BASE);
  const edited = E.applyEdit(trip, { op: "swap", day: 2, arch: "biobay" });
  const hash = E.encodeTrip(edited);
  const payload = E.decodeTrip(hash);
  assert.strictEqual(payload.input.departure, "纽约");
  assert.strictEqual(payload.edits.length, 1);
  assert.strictEqual(payload.edits[0].arch, "biobay");
});
test("非法 hash 返回 null", () => {
  assert.strictEqual(E.decodeTrip("!!!not-valid!!!"), null);
  assert.strictEqual(E.decodeTrip(""), null);
});

console.log(`\n通过 ${passed} 项断言组`);
if (process.exitCode) {
  console.error("存在失败用例");
  process.exit(1);
}
