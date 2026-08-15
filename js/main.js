import {
  auth, onAuthStateChanged, signOut,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider,
} from "./firebase.js";
import {
  getUserDoc, watchUsers, setUserRole,
  watchProjects, getProject, createProject, updateProject, deleteProject, resizeImageToDataUrl, updateNextDayPlan,
  watchBoreholes, addBorehole, updateBorehole, deleteBorehole,
  watchSurveyItems, addSurveyItem, updateSurveyItem, deleteSurveyItem,
  watchActivity, dateKey, sumDailyLog,
} from "./store.js";
import { applyI18n, getLang, setLang, t } from "./i18n.js";
import { initTheme, toggleTheme, getTheme, applyTheme } from "./theme.js";
import { buildReportHTML, buildReportRows, buildSummaryText, exportReportToPdf } from "./report.js";

initTheme();
applyI18n();

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
  mainView.innerHTML = topbarHtml("overview") + `
    <div class="card" id="analysisCard">
      <h3>📊 <span data-i18n="analysisTitle"></span></h3>
      <div id="analysisBody"><div class="empty-state">…</div></div>
    </div>
    <div id="ovStats" class="grid-cards"></div>
    <div class="card"><h3 data-i18n="currentProjects"></h3><div id="ovProjects" class="grid-cards"></div></div>`;
  bindTopbar();
  unsubProjects = watchProjects((projects) => {
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
    if (!projects.length) {
      list.innerHTML = `<div class="empty-state">${t("noProjects")}</div>`;
    } else {
      list.innerHTML = projects.slice(0, 6).map(projectCardHtml).join("");
      bindProjectCards(list);
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
  return { project, itemsTotal, itemsDone, pctAvg };
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

  const attention = [...summaries].sort((a, b) => a.pctAvg - b.pctAvg).slice(0, 5);

  const byManager = {};
  summaries.forEach((s) => {
    const key = s.project.manager || s.project.siteEngineer || s.project.createdByName || "—";
    byManager[key] = (byManager[key] || 0) + 1;
  });

  body.innerHTML = `
    <div class="analysis-grid">
      ${statMini(totalProjects, t("totalProjects"))}
      ${statMini(avgProgress.toFixed(0) + "%", t("avgProgress"), "#f5a623")}
      ${statMini(completed, t("completedCount"), "var(--success)")}
      ${statMini(inProgress, t("inProgressCount"))}
      ${statMini(notStarted, t("notStartedCount"), "var(--danger)")}
      ${statMini(`${itemsDoneSum}/${itemsTotalSum}`, t("itemsSystemWide"))}
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
function statMini(value, label, color) {
  return `<div class="analysis-stat">
    <div class="val" style="${color ? `color:${color};` : ""}">${value}</div>
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
  mainView.innerHTML = topbarHtml("currentProjects", canCreateBtn) + `<div id="projList" class="grid-cards"></div>`;
  bindTopbar();
  const btn = document.getElementById("newProjectBtn");
  if (btn) btn.addEventListener("click", () => openProjectModal());
  unsubProjects = watchProjects((projects) => {
    projectsCache = projects;
    const list = document.getElementById("projList");
    if (!projects.length) {
      list.innerHTML = `<div class="empty-state">${t("noProjects")}</div>`;
      return;
    }
    list.innerHTML = projects.map(projectCardHtml).join("");
    bindProjectCards(list);
  });
}
function projectCardHtml(p) {
  const tags = [
    p.workTypes?.soil ? `<span class="tag">${t("soilInvestigation")}</span>` : "",
    p.workTypes?.survey ? `<span class="tag">${t("survey")}</span>` : "",
  ].join("");
  const pct = p._pct ?? 0;
  const thumb = p.siteImageUrl ? `style="background-image:url('${p.siteImageUrl}')"` : "";
  return `<div class="project-card" data-id="${p.id}">
    <div class="thumb" ${thumb}>${p.siteImageUrl ? "" : "📍"}</div>
    <div class="body">
      <h4>${escapeHtml(p.name || "—")}</h4>
      <div class="loc">${escapeHtml(p.location || "—")}</div>
      ${tags ? `<div class="tag-row">${tags}</div>` : ""}
    </div>
  </div>`;
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
    if (confirm(t("deleteConfirm"))) {
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
  content.innerHTML = `<div style="display:flex; justify-content:flex-end; margin-bottom:10px;">${addBtn}</div><div id="boreholeList"></div>`;
  applyI18n(content);
  const addBtnEl = document.getElementById("addBoreholeBtn");
  if (addBtnEl) addBtnEl.addEventListener("click", () => openBoreholeModal(project.id));

  const unsub = watchBoreholes(project.id, (boreholes) => {
    const list = document.getElementById("boreholeList");
    if (!list) return;
    if (!boreholes.length) { list.innerHTML = `<div class="empty-state">—</div>`; return; }
    list.innerHTML = boreholes.map((b) => boreholeBlockHtml(b)).join("");
    boreholes.forEach((b) => bindBoreholeBlock(project.id, b));
  });
  currentProjectUnsubs.push(unsub);
}
function pctBadgeClass(pct) { return pct >= 100 ? "high" : pct >= 40 ? "mid" : "low"; }
function boreholeBlockHtml(b) {
  const total = sumDailyLog(b.dailyLog);
  const contract = Number(b.contractVolume) || 0;
  const pct = contract > 0 ? Math.min(100, (total / contract) * 100) : 0;
  const today = new Date();
  const todayVal = (b.dailyLog || {})[dateKey(today)] || "";
  return `<div class="item-block" data-id="${b.id}">
    <div class="item-head">
      <h4>🕳 ${escapeHtml(b.name || "—")} <span style="color:var(--text-dim); font-weight:500;">(${escapeHtml(b.team || "—")})</span></h4>
      <div class="item-actions">
        <span class="pct-badge ${pctBadgeClass(pct)}">${pct.toFixed(0)}%</span>
        ${canEdit() ? `<button class="btn btn-ghost btn-sm edit-bh" data-i18n="edit"></button>` : ""}
        ${canEdit() ? `<button class="btn btn-danger btn-sm del-bh" data-i18n="delete"></button>` : ""}
      </div>
    </div>
    <div class="field-row">
      <div class="field"><label data-i18n="contractVolume"></label><input value="${contract} m" disabled /></div>
      <div class="field"><label data-i18n="completedTotal"></label><input value="${total} / ${contract} m" disabled /></div>
      <div class="field"><label data-i18n="waterLevel"></label><input value="${b.waterLevel ?? "—"}" disabled /></div>
    </div>
    <div class="progress-bar"><div style="width:${pct.toFixed(0)}%"></div></div>
    <div class="field-row" style="margin-top:12px;">
      <div class="field">
        <label data-i18n="completedToday"></label>
        <input type="number" class="today-input" min="0" step="0.1" value="${todayVal}" ${canEdit() ? "" : "disabled"} />
      </div>
      <div class="field"><label data-i18n="coordN"></label><input value="${b.coordN ?? "—"}" disabled /></div>
      <div class="field"><label data-i18n="coordE"></label><input value="${b.coordE ?? "—"}" disabled /></div>
      <div class="field"><label data-i18n="elevation"></label><input value="${b.elevation ?? "—"}" disabled /></div>
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
    if (confirm(t("deleteConfirm"))) await deleteBorehole(projectId, b.id, CURRENT_USER, b.name);
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
  const pct = contract > 0 ? Math.min(100, (total / contract) * 100) : 0;
  const todayVal = (s.dailyLog || {})[dateKey()] || "";
  const label = surveyItemLabel(s);
  return `<div class="item-block" data-id="${s.id}">
    <div class="item-head">
      <h4>📍 ${escapeHtml(label)} ${s.assignee ? `<span style="color:var(--text-dim); font-weight:500;">(${escapeHtml(s.assignee)})</span>` : ""}</h4>
      <div class="item-actions">
        <span class="pct-badge ${pctBadgeClass(pct)}">${pct.toFixed(0)}%</span>
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
    <div class="progress-bar"><div style="width:${pct.toFixed(0)}%"></div></div>
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
    if (confirm(t("deleteConfirm"))) await deleteSurveyItem(projectId, s.id, CURRENT_USER, surveyItemLabel(s));
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
    const html = buildReportHTML({ project, boreholes, surveyItems, dKey, activities, currentUser: CURRENT_USER, lang: getLang() });
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
      const name = (window.__reportCtx?.project?.name || "report").replace(/[^a-z0-9]+/gi, "_");
      await exportReportToPdf("reportPrintArea", `${name}_${window.__reportCtx?.dKey}.pdf`);
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
// ACTIVITY LOG VIEW
// ============================================================
function renderActivityView() {
  const extraControls = `
    <select id="al_project" style="min-width:200px;"></select>
    <select id="al_user" style="min-width:180px;"></select>`;
  mainView.innerHTML = topbarHtml("activityLog", extraControls) + `<div class="card"><div class="table-wrap"><table id="al_table" class="table-divided"><thead><tr><th>${t("timeCol")}</th><th data-i18n="user"></th><th data-i18n="activity"></th></tr></thead><tbody id="al_body"></tbody></table></div></div>`;
  bindTopbar();
  const sel = document.getElementById("al_project");
  const userSel = document.getElementById("al_user");
  let currentActivities = [];

  function fill() {
    sel.innerHTML = projectsCache.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  }
  function renderRows() {
    const body = document.getElementById("al_body");
    if (!body) return;
    const filterUser = userSel.value;
    const filtered = filterUser ? currentActivities.filter((a) => (a.userName || "") === filterUser) : currentActivities;
    if (!filtered.length) { body.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--text-dim);">—</td></tr>`; return; }
    body.innerHTML = filtered.map((a) => {
      const time = a.ts?.toDate ? a.ts.toDate().toLocaleString(getLang() === "vi" ? "vi-VN" : "en-US") : "—";
      return `<tr><td>${time}</td><td>${escapeHtml(a.userName || "")}</td><td>${escapeHtml(a.userName || "")} ${t("action_" + (a.action || "updated"))}: ${escapeHtml(a.itemLabel || "")}</td></tr>`;
    }).join("");
  }
  function fillUserFilter() {
    const names = [...new Set(currentActivities.map((a) => a.userName).filter(Boolean))].sort();
    const prev = userSel.value;
    userSel.innerHTML = `<option value="">${t("allUsers")}</option>` + names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
    if (names.includes(prev)) userSel.value = prev;
  }
  function load(pid) {
    if (!pid) return;
    const unsub = watchActivity(pid, (activities) => {
      currentActivities = activities;
      fillUserFilter();
      renderRows();
    });
    currentProjectUnsubs.push(unsub);
  }
  sel.addEventListener("change", () => { cleanupProjectWatchers(); currentActivities = []; load(sel.value); });
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
