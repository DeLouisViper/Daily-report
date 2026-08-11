import { sumDailyLog } from "./store.js";
import { t } from "./i18n.js";

function statusOf(pct) {
  if (pct >= 100) return { key: "completed", cls: "high" };
  if (pct <= 0) return { key: "notStarted", cls: "low" };
  return { key: "inProgress", cls: "mid" };
}

function surveyLabel(item) {
  const known = ["benchmark_place", "benchmark_bury", "benchmark_check", "leveling", "rtk", "underground", "drone"];
  if (known.includes(item.type)) return t(item.type);
  return item.type;
}

export function buildReportRows(project, boreholes, surveyItems, dKey) {
  const rows = [];
  (boreholes || []).forEach((b) => {
    const total = sumDailyLog(b.dailyLog);
    const contract = Number(b.contractVolume) || 0;
    const today = Number((b.dailyLog || {})[dKey]) || 0;
    const pct = contract > 0 ? Math.min(100, (total / contract) * 100) : 0;
    rows.push({
      label: b.name || "—",
      unit: "m",
      assignee: b.team || "—",
      contract, today, total, pct,
      type: "soil",
      coordN: b.coordN, coordE: b.coordE, elevation: b.elevation, waterLevel: b.waterLevel,
    });
  });
  (surveyItems || []).forEach((s) => {
    const total = sumDailyLog(s.dailyLog);
    const contract = Number(s.contractQty) || 0;
    const today = Number((s.dailyLog || {})[dKey]) || 0;
    const pct = contract > 0 ? Math.min(100, (total / contract) * 100) : 0;
    rows.push({
      label: surveyLabel(s),
      unit: s.unit || "",
      assignee: "—",
      contract, today, total, pct,
      type: "survey",
    });
  });
  return rows;
}

export function buildReportHTML({ project, boreholes, surveyItems, dKey, currentUser, lang }) {
  const rows = buildReportRows(project, boreholes, surveyItems, dKey);
  const overallPct = rows.length ? rows.reduce((a, r) => a + r.pct, 0) / rows.length : 0;
  const missing = rows.filter((r) => r.pct < 100);
  const now = new Date();
  const exportedAt = now.toLocaleString(lang === "vi" ? "vi-VN" : "en-US");
  const dateDisplay = dKey.split("-").reverse().join("/");

  const rowsHtml = rows.map((r) => {
    const st = statusOf(r.pct);
    return `<tr>
      <td>${escapeHtml(r.label)}</td>
      <td>${escapeHtml(r.assignee)}</td>
      <td class="num">${r.contract.toLocaleString()} ${escapeHtml(r.unit)}</td>
      <td class="num">${r.today.toLocaleString()} ${escapeHtml(r.unit)}</td>
      <td class="num">${r.total.toLocaleString()} ${escapeHtml(r.unit)}</td>
      <td class="num">${r.pct.toFixed(0)}%</td>
      <td>${t(st.key)}</td>
    </tr>`;
  }).join("");

  const missingHtml = missing.length
    ? `<div class="section-title">${t("missingItems")}</div><ul class="missing-list">${missing.map((m) => `<li>${escapeHtml(m.label)} — ${m.pct.toFixed(0)}%</li>`).join("")}</ul>`
    : "";

  const boreholeRows = rows.filter((r) => r.type === "soil");
  const coordsHtml = boreholeRows.length
    ? `<div class="section-title">${t("boreholeInfo")}</div>
       <table class="report-table-closed">
         <thead><tr><th>${t("boreholeName")}</th><th>${t("coordN")}</th><th>${t("coordE")}</th><th>${t("elevation")}</th><th>${t("waterLevel")}</th></tr></thead>
         <tbody>${boreholeRows.map((r) => `<tr>
           <td>${escapeHtml(r.label)}</td>
           <td class="num">${escapeHtml(r.coordN || "—")}</td>
           <td class="num">${escapeHtml(r.coordE || "—")}</td>
           <td class="num">${escapeHtml(r.elevation || "—")}</td>
           <td class="num">${escapeHtml(r.waterLevel || "—")}</td>
         </tr>`).join("")}</tbody>
       </table>`
    : "";

  const workTypeTags = [
    project.workTypes?.soil ? t("soilInvestigation") : null,
    project.workTypes?.survey ? t("survey") : null,
  ].filter(Boolean).join(" · ");

  return `
  <div class="report-page" id="reportPrintArea">
    <div class="report-head">
      <div class="brand">
        <div class="mark">DR</div>
        <div>
          <div class="name">Daily Report</div>
          <div class="tag">${lang === "vi" ? "Hệ thống quản lý quy trình khảo sát" : "Field survey workflow management system"}</div>
        </div>
      </div>
      <div class="meta">
        <div><b>${t("reportDate")}:</b> ${dateDisplay}</div>
        <div><b>${t("exportedAt")}:</b> ${exportedAt}</div>
      </div>
    </div>

    <div class="report-title">${t("reportTitle")}</div>

    <table class="report-info-table report-table-closed">
      <tr><td>${t("project")}</td><td>${escapeHtml(project.name || "—")}</td></tr>
      <tr><td>${t("location")}</td><td>${escapeHtml(project.location || "—")}</td></tr>
      <tr><td>${t("siteEngineer")}</td><td>${escapeHtml(project.siteEngineer || "—")}</td></tr>
      <tr><td>${t("manager")}</td><td>${escapeHtml(project.manager || "—")}</td></tr>
      <tr><td>${t("workTypes")}</td><td>${escapeHtml(workTypeTags || "—")}</td></tr>
    </table>

    <div class="report-progress-wrap">
      <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:700; margin-bottom:4px;">
        <span>${t("overallProgress")}</span><span>${overallPct.toFixed(0)}%</span>
      </div>
      <div class="progress-bar"><div style="width:${overallPct.toFixed(0)}%"></div></div>
    </div>

    <div class="section-title">${t("itemsTable")}</div>
    <table class="report-table-closed">
      <thead><tr>
        <th>${t("itemsTable")}</th><th>${t("assignee")}</th><th>${t("qtyContract")}</th><th>${t("qtyToday")}</th><th>${t("completedTotal")}</th><th>${t("completionRate")}</th><th>${t("status")}</th>
      </tr></thead>
      <tbody>${rowsHtml || `<tr><td colspan="7" style="text-align:center;color:#888;">—</td></tr>`}</tbody>
    </table>

    ${missingHtml}

    ${coordsHtml}

    ${project.siteImageUrl ? `<div class="section-title">${t("siteImage")}</div><img class="report-photo" src="${project.siteImageUrl}" />` : ""}

    <div class="sign-row">
      <div>
        <div class="role">${t("preparedBy")}</div>
        <div class="name">${escapeHtml(currentUser?.name || currentUser?.email || "")}</div>
      </div>
      <div>
        <div class="role">${t("checkedBy")}</div>
        <div class="name">&nbsp;</div>
      </div>
      <div>
        <div class="role">${t("headOfDept")}</div>
        <div class="name">&nbsp;</div>
      </div>
    </div>
  </div>`;
}

export function buildSummaryText({ project, boreholes, surveyItems, dKey, lang }) {
  const rows = buildReportRows(project, boreholes, surveyItems, dKey);
  const overallPct = rows.length ? rows.reduce((a, r) => a + r.pct, 0) / rows.length : 0;
  const dateDisplay = dKey.split("-").reverse().join("/");
  let txt = `${project.name} — ${t("reportDate")}: ${dateDisplay}\n${t("overallProgress")}: ${overallPct.toFixed(0)}%\n\n`;
  rows.forEach((r) => {
    txt += `- ${r.label}: ${r.today} ${r.unit} ${lang === "vi" ? "hôm nay" : "today"} | ${t("total")} ${r.total}/${r.contract} ${r.unit} (${r.pct.toFixed(0)}%)\n`;
  });
  return txt;
}

export async function exportReportToPdf(elementId, filename) {
  const { jsPDF } = window.jspdf;
  const el = document.getElementById(elementId);
  const canvas = await window.html2canvas(el, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageWidth = 210;
  const pageHeight = 297;
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  let heightLeft = imgHeight;
  let position = 0;
  pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;
  while (heightLeft > 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }
  pdf.save(filename);
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
