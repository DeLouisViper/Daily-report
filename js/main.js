import {
  auth, onAuthStateChanged, signOut,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider,
} from "./firebase.js";
import {
  getUserDoc, watchUsers, setUserRole,
  watchProjects, getProject, createProject, updateProject, deleteProject, resizeImageToDataUrl, updateNextDayPlan,
  getProjectFullData, importProjectFullData,
  watchBoreholes, addBorehole, updateBorehole, deleteBorehole, resetBoreholeDay,
  watchSurveyItems, addSurveyItem, updateSurveyItem, deleteSurveyItem, resetSurveyItemDay,
  watchActivity, watchGlobalActivity, dateKey, sumDailyLog,
  watchDrillingMachines, addDrillingMachine, updateDrillingMachine, deleteDrillingMachine, saveDrillingMachineDayLog, updateDrillingMachineField,
  watchEquipmentLogs, getLatestEquipmentLog, createEquipmentCheckout, updateEquipmentCheckout, saveEquipmentCheckin, deleteEquipmentLog,
  watchConsumables, addConsumableItem, updateConsumableDay, deleteConsumableItem,
  watchMaterials, getMaterialsOnce, addMaterial, updateMaterial, deleteMaterial,
  watchOpenDrillTeamPayment, getOpenDrillTeamPayment, saveDrillTeamPaymentProgress, finalizeDrillTeamPayment,
} from "./store.js";
import { applyI18n, getLang, setLang, t } from "./i18n.js";
import { initTheme, toggleTheme, getTheme, applyTheme } from "./theme.js";
import { buildReportHTML, buildReportRows, buildSummaryText, exportReportToPdf, buildDrillLogHTML, buildRepairHistoryHTML, buildEquipmentCheckoutHTML, buildEquipmentCheckinHTML, buildMaterialsPdfHTML, buildDrillTeamPaymentPdfHTML, buildConsumablesReportHTML, slugify } from "./report.js";
import { EQUIPMENT_CATALOG, EQUIPMENT_CATEGORIES } from "./equipment-catalog.js";

initTheme();
applyI18n();

// ============================================================
// DRILL BIT ICON (thay cho emoji ⛏ bị vỡ font trên một số máy)
// ============================================================
const DRILL_ICON_INNER = `<rect x="10" y="2" width="4" height="2.6" rx="0.5"/><path d="M10.2 4.6 L9.4 14.5"/><path d="M13.8 4.6 L14.6 14.5"/><path d="M9.4 14.5 L12 21 L14.6 14.5"/><path d="M9.9 8 L14.1 8"/><path d="M9.65 11.2 L14.35 11.2"/>`;
let drillIconSeq = 0;
function drillIconSvg() {
  const gid = `drillIconGrad-${drillIconSeq++}`;
  return `<svg class="drill-icon" viewBox="0 0 24 24" fill="none" stroke="url(#${gid})" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:var(--accent-red)" /><stop offset="50%" style="stop-color:var(--accent)" /><stop offset="100%" style="stop-color:var(--accent-2)" /></linearGradient></defs>${DRILL_ICON_INNER}</svg>`;
}

const mainView = document.getElementById("mainView");
let CURRENT_USER = null; // { uid, name, email, role }
let unsubProjects = null;
let projectsCache = [];
let currentProjectUnsubs = [];

const SURVEY_TYPES = ["benchmark_place", "benchmark_bury", "benchmark_check", "leveling", "rtk", "underground", "drone"];
const SURVEY_UNITS = { benchmark_place: "mốc", benchmark_bury: "mốc", benchmark_check: "mốc", leveling: "mốc", rtk: "Ha", underground: "", drone: "Ha" };
function surveyItemLabel(s) {
  if (s.type === "custom") return s.customLabel || "—";
  return SURVEY_TYPES.includes(s.type) ? t(s.type) : s.type;
}

// ============================================================
// AUTH GUARD
// ============================================================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  const udoc = await getUserDoc(user.uid);
  CURRENT_USER = {
    uid: user.uid,
    name: (udoc && udoc.name) || user.displayName || user.email,
    email: user.email,
    role: (udoc && udoc.role) || "viewer",
  };
  initSidebar();
  navigateTo("overview");
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

// ============================================================
// SIDEBAR
// ============================================================
function initSidebar() {
  document.getElementById("userAvatar").textContent = (CURRENT_USER.name || "?").slice(0, 1).toUpperCase();
  document.getElementById("userNameLabel").textContent = CURRENT_USER.name;
  document.getElementById("userRoleLabel").textContent = t(CURRENT_USER.role);
  const sidebarEl = document.getElementById("sidebar");
  const menuBtn = document.getElementById("mobileMenuBtn");
  const backdrop = document.getElementById("mobileBackdrop");
  const closeMobileSidebar = () => { sidebarEl.classList.remove("open"); backdrop.classList.remove("show"); };
  if (menuBtn) menuBtn.addEventListener("click", () => {
    sidebarEl.classList.toggle("open");
    backdrop.classList.toggle("show");
  });
  if (backdrop) backdrop.addEventListener("click", closeMobileSidebar);
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => { navigateTo(btn.dataset.view); closeMobileSidebar(); });
  });
}
function setActiveNav(view) {
  document.querySelectorAll(".nav-item").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));
}

function isAdmin() { return CURRENT_USER?.role === "admin"; }
function canEdit() { return CURRENT_USER?.role === "admin" || CURRENT_USER?.role === "engineer"; }

// ============================================================
// ROUTER
// ============================================================
function cleanupProjectWatchers() {
  currentProjectUnsubs.forEach((u) => u && u());
  currentProjectUnsubs = [];
}

function navigateTo(view, param) {
  setActiveNav(view);
  cleanupProjectWatchers();
  if (view === "overview") renderOverview();
  else if (view === "projects") renderProjectsList();
  else if (view === "project-detail") renderProjectDetail(param);
  else if (view === "report") renderReportView(param);
  else if (view === "drilllog") renderDrillLogView(param);
  else if (view === "equipment") renderEquipmentView(param);
  else if (view === "drillpay") renderDrillTeamPaymentView();
  else if (view === "materials") renderMaterialsView();
  else if (view === "activity") renderActivityView();
  else if (view === "settings") renderSettingsView();
}

// ============================================================
// TOPBAR (shared)
// ============================================================
function topbarHtml(titleKey, extraButtonsHtml = "") {
  return `
  <div class="topbar">
    <h1 data-i18n="${titleKey}"></h1>
    <div class="topbar-actions">
      ${extraButtonsHtml}
      <div class="toggle-pill" id="langTogglePill">
        <button data-lang="vi">VI</button>
        <button data-lang="en">EN</button>
      </div>
      <button class="btn btn-ghost btn-sm" id="themeTogglePill">${getTheme() === "dark" ? "🌙" : "☀️"}</button>
    </div>
  </div>`;
}
function bindTopbar() {
  applyI18n(mainView);
  document.querySelectorAll("#langTogglePill button").forEach((b) => {
    b.classList.toggle("active", b.dataset.lang === getLang());
    b.addEventListener("click", () => {
      setLang(b.dataset.lang);
      // re-render current view to refresh dynamic (non data-i18n) text
      applyI18n(document);
      const active = document.querySelector(".nav-item.active");
      if (active) navigateTo(active.dataset.view, window.__routeParam);
    });
  });
  const themeBtn = document.getElementById("themeTogglePill");
  if (themeBtn) themeBtn.addEventListener("click", () => {
    const th = toggleTheme();
    themeBtn.textContent = th === "dark" ? "🌙" : "☀️";
  });
}

// ============================================================
// OVERVIEW
// ============================================================
function renderOverview() {
  const canCreateBtn = canEdit() ? `<button class="btn btn-primary btn-sm" id="newProjectBtnOv" data-i18n="newProject"></button>` : "";
  mainView.innerHTML = topbarHtml("overview", canCreateBtn) + `
    <div class="card" id="analysisCard">
      <h3>📊 <span data-i18n="analysisTitle"></span></h3>
      <div id="analysisBody"><div class="empty-state">…</div></div>
    </div>
    <div id="ovStats" class="grid-cards"></div>
    <div class="card"><h3 data-i18n="currentProjects"></h3><div id="ovProjects" class="grid-cards"></div></div>
    <div class="card hidden" id="ovCompletedCard"><h3>✓ <span data-i18n="completedCount"></span></h3><div id="ovCompletedProjects" class="grid-cards"></div></div>`;
  bindTopbar();
  const newBtnOv = document.getElementById("newProjectBtnOv");
  if (newBtnOv) newBtnOv.addEventListener("click", () => openProjectModal());
  unsubProjects = watchProjects(async (projects) => {
    projectsCache = projects;
    const total = projects.length;
    const soil = projects.filter((p) => p.workTypes?.soil).length;
    const survey = projects.filter((p) => p.workTypes?.survey).length;
    document.getElementById("ovStats").innerHTML = [
      statCard(total, t("currentProjects")),
      statCard(soil, t("soilInvestigation")),
      statCard(survey, t("survey")),
    ].join("");
    const list = document.getElementById("ovProjects");
    const completedCard = document.getElementById("ovCompletedCard");
    const completedList = document.getElementById("ovCompletedProjects");
    if (!projects.length) {
      list.innerHTML = `<div class="empty-state">${t("noProjects")}</div>`;
      completedCard.classList.add("hidden");
    } else {
      list.innerHTML = `<div class="empty-state">…</div>`;
      const summaries = await Promise.all(projects.map(computeProjectSummary));
      if (!document.getElementById("ovProjects")) return; // view changed while loading
      const completed = summaries.filter((s) => s.itemsTotal > 0 && s.pctAvg >= 100);
      const active = summaries.filter((s) => !(s.itemsTotal > 0 && s.pctAvg >= 100)).slice(0, 6);

      list.innerHTML = active.length ? active.map((s) => projectCardHtml(s.project)).join("") : `<div class="empty-state">${t("noProjects")}</div>`;
      bindProjectCards(list);
      active.forEach((s) => applySummaryToCard(list, s));

      if (completed.length) {
        completedCard.classList.remove("hidden");
        completedList.innerHTML = completed.map((s) => projectCardHtml(s.project)).join("");
        bindProjectCards(completedList);
        completed.forEach((s) => applySummaryToCard(completedList, s));
      } else {
        completedCard.classList.add("hidden");
      }
    }
    renderAnalysis(projects);
  });
}
async function computeProjectSummary(project) {
  const [boreholes, surveyItems] = await Promise.all([
    oneOff(watchBoreholes, project.id),
    oneOff(watchSurveyItems, project.id),
  ]);
  const rows = buildReportRows(project, boreholes, surveyItems, dateKey());
  const itemsTotal = rows.length;
  const itemsDone = rows.filter((r) => r.pct >= 100).length;
  const pctAvg = itemsTotal ? rows.reduce((a, r) => a + r.pct, 0) / itemsTotal : 0;
  return { project, itemsTotal, itemsDone, pctAvg, rows };
}
async function renderAnalysis(projects) {
  const body = document.getElementById("analysisBody");
  if (!body) return;
  if (!projects.length) { body.innerHTML = `<div class="empty-state">${t("noProjects")}</div>`; return; }
  const summaries = await Promise.all(projects.map(computeProjectSummary));
  if (!document.getElementById("analysisBody")) return; // view changed while loading

  const totalProjects = summaries.length;
  const avgProgress = totalProjects ? summaries.reduce((a, s) => a + s.pctAvg, 0) / totalProjects : 0;
  const completed = summaries.filter((s) => s.itemsTotal > 0 && s.pctAvg >= 100).length;
  const notStarted = summaries.filter((s) => s.pctAvg <= 0).length;
  const inProgress = totalProjects - completed - notStarted;
  const itemsTotalSum = summaries.reduce((a, s) => a + s.itemsTotal, 0);
  const itemsDoneSum = summaries.reduce((a, s) => a + s.itemsDone, 0);

  const attention = [...summaries].filter((s) => s.pctAvg < 100).sort((a, b) => a.pctAvg - b.pctAvg).slice(0, 5);

  const byManager = {};
  summaries.forEach((s) => {
    const key = s.project.manager || s.project.siteEngineer || s.project.createdByName || "—";
    byManager[key] = (byManager[key] || 0) + 1;
  });

  body.innerHTML = `
    <div class="analysis-grid">
      ${statMini(totalProjects, t("totalProjects"), "stat-indigo")}
      ${statMini(avgProgress.toFixed(0) + "%", t("avgProgress"), "stat-cyan")}
      ${statMini(completed, t("completedCount"), "stat-green")}
      ${statMini(inProgress, t("inProgressCount"), "stat-yellow")}
      ${statMini(notStarted, t("notStartedCount"), "stat-red")}
      ${statMini(`${itemsDoneSum}/${itemsTotalSum}`, t("itemsSystemWide"), "stat-orange")}
    </div>
    <div class="analysis-sub-title">⚠️ <span>${t("attentionProjects")}</span></div>
    <div class="chip-row">
      ${attention.length ? attention.map((s) => `<span class="chip chip-alert" data-pid="${s.project.id}">${escapeHtml(s.project.name)} — ${s.pctAvg.toFixed(0)}%</span>`).join("") : `<span class="chip">—</span>`}
    </div>
    <div class="analysis-sub-title">👤 <span>${t("projectsByManager")}</span></div>
    <div class="chip-row">
      ${Object.entries(byManager).map(([name, count]) => `<span class="chip">${escapeHtml(name)}: ${count}</span>`).join("")}
    </div>
  `;
  body.querySelectorAll(".chip-alert").forEach((el) => {
    el.addEventListener("click", () => navigateTo("project-detail", el.dataset.pid));
  });
}
function statMini(value, label, colorClass) {
  return `<div class="analysis-stat ${colorClass || ""}">
    <div class="val">${value}</div>
    <div class="lbl">${label}</div>
  </div>`;
}
function statCard(value, label) {
  return `<div class="card" style="text-align:center;">
    <div style="font-size:28px; font-weight:800; color:var(--accent);">${value}</div>
    <div style="font-size:12.5px; color:var(--text-dim); margin-top:4px;">${label}</div>
  </div>`;
}

// ============================================================
// PROJECTS LIST
// ============================================================
function renderProjectsList() {
  const canCreateBtn = canEdit() ? `<button class="btn btn-primary btn-sm" id="newProjectBtn" data-i18n="newProject"></button>` : "";
  mainView.innerHTML = topbarHtml("currentProjects", canCreateBtn) + `
    <div class="tabs" id="projTabs">
      <button class="tab-btn active" data-tab="active">${t("inProgress")}</button>
      <button class="tab-btn" data-tab="completed">${t("completedCount")}</button>
    </div>
    <div id="projActiveList" class="grid-cards"></div>
    <div id="projCompletedList" class="grid-cards hidden"></div>
  `;
  bindTopbar();
  const btn = document.getElementById("newProjectBtn");
  if (btn) btn.addEventListener("click", () => openProjectModal());

  const tabs = document.querySelectorAll("#projTabs .tab-btn");
  const activeList = document.getElementById("projActiveList");
  const completedList = document.getElementById("projCompletedList");
  tabs.forEach((b) => b.addEventListener("click", () => {
    tabs.forEach((x) => x.classList.toggle("active", x === b));
    activeList.classList.toggle("hidden", b.dataset.tab !== "active");
    completedList.classList.toggle("hidden", b.dataset.tab !== "completed");
  }));

  unsubProjects = watchProjects(async (projects) => {
    projectsCache = projects;
    if (!projects.length) {
      activeList.innerHTML = `<div class="empty-state">${t("noProjects")}</div>`;
      completedList.innerHTML = "";
      return;
    }
    activeList.innerHTML = `<div class="empty-state">…</div>`;
    const summaries = await Promise.all(projects.map(computeProjectSummary));
    if (!document.getElementById("projActiveList")) return; // view changed while loading

    const completed = summaries.filter((s) => s.itemsTotal > 0 && s.pctAvg >= 100);
    const active = summaries.filter((s) => !(s.itemsTotal > 0 && s.pctAvg >= 100));

    activeList.innerHTML = active.length ? active.map((s) => projectCardHtml(s.project)).join("") : `<div class="empty-state">${t("noProjects")}</div>`;
    completedList.innerHTML = completed.length ? completed.map((s) => projectCardHtml(s.project)).join("") : `<div class="empty-state">${t("noProjects")}</div>`;
    bindProjectCards(activeList);
    bindProjectCards(completedList);
    active.forEach((s) => applySummaryToCard(activeList, s));
    completed.forEach((s) => applySummaryToCard(completedList, s));
  });
}
function projectCardHtml(p) {
  const tags = [
    p.workTypes?.soil ? `<span class="tag tag-soil">${t("soilInvestigation")}</span>` : "",
    p.workTypes?.survey ? `<span class="tag tag-survey">${t("survey")}</span>` : "",
  ].join("");
  const thumb = p.siteImageUrl ? `style="background-image:url('${p.siteImageUrl}')"` : "";
  const dateRaw = p.startDateSite || (p.createdAt?.toDate ? p.createdAt.toDate().toISOString().slice(0, 10) : "");
  const dateDisplay = dateRaw ? dateRaw.split("-").reverse().join("/") : "—";
  const manager = p.manager || p.siteEngineer || "—";
  return `<div class="project-card" data-id="${p.id}">
    <div class="thumb" ${thumb}>${p.siteImageUrl ? "" : "📍"}</div>
    <div class="body">
      <div class="pc-head">
        <div>
          <h4>${escapeHtml(p.name || "—")}</h4>
          <div class="pc-date">📅 ${dateDisplay}</div>
        </div>
        <div class="pc-ring" style="--pct:0;"><span>…</span></div>
      </div>
      <div class="pc-manager">👤 ${t("managerShort")}: <b>${escapeHtml(manager)}</b></div>
      ${tags ? `<div class="tag-row">${tags}</div>` : ""}
      <div class="progress-bar pc-progress-bar"><div style="width:0%"></div></div>
      <div class="chip-row pc-items"></div>
    </div>
  </div>`;
}
function applySummaryToCard(container, s) {
  const card = container.querySelector(`.project-card[data-id="${s.project.id}"]`);
  if (!card) return;
  const pct = Math.round(s.pctAvg);

  const ring = card.querySelector(".pc-ring");
  if (ring) {
    ring.style.setProperty("--pct", Math.min(100, pct));
    ring.querySelector("span").textContent = pct + "%";
  }
  const bar = card.querySelector(".pc-progress-bar > div");
  if (bar) bar.style.width = Math.min(100, pct) + "%";

  const itemsWrap = card.querySelector(".pc-items");
  if (itemsWrap) {
    const maxShow = 4;
    const shown = s.rows.slice(0, maxShow);
    const rest = s.rows.length - shown.length;
    itemsWrap.innerHTML = shown.length
      ? shown.map((r) => `<span class="chip pc-chip">${escapeHtml(r.label)}</span>`).join("") + (rest > 0 ? `<span class="chip pc-chip">+${rest}</span>` : "")
      : `<span class="chip pc-chip">—</span>`;
  }

  if (s.itemsTotal > 0) {
    let tagRow = card.querySelector(".tag-row");
    if (!tagRow) {
      tagRow = document.createElement("div");
      tagRow.className = "tag-row";
      card.querySelector(".pc-manager").insertAdjacentElement("afterend", tagRow);
    }
    const badge = document.createElement("span");
    if (pct >= 100) {
      badge.className = "tag tag-completed";
      badge.textContent = "✓ " + t("projectCompleted");
      tagRow.appendChild(badge);
    } else if (pct > 0) {
      badge.className = "tag tag-inprogress";
      badge.textContent = "◐ " + t("inProgress");
      tagRow.appendChild(badge);
    }
  }
}
async function hydrateProjectCards(container, projects) {
  const summaries = await Promise.all(projects.map(computeProjectSummary));
  if (!document.body.contains(container)) return; // view changed while loading
  summaries.forEach((s) => applySummaryToCard(container, s));
}
function bindProjectCards(container) {
  container.querySelectorAll(".project-card").forEach((c) => {
    c.addEventListener("click", () => navigateTo("project-detail", c.dataset.id));
  });
}

// ---------- Project create/edit modal ----------
function openProjectModal(project) {
  const editing = !!project;
  const wt = project?.workTypes || {};
  const modalHtml = `
  <div class="modal-backdrop" id="projModalBackdrop">
    <div class="modal wide">
      <div class="modal-head">
        <h3>${editing ? t("edit") : t("newProject")}</h3>
        <button class="icon-btn" id="closeProjModal">✕</button>
      </div>
      <div class="field"><label data-i18n="projectName"></label><input id="pf_name" value="${escapeAttr(project?.name)}" /></div>
      <div class="field-row">
        <div class="field"><label data-i18n="projectLocation"></label><input id="pf_location" value="${escapeAttr(project?.location)}" /></div>
        <div class="field"><label data-i18n="fieldEngineer"></label><input id="pf_engineer" value="${escapeAttr(project?.siteEngineer)}" /></div>
      </div>
      <div class="field"><label data-i18n="manager"></label><input id="pf_manager" value="${escapeAttr(project?.manager)}" /></div>
      <div class="field-row">
        <div class="field"><label data-i18n="startDateSite"></label><input type="date" id="pf_startDate" value="${project?.startDateSite || ""}" /></div>
        <div class="field"><label data-i18n="endDateSite"></label><input type="date" id="pf_endDate" value="${project?.endDateSite || ""}" /></div>
      </div>
      <div class="field">
        <label data-i18n="workTypes"></label>
        <div class="checkbox-row"><input type="checkbox" id="pf_soil" ${wt.soil ? "checked" : ""} /><label for="pf_soil" data-i18n="soilInvestigation"></label></div>
        <div class="checkbox-row"><input type="checkbox" id="pf_survey" ${wt.survey ? "checked" : ""} /><label for="pf_survey" data-i18n="survey"></label></div>
      </div>
      <div class="field">
        <label data-i18n="siteImage"></label>
        ${project?.siteImageUrl ? `<img src="${project.siteImageUrl}" class="photo-thumb" />` : ""}
        <input type="file" id="pf_image" accept="image/*" />
      </div>
      <p class="error-msg" id="pf_error"></p>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="pf_cancel" data-i18n="cancel"></button>
        <button class="btn btn-primary" id="pf_save" data-i18n="save"></button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML("beforeend", modalHtml);
  applyI18n(document.getElementById("projModalBackdrop"));
  const close = () => document.getElementById("projModalBackdrop").remove();
  document.getElementById("closeProjModal").addEventListener("click", close);
  document.getElementById("pf_cancel").addEventListener("click", close);
  document.getElementById("pf_save").addEventListener("click", async () => {
    const name = document.getElementById("pf_name").value.trim();
    const errEl = document.getElementById("pf_error");
    if (!name) { errEl.textContent = t("projectName") + " *"; return; }
    const saveBtn = document.getElementById("pf_save");
    saveBtn.disabled = true;
    try {
      const data = {
        name,
        location: document.getElementById("pf_location").value.trim(),
        siteEngineer: document.getElementById("pf_engineer").value.trim(),
        manager: document.getElementById("pf_manager").value.trim(),
        startDateSite: document.getElementById("pf_startDate").value,
        endDateSite: document.getElementById("pf_endDate").value,
        workTypes: {
          soil: document.getElementById("pf_soil").checked,
          survey: document.getElementById("pf_survey").checked,
        },
      };
      const file = document.getElementById("pf_image").files[0];
      let projectId = project?.id;
      if (editing) {
        await updateProject(projectId, data, CURRENT_USER);
      } else {
        projectId = await createProject(data, CURRENT_USER);
      }
      if (file) {
        showSaveIndicator(true);
        let dataUrl = await resizeImageToDataUrl(file, 900, 0.72);
        if (dataUrl.length > 700000) dataUrl = await resizeImageToDataUrl(file, 600, 0.6);
        await updateProject(projectId, { siteImageUrl: dataUrl }, CURRENT_USER, "site image");
      }
      showSaveIndicator();
      close();
      navigateTo("project-detail", projectId);
    } catch (e) {
      document.getElementById("pf_error").textContent = e.message;
    } finally {
      saveBtn.disabled = false;
    }
  });
}

// ============================================================
// PROJECT DETAIL
// ============================================================
async function renderProjectDetail(projectId) {
  window.__routeParam = projectId;
  const project = await getProject(projectId);
  if (!project) { navigateTo("projects"); return; }

  const editBtn = canEdit() ? `<button class="btn btn-ghost btn-sm" id="editProjBtn" data-i18n="edit"></button>` : "";
  const delBtn = isAdmin() ? `<button class="btn btn-danger btn-sm" id="delProjBtn" data-i18n="delete"></button>` : "";

  mainView.innerHTML = `
    <div class="topbar">
      <h1>${escapeHtml(project.name)}</h1>
      <div class="topbar-actions">
        ${editBtn}${delBtn}
        <div class="toggle-pill" id="langTogglePill"><button data-lang="vi">VI</button><button data-lang="en">EN</button></div>
        <button class="btn btn-ghost btn-sm" id="themeTogglePill">${getTheme() === "dark" ? "🌙" : "☀️"}</button>
      </div>
    </div>
    <div class="card" style="display:flex; gap:18px; flex-wrap:wrap;">
      ${project.siteImageUrl ? `<img src="${project.siteImageUrl}" style="width:200px; height:130px; object-fit:cover; border-radius:10px; border:1px solid var(--border);" />` : ""}
      <table style="flex:1; min-width:240px;">
        <tr><td style="color:var(--text-dim);">${t("projectLocation")}</td><td>${escapeHtml(project.location || "—")}</td></tr>
        <tr><td style="color:var(--text-dim);">${t("fieldEngineer")}</td><td>${escapeHtml(project.siteEngineer || "—")}</td></tr>
        <tr><td style="color:var(--text-dim);">${t("manager")}</td><td>${escapeHtml(project.manager || "—")}</td></tr>
        <tr><td style="color:var(--text-dim);">${t("startDateSite")}</td><td>${escapeHtml(project.startDateSite || "—")}</td></tr>
        <tr><td style="color:var(--text-dim);">${t("endDateSite")}</td><td>${escapeHtml(project.endDateSite || "—")}</td></tr>
        <tr><td style="color:var(--text-dim);">${t("createdBy")}</td><td>${escapeHtml(project.createdByName || "—")}</td></tr>
      </table>
    </div>
    <div class="tabs" id="detailTabs">
      ${project.workTypes?.soil ? `<button class="tab-btn" data-tab="soil">${t("soilInvestigation")}</button>` : ""}
      ${project.workTypes?.survey ? `<button class="tab-btn" data-tab="survey">${t("survey")}</button>` : ""}
      <button class="tab-btn" data-tab="report">${t("dailyReport")}</button>
    </div>
    <div id="tabContent"></div>
  `;
  applyI18n(mainView);
  document.querySelectorAll("#langTogglePill button").forEach((b) => {
    b.classList.toggle("active", b.dataset.lang === getLang());
    b.addEventListener("click", () => { setLang(b.dataset.lang); navigateTo("project-detail", projectId); });
  });
  const themeBtn = document.getElementById("themeTogglePill");
  if (themeBtn) themeBtn.addEventListener("click", () => { const th = toggleTheme(); themeBtn.textContent = th === "dark" ? "🌙" : "☀️"; });

  const editBtnEl = document.getElementById("editProjBtn");
  if (editBtnEl) editBtnEl.addEventListener("click", () => openProjectModal(project));
  const delBtnEl = document.getElementById("delProjBtn");
  if (delBtnEl) delBtnEl.addEventListener("click", async () => {
    if (!isAdmin()) { alert(t("onlyAdminDelete")); return; }
    if (await showConfirmModal(t("deleteConfirm"))) {
      await deleteProject(projectId);
      navigateTo("projects");
    }
  });

  const tabs = document.querySelectorAll("#detailTabs .tab-btn");
  const firstTab = tabs[0]?.dataset.tab || "report";
  function activateTab(tabName) {
    tabs.forEach((b) => b.classList.toggle("active", b.dataset.tab === tabName));
    if (tabName === "soil") renderSoilTab(project);
    else if (tabName === "survey") renderSurveyTab(project);
    else if (tabName === "report") renderReportView(project.id);
  }
  tabs.forEach((b) => b.addEventListener("click", () => activateTab(b.dataset.tab)));
  activateTab(firstTab);
}

// ---------- Soil tab ----------
function renderSoilTab(project) {
  const content = document.getElementById("tabContent");
  const addBtn = canEdit() ? `<button class="btn btn-primary btn-sm" id="addBoreholeBtn" data-i18n="addBorehole"></button>` : "";
  content.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:14px;">
      <input type="search" id="bh_search" style="max-width:280px;" data-i18n-placeholder="searchBorehole" />
      ${addBtn}
    </div>
    <div class="tabs" id="bhTabs">
      <button class="tab-btn active" data-tab="active">${t("inProgress")}</button>
      <button class="tab-btn" data-tab="completed">${t("completedCount")}</button>
    </div>
    <div id="boreholeActiveList"></div>
    <div id="boreholeCompletedList" class="hidden"></div>
  `;
  applyI18n(content);
  const addBtnEl = document.getElementById("addBoreholeBtn");
  if (addBtnEl) addBtnEl.addEventListener("click", () => openBoreholeModal(project.id));

  const tabs = document.querySelectorAll("#bhTabs .tab-btn");
  const activeList = document.getElementById("boreholeActiveList");
  const completedList = document.getElementById("boreholeCompletedList");
  tabs.forEach((b) => b.addEventListener("click", () => {
    tabs.forEach((x) => x.classList.toggle("active", x === b));
    activeList.classList.toggle("hidden", b.dataset.tab !== "active");
    completedList.classList.toggle("hidden", b.dataset.tab !== "completed");
  }));

  const searchEl = document.getElementById("bh_search");
  let allBoreholes = [];
  function renderLists() {
    const q = searchEl.value.trim().toLowerCase();
    const filtered = q ? allBoreholes.filter((b) => (b.name || "").toLowerCase().includes(q)) : allBoreholes;
    const withPct = filtered.map((b) => {
      const total = sumDailyLog(b.dailyLog);
      const contract = Number(b.contractVolume) || 0;
      const pct = contract > 0 ? Math.min(100, (total / contract) * 100) : 0;
      return { b, pct, hasContract: contract > 0 };
    });
    const completed = withPct.filter((x) => x.hasContract && x.pct >= 100);
    const active = withPct.filter((x) => !(x.hasContract && x.pct >= 100));
    // Ưu tiên hố khoan đang thực hiện lên đầu, chưa bắt đầu ở dưới; trong mỗi
    // nhóm sắp xếp theo tên A-Z, 0-9 (tự nhiên) thay vì theo % hay thứ tự tạo.
    const nameCompare = (a, b) => (a.b.name || "").localeCompare(b.b.name || "", undefined, { numeric: true, sensitivity: "base" });
    active.sort((a, b2) => {
      const aStarted = a.pct > 0 ? 0 : 1;
      const bStarted = b2.pct > 0 ? 0 : 1;
      if (aStarted !== bStarted) return aStarted - bStarted;
      return nameCompare(a, b2);
    });
    completed.sort(nameCompare);

    activeList.innerHTML = active.length ? active.map((x) => boreholeBlockHtml(x.b)).join("") : `<div class="empty-state">—</div>`;
    completedList.innerHTML = completed.length ? completed.map((x) => boreholeBlockHtml(x.b)).join("") : `<div class="empty-state">—</div>`;
    active.forEach((x) => bindBoreholeBlock(project.id, x.b));
    completed.forEach((x) => bindBoreholeBlock(project.id, x.b));
  }
  searchEl.addEventListener("input", renderLists);

  const unsub = watchBoreholes(project.id, (boreholes) => {
    allBoreholes = boreholes;
    renderLists();
  });
  currentProjectUnsubs.push(unsub);
}
function pctBadgeClass(pct) { return pct >= 100 ? "high" : pct >= 40 ? "mid" : "low"; }
function boreholeBlockHtml(b) {
  const total = sumDailyLog(b.dailyLog);
  const contract = Number(b.contractVolume) || 0;
  const pct = contract > 0 ? (total / contract) * 100 : 0; // hiển thị đúng thực tế, có thể > 100%
  const today = new Date();
  const todayVal = (b.dailyLog || {})[dateKey(today)] || "";
  return `<div class="item-block" data-id="${b.id}">
    <div class="item-head">
      <h4>🕳 ${escapeHtml(b.name || "—")} <span style="color:var(--text-dim); font-weight:500;">(${escapeHtml(b.team || "—")})</span></h4>
      <div class="item-actions">
        <span class="pct-badge ${pctBadgeClass(pct)}">${pct.toFixed(0)}%</span>
        ${canEdit() ? `<button class="btn btn-ghost btn-sm reset-bh-yesterday" data-i18n="resetYesterday"></button>` : ""}
        ${canEdit() ? `<button class="btn btn-ghost btn-sm reset-bh" data-i18n="resetProgress"></button>` : ""}
        ${canEdit() ? `<button class="btn btn-ghost btn-sm edit-bh" data-i18n="edit"></button>` : ""}
        ${canEdit() ? `<button class="btn btn-danger btn-sm del-bh" data-i18n="delete"></button>` : ""}
      </div>
    </div>
    <div class="field-row">
      <div class="field"><label data-i18n="contractVolume"></label><input value="${contract} m" disabled /></div>
      <div class="field"><label data-i18n="completedTotal"></label><input value="${total} / ${contract} m" disabled /></div>
      <div class="field"><label data-i18n="waterLevel"></label><input value="${b.waterLevel ?? "—"}" disabled /></div>
    </div>
    <div class="progress-bar"><div style="width:${Math.min(100, pct).toFixed(0)}%"></div></div>
    <div class="field-row" style="margin-top:12px;">
      <div class="field">
        <label data-i18n="completedToday"></label>
        <input type="number" class="today-input" min="0" step="0.1" value="${todayVal}" ${canEdit() ? "" : "disabled"} />
      </div>
      <div class="field"><label data-i18n="coordN"></label><input value="${b.coordN ?? "—"}" disabled /></div>
      <div class="field"><label data-i18n="coordE"></label><input value="${b.coordE ?? "—"}" disabled /></div>
      <div class="field"><label data-i18n="elevation"></label><input value="${b.elevation ?? "—"}" disabled /></div>
      <div class="field"><label data-i18n="soilM"></label><input value="${b.soilM ?? "—"}" disabled /></div>
      <div class="field"><label data-i18n="rockM"></label><input value="${b.rockM ?? "—"}" disabled /></div>
    </div>
    ${b.note ? `<div class="field"><label data-i18n="note"></label><div style="font-size:13px;">${escapeHtml(b.note)}</div></div>` : ""}
  </div>`;
}
function bindBoreholeBlock(projectId, b) {
  const el = document.querySelector(`.item-block[data-id="${b.id}"]`);
  if (!el) return;
  applyI18n(el);
  const editBtn = el.querySelector(".edit-bh");
  if (editBtn) editBtn.addEventListener("click", () => openBoreholeModal(projectId, b));
  const delBtn = el.querySelector(".del-bh");
  if (delBtn) delBtn.addEventListener("click", async () => {
    if (await showConfirmModal(t("deleteConfirm"))) await deleteBorehole(projectId, b.id, CURRENT_USER, b.name);
  });
  const resetBtn = el.querySelector(".reset-bh");
  if (resetBtn) resetBtn.addEventListener("click", async () => {
    if (await showConfirmModal(t("resetConfirm"))) {
      showSaveIndicator(true);
      await updateBorehole(projectId, b.id, { dailyLog: {} }, CURRENT_USER, `${b.name}: ${t("resetProgress")}`);
      showSaveIndicator();
    }
  });
  const resetYesterdayBtn = el.querySelector(".reset-bh-yesterday");
  if (resetYesterdayBtn) resetYesterdayBtn.addEventListener("click", async () => {
    if (await showConfirmModal(t("resetYesterdayConfirm"))) {
      showSaveIndicator(true);
      const yKey = dateKey(new Date(Date.now() - 86400000));
      await resetBoreholeDay(projectId, b.id, yKey, CURRENT_USER, b.name);
      showSaveIndicator();
    }
  });
  const todayInput = el.querySelector(".today-input");
  if (todayInput) {
    todayInput.addEventListener("change", async () => {
      showSaveIndicator(true);
      const dailyLog = { ...(b.dailyLog || {}) };
      const val = Number(todayInput.value) || 0;
      dailyLog[dateKey()] = val;
      await updateBorehole(projectId, b.id, { dailyLog }, CURRENT_USER, `${b.name}: +${val}m`);
      showSaveIndicator();
    });
  }
}
function openBoreholeModal(projectId, b) {
  const editing = !!b;
  const modalHtml = `
  <div class="modal-backdrop" id="bhModalBackdrop">
    <div class="modal wide">
      <div class="modal-head"><h3>${t("boreholeInfo")}</h3><button class="icon-btn" id="closeBhModal">✕</button></div>
      <div class="field-row">
        <div class="field"><label data-i18n="boreholeName"></label><input id="bh_name" value="${escapeAttr(b?.name)}" /></div>
        <div class="field"><label data-i18n="drillTeam"></label><input id="bh_team" value="${escapeAttr(b?.team)}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label data-i18n="contractVolume"></label><input type="number" id="bh_contract" value="${b?.contractVolume ?? ""}" /></div>
        <div class="field"><label data-i18n="unit"></label><input value="m" disabled /></div>
      </div>
      <div class="field-row">
        <div class="field"><label data-i18n="itemStartDate"></label><input type="date" id="bh_itemStart" value="${b?.itemStartDate || ""}" /></div>
        <div class="field"><label data-i18n="itemEndDate"></label><input type="date" id="bh_itemEnd" value="${b?.itemEndDate || ""}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label data-i18n="coordN"></label><input id="bh_n" value="${escapeAttr(b?.coordN)}" /></div>
        <div class="field"><label data-i18n="coordE"></label><input id="bh_e" value="${escapeAttr(b?.coordE)}" /></div>
        <div class="field"><label data-i18n="elevation"></label><input id="bh_elev" value="${escapeAttr(b?.elevation)}" /></div>
        <div class="field"><label data-i18n="waterLevel"></label><input id="bh_water" value="${escapeAttr(b?.waterLevel)}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label data-i18n="soilM"></label><input type="number" id="bh_soilM" value="${b?.soilM ?? ""}" /></div>
        <div class="field"><label data-i18n="rockM"></label><input type="number" id="bh_rockM" value="${b?.rockM ?? ""}" /></div>
      </div>
      <div class="field"><label data-i18n="note"></label><textarea id="bh_note" rows="2">${escapeHtml(b?.note)}</textarea></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="bh_cancel" data-i18n="cancel"></button>
        <button class="btn btn-primary" id="bh_save" data-i18n="save"></button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML("beforeend", modalHtml);
  applyI18n(document.getElementById("bhModalBackdrop"));
  const close = () => document.getElementById("bhModalBackdrop").remove();
  document.getElementById("closeBhModal").addEventListener("click", close);
  document.getElementById("bh_cancel").addEventListener("click", close);
  document.getElementById("bh_save").addEventListener("click", async () => {
    const data = {
      name: document.getElementById("bh_name").value.trim(),
      team: document.getElementById("bh_team").value.trim(),
      contractVolume: Number(document.getElementById("bh_contract").value) || 0,
      itemStartDate: document.getElementById("bh_itemStart").value,
      itemEndDate: document.getElementById("bh_itemEnd").value,
      coordN: document.getElementById("bh_n").value.trim(),
      coordE: document.getElementById("bh_e").value.trim(),
      elevation: document.getElementById("bh_elev").value.trim(),
      waterLevel: document.getElementById("bh_water").value.trim(),
      soilM: Number(document.getElementById("bh_soilM").value) || 0,
      rockM: Number(document.getElementById("bh_rockM").value) || 0,
      note: document.getElementById("bh_note").value.trim(),
    };
    if (!data.name) return;
    showSaveIndicator(true);
    if (editing) await updateBorehole(projectId, b.id, data, CURRENT_USER, data.name);
    else await addBorehole(projectId, data, CURRENT_USER);
    showSaveIndicator();
    close();
  });
}

// ---------- Survey tab ----------
function renderSurveyTab(project) {
  const content = document.getElementById("tabContent");
  const addBtn = canEdit() ? `<button class="btn btn-primary btn-sm" id="addSurveyBtn" data-i18n="addSurveyItem"></button>` : "";
  content.innerHTML = `<div style="display:flex; justify-content:flex-end; margin-bottom:10px;">${addBtn}</div><div id="surveyList"></div>`;
  applyI18n(content);
  const addBtnEl = document.getElementById("addSurveyBtn");
  if (addBtnEl) addBtnEl.addEventListener("click", () => openSurveyModal(project.id));

  const unsub = watchSurveyItems(project.id, (items) => {
    const list = document.getElementById("surveyList");
    if (!list) return;
    if (!items.length) { list.innerHTML = `<div class="empty-state">—</div>`; return; }
    list.innerHTML = items.map((s) => surveyBlockHtml(s)).join("");
    items.forEach((s) => bindSurveyBlock(project.id, s));
  });
  currentProjectUnsubs.push(unsub);
}
function surveyBlockHtml(s) {
  const total = sumDailyLog(s.dailyLog);
  const contract = Number(s.contractQty) || 0;
  const pct = contract > 0 ? (total / contract) * 100 : 0; // hiển thị đúng thực tế, có thể > 100%
  const todayVal = (s.dailyLog || {})[dateKey()] || "";
  const label = surveyItemLabel(s);
  return `<div class="item-block" data-id="${s.id}">
    <div class="item-head">
      <h4>📍 ${escapeHtml(label)} ${s.assignee ? `<span style="color:var(--text-dim); font-weight:500;">(${escapeHtml(s.assignee)})</span>` : ""}</h4>
      <div class="item-actions">
        <span class="pct-badge ${pctBadgeClass(pct)}">${pct.toFixed(0)}%</span>
        ${canEdit() ? `<button class="btn btn-ghost btn-sm reset-sv-yesterday" data-i18n="resetYesterday"></button>` : ""}
        ${canEdit() ? `<button class="btn btn-ghost btn-sm reset-sv" data-i18n="resetProgress"></button>` : ""}
        ${canEdit() ? `<button class="btn btn-ghost btn-sm edit-sv" data-i18n="edit"></button>` : ""}
        ${canEdit() ? `<button class="btn btn-danger btn-sm del-sv" data-i18n="delete"></button>` : ""}
      </div>
    </div>
    <div class="field-row">
      <div class="field"><label data-i18n="qtyContract"></label><input value="${contract} ${escapeHtml(s.unit || "")}" disabled /></div>
      <div class="field"><label data-i18n="qtyTotal"></label><input value="${total} / ${contract} ${escapeHtml(s.unit || "")}" disabled /></div>
      <div class="field">
        <label data-i18n="qtyToday"></label>
        <input type="number" class="today-input" min="0" step="0.1" value="${todayVal}" ${canEdit() ? "" : "disabled"} />
      </div>
    </div>
    <div class="progress-bar"><div style="width:${Math.min(100, pct).toFixed(0)}%"></div></div>
    ${s.note ? `<div class="field" style="margin-top:10px;"><label data-i18n="note"></label><div style="font-size:13px;">${escapeHtml(s.note)}</div></div>` : ""}
  </div>`;
}
function bindSurveyBlock(projectId, s) {
  const el = document.querySelector(`.item-block[data-id="${s.id}"]`);
  if (!el) return;
  applyI18n(el);
  const editBtn = el.querySelector(".edit-sv");
  if (editBtn) editBtn.addEventListener("click", () => openSurveyModal(projectId, s));
  const delBtn = el.querySelector(".del-sv");
  if (delBtn) delBtn.addEventListener("click", async () => {
    if (await showConfirmModal(t("deleteConfirm"))) await deleteSurveyItem(projectId, s.id, CURRENT_USER, surveyItemLabel(s));
  });
  const resetBtn = el.querySelector(".reset-sv");
  if (resetBtn) resetBtn.addEventListener("click", async () => {
    if (await showConfirmModal(t("resetConfirm"))) {
      showSaveIndicator(true);
      await updateSurveyItem(projectId, s.id, { dailyLog: {} }, CURRENT_USER, `${surveyItemLabel(s)}: ${t("resetProgress")}`);
      showSaveIndicator();
    }
  });
  const resetYesterdayBtn = el.querySelector(".reset-sv-yesterday");
  if (resetYesterdayBtn) resetYesterdayBtn.addEventListener("click", async () => {
    if (await showConfirmModal(t("resetYesterdayConfirm"))) {
      showSaveIndicator(true);
      const yKey = dateKey(new Date(Date.now() - 86400000));
      await resetSurveyItemDay(projectId, s.id, yKey, CURRENT_USER, surveyItemLabel(s));
      showSaveIndicator();
    }
  });
  const todayInput = el.querySelector(".today-input");
  if (todayInput) {
    todayInput.addEventListener("change", async () => {
      showSaveIndicator(true);
      const dailyLog = { ...(s.dailyLog || {}) };
      const val = Number(todayInput.value) || 0;
      dailyLog[dateKey()] = val;
      await updateSurveyItem(projectId, s.id, { dailyLog }, CURRENT_USER, `${surveyItemLabel(s)}: +${val}`);
      showSaveIndicator();
    });
  }
}
function openSurveyModal(projectId, s) {
  const editing = !!s;
  const isCustom = s?.type === "custom";
  const typeOptions = SURVEY_TYPES.map((ty) => `<option value="${ty}" ${s?.type === ty ? "selected" : ""}>${t(ty)}</option>`).join("")
    + `<option value="custom" ${isCustom ? "selected" : ""}>${t("customType")}</option>`;
  const modalHtml = `
  <div class="modal-backdrop" id="svModalBackdrop">
    <div class="modal">
      <div class="modal-head"><h3 data-i18n="surveyItems"></h3><button class="icon-btn" id="closeSvModal">✕</button></div>
      <div class="field"><label data-i18n="surveyItems"></label>
        <select id="sv_type">${typeOptions}</select>
      </div>
      <div class="field ${isCustom ? "" : "hidden"}" id="sv_customWrap">
        <label data-i18n="customTypeName"></label>
        <input id="sv_customLabel" value="${escapeAttr(s?.customLabel)}" />
      </div>
      <div class="field-row">
        <div class="field"><label data-i18n="qtyContract"></label><input type="number" id="sv_contract" value="${s?.contractQty ?? ""}" /></div>
        <div class="field"><label data-i18n="customUnit"></label><input id="sv_unit" value="${escapeAttr(s?.unit)}" /></div>
      </div>
      <div class="field"><label data-i18n="itemAssignee"></label><input id="sv_assignee" value="${escapeAttr(s?.assignee)}" /></div>
      <div class="field"><label data-i18n="note"></label><textarea id="sv_note" rows="2">${escapeHtml(s?.note)}</textarea></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="sv_cancel" data-i18n="cancel"></button>
        <button class="btn btn-primary" id="sv_save" data-i18n="save"></button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML("beforeend", modalHtml);
  applyI18n(document.getElementById("svModalBackdrop"));
  const typeSel = document.getElementById("sv_type");
  const unitInput = document.getElementById("sv_unit");
  const customWrap = document.getElementById("sv_customWrap");
  if (!editing) unitInput.value = SURVEY_UNITS[typeSel.value] || "";
  typeSel.addEventListener("change", () => {
    customWrap.classList.toggle("hidden", typeSel.value !== "custom");
    if (typeSel.value !== "custom") unitInput.value = SURVEY_UNITS[typeSel.value] || "";
  });
  const close = () => document.getElementById("svModalBackdrop").remove();
  document.getElementById("closeSvModal").addEventListener("click", close);
  document.getElementById("sv_cancel").addEventListener("click", close);
  document.getElementById("sv_save").addEventListener("click", async () => {
    const data = {
      type: typeSel.value,
      customLabel: typeSel.value === "custom" ? document.getElementById("sv_customLabel").value.trim() : "",
      contractQty: Number(document.getElementById("sv_contract").value) || 0,
      unit: unitInput.value.trim() || SURVEY_UNITS[typeSel.value] || "",
      assignee: document.getElementById("sv_assignee").value.trim(),
      note: document.getElementById("sv_note").value.trim(),
    };
    if (data.type === "custom" && !data.customLabel) return;
    showSaveIndicator(true);
    if (editing) await updateSurveyItem(projectId, s.id, data, CURRENT_USER, surveyItemLabel(data));
    else await addSurveyItem(projectId, data, CURRENT_USER);
    showSaveIndicator();
    close();
  });
}

// ============================================================
// DAILY REPORT VIEW
// ============================================================
function renderReportView(preselectedProjectId) {
  window.__routeParam = preselectedProjectId;
  const target = document.getElementById("tabContent") || mainView;
  const isStandalone = target === mainView;
  const html = `
    ${isStandalone ? topbarHtml("dailyReport") : ""}
    <div class="report-toolbar">
      <div class="field">
        <label data-i18n="selectProject"></label>
        <select id="rp_project"></select>
      </div>
      <div class="field">
        <label data-i18n="selectDate"></label>
        <input type="date" id="rp_date" value="${dateKey()}" />
      </div>
      <button class="btn btn-primary" id="rp_exportPdf" data-i18n="exportPdf"></button>
      <button class="btn btn-ghost" id="rp_copy" data-i18n="copySummary"></button>
    </div>
    <label class="switch-row">
      <span class="switch">
        <input type="checkbox" id="rp_includeSoilRock" ${localStorage.getItem("sh_includeSoilRock") === "false" ? "" : "checked"} />
        <span class="switch-slider"></span>
      </span>
      <span data-i18n="includeSoilRockTable"></span>
    </label>
    <div class="card">
      <h3 data-i18n="nextDayPlan"></h3>
      <textarea id="rp_nextPlan" rows="2" data-i18n-placeholder="nextDayPlanPlaceholder" ${canEdit() ? "" : "disabled"}></textarea>
    </div>
    <div id="rp_container" style="overflow-x:auto; padding-bottom:20px;"></div>
  `;
  target.innerHTML = html;
  if (isStandalone) bindTopbar(); else applyI18n(target);

  const projSelect = document.getElementById("rp_project");
  projSelect.innerHTML = projectsCache.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  if (preselectedProjectId) projSelect.value = preselectedProjectId;

  const includeSoilRockEl = document.getElementById("rp_includeSoilRock");
  includeSoilRockEl.addEventListener("change", () => {
    localStorage.setItem("sh_includeSoilRock", includeSoilRockEl.checked ? "true" : "false");
    refreshReport();
  });

  async function refreshReport() {
    const pid = projSelect.value;
    if (!pid) { document.getElementById("rp_container").innerHTML = `<div class="empty-state">${t("noProjects")}</div>`; return; }
    const project = await getProject(pid);
    const dKey = document.getElementById("rp_date").value || dateKey();
    // fetch data via one-off watchers (snapshot once)
    const [boreholes, surveyItems, activities] = await Promise.all([
      oneOff(watchBoreholes, pid),
      oneOff(watchSurveyItems, pid),
      oneOff(watchActivity, pid),
    ]);
    const html = buildReportHTML({ project, boreholes, surveyItems, dKey, activities, currentUser: CURRENT_USER, lang: getLang(), includeSoilRockTable: includeSoilRockEl.checked });
    document.getElementById("rp_container").innerHTML = html;
    window.__reportCtx = { project, boreholes, surveyItems, dKey };
    const planEl = document.getElementById("rp_nextPlan");
    if (planEl) planEl.value = (project.nextDayPlan || {})[dKey] || "";
  }
  projSelect.addEventListener("change", refreshReport);
  document.getElementById("rp_date").addEventListener("change", refreshReport);
  const planEl = document.getElementById("rp_nextPlan");
  if (planEl) {
    planEl.addEventListener("change", async () => {
      const pid = projSelect.value;
      const dKey = document.getElementById("rp_date").value || dateKey();
      if (!pid) return;
      showSaveIndicator(true);
      await updateNextDayPlan(pid, dKey, planEl.value.trim(), CURRENT_USER);
      showSaveIndicator();
      refreshReport();
    });
  }
  document.getElementById("rp_exportPdf").addEventListener("click", async () => {
    const btn = document.getElementById("rp_exportPdf");
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "…";
    try {
      const name = slugify(window.__reportCtx?.project?.name);
      await exportReportToPdf("reportPrintArea", `${name}_${dateKey()}.pdf`);
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  });
  document.getElementById("rp_copy").addEventListener("click", async () => {
    if (!window.__reportCtx) return;
    const txt = buildSummaryText({ ...window.__reportCtx, lang: getLang() });
    try {
      await navigator.clipboard.writeText(txt);
      alert(getLang() === "vi" ? "Đã sao chép!" : "Copied!");
    } catch { /* ignore */ }
  });

  if (projectsCache.length) refreshReport();
  else {
    const unsub = watchProjects((projects) => {
      projectsCache = projects;
      projSelect.innerHTML = projects.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
      if (preselectedProjectId) projSelect.value = preselectedProjectId;
      refreshReport();
    });
    currentProjectUnsubs.push(unsub);
  }
}
function oneOff(watchFn, id) {
  return new Promise((resolve) => {
    const unsub = watchFn(id, (data) => { resolve(data); unsub(); });
  });
}

// ============================================================
// DRILLING MACHINE DAILY LOG
// ============================================================
// Danh sách hạng mục sửa máy khoan thường gặp (song ngữ) để chọn nhanh, kèm lựa
// chọn "Tự nhập" cho trường hợp không có sẵn trong danh sách.
const REPAIR_ITEM_OPTIONS = [
  "Hỏng búa SPT / SPT Hammer broken",
  "Hỏng côn / Clutch broken",
  "Hỏng bơm / Pump broken",
  "Hỏng hộp số phụ / Auxiliary gearbox broken",
  "Hỏng đầu rồng / Main drilling rod broken",
  "Hỏng bạc đạn / Bearing broken",
  "Hỏng máy nổ / Diesel machine broken",
  "Hỏng co nối / Valve broken",
  "Hỏng tời / Winch broken",
  "Hỏng ống khoan / Drilling tube broken",
];

const DRILL_LOG_FIELDS = [
  { key: "operator", label: "operator", type: "text" },
  { key: "engineer", label: "engineerInCharge", type: "text" },
  { key: "morningStart", label: "morningStart", type: "time" },
  { key: "lunchBreak", label: "lunchBreak", type: "time" },
  { key: "afternoonStart", label: "afternoonStart", type: "time" },
  { key: "endOfDay", label: "endOfDay", type: "time" },
  { key: "breakdownPeriods", label: "breakdownPeriods", type: "periods" },
  { key: "repairItem", label: "repairItem", type: "multiselect" },
  { key: "suspensionTime", label: "suspensionTime", type: "time" },
  { key: "suspensionReason", label: "suspensionReason", type: "text" },
];

function getMachineDayLog(m, dKey) {
  const logs = m.dailyLogs || {};
  if (logs[dKey]) return { data: logs[dKey], carried: false };
  const prevDates = Object.keys(logs).filter((d) => d < dKey).sort();
  if (prevDates.length) {
    return { data: { ...logs[prevDates[prevDates.length - 1]] }, carried: true };
  }
  return { data: {}, carried: false };
}

function renderDrillLogView() {
  mainView.innerHTML = topbarHtml("drillLogTitle") + `
    <div class="report-toolbar">
      <div class="field"><label data-i18n="selectProject"></label><select id="dl_project"></select></div>
      <div class="field"><label data-i18n="selectDate"></label><input type="date" id="dl_date" value="${dateKey()}" /></div>
      <div class="field"><label data-i18n="selectMachine"></label><select id="dl_machineFilter"></select></div>
      <button class="btn btn-primary" id="dl_exportPdf" data-i18n="exportPdf"></button>
      <button class="btn btn-primary" id="dl_exportRepairLog" data-i18n="exportRepairLog"></button>
      ${canEdit() ? `<button class="btn btn-primary" id="dl_addMachine" data-i18n="addMachine"></button>` : ""}
    </div>
    <div id="dl_container"></div>
  `;
  bindTopbar();

  const projSelect = document.getElementById("dl_project");
  const dateInput = document.getElementById("dl_date");
  const machineFilter = document.getElementById("dl_machineFilter");
  let currentProject = null;
  let currentMachines = [];

  function fillProjects() {
    projSelect.innerHTML = projectsCache.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  }
  function fillMachineFilter() {
    const prev = machineFilter.value;
    machineFilter.innerHTML = `<option value="">${t("allMachines")}</option>` + currentMachines.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join("");
    if ([...machineFilter.options].some((o) => o.value === prev)) machineFilter.value = prev;
  }
  async function renderCards() {
    const container = document.getElementById("dl_container");
    if (!container) return;
    const dKey = dateInput.value || dateKey();
    const filterId = machineFilter.value;
    const machines = filterId ? currentMachines.filter((m) => m.id === filterId) : currentMachines;
    if (!machines.length) { container.innerHTML = `<div class="empty-state">${t("noMachinesYet")}</div>`; return; }
    container.innerHTML = machines.map((m) => drillMachineCardHtml(m, dKey)).join("");
    machines.forEach((m) => bindDrillMachineCard(currentProject.id, m, dKey));
    // Lưu lại bản kế thừa của những máy chưa có dữ liệu ngày này, để lần sau không phải tính lại.
    machines.forEach(async (m) => {
      const { data, carried } = getMachineDayLog(m, dKey);
      if (carried && Object.keys(data).length) {
        await saveDrillingMachineDayLog(currentProject.id, m.id, dKey, data, CURRENT_USER, m.name);
      }
    });
  }
  // Trên điện thoại, bộ chọn giờ gốc (native <input type="time">) sẽ tự động
  // đóng lại nếu phần tử input bị hủy/tạo lại giữa lúc đang chọn (ví dụ vừa
  // chỉnh xong giờ thì component bị vẽ lại do Firestore báo có thay đổi —
  // chính là giá trị vừa lưu). Vì vậy khi đang có 1 ô giờ (input type="time")
  // bất kỳ được focus, ta hoãn việc vẽ lại danh sách cho đến khi rời khỏi ô đó.
  let pendingRerender = false;
  function isTimeInput(el) { return !!el && el.tagName === "INPUT" && el.type === "time"; }
  function loadMachines(pid) {
    const unsub = watchDrillingMachines(pid, (machines) => {
      currentMachines = machines;
      fillMachineFilter();
      if (isTimeInput(document.activeElement)) {
        pendingRerender = true;
        return;
      }
      renderCards();
    });
    currentProjectUnsubs.push(unsub);
  }
  document.getElementById("dl_container").addEventListener("focusout", (e) => {
    if (isTimeInput(e.target) && pendingRerender) {
      pendingRerender = false;
      renderCards();
    }
  });
  async function loadProject(pid) {
    cleanupProjectWatchers();
    currentProject = await getProject(pid);
    loadMachines(pid);
  }

  projSelect.addEventListener("change", () => loadProject(projSelect.value));
  dateInput.addEventListener("change", renderCards);
  machineFilter.addEventListener("change", renderCards);
  const addBtn = document.getElementById("dl_addMachine");
  if (addBtn) addBtn.addEventListener("click", () => openDrillMachineModal(currentProject.id));
  document.getElementById("dl_exportPdf").addEventListener("click", async () => {
    const btn = document.getElementById("dl_exportPdf");
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "…";
    try {
      const dKey = dateInput.value || dateKey();
      const filterId = machineFilter.value;
      const machines = filterId ? currentMachines.filter((m) => m.id === filterId) : currentMachines;
      const html = buildDrillLogHTML({ project: currentProject, machines, dKey, currentUser: CURRENT_USER, lang: getLang() });
      const holder = document.createElement("div");
      holder.id = "drillLogPrintAreaHolder";
      holder.style.position = "fixed";
      holder.style.top = "0";
      holder.style.left = "-99999px";
      holder.innerHTML = html;
      document.body.appendChild(holder);
      const name = slugify(currentProject?.name);
      await exportReportToPdf("drillLogPrintArea", `${name}_drilllog_${dKey}.pdf`);
      document.body.removeChild(holder);
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  });
  document.getElementById("dl_exportRepairLog").addEventListener("click", async () => {
    const btn = document.getElementById("dl_exportRepairLog");
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "…";
    try {
      const filterId = machineFilter.value;
      const machines = filterId ? currentMachines.filter((m) => m.id === filterId) : currentMachines;
      const machineLabel = filterId ? (currentMachines.find((m) => m.id === filterId)?.name || "") : t("allMachines");
      const html = buildRepairHistoryHTML({ project: currentProject, machines, currentUser: CURRENT_USER, lang: getLang(), machineLabel });
      const holder = document.createElement("div");
      holder.id = "repairLogPrintAreaHolder";
      holder.style.position = "fixed";
      holder.style.top = "0";
      holder.style.left = "-99999px";
      holder.innerHTML = html;
      document.body.appendChild(holder);
      const name = slugify(currentProject?.name);
      await exportReportToPdf("repairLogPrintArea", `${name}_suachua_${dateKey()}.pdf`);
      document.body.removeChild(holder);
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  });

  if (projectsCache.length) {
    fillProjects();
    loadProject(projSelect.value);
  } else {
    const unsub = watchProjects((projects) => {
      projectsCache = projects;
      fillProjects();
      loadProject(projSelect.value);
    });
    currentProjectUnsubs.push(unsub);
  }
}

// Cho phép ghi nhận NHIỀU khoảng thời gian hỏng máy/sửa xong trong cùng 1 ngày
// (VD: hỏng lúc 8h sửa xong 11h, rồi lại hỏng lúc 13h sửa xong 15h), thay vì chỉ
// 1 cặp giờ duy nhất như trước — giúp người kiểm tra dễ theo dõi hơn.
function breakdownPeriodsFieldHtml(value) {
  const periods = Array.isArray(value) ? value : [];
  if (!canEdit()) {
    if (!periods.length) return `<div class="ms-readonly">—</div>`;
    return `<div class="ms-readonly">${periods.map((p) => `${escapeHtml(p.start || "?")} → ${escapeHtml(p.end || "?")}`).join("; ")}</div>`;
  }
  const rowsHtml = periods.map((p) => `
    <div class="bp-row">
      <input type="time" class="bp-start" value="${escapeAttr(p.start)}" />
      <span class="bp-arrow">→</span>
      <input type="time" class="bp-end" value="${escapeAttr(p.end)}" />
      <button type="button" class="bp-remove" title="${t("remove")}">✕</button>
    </div>`).join("");
  return `<div class="bp-wrap">
    <div class="bp-rows">${rowsHtml}</div>
    ${!periods.length ? `<div class="bp-empty">${t("noBreakdownPeriods")}</div>` : ""}
    <button type="button" class="btn btn-ghost btn-sm bp-add">${t("addBreakdownPeriod")}</button>
  </div>`;
}

function bindBreakdownPeriodsField(wrap, projectId, machineId, dKey, machineName) {
  if (!wrap) return; // read-only (no editor rendered)
  const rowsContainer = wrap.querySelector(".bp-rows");
  const addBtn = wrap.querySelector(".bp-add");

  function bindRow(row) {
    row.querySelectorAll(".bp-start, .bp-end").forEach((inp) => inp.addEventListener("change", save));
    row.querySelector(".bp-remove").addEventListener("click", () => { row.remove(); save(); });
  }
  rowsContainer.querySelectorAll(".bp-row").forEach(bindRow);

  async function save() {
    const periods = [...rowsContainer.querySelectorAll(".bp-row")].map((row) => ({
      start: row.querySelector(".bp-start").value || "",
      end: row.querySelector(".bp-end").value || "",
    }));
    showSaveIndicator(true);
    await updateDrillingMachineField(projectId, machineId, dKey, "breakdownPeriods", periods, CURRENT_USER, machineName);
    showSaveIndicator();
  }

  addBtn.addEventListener("click", () => {
    const empty = wrap.querySelector(".bp-empty");
    if (empty) empty.remove();
    const row = document.createElement("div");
    row.className = "bp-row";
    row.innerHTML = `<input type="time" class="bp-start" /><span class="bp-arrow">→</span><input type="time" class="bp-end" /><button type="button" class="bp-remove" title="${t("remove")}">✕</button>`;
    rowsContainer.appendChild(row);
    bindRow(row);
  });
}

function repairItemFieldHtml(value) {
  const val = value || "";
  const parts = val.split(";").map((s) => s.trim()).filter(Boolean);
  const selectedSet = new Set(parts.filter((p) => REPAIR_ITEM_OPTIONS.includes(p)));
  const manualText = parts.filter((p) => !REPAIR_ITEM_OPTIONS.includes(p)).join("; ");
  const summary = parts.length ? parts.join(", ") : t("repairItemPlaceholder");

  if (!canEdit()) {
    return `<div class="ms-readonly">${escapeHtml(parts.length ? parts.join(", ") : "—")}</div>`;
  }

  const optionsHtml = REPAIR_ITEM_OPTIONS.map((opt) => `
    <label class="ms-option">
      <input type="checkbox" class="ms-opt-cb" value="${escapeAttr(opt)}" ${selectedSet.has(opt) ? "checked" : ""} />
      <span>${escapeHtml(opt)}</span>
    </label>`).join("");

  return `
  <div class="ms-wrap">
    <button type="button" class="ms-toggle">
      <span class="ms-summary">${escapeHtml(summary)}</span>
      <span class="ms-caret">▾</span>
    </button>
    <div class="ms-panel hidden">
      ${optionsHtml}
      <label class="ms-option ms-manual-opt">
        <input type="checkbox" class="ms-manual-cb" ${manualText ? "checked" : ""} />
        <span data-i18n="manualInput"></span>
      </label>
      <textarea class="ms-manual-text ${manualText ? "" : "hidden"}" rows="2" data-i18n-placeholder="manualInputPlaceholder">${escapeHtml(manualText)}</textarea>
      <button type="button" class="btn btn-primary btn-sm ms-done" data-i18n="done"></button>
    </div>
    <input type="hidden" class="dl-field" data-key="repairItem" value="${escapeAttr(val)}" />
  </div>`;
}

function bindRepairItemField(wrap) {
  if (!wrap) return;
  const toggleBtn = wrap.querySelector(".ms-toggle");
  const panel = wrap.querySelector(".ms-panel");
  if (!toggleBtn || !panel) return; // read-only (no picker rendered)
  const hidden = wrap.querySelector('input.dl-field[data-key="repairItem"]');
  const summaryEl = wrap.querySelector(".ms-summary");
  const manualCb = wrap.querySelector(".ms-manual-cb");
  const manualText = wrap.querySelector(".ms-manual-text");

  function recompute() {
    const checked = [...wrap.querySelectorAll(".ms-opt-cb:checked")].map((cb) => cb.value);
    let manual = "";
    if (manualCb && manualCb.checked) manual = (manualText?.value || "").trim();
    const all = manual ? [...checked, manual] : checked;
    const combined = all.join("; ");
    hidden.value = combined;
    summaryEl.textContent = all.length ? all.join(", ") : t("repairItemPlaceholder");
    return combined;
  }
  function commit() { hidden.dispatchEvent(new Event("change")); }

  toggleBtn.addEventListener("click", () => panel.classList.toggle("hidden"));
  wrap.querySelectorAll(".ms-opt-cb").forEach((cb) => {
    cb.addEventListener("change", () => { recompute(); commit(); });
  });
  if (manualCb) {
    manualCb.addEventListener("change", () => {
      manualText.classList.toggle("hidden", !manualCb.checked);
      if (manualCb.checked) manualText.focus();
      recompute(); commit();
    });
  }
  if (manualText) {
    manualText.addEventListener("input", recompute);
    manualText.addEventListener("change", commit);
  }
  const doneBtn = wrap.querySelector(".ms-done");
  if (doneBtn) doneBtn.addEventListener("click", () => panel.classList.add("hidden"));
}

function drillMachineCardHtml(m, dKey) {
  const { data, carried } = getMachineDayLog(m, dKey);
  const fieldsHtml = DRILL_LOG_FIELDS.map((f) => {
    let control;
    if (f.type === "periods") {
      control = breakdownPeriodsFieldHtml(data[f.key]);
    } else if (f.type === "multiselect") {
      control = repairItemFieldHtml(data[f.key]);
    } else if (f.type === "textarea") {
      control = `<textarea class="dl-field" data-key="${f.key}" rows="2" ${canEdit() ? "" : "disabled"}>${escapeHtml(data[f.key] ?? "")}</textarea>`;
    } else if (f.type === "time") {
      // Nút "✕" riêng để xóa giờ một cách chắc chắn: nút "Đặt lại" của bộ chọn
      // giờ gốc trên điện thoại có thể không xóa về rỗng thật sự tùy máy/trình
      // duyệt, khiến báo cáo lỡ hiện ra một mốc giờ không có thật (VD 00:00).
      control = `<div class="time-field-wrap">
          <input type="time" class="dl-field" data-key="${f.key}" value="${escapeAttr(data[f.key])}" ${canEdit() ? "" : "disabled"} />
          ${canEdit() ? `<button type="button" class="dl-field-clear" data-key="${f.key}" title="${t("clearTime")}" aria-label="${t("clearTime")}">✕</button>` : ""}
        </div>`;
    } else {
      control = `<input type="${f.type}" class="dl-field" data-key="${f.key}" value="${escapeAttr(data[f.key])}" ${canEdit() ? "" : "disabled"} />`;
    }
    return `
    <div class="field">
      <label data-i18n="${f.label}"></label>
      ${control}
    </div>`;
  }).join("");
  return `<div class="card item-block" data-id="${m.id}">
    <div class="item-head">
      <h4>${drillIconSvg()} ${escapeHtml(m.name || "—")}</h4>
      <div class="item-actions">
        ${canEdit() ? `<button class="btn btn-ghost btn-sm edit-dm" data-i18n="edit"></button>` : ""}
        ${canEdit() ? `<button class="btn btn-danger btn-sm del-dm" data-i18n="delete"></button>` : ""}
      </div>
    </div>
    ${carried && Object.keys(data).length ? `<p style="font-size:12px; color:var(--text-dim); margin:0 0 10px;">↺ ${t("carriedForwardNote")}</p>` : ""}
    <div class="field-row">${fieldsHtml}</div>
  </div>`;
}
function bindDrillMachineCard(projectId, m, dKey) {
  const el = document.querySelector(`.item-block[data-id="${m.id}"]`);
  if (!el) return;
  applyI18n(el);
  const editBtn = el.querySelector(".edit-dm");
  if (editBtn) editBtn.addEventListener("click", () => openDrillMachineModal(projectId, m));
  const delBtn = el.querySelector(".del-dm");
  if (delBtn) delBtn.addEventListener("click", async () => {
    if (await showConfirmModal(t("deleteMachineConfirm"))) await deleteDrillingMachine(projectId, m.id, CURRENT_USER, m.name);
  });
  el.querySelectorAll(".dl-field").forEach((input) => {
    input.addEventListener("change", async () => {
      showSaveIndicator(true);
      await updateDrillingMachineField(projectId, m.id, dKey, input.dataset.key, input.value, CURRENT_USER, m.name);
      showSaveIndicator();
    });
  });
  el.querySelectorAll(".dl-field-clear").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = btn.previousElementSibling;
      if (!input || !input.classList.contains("dl-field")) return;
      input.value = "";
      input.dispatchEvent(new Event("change"));
    });
  });
  bindRepairItemField(el.querySelector(".ms-wrap"));
  bindBreakdownPeriodsField(el.querySelector(".bp-wrap"), projectId, m.id, dKey, m.name);
}
function openDrillMachineModal(projectId, m) {
  const editing = !!m;
  const modalHtml = `
  <div class="modal-backdrop" id="dmModalBackdrop">
    <div class="modal">
      <div class="modal-head"><h3 data-i18n="machine"></h3><button class="icon-btn" id="closeDmModal">✕</button></div>
      <div class="field"><label data-i18n="machineName"></label><input id="dm_name" data-i18n-placeholder="machineNamePlaceholder" value="${escapeAttr(m?.name)}" /></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="dm_cancel" data-i18n="cancel"></button>
        <button class="btn btn-primary" id="dm_save" data-i18n="save"></button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML("beforeend", modalHtml);
  applyI18n(document.getElementById("dmModalBackdrop"));
  const close = () => document.getElementById("dmModalBackdrop").remove();
  document.getElementById("closeDmModal").addEventListener("click", close);
  document.getElementById("dm_cancel").addEventListener("click", close);
  document.getElementById("dm_save").addEventListener("click", async () => {
    const name = document.getElementById("dm_name").value.trim();
    if (!name) return;
    showSaveIndicator(true);
    if (editing) await updateDrillingMachine(projectId, m.id, { name }, CURRENT_USER, name);
    else await addDrillingMachine(projectId, { name }, CURRENT_USER);
    showSaveIndicator();
    close();
  });
}

// ============================================================
// EQUIPMENT CHECK IN / CHECK OUT VIEW
// ============================================================
function equipItemLabel(it) {
  if (!it) return "";
  if (it.customName) return it.customName;
  const cat = EQUIPMENT_CATALOG.find((e) => e.id === it.itemId);
  const name = cat ? (getLang() === "vi" ? cat.vi : cat.en) : it.itemId;
  return it.spec ? `${name} — ${it.spec}` : name;
}
function equipTimeLabel(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString(getLang() === "vi" ? "vi-VN" : "en-US") + " " + d.toLocaleTimeString(getLang() === "vi" ? "vi-VN" : "en-US", { hour: "2-digit", minute: "2-digit" });
}

function showRepeatProjectModal() {
  return new Promise((resolve) => {
    const html = `
    <div class="modal-backdrop" id="repeatProjModalBackdrop">
      <div class="modal">
        <div class="modal-head">
          <h3 data-i18n="repeatProjectPick"></h3>
          <button class="icon-btn" id="repeatProjClose">✕</button>
        </div>
        <div class="field"><select id="repeatProjSelect">${projectsCache.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}</select></div>
        <p class="error-msg" id="repeatProjError"></p>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="repeatProjCancel" data-i18n="cancel"></button>
          <button class="btn btn-primary" id="repeatProjOk" data-i18n="confirmBtn"></button>
        </div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML("beforeend", html);
    const backdrop = document.getElementById("repeatProjModalBackdrop");
    applyI18n(backdrop);
    const close = (val) => { backdrop.remove(); resolve(val); };
    document.getElementById("repeatProjClose").addEventListener("click", () => close(null));
    document.getElementById("repeatProjCancel").addEventListener("click", () => close(null));
    document.getElementById("repeatProjOk").addEventListener("click", () => close(document.getElementById("repeatProjSelect").value));
  });
}

function renderEquipmentView() {
  let currentProject = null;
  let logs = [];
  let section = "checkinout"; // checkinout | consumables
  let mode = "list"; // list | new | checkin
  let draftItems = []; // { itemId, spec, customName, qty }
  let editingLogId = null; // when editing an existing checkout's item list
  let checkinLog = null; // the log currently being checked in / edited

  function tabsHtml() {
    return `<div class="eq-tabs">
      <button type="button" class="btn ${section === "checkinout" ? "btn-primary" : "btn-ghost"}" id="eq_tab_checkinout" data-i18n="tabCheckInOut"></button>
      <button type="button" class="btn ${section === "consumables" ? "btn-primary" : "btn-ghost"}" id="eq_tab_consumables" data-i18n="tabConsumables"></button>
    </div>`;
  }
  function bindTabs() {
    document.getElementById("eq_tab_checkinout").addEventListener("click", () => { section = "checkinout"; mode = "list"; render(); });
    document.getElementById("eq_tab_consumables").addEventListener("click", () => { section = "consumables"; render(); });
  }

  function render() {
    if (section === "consumables") { renderConsumablesMode(); return; }
    if (mode === "new") renderNewMode();
    else if (mode === "checkin") renderCheckinMode();
    else renderListMode();
  }

  // ---------- LIST MODE ----------
  function renderListMode() {
    mainView.innerHTML = topbarHtml("equipmentTitle") + tabsHtml() + `
      <div class="report-toolbar">
        <div class="field"><label data-i18n="selectProject"></label><select id="eq_project"></select></div>
        ${canEdit() ? `<button class="btn btn-primary" id="eq_new" data-i18n="newCheckout"></button>
        <button class="btn btn-ghost" id="eq_repeat" data-i18n="repeatPreviousProject"></button>` : ""}
      </div>
      <div id="eq_list"></div>
    `;
    bindTopbar();
    bindTabs();
    const projSelect = document.getElementById("eq_project");
    projSelect.innerHTML = projectsCache.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
    if (currentProject) projSelect.value = currentProject.id;

    async function loadProject(pid) {
      cleanupProjectWatchers();
      currentProject = await getProject(pid);
      const unsub = watchEquipmentLogs(pid, (data) => { logs = data; renderList(); });
      currentProjectUnsubs.push(unsub);
    }
    projSelect.addEventListener("change", () => loadProject(projSelect.value));

    function renderList() {
      const listEl = document.getElementById("eq_list");
      if (!listEl) return;
      if (!logs.length) { listEl.innerHTML = `<div class="empty-state">${t("noEquipmentLogs")}</div>`; return; }
      listEl.innerHTML = logs.map((log) => {
        const checkedIn = !!log.checkin;
        const items = log.items || [];
        const preview = items.slice(0, 3).map(equipItemLabel).join(", ") + (items.length > 3 ? "…" : "");
        let summaryHtml = "";
        if (checkedIn) {
          const totals = (log.checkin.items || []).reduce((a, it) => {
            a.issued += Number(it.issuedQty) || 0; a.returned += Number(it.returnedQty) || 0;
            a.damaged += Number(it.damagedQty) || 0; a.lost += Number(it.lostQty) || 0;
            return a;
          }, { issued: 0, returned: 0, damaged: 0, lost: 0 });
          summaryHtml = `<div class="equip-summary-inline">
            <span>${t("totalIssued")}: <b>${totals.issued}</b></span>
            <span>${t("totalReturned")}: <b>${totals.returned}</b></span>
            <span>${t("totalDamaged")}: <b>${totals.damaged}</b></span>
            <span>${t("totalLost")}: <b>${totals.lost}</b></span>
          </div>`;
        }
        return `
        <div class="card equip-card" data-log-id="${log.id}">
          <div class="item-head">
            <h4>${equipTimeLabel(log.createdAt)} · ${items.length} ${t("itemsCount")}</h4>
            <span class="badge ${checkedIn ? "st-done" : "st-progress"}">${checkedIn ? t("checkedIn") : t("notCheckedIn")}</span>
          </div>
          <div class="equip-preview">${escapeHtml(preview || "—")}</div>
          ${summaryHtml}
          <div class="equip-actions">
            ${canEdit() && !checkedIn ? `<button class="btn btn-ghost btn-sm eq-edit" data-i18n="editCheckout"></button>` : ""}
            ${canEdit() ? `<button class="btn btn-primary btn-sm eq-checkin" data-i18n="${checkedIn ? "editCheckin" : "checkinBtn"}"></button>` : ""}
            <button class="btn btn-ghost btn-sm eq-pdf-out" data-i18n="exportCheckoutPdf"></button>
            ${checkedIn ? `<button class="btn btn-ghost btn-sm eq-pdf-in" data-i18n="exportCheckinPdf"></button>` : ""}
            ${isAdmin() ? `<button class="btn btn-danger btn-sm eq-delete" data-i18n="delete"></button>` : ""}
          </div>
        </div>`;
      }).join("");
      applyI18n(listEl);
      listEl.querySelectorAll(".equip-card").forEach((card) => {
        const logId = card.dataset.logId;
        const log = logs.find((l) => l.id === logId);
        const editBtn = card.querySelector(".eq-edit");
        if (editBtn) editBtn.addEventListener("click", () => {
          editingLogId = logId;
          draftItems = (log.items || []).map((it) => ({ ...it }));
          mode = "new"; render();
        });
        const checkinBtn = card.querySelector(".eq-checkin");
        if (checkinBtn) checkinBtn.addEventListener("click", () => { checkinLog = log; mode = "checkin"; render(); });
        card.querySelector(".eq-pdf-out").addEventListener("click", async (e) => {
          await exportEquipmentPdf("checkout", log, e.target);
        });
        const pdfInBtn = card.querySelector(".eq-pdf-in");
        if (pdfInBtn) pdfInBtn.addEventListener("click", async (e) => {
          await exportEquipmentPdf("checkin", log, e.target);
        });
        const delBtn = card.querySelector(".eq-delete");
        if (delBtn) delBtn.addEventListener("click", async () => {
          if (await showConfirmModal(t("deleteLogConfirm"))) {
            showSaveIndicator(true);
            try {
              await deleteEquipmentLog(currentProject.id, logId, CURRENT_USER);
              showSaveIndicator();
            } catch (e) {
              showSaveIndicator();
              alert(t("equipSaveError") + "\n" + (e?.message || e));
            }
          }
        });
      });
    }

    async function exportEquipmentPdf(kind, log, btnEl) {
      const btn = btnEl.closest("button");
      const orig = btn.textContent;
      btn.disabled = true; btn.textContent = "…";
      try {
        const html = kind === "checkout"
          ? buildEquipmentCheckoutHTML({ project: currentProject, log, currentUser: CURRENT_USER, lang: getLang() })
          : buildEquipmentCheckinHTML({ project: currentProject, log, currentUser: CURRENT_USER, lang: getLang() });
        const holder = document.createElement("div");
        holder.style.position = "fixed"; holder.style.top = "0"; holder.style.left = "-99999px";
        holder.innerHTML = html;
        document.body.appendChild(holder);
        const name = slugify(currentProject?.name);
        const elId = kind === "checkout" ? "equipCheckoutPrintArea" : "equipCheckinPrintArea";
        await exportReportToPdf(elId, `${name}_${kind === "checkout" ? "xuatkho" : "nhapkho"}_${dateKey()}.pdf`);
        document.body.removeChild(holder);
      } finally {
        btn.disabled = false; btn.textContent = orig;
      }
    }

    const newBtn = document.getElementById("eq_new");
    if (newBtn) newBtn.addEventListener("click", () => { editingLogId = null; draftItems = []; mode = "new"; render(); });
    const repeatBtn = document.getElementById("eq_repeat");
    if (repeatBtn) repeatBtn.addEventListener("click", async () => {
      const pid = await showRepeatProjectModal();
      if (!pid) return;
      showSaveIndicator(true);
      try {
        const prevLog = await getLatestEquipmentLog(pid);
        showSaveIndicator();
        if (!prevLog) { alert(t("repeatProjectNone")); return; }
        editingLogId = null;
        draftItems = (prevLog.items || []).map((it) => ({ ...it }));
        mode = "new"; render();
      } catch (e) {
        showSaveIndicator();
        alert(t("equipSaveError") + "\n" + (e?.message || e));
      }
    });

    if (projectsCache.length) loadProject(projSelect.value);
  }

  // ---------- NEW / EDIT CHECKOUT MODE ----------
  function renderNewMode() {
    const catOptions = `<option value="">${t("allCategories")}</option>` + EQUIPMENT_CATEGORIES.map((c) => `<option value="${c.id}">${escapeHtml(getLang() === "vi" ? c.vi : c.en)}</option>`).join("");
    mainView.innerHTML = topbarHtml("equipmentTitle") + `
      <button class="btn btn-ghost btn-sm" id="eq_back" data-i18n="backToList"></button>
      <div class="card">
        <h3 data-i18n="newCheckout"></h3>
        <div class="field-row">
          <div class="field"><label data-i18n="selectCategory"></label><select id="eq_cat">${catOptions}</select></div>
          <div class="field"><label data-i18n="searchEquipment"></label><input id="eq_search" data-i18n-placeholder="searchEquipment" /></div>
        </div>
        <div class="field-row">
          <div class="field"><label data-i18n="selectEquipment"></label><select id="eq_item"></select></div>
          <div class="field hidden" id="eq_specWrap"><label data-i18n="selectSpec"></label><select id="eq_spec"></select></div>
          <div class="field hidden" id="eq_customWrap"><label data-i18n="customEquipmentName"></label><input id="eq_custom" /></div>
          <div class="field" style="max-width:120px;"><label data-i18n="quantity"></label><input type="number" id="eq_qty" min="1" value="1" /></div>
        </div>
        <button class="btn btn-primary btn-sm" id="eq_add" data-i18n="addItem"></button>
      </div>
      <div class="card">
        <h3 data-i18n="draftListTitle"></h3>
        <div class="table-scroll-hint">↔ <span data-i18n="swipeHint"></span></div>
        <div id="eq_draftTable" class="table-scroll"></div>
        <button class="btn btn-primary" id="eq_save" data-i18n="saveCheckout"></button>
      </div>
    `;
    bindTopbar();
    document.getElementById("eq_back").addEventListener("click", () => { mode = "list"; render(); });

    const catSel = document.getElementById("eq_cat");
    const searchInput = document.getElementById("eq_search");
    const itemSel = document.getElementById("eq_item");
    const specWrap = document.getElementById("eq_specWrap");
    const specSel = document.getElementById("eq_spec");
    const customWrap = document.getElementById("eq_customWrap");
    const customInput = document.getElementById("eq_custom");
    const qtyInput = document.getElementById("eq_qty");

    function fillItemSelect() {
      const cat = catSel.value;
      const q = searchInput.value.trim().toLowerCase();
      const filtered = EQUIPMENT_CATALOG.filter((e) => {
        if (cat && e.cat !== cat) return false;
        if (!q) return true;
        return e.vi.toLowerCase().includes(q) || e.en.toLowerCase().includes(q);
      });
      itemSel.innerHTML = filtered.map((e) => `<option value="${e.id}">${escapeHtml(getLang() === "vi" ? e.vi : e.en)}</option>`).join("");
      updateItemDependentFields();
    }
    function updateItemDependentFields() {
      const it = EQUIPMENT_CATALOG.find((e) => e.id === itemSel.value);
      if (it && it.specs) {
        specWrap.classList.remove("hidden");
        specSel.innerHTML = it.specs.map((s) => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join("");
      } else {
        specWrap.classList.add("hidden");
      }
      customWrap.classList.toggle("hidden", !(it && it.custom));
    }
    catSel.addEventListener("change", fillItemSelect);
    searchInput.addEventListener("input", fillItemSelect);
    itemSel.addEventListener("change", updateItemDependentFields);
    fillItemSelect();

    function renderDraftTable() {
      const el = document.getElementById("eq_draftTable");
      if (!draftItems.length) { el.innerHTML = `<div class="empty-state">${t("draftListEmpty")}</div>`; return; }
      el.innerHTML = `<table class="simple-table"><thead><tr>
        <th data-i18n="equipmentName"></th><th data-i18n="specColumn"></th><th data-i18n="quantity"></th><th></th>
      </tr></thead><tbody>
      ${draftItems.map((it, i) => `<tr>
        <td>${escapeHtml(it.customName || (EQUIPMENT_CATALOG.find((e) => e.id === it.itemId)?.[getLang() === "vi" ? "vi" : "en"] || it.itemId))}</td>
        <td>${escapeHtml(it.spec || "—")}</td>
        <td><input type="number" min="0" class="draft-qty" data-idx="${i}" value="${it.qty}" style="width:70px;" /></td>
        <td><button type="button" class="btn btn-ghost btn-sm draft-remove" data-idx="${i}">✕</button></td>
      </tr>`).join("")}
      </tbody></table>`;
      applyI18n(el);
      el.querySelectorAll(".draft-qty").forEach((inp) => {
        inp.addEventListener("change", () => { draftItems[+inp.dataset.idx].qty = Number(inp.value) || 0; });
      });
      el.querySelectorAll(".draft-remove").forEach((btn) => {
        btn.addEventListener("click", () => { draftItems.splice(+btn.dataset.idx, 1); renderDraftTable(); });
      });
    }
    renderDraftTable();

    document.getElementById("eq_add").addEventListener("click", () => {
      const itemId = itemSel.value;
      if (!itemId) return;
      const it = EQUIPMENT_CATALOG.find((e) => e.id === itemId);
      const spec = it && it.specs ? specSel.value : null;
      const customName = it && it.custom ? customInput.value.trim() : null;
      const qty = Number(qtyInput.value) || 0;
      if (qty <= 0) return;
      if (it && it.custom && !customName) { alert(t("customEquipmentName")); return; }
      const existing = draftItems.find((d) => d.itemId === itemId && d.spec === spec && d.customName === customName);
      if (existing) existing.qty += qty;
      else draftItems.push({ itemId, spec, customName, qty });
      qtyInput.value = "1";
      if (customInput) customInput.value = "";
      renderDraftTable();
    });

    document.getElementById("eq_save").addEventListener("click", async () => {
      const items = draftItems.filter((d) => d.qty > 0);
      if (!items.length) return;
      const saveBtn = document.getElementById("eq_save");
      saveBtn.disabled = true;
      try {
        showSaveIndicator(true);
        if (editingLogId) await updateEquipmentCheckout(currentProject.id, editingLogId, items, CURRENT_USER);
        else await createEquipmentCheckout(currentProject.id, items, CURRENT_USER);
        showSaveIndicator();
        mode = "list"; render();
      } catch (e) {
        showSaveIndicator();
        alert(t("equipSaveError") + "\n" + (e?.message || e));
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  // ---------- CHECK-IN MODE ----------
  function renderCheckinMode() {
    const log = checkinLog;
    const existingByKey = {};
    (log.checkin?.items || []).forEach((it) => { existingByKey[`${it.itemId}|${it.spec || ""}|${it.customName || ""}`] = it; });

    mainView.innerHTML = topbarHtml("equipmentTitle") + `
      <button class="btn btn-ghost btn-sm" id="eq_back2" data-i18n="backToList"></button>
      <div class="card">
        <h3 data-i18n="checkinTitle"></h3>
        <div class="table-scroll-hint">↔ <span data-i18n="swipeHint"></span></div>
        <div class="table-scroll"><table class="simple-table">
          <thead><tr>
            <th data-i18n="equipmentName"></th><th data-i18n="specColumn"></th>
            <th data-i18n="issuedQty"></th><th data-i18n="returnedQty"></th>
            <th data-i18n="damagedQty"></th><th data-i18n="lostQty"></th><th data-i18n="noteCol"></th>
          </tr></thead>
          <tbody id="eq_checkinBody">
          ${(log.items || []).map((it, i) => {
            const key = `${it.itemId}|${it.spec || ""}|${it.customName || ""}`;
            const prev = existingByKey[key];
            const name = it.customName || (EQUIPMENT_CATALOG.find((e) => e.id === it.itemId)?.[getLang() === "vi" ? "vi" : "en"] || it.itemId);
            return `<tr data-idx="${i}">
              <td>${escapeHtml(name)}</td>
              <td>${escapeHtml(it.spec || "—")}</td>
              <td class="num">${it.qty}</td>
              <td><input type="number" min="0" class="ci-returned" value="${prev ? prev.returnedQty : it.qty}" style="width:70px;" /></td>
              <td><input type="number" min="0" class="ci-damaged" value="${prev ? prev.damagedQty : 0}" style="width:70px;" /></td>
              <td><input type="number" min="0" class="ci-lost" value="${prev ? prev.lostQty : 0}" style="width:70px;" /></td>
              <td><input type="text" class="ci-note" value="${escapeAttr(prev ? prev.note : "")}" /></td>
            </tr>`;
          }).join("")}
          </tbody>
        </table></div>
        <button class="btn btn-primary" id="eq_saveCheckin" data-i18n="saveCheckin"></button>
      </div>
    `;
    bindTopbar();
    document.getElementById("eq_back2").addEventListener("click", () => { mode = "list"; render(); });
    document.getElementById("eq_saveCheckin").addEventListener("click", async () => {
      const rows = [...document.querySelectorAll("#eq_checkinBody tr")];
      const checkinItems = rows.map((row) => {
        const idx = +row.dataset.idx;
        const it = log.items[idx];
        return {
          itemId: it.itemId, spec: it.spec || null, customName: it.customName || null,
          issuedQty: it.qty,
          returnedQty: Number(row.querySelector(".ci-returned").value) || 0,
          damagedQty: Number(row.querySelector(".ci-damaged").value) || 0,
          lostQty: Number(row.querySelector(".ci-lost").value) || 0,
          note: row.querySelector(".ci-note").value.trim(),
        };
      });
      const btn = document.getElementById("eq_saveCheckin");
      btn.disabled = true;
      try {
        showSaveIndicator(true);
        await saveEquipmentCheckin(currentProject.id, log.id, checkinItems, CURRENT_USER);
        showSaveIndicator();
        mode = "list"; render();
      } catch (e) {
        showSaveIndicator();
        alert(t("equipSaveError") + "\n" + (e?.message || e));
      } finally {
        btn.disabled = false;
      }
    });
  }

  // ---------- VẬT TƯ TIÊU HAO (Consumables) MODE ----------
  function renderConsumablesMode() {
    let items = [];
    let materialsOnce = [];

    mainView.innerHTML = topbarHtml("equipmentTitle") + tabsHtml() + `
      <div class="report-toolbar">
        <div class="field"><label data-i18n="selectProject"></label><select id="cs_project"></select></div>
        <div class="field"><label data-i18n="selectDate"></label><input type="date" id="cs_date" value="${dateKey()}" /></div>
        <button class="btn btn-ghost" id="cs_exportPdf" data-i18n="exportConsumablesPdf"></button>
      </div>
      ${canEdit() ? `
      <div class="card">
        <h3 data-i18n="addConsumableTitle"></h3>
        <div class="field-row">
          <div class="field"><label data-i18n="selectMaterialOrCustom"></label><select id="cs_materialSelect"><option value="">${t("customInput")}</option></select></div>
          <div class="field" id="cs_customWrap"><label data-i18n="customEquipmentName"></label><input id="cs_customName" /></div>
          <div class="field" style="max-width:120px;"><label data-i18n="unitLabel"></label><input id="cs_unit" placeholder="lít, bao, cái..." /></div>
        </div>
        <button class="btn btn-primary btn-sm" id="cs_add" data-i18n="addItem"></button>
      </div>` : ""}
      <div id="cs_list"></div>
    `;
    bindTopbar();
    bindTabs();

    const projSelect = document.getElementById("cs_project");
    projSelect.innerHTML = projectsCache.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
    if (currentProject) projSelect.value = currentProject.id;
    projSelect.addEventListener("change", () => loadProject(projSelect.value));

    const dateInput = document.getElementById("cs_date");
    dateInput.addEventListener("change", renderList);

    const materialSelect = document.getElementById("cs_materialSelect");
    const customWrap = document.getElementById("cs_customWrap");
    if (materialSelect) {
      getMaterialsOnce().then((mats) => {
        materialsOnce = mats;
        materialSelect.innerHTML = `<option value="">${t("customInput")}</option>` + mats.map((m) => `<option value="${escapeAttr(m.name)}">${escapeHtml(m.name)}</option>`).join("");
      });
      materialSelect.addEventListener("change", () => {
        customWrap.classList.toggle("hidden", !!materialSelect.value);
      });
    }

    const addBtn = document.getElementById("cs_add");
    if (addBtn) addBtn.addEventListener("click", async () => {
      const selected = materialSelect.value;
      const customName = document.getElementById("cs_customName").value.trim();
      const name = selected || customName;
      if (!name) return;
      const unit = document.getElementById("cs_unit").value.trim();
      showSaveIndicator(true);
      await addConsumableItem(currentProject.id, { name, unit }, CURRENT_USER);
      showSaveIndicator();
      document.getElementById("cs_customName").value = "";
      document.getElementById("cs_unit").value = "";
      if (materialSelect) materialSelect.value = "";
      customWrap.classList.remove("hidden");
    });

    function renderList() {
      const el = document.getElementById("cs_list");
      if (!el) return;
      const dKey = dateInput.value || dateKey();
      if (!items.length) { el.innerHTML = `<div class="empty-state">${t("noConsumables")}</div>`; return; }
      el.innerHTML = `<div class="table-scroll-hint">↔ <span data-i18n="swipeHint"></span></div><div class="table-scroll"><table class="simple-table">
        <thead><tr><th data-i18n="materialName"></th><th data-i18n="unitLabel"></th><th data-i18n="quantity"></th>${canEdit() ? "<th></th>" : ""}</tr></thead>
        <tbody>
          ${items.map((it) => {
            const qty = (it.dailyLog || {})[dKey];
            return `<tr data-id="${it.id}">
              <td>${escapeHtml(it.name)}</td>
              <td>${escapeHtml(it.unit || "—")}</td>
              <td><input type="number" min="0" class="cs-qty" value="${qty ?? ""}" ${canEdit() ? "" : "disabled"} style="width:90px;" /></td>
              ${canEdit() ? `<td><button type="button" class="btn btn-ghost btn-sm cs-remove">✕</button></td>` : ""}
            </tr>`;
          }).join("")}
        </tbody>
      </table></div>`;
      applyI18n(el);
      el.querySelectorAll("tr[data-id]").forEach((row) => {
        const id = row.dataset.id;
        const item = items.find((x) => x.id === id);
        const qtyInput = row.querySelector(".cs-qty");
        qtyInput.addEventListener("change", async () => {
          const val = Number(qtyInput.value) || 0;
          showSaveIndicator(true);
          await updateConsumableDay(currentProject.id, id, dKey, val, CURRENT_USER, item.name);
          showSaveIndicator();
        });
        const rmBtn = row.querySelector(".cs-remove");
        if (rmBtn) rmBtn.addEventListener("click", async () => {
          if (await showConfirmModal(t("deleteConsumableConfirm"))) {
            showSaveIndicator(true);
            await deleteConsumableItem(currentProject.id, id, CURRENT_USER, item.name);
            showSaveIndicator();
          }
        });
      });
    }

    function loadProject(pid) {
      cleanupProjectWatchers();
      (async () => {
        currentProject = await getProject(pid);
        const unsub = watchConsumables(pid, (data) => { items = data; renderList(); });
        currentProjectUnsubs.push(unsub);
      })();
    }

    document.getElementById("cs_exportPdf").addEventListener("click", async (e) => {
      const btn = e.target;
      const orig = btn.textContent;
      btn.disabled = true; btn.textContent = "…";
      try {
        const html = buildConsumablesReportHTML({ project: currentProject, items, currentUser: CURRENT_USER, lang: getLang() });
        const holder = document.createElement("div");
        holder.style.position = "fixed"; holder.style.top = "0"; holder.style.left = "-99999px";
        holder.innerHTML = html;
        document.body.appendChild(holder);
        const name = slugify(currentProject?.name);
        await exportReportToPdf("consumablesPrintArea", `${name}_vattutieuhao_${dateKey()}.pdf`);
        document.body.removeChild(holder);
      } finally {
        btn.disabled = false; btn.textContent = orig;
      }
    });

    if (projectsCache.length) loadProject(projSelect.value);
  }

  render();
}

// ============================================================
// KHỐI LƯỢNG ĐỘI KHOAN (Drill Team Payment) VIEW
// ============================================================
function formatMoney(val, currency) {
  const n = Number(val) || 0;
  if (currency === "USD") return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toLocaleString("vi-VN") + " ₫";
}
function dtpBoreholePct(b) {
  const total = sumDailyLog(b.dailyLog);
  const contract = Number(b.contractVolume) || 0;
  return contract > 0 ? (total / contract) * 100 : 0;
}
function dtpDateRangeArray(startStr, endStr) {
  if (!startStr || !endStr) return [];
  let cur = new Date(startStr + "T00:00:00");
  const end = new Date(endStr + "T00:00:00");
  if (isNaN(cur) || isNaN(end) || cur > end) return [];
  const out = [];
  let guard = 0;
  while (cur <= end && guard < 400) {
    out.push(dateKey(cur));
    cur = new Date(cur.getTime() + 86400000);
    guard++;
  }
  return out;
}
function dtpFormatTotals(totals) {
  const entries = Object.entries(totals).filter(([, v]) => Math.abs(v) > 1e-9 || Object.keys(totals).length === 1);
  if (!entries.length) return [formatMoney(0, "VND")];
  return entries.map(([cur, v]) => formatMoney(v, cur));
}

function renderDrillTeamPaymentView() {
  let currentProject = null;
  let currentPaymentId = null; // id phiếu "đang mở" hiện tại (null = chưa lưu lần nào)
  let boreholes = [];
  let selectedTeam = "";
  let method = "contract"; // "contract" | "daily"

  let soilRate = 0, soilCurrency = "VND", rockRate = 0, rockCurrency = "VND";

  let startDate = "", endDate = "";
  let workerRate = 0, workerCurrency = "VND", laborRate = 0, laborCurrency = "VND";
  let workerCount = 1, laborCount = 1;
  let dailyOverrides = {};

  let allowanceAmount = 0, allowanceCurrency = "VND";
  let advances = [];
  let drillTeamRep = "";

  function teamsList() {
    const set = new Set();
    boreholes.forEach((b) => { if (b.team) set.add(b.team); });
    return [...set].sort();
  }
  function matchedBoreholes() {
    if (!selectedTeam) return [];
    return boreholes.filter((b) => b.team === selectedTeam && dtpBoreholePct(b) >= 100);
  }
  function dayList() {
    return dtpDateRangeArray(startDate, endDate).map((dKey) => {
      const o = dailyOverrides[dKey] || {};
      return {
        dKey,
        workerCount: o.workerCount ?? workerCount,
        laborCount: o.laborCount ?? laborCount,
        workerRate: o.workerRate ?? workerRate,
        laborRate: o.laborRate ?? laborRate,
      };
    });
  }
  function computeTotals() {
    const totals = {};
    const add = (cur, amt) => { if (!cur) return; totals[cur] = (totals[cur] || 0) + amt; };
    if (method === "contract") {
      const mb = matchedBoreholes();
      const totalSoil = mb.reduce((s, b) => s + (Number(b.soilM) || 0), 0);
      const totalRock = mb.reduce((s, b) => s + (Number(b.rockM) || 0), 0);
      add(soilCurrency, totalSoil * soilRate);
      add(rockCurrency, totalRock * rockRate);
    } else {
      dayList().forEach((d) => {
        add(workerCurrency, d.workerCount * d.workerRate);
        add(laborCurrency, d.laborCount * d.laborRate);
      });
    }
    add(allowanceCurrency, allowanceAmount);
    advances.forEach((a) => add(a.currency, -(Number(a.amount) || 0)));
    return totals;
  }

  // ---------- Dựng khung giao diện tĩnh MỘT LẦN DUY NHẤT ----------
  // (Trước đây toàn bộ khung + select dự án bị dựng lại mỗi khi Firestore báo
  // có dữ liệu mới, và trong lúc dựng lại lại tự gọi loadProject() lần nữa —
  // tạo thành vòng lặp vô hạn gây giật/lag. Giờ chỉ các phần DỮ LIỆU ĐỘNG mới
  // được vẽ lại khi có thay đổi; khung + các sự kiện chỉ gắn đúng 1 lần.)
  mainView.innerHTML = topbarHtml("drillPayTitle") + `
    <div class="report-toolbar">
      <div class="field"><label data-i18n="selectProject"></label><select id="dp_project"></select></div>
      <div class="field"><label data-i18n="drillTeamLabel"></label><select id="dp_team"><option value="">—</option></select></div>
    </div>

    <div class="card">
      <h3 data-i18n="completedBoreholesTitle"></h3>
      <div class="table-scroll-hint">↔ <span data-i18n="swipeHint"></span></div>
      <div class="table-scroll"><table class="simple-table dtp-table" id="dp_boreholesTable"></table></div>
    </div>

    <div class="card">
      <h3 data-i18n="paymentMethod"></h3>
      <div class="dtp-method-toggle">
        <button type="button" class="btn btn-primary" id="dp_methodContract" data-i18n="methodContract"></button>
        <button type="button" class="btn btn-ghost" id="dp_methodDaily" data-i18n="methodDaily"></button>
      </div>
      <div id="dp_methodBody"></div>
    </div>

    <div class="card">
      <h3 data-i18n="allowanceTitle"></h3>
      <div class="field-row">
        <div class="field"><label data-i18n="allowanceAmount"></label><input type="number" min="0" id="dp_allowance" value="" /></div>
        <div class="field" style="max-width:120px;"><label data-i18n="currency"></label>
          <select id="dp_allowanceCurrency"><option value="VND">VND</option><option value="USD">USD</option></select>
        </div>
      </div>
    </div>

    <div class="card">
      <h3 data-i18n="advancesTitle"></h3>
      <div id="dp_advancesTable"></div>
      <button type="button" class="btn btn-ghost btn-sm" id="dp_addAdvance" data-i18n="addAdvance"></button>
    </div>

    <div class="card">
      <h3 data-i18n="drillTeamRepTitle"></h3>
      <div class="field"><label data-i18n="drillTeamRepLabel2"></label><input id="dp_rep" value="" data-i18n-placeholder="drillTeamRepPlaceholder" /></div>
    </div>

    <div class="card" id="dp_summaryCard">
      <h3 data-i18n="grandTotalTitle"></h3>
      <div id="dp_summary" class="dtp-summary"></div>
      <div id="dp_status" class="dtp-status"></div>
      <div class="equip-actions">
        <button class="btn btn-ghost" id="dp_save" data-i18n="saveProgress"></button>
        <button class="btn btn-primary" id="dp_exportPdf" data-i18n="saveAndExportPdf"></button>
      </div>
    </div>
  `;
  bindTopbar();

  const projSelect = document.getElementById("dp_project");
  const teamSelect = document.getElementById("dp_team");
  const methodContractBtn = document.getElementById("dp_methodContract");
  const methodDailyBtn = document.getElementById("dp_methodDaily");
  const repInput = document.getElementById("dp_rep");

  projSelect.innerHTML = projectsCache.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  projSelect.addEventListener("change", () => loadProject(projSelect.value));

  teamSelect.addEventListener("change", async () => {
    selectedTeam = teamSelect.value;
    currentPaymentId = null;
    if (!selectedTeam) { applyLoadedPayment(null); renderDynamic(); return; }
    showSaveIndicator(true);
    const existing = await getOpenDrillTeamPayment(currentProject.id, selectedTeam);
    showSaveIndicator();
    applyLoadedPayment(existing);
    renderDynamic();
  });

  function updateMethodButtons() {
    methodContractBtn.className = `btn ${method === "contract" ? "btn-primary" : "btn-ghost"}`;
    methodDailyBtn.className = `btn ${method === "daily" ? "btn-primary" : "btn-ghost"}`;
  }
  methodContractBtn.addEventListener("click", () => { method = "contract"; updateMethodButtons(); renderMethodBody(); renderSummary(); });
  methodDailyBtn.addEventListener("click", () => { method = "daily"; updateMethodButtons(); renderMethodBody(); renderSummary(); });

  document.getElementById("dp_allowance").addEventListener("change", (e) => { allowanceAmount = Number(e.target.value) || 0; renderSummary(); });
  document.getElementById("dp_allowanceCurrency").addEventListener("change", (e) => { allowanceCurrency = e.target.value; renderSummary(); });

  document.getElementById("dp_addAdvance").addEventListener("click", () => {
    advances.push({ date: dateKey(), amount: 0, currency: "VND", note: "" });
    renderAdvancesTable();
    renderSummary();
  });

  repInput.addEventListener("change", (e) => { drillTeamRep = e.target.value.trim(); });

  function buildPayload() {
    return {
      method, team: selectedTeam, drillTeamRep,
      boreholeIds: matchedBoreholes().map((b) => b.id),
      soilRate, soilCurrency, rockRate, rockCurrency,
      startDate, endDate, workerRate, workerCurrency, laborRate, laborCurrency, workerCount, laborCount, dailyOverrides,
      allowanceAmount, allowanceCurrency,
      advances,
    };
  }
  function updateStatusLine() {
    const el = document.getElementById("dp_status");
    if (!el) return;
    el.textContent = currentPaymentId ? t("progressSavedNote") : t("notSavedYetNote");
  }
  function applyLoadedPayment(payment) {
    currentPaymentId = payment ? payment.id : null;
    method = payment?.method || "contract";
    soilRate = payment?.soilRate || 0; soilCurrency = payment?.soilCurrency || "VND";
    rockRate = payment?.rockRate || 0; rockCurrency = payment?.rockCurrency || "VND";
    startDate = payment?.startDate || ""; endDate = payment?.endDate || "";
    workerRate = payment?.workerRate || 0; workerCurrency = payment?.workerCurrency || "VND";
    laborRate = payment?.laborRate || 0; laborCurrency = payment?.laborCurrency || "VND";
    workerCount = payment?.workerCount ?? 1; laborCount = payment?.laborCount ?? 1;
    dailyOverrides = payment?.dailyOverrides ? { ...payment.dailyOverrides } : {};
    allowanceAmount = payment?.allowanceAmount || 0; allowanceCurrency = payment?.allowanceCurrency || "VND";
    advances = payment?.advances ? payment.advances.map((a) => ({ ...a })) : [];
    drillTeamRep = payment?.drillTeamRep || selectedTeam;

    updateMethodButtons();
    renderMethodBody();
    document.getElementById("dp_allowance").value = allowanceAmount || "";
    document.getElementById("dp_allowanceCurrency").value = allowanceCurrency;
    renderAdvancesTable();
    repInput.value = drillTeamRep;
    updateStatusLine();
  }

  document.getElementById("dp_save").addEventListener("click", async () => {
    if (!currentProject || !selectedTeam) { alert(t("selectTeamFirst")); return; }
    const btn = document.getElementById("dp_save");
    btn.disabled = true;
    try {
      showSaveIndicator(true);
      currentPaymentId = await saveDrillTeamPaymentProgress(currentProject.id, currentPaymentId, buildPayload(), CURRENT_USER);
      showSaveIndicator();
      updateStatusLine();
    } catch (e) {
      showSaveIndicator();
      alert(t("equipSaveError") + "\n" + (e?.message || e));
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("dp_exportPdf").addEventListener("click", exportDrillTeamPaymentPdf);

  function fillTeamSelect() {
    const teams = teamsList();
    const prevVal = teamSelect.value;
    teamSelect.innerHTML = `<option value="">—</option>` + teams.map((tm) => `<option value="${escapeAttr(tm)}">${escapeHtml(tm)}</option>`).join("");
    if (teams.includes(prevVal)) teamSelect.value = prevVal;
  }

  function renderBoreholesTable() {
    const el = document.getElementById("dp_boreholesTable");
    const mb = matchedBoreholes();
    const totalSoilM = mb.reduce((s, b) => s + (Number(b.soilM) || 0), 0);
    const totalRockM = mb.reduce((s, b) => s + (Number(b.rockM) || 0), 0);
    el.innerHTML = `
      <thead><tr><th data-i18n="boreholeName"></th><th data-i18n="soilM"></th><th data-i18n="rockM"></th><th data-i18n="totalM"></th></tr></thead>
      <tbody>
        ${mb.length ? mb.map((b) => `<tr><td>${escapeHtml(b.name || "—")}</td><td class="num">${b.soilM || 0}</td><td class="num">${b.rockM || 0}</td><td class="num">${(Number(b.soilM) || 0) + (Number(b.rockM) || 0)}</td></tr>`).join("") : `<tr><td colspan="4" style="text-align:center;color:var(--text-dim);">${t("noCompletedBoreholes")}</td></tr>`}
      </tbody>
      ${mb.length ? `<tfoot><tr class="dtp-total-row"><td>${t("total")}</td><td class="num">${totalSoilM}</td><td class="num">${totalRockM}</td><td class="num">${totalSoilM + totalRockM}</td></tr></tfoot>` : ""}
    `;
    applyI18n(el);
  }

  function renderMethodBody() {
    const el = document.getElementById("dp_methodBody");
    if (method === "contract") {
      el.innerHTML = `
        <div class="field-row">
          <div class="field"><label data-i18n="soilRate"></label><input type="number" min="0" id="dp_soilRate" value="${soilRate || ""}" /></div>
          <div class="field" style="max-width:120px;"><label data-i18n="currency"></label><select id="dp_soilCurrency"><option value="VND" ${soilCurrency === "VND" ? "selected" : ""}>VND</option><option value="USD" ${soilCurrency === "USD" ? "selected" : ""}>USD</option></select></div>
        </div>
        <div class="field-row">
          <div class="field"><label data-i18n="rockRate"></label><input type="number" min="0" id="dp_rockRate" value="${rockRate || ""}" /></div>
          <div class="field" style="max-width:120px;"><label data-i18n="currency"></label><select id="dp_rockCurrency"><option value="VND" ${rockCurrency === "VND" ? "selected" : ""}>VND</option><option value="USD" ${rockCurrency === "USD" ? "selected" : ""}>USD</option></select></div>
        </div>
      `;
      applyI18n(el);
      document.getElementById("dp_soilRate").addEventListener("change", (e) => { soilRate = Number(e.target.value) || 0; renderSummary(); });
      document.getElementById("dp_soilCurrency").addEventListener("change", (e) => { soilCurrency = e.target.value; renderSummary(); });
      document.getElementById("dp_rockRate").addEventListener("change", (e) => { rockRate = Number(e.target.value) || 0; renderSummary(); });
      document.getElementById("dp_rockCurrency").addEventListener("change", (e) => { rockCurrency = e.target.value; renderSummary(); });
    } else {
      el.innerHTML = `
        <div class="field-row">
          <div class="field"><label data-i18n="startDate"></label><input type="date" id="dp_startDate" value="${startDate}" /></div>
          <div class="field"><label data-i18n="endDate"></label><input type="date" id="dp_endDate" value="${endDate}" /></div>
        </div>
        <div class="field-row">
          <div class="field"><label data-i18n="workerRate"></label><input type="number" min="0" id="dp_workerRate" value="${workerRate || ""}" /></div>
          <div class="field" style="max-width:120px;"><label data-i18n="currency"></label><select id="dp_workerCurrency"><option value="VND" ${workerCurrency === "VND" ? "selected" : ""}>VND</option><option value="USD" ${workerCurrency === "USD" ? "selected" : ""}>USD</option></select></div>
          <div class="field" style="max-width:110px;"><label data-i18n="workerCount"></label><input type="number" min="0" step="1" id="dp_workerCount" value="${workerCount}" /></div>
        </div>
        <div class="field-row">
          <div class="field"><label data-i18n="laborRate"></label><input type="number" min="0" id="dp_laborRate" value="${laborRate || ""}" /></div>
          <div class="field" style="max-width:120px;"><label data-i18n="currency"></label><select id="dp_laborCurrency"><option value="VND" ${laborCurrency === "VND" ? "selected" : ""}>VND</option><option value="USD" ${laborCurrency === "USD" ? "selected" : ""}>USD</option></select></div>
          <div class="field" style="max-width:110px;"><label data-i18n="laborCount"></label><input type="number" min="0" step="1" id="dp_laborCount" value="${laborCount}" /></div>
        </div>
        <div class="table-scroll-hint">↔ <span data-i18n="swipeHint"></span></div>
        <div class="table-scroll"><table class="simple-table dtp-table" id="dp_dayTable"></table></div>
      `;
      applyI18n(el);
      const rebuildDays = () => { renderDayTable(); renderSummary(); };
      document.getElementById("dp_startDate").addEventListener("change", (e) => { startDate = e.target.value; rebuildDays(); });
      document.getElementById("dp_endDate").addEventListener("change", (e) => { endDate = e.target.value; rebuildDays(); });
      document.getElementById("dp_workerRate").addEventListener("change", (e) => { workerRate = Number(e.target.value) || 0; rebuildDays(); });
      document.getElementById("dp_workerCurrency").addEventListener("change", (e) => { workerCurrency = e.target.value; renderSummary(); });
      document.getElementById("dp_workerCount").addEventListener("change", (e) => { workerCount = Math.max(0, Math.round(Number(e.target.value) || 0)); rebuildDays(); });
      document.getElementById("dp_laborRate").addEventListener("change", (e) => { laborRate = Number(e.target.value) || 0; rebuildDays(); });
      document.getElementById("dp_laborCurrency").addEventListener("change", (e) => { laborCurrency = e.target.value; renderSummary(); });
      document.getElementById("dp_laborCount").addEventListener("change", (e) => { laborCount = Math.max(0, Math.round(Number(e.target.value) || 0)); rebuildDays(); });
      renderDayTable();
    }
  }

  function renderDayTable() {
    const el = document.getElementById("dp_dayTable");
    if (!el) return;
    const days = dayList();
    if (!days.length) {
      el.innerHTML = `<tbody><tr><td style="text-align:center;color:var(--text-dim);padding:14px;">${t("selectDateRangeFirst")}</td></tr></tbody>`;
      return;
    }
    el.innerHTML = `
      <thead><tr>
        <th data-i18n="dateCol"></th><th data-i18n="workerCount"></th><th data-i18n="workerRate"></th>
        <th data-i18n="laborCount"></th><th data-i18n="laborRate"></th><th data-i18n="dayTotal"></th>
      </tr></thead>
      <tbody>
        ${days.map((d) => {
          const dayTotal = d.workerCount * d.workerRate + d.laborCount * d.laborRate;
          return `<tr data-day="${d.dKey}">
            <td>${d.dKey.split("-").reverse().join("/")}</td>
            <td><input type="number" min="0" step="1" class="dp-day-workerCount" value="${d.workerCount}" style="width:60px;" /></td>
            <td><input type="number" min="0" class="dp-day-workerRate" value="${d.workerRate}" style="width:90px;" /></td>
            <td><input type="number" min="0" step="1" class="dp-day-laborCount" value="${d.laborCount}" style="width:60px;" /></td>
            <td><input type="number" min="0" class="dp-day-laborRate" value="${d.laborRate}" style="width:90px;" /></td>
            <td class="num dp-day-total">${dayTotal.toLocaleString(getLang() === "vi" ? "vi-VN" : "en-US")}</td>
          </tr>`;
        }).join("")}
      </tbody>
      <tfoot><tr class="dtp-total-row"><td colspan="5">${t("total")} (${days.length} ${t("days")})</td><td class="num" id="dp_daysGrandTotal"></td></tr></tfoot>
    `;
    applyI18n(el);
    function updateOverride(dKey, key, val) {
      dailyOverrides[dKey] = { ...(dailyOverrides[dKey] || {}), [key]: val };
    }
    el.querySelectorAll("tr[data-day]").forEach((row) => {
      const dKey = row.dataset.day;
      row.querySelector(".dp-day-workerCount").addEventListener("change", (e) => { updateOverride(dKey, "workerCount", Math.max(0, Math.round(Number(e.target.value) || 0))); refreshDayRowAndTotal(row, dKey); });
      row.querySelector(".dp-day-workerRate").addEventListener("change", (e) => { updateOverride(dKey, "workerRate", Number(e.target.value) || 0); refreshDayRowAndTotal(row, dKey); });
      row.querySelector(".dp-day-laborCount").addEventListener("change", (e) => { updateOverride(dKey, "laborCount", Math.max(0, Math.round(Number(e.target.value) || 0))); refreshDayRowAndTotal(row, dKey); });
      row.querySelector(".dp-day-laborRate").addEventListener("change", (e) => { updateOverride(dKey, "laborRate", Number(e.target.value) || 0); refreshDayRowAndTotal(row, dKey); });
    });
    updateDaysGrandTotalFooter();
  }
  function refreshDayRowAndTotal(row, dKey) {
    const d = dayList().find((x) => x.dKey === dKey);
    const dayTotal = d.workerCount * d.workerRate + d.laborCount * d.laborRate;
    row.querySelector(".dp-day-total").textContent = dayTotal.toLocaleString(getLang() === "vi" ? "vi-VN" : "en-US");
    updateDaysGrandTotalFooter();
    renderSummary();
  }
  function updateDaysGrandTotalFooter() {
    const footEl = document.getElementById("dp_daysGrandTotal");
    if (!footEl) return;
    if (workerCurrency === laborCurrency) {
      const sum = dayList().reduce((s, d) => s + d.workerCount * d.workerRate + d.laborCount * d.laborRate, 0);
      footEl.textContent = formatMoney(sum, workerCurrency);
    } else {
      footEl.textContent = "—";
    }
  }

  function renderAdvancesTable() {
    const el = document.getElementById("dp_advancesTable");
    if (!advances.length) { el.innerHTML = `<div class="empty-state">${t("noAdvances")}</div>`; return; }
    el.innerHTML = `<div class="table-scroll"><table class="simple-table">
      <thead><tr><th data-i18n="advanceDate"></th><th data-i18n="advanceAmount"></th><th data-i18n="currency"></th><th data-i18n="noteCol"></th><th></th></tr></thead>
      <tbody>
        ${advances.map((a, i) => `<tr data-idx="${i}">
          <td><input type="date" class="dp-adv-date" value="${a.date}" /></td>
          <td><input type="number" min="0" class="dp-adv-amount" value="${a.amount || ""}" style="width:100px;" /></td>
          <td><select class="dp-adv-currency"><option value="VND" ${a.currency === "VND" ? "selected" : ""}>VND</option><option value="USD" ${a.currency === "USD" ? "selected" : ""}>USD</option></select></td>
          <td><input type="text" class="dp-adv-note" value="${escapeAttr(a.note)}" /></td>
          <td><button type="button" class="btn btn-ghost btn-sm dp-adv-remove">✕</button></td>
        </tr>`).join("")}
      </tbody>
    </table></div>`;
    applyI18n(el);
    el.querySelectorAll("tr[data-idx]").forEach((row) => {
      const idx = +row.dataset.idx;
      row.querySelector(".dp-adv-date").addEventListener("change", (e) => { advances[idx].date = e.target.value; });
      row.querySelector(".dp-adv-amount").addEventListener("change", (e) => { advances[idx].amount = Number(e.target.value) || 0; renderSummary(); });
      row.querySelector(".dp-adv-currency").addEventListener("change", (e) => { advances[idx].currency = e.target.value; renderSummary(); });
      row.querySelector(".dp-adv-note").addEventListener("change", (e) => { advances[idx].note = e.target.value; });
      row.querySelector(".dp-adv-remove").addEventListener("click", () => { advances.splice(idx, 1); renderAdvancesTable(); renderSummary(); });
    });
  }

  function renderSummary() {
    const el = document.getElementById("dp_summary");
    if (!el) return;
    const totals = computeTotals();
    el.innerHTML = dtpFormatTotals(totals).map((line) => `<div class="dtp-grand-total">${line}</div>`).join("");
  }

  // Chỉ cập nhật PHẦN DỮ LIỆU ĐỘNG (bảng hố khoan + tổng tiền) khi Firestore
  // báo có thay đổi — KHÔNG dựng lại khung/select, KHÔNG gọi lại loadProject.
  function renderDynamic() {
    renderBoreholesTable();
    renderSummary();
  }

  async function loadProject(pid) {
    cleanupProjectWatchers();
    currentProject = await getProject(pid);
    selectedTeam = "";
    teamSelect.value = "";
    currentPaymentId = null;
    applyLoadedPayment(null);
    const unsub = watchBoreholes(pid, (data) => {
      boreholes = data;
      fillTeamSelect();
      renderDynamic();
    });
    currentProjectUnsubs.push(unsub);
  }

  async function exportDrillTeamPaymentPdf() {
    const btn = document.getElementById("dp_exportPdf");
    const orig = btn.textContent;
    if (!currentProject || !selectedTeam) { alert(t("selectTeamFirst")); return; }
    btn.disabled = true; btn.textContent = "…";
    try {
      const totals = computeTotals();
      showSaveIndicator(true);
      currentPaymentId = await finalizeDrillTeamPayment(currentProject.id, currentPaymentId, buildPayload(), CURRENT_USER);
      showSaveIndicator();
      updateStatusLine();

      const html = buildDrillTeamPaymentPdfHTML({
        project: currentProject, method, team: selectedTeam, drillTeamRep,
        boreholes: matchedBoreholes(), days: method === "daily" ? dayList() : [],
        soilRate, soilCurrency, rockRate, rockCurrency,
        workerCurrency, laborCurrency, startDate, endDate,
        allowanceAmount, allowanceCurrency, advances, totals,
        currentUser: CURRENT_USER, lang: getLang(),
      });
      const holder = document.createElement("div");
      holder.style.position = "fixed"; holder.style.top = "0"; holder.style.left = "-99999px";
      holder.innerHTML = html;
      document.body.appendChild(holder);
      const name = slugify(currentProject?.name);
      await exportReportToPdf("drillPayPrintArea", `${name}_khoiluong_doikhoan_${dateKey()}.pdf`);
      document.body.removeChild(holder);
    } catch (e) {
      showSaveIndicator();
      alert(t("equipSaveError") + "\n" + (e?.message || e));
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  }

  // Khởi tạo lần đầu
  renderMethodBody();
  renderAdvancesTable();
  renderSummary();
  if (projectsCache.length) loadProject(projSelect.value);
}

// ============================================================
// MATERIALS PRICE LIST VIEW (Bảng giá vật tư)
// ============================================================
function isUrlLike(str) { return /^https?:\/\//i.test(String(str || "").trim()); }
// Dữ liệu cũ lưu chung "Tên - link" trong 1 ô "Nơi mua"; tách ra để điền sẵn khi
// sửa 1 vật tư cũ, và để hiển thị đẹp (tên là chữ bấm được, dẫn tới link).
function splitLegacyBuyLocation(str) {
  const s = String(str || "").trim();
  if (!s) return { name: "", url: "" };
  const m = s.match(/(https?:\/\/\S+)/i);
  if (!m) return { name: s, url: "" };
  const url = m[1];
  const name = s.replace(url, "").replace(/[-–—:|]+$/, "").replace(/^[-–—:|]+/, "").trim();
  return { name, url };
}
function buyLocationDisplay(m) {
  const name = (m.buyLocationName || "").trim();
  const url = (m.buyLocationUrl || "").trim();
  if (name || url) return { text: name || url, url: url || null };
  const legacy = splitLegacyBuyLocation(m.buyLocation);
  if (!legacy.name && !legacy.url) return null;
  return { text: legacy.name || legacy.url, url: legacy.url || null };
}
function formatMaterialPrice(m) {
  const val = Number(m.price) || 0;
  if (m.currency === "USD") return "$" + val.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return val.toLocaleString("vi-VN") + " ₫";
}
function formatMaterialTime(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const lang = getLang() === "vi" ? "vi-VN" : "en-US";
  return d.toLocaleDateString(lang) + " " + d.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
}

function openMaterialModal(material) {
  const editing = !!material;
  const prefill = (material && !material.buyLocationName && !material.buyLocationUrl && material.buyLocation)
    ? splitLegacyBuyLocation(material.buyLocation)
    : { name: material?.buyLocationName || "", url: material?.buyLocationUrl || "" };
  const html = `
  <div class="modal-backdrop" id="mtModalBackdrop">
    <div class="modal">
      <div class="modal-head">
        <h3>${editing ? t("editMaterial") : t("addMaterial")}</h3>
        <button class="icon-btn" id="mtModalClose">✕</button>
      </div>
      <div class="field"><label data-i18n="materialName"></label><input id="mt_name" value="${escapeAttr(material?.name)}" /></div>
      <div class="field-row">
        <div class="field"><label data-i18n="price"></label><input type="number" step="any" min="0" id="mt_price" value="${material ? material.price : ""}" /></div>
        <div class="field" style="max-width:120px;"><label data-i18n="currency"></label>
          <select id="mt_currency">
            <option value="VND" ${material?.currency === "VND" || !material ? "selected" : ""}>VND</option>
            <option value="USD" ${material?.currency === "USD" ? "selected" : ""}>USD</option>
          </select>
        </div>
      </div>
      <div class="field"><label data-i18n="buyLocationName"></label><input id="mt_locationName" data-i18n-placeholder="buyLocationNamePlaceholder" value="${escapeAttr(prefill.name)}" /></div>
      <div class="field"><label data-i18n="buyLocationUrl"></label><input id="mt_locationUrl" placeholder="https://maps.app.goo.gl/..." value="${escapeAttr(prefill.url)}" /></div>
      <div class="field"><label data-i18n="imageUrl"></label><input id="mt_image" value="${escapeAttr(material?.imageUrl)}" placeholder="https://drive.google.com/..." /></div>
      <p class="error-msg" id="mtModalError"></p>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="mtModalCancel" data-i18n="cancel"></button>
        <button class="btn btn-primary" id="mtModalSave" data-i18n="saveMaterial"></button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML("beforeend", html);
  const backdrop = document.getElementById("mtModalBackdrop");
  applyI18n(backdrop);
  const close = () => backdrop.remove();
  document.getElementById("mtModalClose").addEventListener("click", close);
  document.getElementById("mtModalCancel").addEventListener("click", close);
  document.getElementById("mtModalSave").addEventListener("click", async () => {
    const name = document.getElementById("mt_name").value.trim();
    const price = Number(document.getElementById("mt_price").value);
    const currency = document.getElementById("mt_currency").value;
    const buyLocationName = document.getElementById("mt_locationName").value.trim();
    const buyLocationUrl = document.getElementById("mt_locationUrl").value.trim();
    const imageUrl = document.getElementById("mt_image").value.trim();
    const errEl = document.getElementById("mtModalError");
    if (!name) { errEl.textContent = t("materialNameRequired"); return; }
    if (!(price >= 0)) { errEl.textContent = t("priceRequired"); return; }
    const data = { name, price, currency, buyLocationName, buyLocationUrl, imageUrl };
    const saveBtn = document.getElementById("mtModalSave");
    saveBtn.disabled = true;
    try {
      showSaveIndicator(true);
      if (editing) await updateMaterial(material.id, data, CURRENT_USER);
      else await addMaterial(data, CURRENT_USER);
      showSaveIndicator();
      close();
    } catch (e) {
      showSaveIndicator();
      errEl.textContent = (e?.message || String(e));
      saveBtn.disabled = false;
    }
  });
}

function renderMaterialsView() {
  let materials = [];
  let searchTerm = "";

  function matchesSearch(m) {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.trim().toLowerCase();
    return (m.name || "").toLowerCase().includes(q) || (m.buyLocation || "").toLowerCase().includes(q);
  }

  function render() {
    mainView.innerHTML = topbarHtml("materialsTitle") + `
      <div class="materials-search-wrap">
        <input type="text" id="mt_search" class="materials-search" data-i18n-placeholder="searchMaterialsPlaceholder" value="${escapeAttr(searchTerm)}" />
      </div>
      <div class="report-toolbar materials-toolbar">
        ${canEdit() ? `<button class="btn btn-primary" id="mt_add" data-i18n="addMaterial"></button>` : ""}
        <button class="btn btn-ghost" id="mt_exportPdf" data-i18n="exportPdf"></button>
        <button class="btn btn-ghost" id="mt_exportExcel" data-i18n="exportExcel"></button>
      </div>
      <div id="mt_list"></div>
    `;
    bindTopbar();

    const searchInput = document.getElementById("mt_search");
    searchInput.addEventListener("input", () => { searchTerm = searchInput.value; renderList(); });

    const addBtn = document.getElementById("mt_add");
    if (addBtn) addBtn.addEventListener("click", () => openMaterialModal(null));

    document.getElementById("mt_exportPdf").addEventListener("click", async (e) => {
      const btn = e.target;
      const orig = btn.textContent;
      btn.disabled = true; btn.textContent = "…";
      try {
        const filtered = materials.filter(matchesSearch);
        const html = buildMaterialsPdfHTML({ materials: filtered, currentUser: CURRENT_USER, lang: getLang() });
        const holder = document.createElement("div");
        holder.style.position = "fixed"; holder.style.top = "0"; holder.style.left = "-99999px";
        holder.innerHTML = html;
        document.body.appendChild(holder);
        await exportReportToPdf("materialsPrintArea", `bang_gia_vat_tu_${dateKey()}.pdf`);
        document.body.removeChild(holder);
      } finally {
        btn.disabled = false; btn.textContent = orig;
      }
    });

    document.getElementById("mt_exportExcel").addEventListener("click", () => {
      const filtered = materials.filter(matchesSearch);
      const rows = filtered.map((m, i) => {
        const loc = buyLocationDisplay(m);
        return {
          [t("no")]: i + 1,
          [t("materialName")]: m.name || "",
          [t("price")]: m.price ?? "",
          [t("currency")]: m.currency || "",
          [t("buyLocationName")]: loc?.text || "",
          [t("buyLocationUrl")]: loc?.url || "",
          [t("imageUrl")]: m.imageUrl || "",
          [t("lastUpdated")]: formatMaterialTime(m.updatedAt),
        };
      });
      const ws = window.XLSX.utils.json_to_sheet(rows);
      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, "Materials");
      window.XLSX.writeFile(wb, `bang_gia_vat_tu_${dateKey()}.xlsx`);
    });

    function renderList() {
      const listEl = document.getElementById("mt_list");
      const filtered = materials.filter(matchesSearch);
      if (!materials.length) { listEl.innerHTML = `<div class="empty-state">${t("noMaterials")}</div>`; return; }
      if (!filtered.length) { listEl.innerHTML = `<div class="empty-state">${t("noMaterialsFound")}</div>`; return; }
      listEl.innerHTML = filtered.map((m) => `
        <div class="card material-card" data-id="${m.id}">
          <div class="item-head">
            <h4>${escapeHtml(m.name || "—")}</h4>
            <div class="item-actions">
              ${canEdit() ? `<button class="btn btn-ghost btn-sm mt-edit" data-i18n="editMaterial"></button>` : ""}
              ${isAdmin() ? `<button class="btn btn-danger btn-sm mt-delete" data-i18n="delete"></button>` : ""}
            </div>
          </div>
          <div class="material-price">${escapeHtml(formatMaterialPrice(m))}</div>
          <div class="material-meta">
            ${(() => { const loc = buyLocationDisplay(m); return loc ? `<div class="material-location">📍 ${loc.url ? `<a href="${escapeAttr(loc.url)}" target="_blank" rel="noopener">${escapeHtml(loc.text)}</a>` : escapeHtml(loc.text)}</div>` : ""; })()}
            ${m.imageUrl ? `<a class="btn btn-ghost btn-sm" href="${escapeAttr(m.imageUrl)}" target="_blank" rel="noopener" data-i18n="viewImage"></a>` : ""}
          </div>
          <div class="material-updated">${t("lastUpdated")}: ${formatMaterialTime(m.updatedAt)}</div>
        </div>`).join("");
      applyI18n(listEl);
      listEl.querySelectorAll(".material-card").forEach((card) => {
        const id = card.dataset.id;
        const m = materials.find((x) => x.id === id);
        const editBtn = card.querySelector(".mt-edit");
        if (editBtn) editBtn.addEventListener("click", () => openMaterialModal(m));
        const delBtn = card.querySelector(".mt-delete");
        if (delBtn) delBtn.addEventListener("click", async () => {
          if (await showConfirmModal(t("deleteMaterialConfirm"))) {
            showSaveIndicator(true);
            await deleteMaterial(id, CURRENT_USER, m?.name);
            showSaveIndicator();
          }
        });
      });
    }

    const unsub = watchMaterials((data) => { materials = data; renderList(); });
    currentProjectUnsubs.push(unsub);
  }

  render();
}

// ============================================================
// ACTIVITY LOG VIEW
// ============================================================
function renderActivityView() {
  mainView.innerHTML = topbarHtml("activityLog") + `
    <div class="report-toolbar">
      <div class="field"><input type="search" id="al_search" placeholder="${t('searchActivity')}" data-i18n-placeholder="searchActivity" /></div>
      <div class="field"><select id="al_project"></select></div>
      <div class="field"><select id="al_user"></select></div>
    </div>
    <div class="card"><div class="table-wrap"><table id="al_table" class="table-divided"><thead><tr><th>${t("timeCol")}</th><th data-i18n="projectCol"></th><th data-i18n="user"></th><th data-i18n="activity"></th></tr></thead><tbody id="al_body"></tbody></table></div></div>`;
  bindTopbar();
  const sel = document.getElementById("al_project");
  const userSel = document.getElementById("al_user");
  const searchEl = document.getElementById("al_search");
  let currentActivities = [];

  function fill() {
    sel.innerHTML = `<option value="">${t("allProjects")}</option>` + projectsCache.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  }
  function renderRows() {
    const body = document.getElementById("al_body");
    if (!body) return;
    const filterUser = userSel.value;
    const q = searchEl.value.trim().toLowerCase();
    let filtered = filterUser ? currentActivities.filter((a) => (a.userName || "") === filterUser) : currentActivities;
    if (q) {
      filtered = filtered.filter((a) =>
        (a.userName || "").toLowerCase().includes(q) ||
        (a.itemLabel || "").toLowerCase().includes(q) ||
        (a._projectName || "").toLowerCase().includes(q) ||
        t("action_" + (a.action || "updated")).toLowerCase().includes(q)
      );
    }
    if (!filtered.length) { body.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-dim);">—</td></tr>`; return; }
    body.innerHTML = filtered.map((a) => {
      const time = a.ts?.toDate ? a.ts.toDate().toLocaleString(getLang() === "vi" ? "vi-VN" : "en-US") : "—";
      return `<tr><td>${time}</td><td>${escapeHtml(a._projectName || "—")}</td><td>${escapeHtml(a.userName || "")}</td><td>${escapeHtml(a.userName || "")} ${t("action_" + (a.action || "updated"))}: ${escapeHtml(a.itemLabel || "")}</td></tr>`;
    }).join("");
  }
  function fillUserFilter() {
    const names = [...new Set(currentActivities.map((a) => a.userName).filter(Boolean))].sort();
    const prev = userSel.value;
    userSel.innerHTML = `<option value="">${t("allUsers")}</option>` + names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
    if (names.includes(prev)) userSel.value = prev;
  }
  function projectNameOf(pid) { return projectsCache.find((p) => p.id === pid)?.name || ""; }

  // Chọn "Tất cả dự án" (mặc định): gộp hoạt động từ MỌI dự án lại thành 1 danh
  // sách chung, sắp xếp theo thời gian mới nhất — thay vì bắt buộc chọn 1 dự án
  // mới thấy được gì.
  function loadAll() {
    const perProjectData = {};
    let globalData = [];
    const mergeAndRender = () => {
      currentActivities = Object.entries(perProjectData).flatMap(([pid, acts]) =>
        acts.map((a) => ({ ...a, _projectId: pid, _projectName: projectNameOf(pid) }))
      ).concat(globalData.map((a) => ({ ...a, _projectId: null, _projectName: t("systemWide") })));
      currentActivities.sort((a, b) => {
        const ta = a.ts?.toMillis ? a.ts.toMillis() : 0;
        const tb = b.ts?.toMillis ? b.ts.toMillis() : 0;
        return tb - ta;
      });
      fillUserFilter();
      renderRows();
    };
    const gUnsub = watchGlobalActivity((activities) => { globalData = activities; mergeAndRender(); });
    currentProjectUnsubs.push(gUnsub);
    if (!projectsCache.length) { mergeAndRender(); return; }
    projectsCache.forEach((p) => {
      const unsub = watchActivity(p.id, (activities) => {
        perProjectData[p.id] = activities;
        mergeAndRender();
      });
      currentProjectUnsubs.push(unsub);
    });
  }
  function load(pid) {
    cleanupProjectWatchers();
    if (!pid) { loadAll(); return; }
    const unsub = watchActivity(pid, (activities) => {
      currentActivities = activities.map((a) => ({ ...a, _projectId: pid, _projectName: projectNameOf(pid) }));
      fillUserFilter();
      renderRows();
    });
    currentProjectUnsubs.push(unsub);
  }
  searchEl.addEventListener("input", renderRows);
  sel.addEventListener("change", () => load(sel.value));
  userSel.addEventListener("change", renderRows);
  if (projectsCache.length) { fill(); load(sel.value); }
  else {
    const unsub = watchProjects((projects) => { projectsCache = projects; fill(); load(sel.value); });
    currentProjectUnsubs.push(unsub);
  }
}

// ============================================================
// SETTINGS VIEW
// ============================================================
function renderSettingsView() {
  mainView.innerHTML = topbarHtml("settings") + `
    <div class="card">
      <h3 data-i18n="profile"></h3>
      <div class="field-row">
        <div class="field"><label data-i18n="fullName"></label><input value="${escapeAttr(CURRENT_USER.name)}" disabled /></div>
        <div class="field"><label data-i18n="email"></label><input value="${escapeAttr(CURRENT_USER.email)}" disabled /></div>
        <div class="field"><label data-i18n="role"></label><input value="${t(CURRENT_USER.role)}" disabled /></div>
      </div>
    </div>
    <div class="card">
      <h3 data-i18n="changePassword"></h3>
      <div class="field-row">
        <div class="field"><label data-i18n="currentPassword"></label><input type="password" id="pw_current" autocomplete="current-password" /></div>
        <div class="field"><label data-i18n="newPassword"></label><input type="password" id="pw_new" minlength="6" autocomplete="new-password" /></div>
        <div class="field"><label data-i18n="confirmNewPassword"></label><input type="password" id="pw_confirm" minlength="6" autocomplete="new-password" /></div>
      </div>
      <button class="btn btn-primary btn-sm" id="pw_save" data-i18n="changePasswordBtn"></button>
      <p class="error-msg" id="pw_msg"></p>
    </div>
    <div class="card">
      <h3 data-i18n="backupTitle"></h3>
      <div class="field-row">
        <div class="field">
          <label data-i18n="selectProject"></label>
          <select id="bk_project"></select>
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" id="bk_export" data-i18n="exportJson"></button>
      <p class="error-msg" id="bk_exportMsg"></p>
      ${canEdit() ? `
        <hr style="border:none; border-top:1px solid var(--border); margin:16px 0;" />
        <div class="field">
          <label data-i18n="importJson"></label>
          <input type="file" id="bk_importFile" accept="application/json" />
        </div>
        <button class="btn btn-primary btn-sm" id="bk_import" data-i18n="importJsonBtn"></button>
        <p class="error-msg" id="bk_importMsg"></p>
      ` : ""}
    </div>
    <div class="card">
      <h3 data-i18n="language"></h3>
      <div class="toggle-pill" id="settingsLangPill"><button data-lang="vi">Tiếng Việt</button><button data-lang="en">English</button></div>
    </div>
    <div class="card">
      <h3 data-i18n="darkMode"></h3>
      <div class="toggle-pill" id="settingsThemePill"><button data-theme="dark">🌙 <span data-i18n="darkMode"></span></button><button data-theme="light">☀️ <span data-i18n="lightMode"></span></button></div>
    </div>
    ${isAdmin() ? `<div class="card"><h3 data-i18n="users"></h3><div class="table-wrap"><table><thead><tr><th data-i18n="fullName"></th><th data-i18n="email"></th><th data-i18n="role"></th></tr></thead><tbody id="usersBody"></tbody></table></div></div>` : ""}
  `;
  bindTopbar();
  const bkProjectSel = document.getElementById("bk_project");
  bkProjectSel.innerHTML = projectsCache.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  if (!projectsCache.length) {
    const unsub = watchProjects((projects) => {
      projectsCache = projects;
      bkProjectSel.innerHTML = projects.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
    });
    currentProjectUnsubs.push(unsub);
  }
  document.getElementById("bk_export").addEventListener("click", async () => {
    const msg = document.getElementById("bk_exportMsg");
    msg.style.color = "";
    const pid = bkProjectSel.value;
    if (!pid) return;
    try {
      const data = await getProjectFullData(pid);
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slugify(data.project?.name)}_backup.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      msg.textContent = err.message;
    }
  });
  const importBtn = document.getElementById("bk_import");
  if (importBtn) {
    importBtn.addEventListener("click", async () => {
      const msg = document.getElementById("bk_importMsg");
      msg.style.color = "";
      msg.textContent = "";
      const fileInput = document.getElementById("bk_importFile");
      const file = fileInput.files[0];
      if (!file) { msg.textContent = t("selectFileFirst"); return; }
      importBtn.disabled = true;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.project || !data.project.name) throw new Error(t("invalidJsonFile"));
        const newId = await importProjectFullData(data, CURRENT_USER);
        msg.style.color = "var(--success)";
        msg.textContent = t("importSuccess");
        fileInput.value = "";
        navigateTo("project-detail", newId);
      } catch (err) {
        msg.textContent = err.message;
      } finally {
        importBtn.disabled = false;
      }
    });
  }
  const pwSaveBtn = document.getElementById("pw_save");
  const pwMsg = document.getElementById("pw_msg");
  pwSaveBtn.addEventListener("click", async () => {
    pwMsg.textContent = "";
    pwMsg.style.color = "";
    const current = document.getElementById("pw_current").value;
    const next = document.getElementById("pw_new").value;
    const confirm = document.getElementById("pw_confirm").value;
    if (next.length < 6) { pwMsg.textContent = t("passwordTooShort"); return; }
    if (next !== confirm) { pwMsg.textContent = t("passwordMismatch"); return; }
    pwSaveBtn.disabled = true;
    try {
      const credential = EmailAuthProvider.credential(auth.currentUser.email, current);
      await reauthenticateWithCredential(auth.currentUser, credential);
      await updatePassword(auth.currentUser, next);
      pwMsg.style.color = "var(--success)";
      pwMsg.textContent = t("passwordChanged");
      document.getElementById("pw_current").value = "";
      document.getElementById("pw_new").value = "";
      document.getElementById("pw_confirm").value = "";
    } catch (err) {
      const code = err.code || "";
      if (code.includes("wrong-password") || code.includes("invalid-credential")) pwMsg.textContent = t("currentPasswordWrong");
      else pwMsg.textContent = err.message;
    } finally {
      pwSaveBtn.disabled = false;
    }
  });
  document.querySelectorAll("#settingsLangPill button").forEach((b) => {
    b.classList.toggle("active", b.dataset.lang === getLang());
    b.addEventListener("click", () => { setLang(b.dataset.lang); navigateTo("settings"); });
  });
  document.querySelectorAll("#settingsThemePill button").forEach((b) => {
    b.classList.toggle("active", b.dataset.theme === getTheme());
    b.addEventListener("click", () => { applyTheme(b.dataset.theme); navigateTo("settings"); });
  });
  if (isAdmin()) {
    const unsub = watchUsers((users) => {
      const body = document.getElementById("usersBody");
      if (!body) return;
      body.innerHTML = users.map((u) => `
        <tr>
          <td>${escapeHtml(u.name || "—")}</td>
          <td>${escapeHtml(u.email || "—")}</td>
          <td>
            <select class="role-select" data-uid="${u.id}" ${u.id === CURRENT_USER.uid ? "disabled" : ""}>
              <option value="admin" ${u.role === "admin" ? "selected" : ""}>${t("admin")}</option>
              <option value="engineer" ${u.role === "engineer" ? "selected" : ""}>${t("engineer")}</option>
              <option value="viewer" ${u.role === "viewer" ? "selected" : ""}>${t("viewer")}</option>
            </select>
          </td>
        </tr>`).join("");
      body.querySelectorAll(".role-select").forEach((sel) => {
        sel.addEventListener("change", async () => {
          await setUserRole(sel.dataset.uid, sel.value);
          showSaveIndicator();
        });
      });
    });
    currentProjectUnsubs.push(unsub);
  }
}

// ============================================================
// CONFIRM MODAL
// ============================================================
// Thay cho window.confirm(): một số trình duyệt trong app (Zalo, Messenger...)
// xử lý confirm()/alert() không đúng chuẩn (có thể tự động xác nhận dù người
// dùng bấm Hủy), khiến các nút xóa/đặt lại thực thi ngay cả khi đã bấm Hủy.
// Dùng modal tự dựng để đảm bảo Hủy/Đồng ý luôn hoạt động chính xác.
function showConfirmModal(message) {
  return new Promise((resolve) => {
    const html = `
    <div class="modal-backdrop" id="confirmModalBackdrop">
      <div class="modal" style="max-width:420px;">
        <p style="margin:0 0 20px; font-size:14.5px; line-height:1.5;">${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="confirmModalCancel" data-i18n="cancel"></button>
          <button class="btn btn-danger" id="confirmModalOk" data-i18n="confirmBtn"></button>
        </div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML("beforeend", html);
    const backdrop = document.getElementById("confirmModalBackdrop");
    applyI18n(backdrop);
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      backdrop.remove();
      resolve(result);
    };
    document.getElementById("confirmModalCancel").addEventListener("click", () => finish(false));
    document.getElementById("confirmModalOk").addEventListener("click", () => finish(true));
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) finish(false); });
  });
}

// ============================================================
// SAVE INDICATOR
// ============================================================
let saveTimer = null;
function showSaveIndicator(saving = false) {
  const el = document.getElementById("saveIndicator");
  const txt = document.getElementById("saveIndicatorText");
  el.classList.remove("hidden");
  txt.textContent = saving ? t("saving") : `${t("saved")} ${new Date().toLocaleTimeString(getLang() === "vi" ? "vi-VN" : "en-US")}`;
  clearTimeout(saveTimer);
  if (!saving) saveTimer = setTimeout(() => el.classList.add("hidden"), 3000);
}

// ============================================================
// UTIL
// ============================================================
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }
