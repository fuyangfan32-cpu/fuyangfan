/*
 * app.js — Boricua 旅行 Agent 界面与交互层
 * ---------------------------------------------------------
 * 依赖 engine.js（window.TripEngine）。
 * 职责：规划向导、行程渲染、聊天意图执行、比价弹窗、分享/保存。
 * 所有业务逻辑（行程生成、预算、月相、内容生成）都在引擎层，
 * 本文件只负责把它们接到 DOM 上。
 */
(function () {
  "use strict";
  const E = window.TripEngine;

  const BUDGET_COLORS = {
    flight: "#0b7878",
    hotel: "#f06f51",
    activities: "#f7c85c",
    transport: "#8bc6b8",
    food: "#c9d6d0",
    buffer: "#e4ebe8",
  };

  const state = {
    step: 1,
    people: 2,
    party: "朋友",
    preferences: new Set(["慢节奏", "自然探索", "在地文化"]),
    trip: null,
    activeTab: "itinerary",
    activeDay: 1,
    bookingFilter: "全部",
    saved: localStorage.getItem("boricua-saved") === "true",
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2400);
  }

  /* ------------------------------------------------------------------ *
   * 规划向导
   * ------------------------------------------------------------------ */

  const plannerCopy = {
    1: ["先从哪里出发？", "我会用出发地估算飞行时间和机票预算。", "多数美国东海岸城市都有前往圣胡安的直飞航班。"],
    2: ["把日期交给我。", "日期会影响机票价格、月相和项目可订状态。", "波多黎各全年温暖，但天气和海况仍会改变实际安排。"],
    3: ["谁和你一起去？", "人数与出行关系会改变房型、交通和行程节奏。", "离岛交通座位有限，多人出行更需要提前锁定。"],
    4: ["舒服地花多少钱？", "先确定人均上限，我会主动做取舍。", "预算是区间估算，最终金额以预订渠道结算页为准。"],
    5: ["选出旅行关键词。", "最多选 3 个，我会用它们决定路线优先级。", "不要追求景点全覆盖，波多黎各更适合留一点即兴空间。"],
  };

  function openPlanner() {
    state.step = 1;
    updatePlannerStep();
    $("#plannerModal").classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function closePlanner() {
    $("#plannerModal").classList.add("hidden");
    document.body.style.overflow = "";
  }

  function updatePlannerStep() {
    $$(".question-step").forEach((el) => el.classList.toggle("active", Number(el.dataset.step) === state.step));
    const [title, hint, fact] = plannerCopy[state.step];
    $("#plannerTitle").textContent = title;
    $("#plannerHint").textContent = hint;
    $("#plannerFact").textContent = fact;
    $("#stepLabel").textContent = state.step;
    $("#progressFill").style.width = `${state.step * 20}%`;
    $("#plannerBack").classList.toggle("invisible", state.step === 1);
    $("#plannerNext").textContent = state.step === 5 ? "生成行程 ✦" : "继续 →";
  }

  function collectInput() {
    return {
      departure: $("#departure").value.trim() || "纽约",
      start: $("#startDate").value,
      end: $("#endDate").value,
      people: state.people,
      party: state.party,
      budgetLimit: Number($("#budgetInput").value) || 1500,
      preferences: [...state.preferences],
    };
  }

  function generateTrip(input, opts = {}) {
    const next = $("#plannerNext");
    if (next) {
      next.disabled = true;
      next.textContent = opts.label || "正在编排行程…";
    }
    setTimeout(() => {
      const trip = E.buildTrip(input);
      state.trip = trip;
      state.activeTab = "itinerary";
      state.activeDay = 1;
      state.bookingFilter = "全部";
      enterDashboard();
      if (next) { next.disabled = false; next.textContent = "生成行程 ✦"; }
      closePlanner();
      window.scrollTo(0, 0);
      showToast(`${trip.meta.days} 日波多黎各行程已生成`);
    }, opts.instant ? 0 : 1100);
  }

  function enterDashboard() {
    const trip = state.trip;
    $("#welcomeView").classList.add("hidden");
    $("#dashboardView").classList.remove("hidden");
    $("#tripDaysTitle").textContent = trip.meta.days;
    $("#departureMeta").textContent = trip.input.departure;
    $("#dateMeta").textContent = trip.meta.dateLabel;
    $("#peopleMeta").textContent = `${trip.input.people} 人 · ${trip.input.party}`;
    $("#tripSummary").textContent = trip.meta.summary;
    $("#budgetTop").textContent = `$${trip.budget.total.toLocaleString()}`;
    $("#budgetStatus").textContent = trip.budget.total <= trip.input.budgetLimit ? "在预算范围内" : "超出预算 · 已提示优化";
    $("#tripLabel").textContent = `${trip.input.departure} → 波多黎各`;
    $("#bookingCount").textContent = trip.bookings.length;
    $("#moonChip").innerHTML = moonChipHtml(trip);
    renderWarnings(trip);
    renderActiveTab();
  }

  function moonChipHtml(trip) {
    const moon = trip.meta.moon;
    if (!trip.days.some((d) => d.id === "biobay" || d.id === "vieques")) return "";
    const cls = moon.dark ? "good" : moon.bright ? "bad" : "";
    return `<span class="moon-chip ${cls}">月相 ${moon.name} · ${moon.illum}% · 生物湾${moon.bioBayScore}</span>`;
  }

  function renderWarnings(trip) {
    const box = $("#warningBox");
    const list = trip.meta.warnings || [];
    box.innerHTML = list.length
      ? `<div class="warning-strip">${list.map((w) => `<span>${escapeHtml(w)}</span>`).join("")}</div>`
      : "";
    box.classList.toggle("hidden", !list.length);
  }

  /* ------------------------------------------------------------------ *
   * 视图渲染
   * ------------------------------------------------------------------ */

  function renderActiveTab() {
    $$("#tripTabs button").forEach((button) => button.classList.toggle("active", button.dataset.tab === state.activeTab));
    const renders = { itinerary: renderItinerary, bookings: renderBookings, assistant: renderAssistant, budget: renderBudget };
    $("#tabContent").innerHTML = renders[state.activeTab]();
  }

  function renderItinerary() {
    const trip = state.trip;
    return `<div class="itinerary-layout"><aside class="day-rail">${trip.days.map((d, i) => `<button class="day-button ${d.id === trip.days[state.activeDay - 1]?.id && i === state.activeDay - 1 ? "active" : ""}" data-day="${i + 1}"><span class="day-number">${i + 1}</span><div><strong>${escapeHtml(d.name)}</strong><small>${escapeHtml(d.tags.includes("arrival") ? "抵达日" : d.tags.includes("departure") ? "返程日" : "行程日")}</small></div></button>`).join("")}</aside><div id="dayDetail">${renderDay(state.activeDay)}</div></div>`;
  }

  function renderDay(dayNumber) {
    const day = state.trip.days[dayNumber - 1] || state.trip.days[0];
    return `<article class="day-content-card"><header class="day-header"><div><small>DAY ${dayNumber} · ${state.trip.meta.dateLabel.split("–")[0]} 起第 ${dayNumber} 天</small><h2>${escapeHtml(day.title)}</h2><p>${escapeHtml(day.subtitle)}</p></div><span class="pace-pill">${escapeHtml(day.pace)}</span></header><div class="timeline">${(day.items || []).map(([time, name, desc, action]) => `<div class="timeline-item"><span class="timeline-time">${escapeHtml(time)}</span><span class="timeline-marker"><i></i><b></b></span><div class="timeline-copy"><strong>${escapeHtml(name)}</strong><p>${escapeHtml(desc)}</p></div>${action ? `<button class="book-inline" data-book="${escapeHtml(action)}" data-day="${dayNumber}">${escapeHtml(action)} ↗</button>` : ""}</div>`).join("")}</div><div class="local-note-inline"><b>实测提示：</b>${escapeHtml(day.note)}${day.replacedFrom ? `<span class="replaced-tag">已按你的要求替换原「${escapeHtml(day.replacedFrom)}」</span>` : ""}</div></article>`;
  }

  function renderBookings() {
    const trip = state.trip;
    const filterMap = { 全部: () => true, 交通: (b) => b.type === "交通" || b.type === "租车", 住宿: (b) => b.type === "酒店", 体验: (b) => b.type === "项目" };
    const items = trip.bookings.filter(filterMap[state.bookingFilter] || filterMap["全部"]);
    return `<div class="booking-header"><div><span class="kicker">BOOKING HUB</span><h2>需要提前确认的项目</h2></div><div class="booking-filter">${["全部", "交通", "住宿", "体验"].map((f) => `<button class="${state.bookingFilter === f ? "active" : ""}" data-bf="${f}">${f}</button>`).join("")}</div></div><p class="booking-note">价格为生成时的估算区间，实际会随日期与库存变动；确认前请以官方渠道为准。</p><div class="booking-list">${items.length ? items.map((item) => `<article class="booking-card"><div class="booking-card-top"><span class="booking-type">${escapeHtml(item.type)}</span><span class="booking-state">${escapeHtml(item.state)}</span></div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.desc)}</p><footer class="booking-card-footer"><div><small>估算起价 / 人</small><strong>$${item.price.toLocaleString()}</strong></div><button data-booking="${escapeHtml(item.title)}">比较选项</button></footer></article>`).join("") : `<p class="empty-note">该分类下暂无项目。</p>`}</div>`;
  }

  function renderAssistant() {
    return `<div class="assistant-header"><div><span class="kicker">ON-TRIP SUPPORT</span><h2>行程发生变化，也有下一步。</h2></div><p>以下为生成时的状态快照，不代表实时数据。</p></div><div class="assistant-grid"><section class="live-card"><div class="live-status"><span class="weather-icon">☀</span><div><strong>San Juan · 体感 30°C</strong><small>生成时快照 · 出发前需刷新实时状态</small></div></div><div class="service-list"><div class="service-item"><span>⛴</span><div><strong>Ceiba 渡轮服务状态</strong><small>查看官方提醒与时刻表</small></div><button data-help="ferry">查询</button></div><div class="service-item"><span>✈</span><div><strong>返程航班动态</strong><small>以航司 App 与机场大屏为准</small></div><button data-help="flight">查询</button></div><div class="service-item"><span>☂</span><div><strong>雨天替代方案</strong><small>自动重排当天，尽量保留已购项目</small></div><button data-help="rain">生成</button></div></div></section><aside class="help-card"><h3>你可能马上需要</h3><button data-help="cancel">生成英文退改话术 →</button><button data-help="packing">查看出海必备清单 →</button><button data-help="tips">当地小费与支付建议 →</button><div class="emergency-box"><b>紧急情况请拨 911</b><br />产品提供信息辅助，不替代警方、医疗或官方机构。</div></aside></div>`;
  }

  function renderBudget() {
    const trip = state.trip;
    const b = trip.budget;
    const segments = [
      ["flight", "机票", b.flight],
      ["hotel", "住宿", b.hotel],
      ["activities", "当地项目", b.activities],
      ["transport", "交通", b.transport],
      ["food", "餐饮预留", b.food],
      ["buffer", "机动金", b.buffer],
    ];
    const total = segments.reduce((a, s) => a + s[2], 0) || 1;
    let acc = 0;
    const stops = segments.map(([key, label, value]) => {
      const from = (acc / total) * 100;
      acc += value;
      const to = (acc / total) * 100;
      return `${BUDGET_COLORS[key]} ${from.toFixed(1)}% ${to.toFixed(1)}%`;
    }).join(", ");
    const leftover = Math.max(0, trip.input.budgetLimit - b.total);
    return `<div class="budget-header"><div><span class="kicker">BUDGET VIEW</span><h2>每一笔都知道花在哪里</h2></div><p>人均估算，实际价格会随日期与库存变化。</p></div><div class="budget-grid"><section class="budget-chart-card"><div class="donut" style="background: conic-gradient(${stops})"><div><small>人均预估</small><strong>$${b.total.toLocaleString()}</strong><small>上限 $${trip.input.budgetLimit.toLocaleString()}</small></div></div></section><section class="budget-list-card"><div class="budget-lines">${segments.map(([key, label, value]) => `<div class="budget-line"><i style="background:${BUDGET_COLORS[key]}"></i><span>${label}</span><strong>$${value.toLocaleString()}</strong></div>`).join("")}</div><div class="budget-total"><div><small>预算余量</small><strong>$${leftover.toLocaleString()}</strong></div><button id="optimizeBudget">优化预算</button></div></section></div>`;
  }

  /* ------------------------------------------------------------------ *
   * 弹窗
   * ------------------------------------------------------------------ */

  function openDetails(type, title = "") {
    const modal = $("#detailModal");
    const content = $("#detailModalContent");
    if (type === "identity") {
      content.innerHTML = `<span class="kicker">TRAVEL DOCUMENTS</span><h2>境内目的地，不等于无需核验文件</h2><p>波多黎各属于美国领地，从美国本土前往通常属于境内旅行；但非美国公民的合法停留状态、个案限制和所需证件并不完全相同。产品不会承诺“绝对不影响身份”。</p><div class="legal-box">建议携带政府签发的带照片证件，并根据自己的 F-1、OPT、H-1B 或其他身份咨询学校 DSO 或合格移民律师。任何行程助手提示都不构成法律意见。</div><div class="source-links"><a href="https://www.uscis.gov/" target="_blank" rel="noreferrer">USCIS 官方信息 ↗</a><a href="https://www.cbp.gov/" target="_blank" rel="noreferrer">CBP 官方信息 ↗</a></div>`;
    } else if (type === "ferry") {
      content.innerHTML = `<span class="kicker">OFFICIAL FERRY</span><h2>Ceiba 离岛渡轮</h2><p>Culebra 与 Vieques 客运航线均从 Ceiba 出发。生成的行程已预留从圣胡安前往码头、停车和提前抵达的时间。</p><div class="detail-option selected"><div><strong>Ceiba → Culebra</strong><p>约 1 小时 30 分钟 · 官方建议提前 1 小时抵达</p></div><aside><strong>查看</strong><small>实时班次</small></aside></div><div class="detail-option"><div><strong>Ceiba → Vieques</strong><p>约 1 小时 · 售出后通常不退款</p></div><aside><strong>查看</strong><small>实时班次</small></aside></div><div class="detail-footer"><span>最终时刻与规则以官方页面为准</span><button onclick="window.open('https://www.puertoricoferry.com/', '_blank')">前往官方渡轮网站 ↗</button></div>`;
    } else {
      const booking = state.trip.bookings.find((b) => b.title === title) || state.trip.bookings.find((b) => b.type === type);
      const options = booking?.options || [];
      content.innerHTML = `<span class="kicker">COMPARE OPTIONS</span><h2>${escapeHtml(booking?.title || title)}</h2><p>这是行程助手调用预订比价后的结构化结果：价格随日期与库存变动，确认前请以官方渠道为准。</p>${options.map((o, i) => `<div class="detail-option ${i === 0 ? "selected" : ""}"><div><strong>${escapeHtml(o.name)}</strong><p>${escapeHtml(o.desc)}</p></div><aside><strong>$${o.price.toLocaleString()}</strong><small>估算 / 人</small></aside></div>`).join("")}<div class="detail-footer"><span>估算数据 · 不构成真实报价</span><button id="officialOutbound">前往官方渠道 ↗</button></div>`;
    }
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function closeDetails() {
    $("#detailModal").classList.add("hidden");
    document.body.style.overflow = "";
  }

  /* ------------------------------------------------------------------ *
   * 聊天
   * ------------------------------------------------------------------ */

  function appendMessage(role, text, cards) {
    const thread = $("#chatThread");
    const cardHtml = cards ? renderCards(cards) : "";
    thread.insertAdjacentHTML(
      "beforeend",
      `<div class="message ${role === "user" ? "user-message" : "agent-message"}">${role === "user" ? "" : `<span class="mini-avatar">B</span>`}<div><p>${escapeHtml(text)}</p>${cardHtml}<small>刚刚</small></div></div>`
    );
    thread.scrollTop = thread.scrollHeight;
  }

  function renderCards(cards) {
    if (cards.type === "list") {
      return `<div class="chat-card chat-list"><h4>${escapeHtml(cards.title)}</h4><ul>${cards.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul></div>`;
    }
    if (cards.type === "phrases") {
      return `<div class="chat-card chat-phrases"><h4>${escapeHtml(cards.title)}</h4>${cards.items.map(([label, text]) => `<div class="phrase-row"><span>${escapeHtml(label)}</span><p>${escapeHtml(text)}</p></div>`).join("")}</div>`;
    }
    if (cards.type === "timeline") {
      return `<div class="chat-card chat-timeline"><h4>${escapeHtml(cards.title)}</h4>${cards.items.map(([time, name, desc]) => `<div class="chat-tl-row"><b>${escapeHtml(time)}</b><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(desc)}</small></span></div>`).join("")}</div>`;
    }
    return "";
  }

  function assistantReply(text) {
    const prompt = String(text || "").trim();
    if (!prompt || !state.trip) return;
    appendMessage("user", prompt);
    const result = E.answer(prompt, state.trip);
    let reply = result.reply;
    setTimeout(() => {
      if (result.edits && result.edits.length) {
        result.edits.forEach((edit) => {
          state.trip = E.applyEdit(state.trip, edit);
        });
        const trip = state.trip;
        $("#budgetTop").textContent = `$${trip.budget.total.toLocaleString()}`;
        $("#budgetStatus").textContent = trip.budget.total <= trip.input.budgetLimit ? "在预算范围内" : "超出预算 · 已提示优化";
        $("#tripSummary").textContent = trip.meta.summary;
        $("#tripDaysTitle").textContent = trip.meta.days;
        $("#dateMeta").textContent = trip.meta.dateLabel;
        $("#bookingCount").textContent = trip.bookings.length;
        $("#moonChip").innerHTML = moonChipHtml(trip);
        renderWarnings(trip);
        if (state.activeTab === "itinerary" && state.activeDay > trip.days.length) state.activeDay = trip.days.length;
        if (state.activeTab === "itinerary" || state.activeTab === "bookings" || state.activeTab === "budget") renderActiveTab();
        if (result.edits.some((e) => e.op === "remove" || e.op === "add")) {
          state.activeDay = Math.min(state.activeDay, trip.days.length);
        }
      }
      appendMessage("agent", reply, result.cards);
    }, 550);
  }

  /* ------------------------------------------------------------------ *
   * 分享 / 保存
   * ------------------------------------------------------------------ */

  function shareTrip() {
    if (!state.trip) return showToast("先生成一份行程再分享");
    const hash = E.encodeTrip(state.trip);
    location.hash = `trip=${hash}`;
    const url = `${location.origin}${location.pathname}#trip=${hash}`;
    try {
      navigator.clipboard.writeText(url);
      showToast("行程链接已复制，打开即可还原这份行程");
    } catch (e) {
      showToast("复制需要浏览器授权，请手动复制地址栏链接");
    }
  }

  function loadSharedTrip() {
    const m = location.hash.match(/^#trip=(.+)$/);
    if (!m) return false;
    const payload = E.decodeTrip(m[1]);
    if (!payload) return false;
    let trip = E.buildTrip(payload.input);
    (payload.edits || []).forEach((edit) => {
      trip = E.applyEdit(trip, edit);
    });
    state.trip = trip;
    state.activeTab = "itinerary";
    state.activeDay = 1;
    enterDashboard();
    return true;
  }

  function toggleSave() {
    state.saved = !state.saved;
    $("#saveButton").textContent = state.saved ? "♥ 已保存" : "♡ 保存行程";
    localStorage.setItem("boricua-saved", String(state.saved));
    showToast(state.saved ? "行程已保存在本机" : "已取消保存");
  }

  /* ------------------------------------------------------------------ *
   * 事件绑定
   * ------------------------------------------------------------------ */

  $$(".start-planning").forEach((button) => button.addEventListener("click", openPlanner));
  $("#previewButton").addEventListener("click", () => {
    const input = { departure: "纽约", start: "2026-10-09", end: "2026-10-13", people: 2, party: "朋友", budgetLimit: 1500, preferences: ["慢节奏", "自然探索", "在地文化"] };
    generateTrip(input, { instant: true, label: "正在生成示例行程…" });
  });
  $("#historyButton").addEventListener("click", () => showToast("暂无历史行程，先生成第一份吧"));
  $("#brandButton").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  $$("[data-scroll]").forEach((button) => button.addEventListener("click", () => $(`#${button.dataset.scroll}`)?.scrollIntoView({ behavior: "smooth" })));
  $$("[data-close-modal]").forEach((button) => button.addEventListener("click", closePlanner));
  $("#plannerModal").addEventListener("click", (event) => { if (event.target === $("#plannerModal")) closePlanner(); });
  $("#plannerNext").addEventListener("click", () => { if (state.step < 5) { state.step += 1; updatePlannerStep(); } else generateTrip(collectInput()); });
  $("#plannerBack").addEventListener("click", () => { if (state.step > 1) { state.step -= 1; updatePlannerStep(); } });
  $$("[data-fill]").forEach((button) => button.addEventListener("click", () => { $("#departure").value = button.dataset.fill; }));
  $("#minusPeople").addEventListener("click", () => { state.people = Math.max(1, state.people - 1); $("#peopleCount").textContent = state.people; });
  $("#plusPeople").addEventListener("click", () => { state.people = Math.min(8, state.people + 1); $("#peopleCount").textContent = state.people; });
  $$("[data-party]").forEach((button) => button.addEventListener("click", () => { $$("[data-party]").forEach((b) => b.classList.remove("active")); button.classList.add("active"); state.party = button.dataset.party; }));
  $("#budgetRange").addEventListener("input", (event) => { $("#budgetInput").value = event.target.value; });
  $("#budgetInput").addEventListener("input", (event) => { $("#budgetRange").value = Math.min(4000, Math.max(500, event.target.value || 500)); });
  $$("[data-pref]").forEach((button) => button.addEventListener("click", () => {
    const pref = button.dataset.pref;
    if (state.preferences.has(pref)) { state.preferences.delete(pref); button.classList.remove("active"); }
    else if (state.preferences.size < 3) { state.preferences.add(pref); button.classList.add("active"); }
    else showToast("最多选择 3 个旅行关键词");
  }));

  document.addEventListener("click", (event) => {
    const day = event.target.closest("[data-day]");
    if (day) { state.activeDay = Number(day.dataset.day); renderActiveTab(); return; }
    const book = event.target.closest("[data-book]");
    if (book) { openDetails(book.dataset.book === "船票" ? "ferry" : book.dataset.book); return; }
    const booking = event.target.closest("[data-booking]");
    if (booking) { openDetails("compare", booking.dataset.booking); return; }
    const bf = event.target.closest("[data-bf]");
    if (bf) { state.bookingFilter = bf.dataset.bf; renderActiveTab(); return; }
    const help = event.target.closest("[data-help]");
    if (help) {
      const prompts = { ferry: "帮我查一下去 Culebra 的渡轮", flight: "帮我查返程航班", rain: "如果下雨，重新安排当天行程", cancel: "生成英文退改话术", packing: "出海需要带什么？", tips: "当地怎么付小费？" };
      assistantReply(prompts[help.dataset.help]);
      return;
    }
    const budgetTab = event.target.closest("[data-tab-target]");
    if (budgetTab) { state.activeTab = budgetTab.dataset.tabTarget; renderActiveTab(); return; }
    if (event.target.id === "optimizeBudget") assistantReply("帮我把人均预算降低 150 美元");
    if (event.target.id === "officialOutbound") { showToast("已跳转官方渠道（此环境不发起真实交易）"); closeDetails(); }
  });

  $("#tripTabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-tab]");
    if (!button) return;
    state.activeTab = button.dataset.tab;
    renderActiveTab();
  });
  $("#identityDetails").addEventListener("click", () => openDetails("identity"));
  $$("[data-close-detail]").forEach((button) => button.addEventListener("click", closeDetails));
  $("#detailModal").addEventListener("click", (event) => { if (event.target === $("#detailModal")) closeDetails(); });
  $("#backHome").addEventListener("click", () => {
    $("#dashboardView").classList.add("hidden");
    $("#welcomeView").classList.remove("hidden");
    window.scrollTo(0, 0);
  });
  $("#saveButton").addEventListener("click", toggleSave);
  $("#shareButton").addEventListener("click", shareTrip);
  $("#chatForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("#chatInput");
    assistantReply(input.value);
    input.value = "";
    input.style.height = "auto";
  });
  $("#chatInput").addEventListener("input", (event) => {
    event.target.style.height = "auto";
    event.target.style.height = `${Math.min(event.target.scrollHeight, 80)}px`;
  });
  $("#quickPrompts").addEventListener("click", (event) => {
    const button = event.target.closest("[data-prompt]");
    if (button) assistantReply(button.dataset.prompt);
  });
  $("#collapseAgent").addEventListener("click", () => showToast("移动端会自动收起对话面板"));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closePlanner(); closeDetails(); } });

  /* ------------------------------------------------------------------ *
   * 初始化
   * ------------------------------------------------------------------ */

  if (state.saved) $("#saveButton").textContent = "♥ 已保存";
  if (!loadSharedTrip() && state.trip) {
    renderActiveTab();
  }
})();
