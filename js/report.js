import { sumDailyLog } from "./store.js";
import { t } from "./i18n.js";
import { EQUIPMENT_CATALOG } from "./equipment-catalog.js";

const DRILL_ICON_INNER = `<rect x="10" y="2" width="4" height="2.6" rx="0.5"/><path d="M10.2 4.6 L9.4 14.5"/><path d="M13.8 4.6 L14.6 14.5"/><path d="M9.4 14.5 L12 21 L14.6 14.5"/><path d="M9.9 8 L14.1 8"/><path d="M9.65 11.2 L14.35 11.2"/>`;

// Rounding a small-but-nonzero progress (e.g. 0.8%) to a whole number shows a
// misleading "0%". Fall back to one decimal place only in that edge case.
function formatPct(pct) {
  if (pct > 0 && Math.round(pct) === 0) return pct.toFixed(1);
  return pct.toFixed(0);
}

function statusOf(pct) {
  if (pct >= 100) return { key: "completed", cls: "high", colorCls: "st-done" };
  if (pct <= 0) return { key: "notStarted", cls: "low", colorCls: "st-missing" };
  return { key: "inProgress", cls: "mid", colorCls: "st-progress" };
}

function surveyLabel(item) {
  if (item.type === "custom") return item.customLabel || "—";
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
    const pct = contract > 0 ? (total / contract) * 100 : 0; // hiển thị đúng thực tế, có thể > 100%
    rows.push({
      label: b.name || "—",
      unit: "m",
      assignee: b.team || "—",
      contract, today, total, pct,
      type: "soil",
      coordN: b.coordN, coordE: b.coordE, elevation: b.elevation, waterLevel: b.waterLevel,
      soilM: b.soilM, rockM: b.rockM, note: b.note,
    });
  });
  (surveyItems || []).forEach((s) => {
    const total = sumDailyLog(s.dailyLog);
    const contract = Number(s.contractQty) || 0;
    const today = Number((s.dailyLog || {})[dKey]) || 0;
    const pct = contract > 0 ? (total / contract) * 100 : 0; // hiển thị đúng thực tế, có thể > 100%
    rows.push({
      label: surveyLabel(s),
      unit: s.unit || "",
      assignee: s.assignee || "—",
      contract, today, total, pct,
      type: "survey",
    });
  });
  // Ưu tiên hạng mục đang thực hiện lên đầu, kế đến là đã hoàn thành (đẩy lên trên,
  // không để tụt xuống cuối bảng), cuối cùng mới tới hạng mục chưa bắt đầu.
  // Trong mỗi nhóm, sắp xếp theo tên A-Z, 0-9 (tự nhiên) thay vì theo thứ tự tạo.
  rows.sort((a, b) => {
    const rank = (r) => (r.pct > 0 && r.pct < 100 ? 0 : r.pct >= 100 ? 1 : 2);
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    return (a.label || "").localeCompare(b.label || "", undefined, { numeric: true, sensitivity: "base" });
  });
  return rows;
}

export function buildReportHTML({ project, boreholes, surveyItems, dKey, currentUser, lang, includeSoilRockTable }) {
  const rows = buildReportRows(project, boreholes, surveyItems, dKey);
  const overallPct = rows.length ? rows.reduce((a, r) => a + r.pct, 0) / rows.length : 0;
  const missing = rows.filter((r) => r.pct < 100);
  const now = new Date();
  const exportedAt = now.toLocaleString(lang === "vi" ? "vi-VN" : "en-US");
  const dateDisplay = dKey.split("-").reverse().join("/");
  const nextPlanText = (project.nextDayPlan || {})[dKey] || "";
  const nextPlanHtml = nextPlanText
    ? `<div class="report-section next-plan-box">
        <div class="section-title">${t("nextDayPlan")}</div>
        <div class="next-plan-text">${escapeHtml(nextPlanText)}</div>
       </div>`
    : "";

  const rowsHtml = rows.map((r) => {
    const st = statusOf(r.pct);
    return `<tr>
      <td><span class="${st.colorCls}">${escapeHtml(r.label)}</span></td>
      <td>${escapeHtml(r.assignee)}</td>
      <td class="num">${r.contract.toLocaleString()} ${escapeHtml(r.unit)}</td>
      <td class="num">${r.today.toLocaleString()} ${escapeHtml(r.unit)}</td>
      <td class="num">${r.total.toLocaleString()} ${escapeHtml(r.unit)}</td>
      <td class="num">${formatPct(r.pct)}%</td>
      <td><span class="${st.colorCls}">${t(st.key)}</span></td>
    </tr>`;
  }).join("");

  const missingHtml = missing.length
    ? `<div class="report-section"><div class="section-title">${t("missingItems")}</div><ul class="missing-list">${missing.map((m) => `<li class="${m.pct > 0 ? "st-progress" : "st-missing"}">${escapeHtml(m.label)} — ${formatPct(m.pct)}%</li>`).join("")}</ul></div>`
    : "";

  const boreholeRows = rows.filter((r) => r.type === "soil");
  const coordsHtml = boreholeRows.length
    ? `<div class="report-section">
       <div class="section-title">${t("boreholeInfo")}</div>
       <table class="report-table-closed">
         <thead><tr><th>${t("boreholeName")}</th><th>${t("coordN")}</th><th>${t("coordE")}</th><th>${t("elevation")}</th><th>${t("waterLevel")}</th></tr></thead>
         <tbody>${boreholeRows.map((r) => `<tr>
           <td><span class="${statusOf(r.pct).colorCls}">${escapeHtml(r.label)}</span></td>
           <td class="num">${escapeHtml(r.coordN || "—")}</td>
           <td class="num">${escapeHtml(r.coordE || "—")}</td>
           <td class="num">${escapeHtml(r.elevation || "—")}</td>
           <td class="num">${escapeHtml(r.waterLevel || "—")}</td>
         </tr>`).join("")}</tbody>
       </table>
       </div>`
    : "";

  const soilRockHtml = includeSoilRockTable && boreholeRows.length
    ? `<div class="report-section">
       <div class="section-title">${t("soilRockTableTitle")}</div>
       <table class="report-table-closed">
         <thead><tr><th>${t("borholeNameCol")}</th><th>${t("totalQtyCol")} (m)</th><th>${t("soilM")}</th><th>${t("rockM")}</th><th>${t("note")}</th></tr></thead>
         <tbody>${boreholeRows.map((r) => `<tr>
           <td><span class="${statusOf(r.pct).colorCls}">${escapeHtml(r.label)}</span></td>
           <td class="num">${r.total.toLocaleString()}</td>
           <td class="num">${r.soilM != null && r.soilM !== "" ? r.soilM : "—"}</td>
           <td class="num">${r.rockM != null && r.rockM !== "" ? r.rockM : "—"}</td>
           <td>${escapeHtml(r.note || "—")}</td>
         </tr>`).join("")}</tbody>
       </table>
       </div>`
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

    <div class="report-section">
      <table class="report-info-table report-table-closed">
        <tr><td>${t("project")}</td><td>${escapeHtml(project.name || "—")}</td></tr>
        <tr><td>${t("location")}</td><td>${escapeHtml(project.location || "—")}</td></tr>
        <tr><td>${t("siteEngineer")}</td><td>${escapeHtml(project.siteEngineer || "—")}</td></tr>
        <tr><td>${t("manager")}</td><td>${escapeHtml(project.manager || "—")}</td></tr>
        <tr><td>${t("workTypes")}</td><td>${escapeHtml(workTypeTags || "—")}</td></tr>
      </table>

      <div class="report-progress-wrap">
        <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:700; margin-bottom:4px;">
          <span>${t("overallProgress")}</span><span>${formatPct(overallPct)}%</span>
        </div>
        <div class="progress-bar"><div style="width:${Math.min(100, Math.max(overallPct, overallPct > 0 ? 1 : 0)).toFixed(0)}%"></div></div>
      </div>
    </div>

    <div class="report-section">
      <div class="section-title">${t("itemsTable")}</div>
      <table class="report-table-closed">
        <thead><tr>
          <th>${t("itemsTable")}</th><th>${t("assignee")}</th><th>${t("qtyContract")}</th><th>${t("qtyToday")}</th><th>${t("completedTotal")}</th><th>${t("completionRate")}</th><th>${t("status")}</th>
        </tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="7" style="text-align:center;color:#888;">—</td></tr>`}</tbody>
      </table>
    </div>

    ${missingHtml}

    ${soilRockHtml}

    ${coordsHtml}

    ${project.siteImageUrl ? `<div class="report-section"><div class="section-title">${t("siteImage")}</div><img class="report-photo" src="${project.siteImageUrl}" /></div>` : ""}

    ${nextPlanHtml}

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

const DRILL_LOG_FIELDS_REPORT = [
  { key: "operator", label: "operator" },
  { key: "engineer", label: "engineerInCharge" },
  { key: "morningStart", label: "morningStart" },
  { key: "lunchBreak", label: "lunchBreak" },
  { key: "afternoonStart", label: "afternoonStart" },
  { key: "endOfDay", label: "endOfDay" },
  { key: "breakdownPeriods", label: "breakdownPeriods" },
  { key: "repairItem", label: "repairItem" },
  { key: "suspensionTime", label: "suspensionTime" },
  { key: "suspensionReason", label: "suspensionReason" },
];
function formatBreakdownPeriods(periods) {
  if (!Array.isArray(periods) || !periods.length) return "—";
  return periods.map((p) => `${p.start || "?"} → ${p.end || "?"}`).join("; ");
}
function getMachineDayLogRaw(m, dKey) {
  const logs = m.dailyLogs || {};
  if (logs[dKey]) return logs[dKey];
  const prevDates = Object.keys(logs).filter((d) => d < dKey).sort();
  if (prevDates.length) return logs[prevDates[prevDates.length - 1]];
  return {};
}

export function buildDrillLogHTML({ project, machines, dKey, currentUser, lang }) {
  const dateDisplay = dKey.split("-").reverse().join("/");
  const exportedAt = new Date().toLocaleString(lang === "vi" ? "vi-VN" : "en-US");

  const machinesHtml = (machines || []).map((m) => {
    const data = getMachineDayLogRaw(m, dKey);
    const rows = DRILL_LOG_FIELDS_REPORT.map((f) => {
      const val = f.key === "breakdownPeriods" ? formatBreakdownPeriods(data[f.key]) : (data[f.key] || "—");
      return `<tr><td>${t(f.label)}</td><td>${escapeHtml(val)}</td></tr>`;
    }).join("");
    return `<div class="report-section">
      <div class="section-title"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;" aria-hidden="true">${DRILL_ICON_INNER}</svg>${escapeHtml(m.name || "—")}</div>
      <table class="report-info-table report-table-closed">${rows}</table>
    </div>`;
  }).join("");

  return `
  <div class="report-page" id="drillLogPrintArea">
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

    <div class="report-title">${t("drillLogTitle")}</div>

    <div class="report-section">
      <table class="report-info-table report-table-closed">
        <tr><td>${t("project")}</td><td>${escapeHtml(project?.name || "—")}</td></tr>
        <tr><td>${t("location")}</td><td>${escapeHtml(project?.location || "—")}</td></tr>
      </table>
    </div>

    ${machinesHtml || `<div class="empty-state">—</div>`}

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

// Báo cáo tổng hợp lịch sử sửa chữa: gom tất cả các ngày có ghi nhận hỏng máy /
// sửa chữa (breakdownPeriods hoặc repairItem) của 1 máy hoặc tất cả máy,
// sắp xếp theo ngày, để phục vụ việc kiểm soát bảo trì thiết bị theo thời gian
// (khác với buildDrillLogHTML vốn chỉ hiển thị 1 ngày cho tất cả máy).
export function buildRepairHistoryHTML({ project, machines, currentUser, lang, machineLabel }) {
  const exportedAt = new Date().toLocaleString(lang === "vi" ? "vi-VN" : "en-US");

  const rows = [];
  (machines || []).forEach((m) => {
    const logs = m.dailyLogs || {};
    Object.keys(logs).sort().forEach((dKey) => {
      const d = logs[dKey] || {};
      const periods = Array.isArray(d.breakdownPeriods) ? d.breakdownPeriods : [];
      const hasRepairInfo = (d.repairItem && String(d.repairItem).trim()) || periods.length > 0;
      if (!hasRepairInfo) return;
      rows.push({
        dKey,
        machine: m.name || "—",
        operator: d.operator || "",
        periods: formatBreakdownPeriods(periods),
        repairItem: d.repairItem || "",
        suspensionReason: d.suspensionReason || "",
      });
    });
  });
  rows.sort((a, b) => a.dKey === b.dKey ? a.machine.localeCompare(b.machine, undefined, { numeric: true, sensitivity: "base" }) : a.dKey.localeCompare(b.dKey));

  const rowsHtml = rows.map((r) => `<tr>
    <td class="num">${r.dKey.split("-").reverse().join("/")}</td>
    <td>${escapeHtml(r.machine)}</td>
    <td>${escapeHtml(r.operator || "—")}</td>
    <td>${escapeHtml(r.periods)}</td>
    <td>${escapeHtml(r.repairItem || "—")}</td>
    <td>${escapeHtml(r.suspensionReason || "—")}</td>
  </tr>`).join("");

  return `
  <div class="report-page" id="repairLogPrintArea">
    <div class="report-head">
      <div class="brand">
        <div class="mark">DR</div>
        <div>
          <div class="name">Daily Report</div>
          <div class="tag">${lang === "vi" ? "Hệ thống quản lý quy trình khảo sát" : "Field survey workflow management system"}</div>
        </div>
      </div>
      <div class="meta">
        <div><b>${t("exportedAt")}:</b> ${exportedAt}</div>
      </div>
    </div>

    <div class="report-title">${t("repairLogTitle")}</div>

    <div class="report-section">
      <table class="report-info-table report-table-closed">
        <tr><td>${t("project")}</td><td>${escapeHtml(project?.name || "—")}</td></tr>
        <tr><td>${t("machine")}</td><td>${escapeHtml(machineLabel || t("allMachines"))}</td></tr>
      </table>
    </div>

    <div class="report-section">
      <table class="report-table-closed">
        <thead><tr>
          <th>${t("reportDate")}</th><th>${t("machine")}</th><th>${t("operator")}</th><th>${t("breakdownPeriods")}</th><th>${t("repairItem")}</th><th>${t("suspensionReason")}</th>
        </tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="6" style="text-align:center;color:#888;">${t("noRepairRecords")}</td></tr>`}</tbody>
      </table>
    </div>

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
  let txt = `${project.name} — ${t("reportDate")}: ${dateDisplay}\n${t("overallProgress")}: ${formatPct(overallPct)}%\n\n`;
  rows.forEach((r) => {
    txt += `- ${r.label}: ${r.today} ${r.unit} ${lang === "vi" ? "hôm nay" : "today"} | ${t("total")} ${r.total}/${r.contract} ${r.unit} (${formatPct(r.pct)}%)\n`;
  });
  return txt;
}

// Splits an oversized report-section (one that contains a <table> taller than a
// single page) into page-sized pieces at row boundaries. Every piece after the
// first carries `headerRect` — the section title + table header row, captured in
// viewport coordinates — so the caller can redraw it at the top of that page.
function splitTableSection(sectionEl, table, elTop, usableHeightPx, sectionTop, sectionBottom, firstPieceTop, firstPieceBudgetBottom) {
  const theadEl = table.querySelector("thead");
  const titleEl = sectionEl.querySelector(".section-title");
  const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
  if (!theadEl || !bodyRows.length) {
    return [{ top: sectionTop, bottom: sectionBottom, headerRect: null }];
  }

  const theadRectRaw = theadEl.getBoundingClientRect(); // viewport coordinates
  const headerRectRaw = titleEl
    ? { top: titleEl.getBoundingClientRect().top, bottom: theadRectRaw.bottom }
    : { top: theadRectRaw.top, bottom: theadRectRaw.bottom };
  const headerHeightRel = headerRectRaw.bottom - headerRectRaw.top;
  const theadBottomRel = theadRectRaw.bottom - elTop;

  const pieces = [];
  let pieceTop = firstPieceTop;
  let budgetBottom = firstPieceBudgetBottom;
  let lastSafeBottom = theadBottomRel;
  let continuing = false;

  bodyRows.forEach((rowEl) => {
    const rr = rowEl.getBoundingClientRect();
    const rTopRel = rr.top - elTop;
    const rBottomRel = rr.bottom - elTop;
    if (rBottomRel > budgetBottom && rBottomRel - rTopRel < usableHeightPx) {
      pieces.push({ top: pieceTop, bottom: lastSafeBottom, headerRect: continuing ? headerRectRaw : null });
      continuing = true;
      pieceTop = rTopRel;
      budgetBottom = pieceTop + (usableHeightPx - headerHeightRel);
    }
    lastSafeBottom = rBottomRel;
  });
  pieces.push({ top: pieceTop, bottom: sectionBottom, headerRect: continuing ? headerRectRaw : null });
  return pieces;
}

// Builds the list of page "pieces" (each {top, bottom, headerRect}) for a report
// element. Normal-sized sections pack together onto a page. A section taller than
// one page (e.g. a table with 30+ rows) gets split at row boundaries and keeps
// filling whatever space is left on the current page first, instead of always
// jumping to a fresh page and leaving the current one mostly blank. Continuation
// pieces carry `headerRect` so the caller can redraw that table's title + header
// row at the top of the next page.
export function computePagePieces(el, elRect, usableHeightPx) {
  const children = Array.from(el.children);
  const pieces = [];
  let pageTop = 0;
  let pageBottom = 0;
  let pageHasContent = false;
  const flushPage = () => {
    if (pageHasContent) pieces.push({ top: pageTop, bottom: pageBottom, headerRect: null });
    pageHasContent = false;
  };

  children.forEach((child) => {
    const r = child.getBoundingClientRect();
    const childTop = r.top - elRect.top;
    const childBottom = r.bottom - elRect.top;
    const childHeight = childBottom - childTop;
    const remainingOnPage = pageHasContent ? (pageTop + usableHeightPx - pageBottom) : usableHeightPx;

    if (childHeight > remainingOnPage) {
      if (childHeight > usableHeightPx) {
        // Genuinely taller than one whole page — split at row boundaries if possible.
        const table = child.querySelector("table");
        const hasRows = table && table.querySelectorAll("tbody tr").length > 0;
        if (hasRows) {
          const firstPieceTop = pageHasContent ? pageTop : childTop;
          const firstPieceBudgetBottom = firstPieceTop + usableHeightPx;
          pieces.push(...splitTableSection(child, table, elRect.top, usableHeightPx, childTop, childBottom, firstPieceTop, firstPieceBudgetBottom));
          pageHasContent = false;
        } else {
          flushPage();
          pieces.push({ top: childTop, bottom: childBottom, headerRect: null }); // oversized, nothing to split by — best effort
        }
      } else {
        // Fits comfortably on a fresh page — move it there whole instead of
        // mid-table splitting just because the *remaining* space ran out.
        flushPage();
        pageTop = childTop;
        pageBottom = childBottom;
        pageHasContent = true;
      }
      return;
    }

    if (!pageHasContent) {
      pageTop = childTop;
      pageBottom = childBottom;
      pageHasContent = true;
    } else {
      pageBottom = childBottom;
    }
  });
  flushPage();
  return pieces;
}

export async function exportReportToPdf(elementId, filename) {
  const { jsPDF } = window.jspdf;
  const original = document.getElementById(elementId);

  // Render from an off-screen clone fixed at the true A4 width (210mm), regardless
  // of the device/viewport used to trigger the export. Without this, exporting from
  // a narrow mobile screen captures the squeezed mobile layout and stretches it to
  // A4 width, producing a distorted/misaligned PDF.
  const el = original.cloneNode(true);
  el.removeAttribute("id");
  el.style.position = "fixed";
  el.style.top = "0";
  el.style.left = "-99999px";
  el.style.width = "210mm";
  el.style.minHeight = "0";
  el.style.margin = "0";
  el.style.boxShadow = "none";
  el.style.zIndex = "-1";
  document.body.appendChild(el);
  // Let the browser lay out and paint the clone before snapshotting it.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  try {
    const scale = 2;
    const canvas = await window.html2canvas(el, { scale, useCORS: true, backgroundColor: "#ffffff" });

    const pageWidthMm = 210;
    const pageHeightMm = 297;
    const marginTopMm = 8;
    const marginBottomMm = 12; // leaves room for the page-number footer
    const usableHeightMm = pageHeightMm - marginTopMm - marginBottomMm;

    const elRect = el.getBoundingClientRect();
    const cssWidthPx = elRect.width;
    const pxPerCssPx = canvas.width / cssWidthPx; // actual rendered scale (matches html2canvas `scale`)
    const pxPerMm = cssWidthPx / pageWidthMm; // clone is fixed at 210mm wide
    const usableHeightPx = usableHeightMm * pxPerMm; // in CSS px (un-scaled)

    // Build the list of page "pieces". Normal-sized sections pack together onto a
    // page like before. A section taller than one page (e.g. a table with 30+ rows)
    // gets split at row boundaries instead of being pushed whole onto its own page —
    // and every continuation page repeats that table's title + column header row so
    // it's still readable/traceable without scrolling back.
    const pieces = computePagePieces(el, elRect, usableHeightPx);

    // html2canvas flattens everything into a plain image, silently dropping every
    // <a href>. Capture each link's position now (in the same coordinate frame
    // used for page-splitting below) so we can re-attach them as real clickable
    // PDF link annotations once each page's image has been placed.
    const linkEls = [...el.querySelectorAll("a[href]")]
      .map((a) => {
        const r = a.getBoundingClientRect();
        return {
          href: a.getAttribute("href"),
          topPx: Math.round((r.top - elRect.top) * pxPerCssPx),
          bottomPx: Math.round((r.bottom - elRect.top) * pxPerCssPx),
          leftPx: Math.round((r.left - elRect.left) * pxPerCssPx),
          rightPx: Math.round((r.right - elRect.left) * pxPerCssPx),
        };
      })
      .filter((l) => l.href && /^https?:\/\//i.test(l.href));

    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
    const totalPages = pieces.length;

    for (let i = 0; i < totalPages; i++) {
      const piece = pieces[i];
      const bodyTopPx = Math.round(piece.top * pxPerCssPx);
      const bodyBottomPx = Math.round(piece.bottom * pxPerCssPx);
      const bodyHeightPx = Math.max(1, bodyBottomPx - bodyTopPx);

      let headerHeightPx = 0;
      let headerTopPx = 0;
      if (piece.headerRect) {
        headerTopPx = Math.round((piece.headerRect.top - elRect.top) * pxPerCssPx);
        headerHeightPx = Math.max(1, Math.round((piece.headerRect.bottom - elRect.top) * pxPerCssPx) - headerTopPx);
      }

      const sliceCanvas = document.createElement("canvas");
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = headerHeightPx + bodyHeightPx;
      const ctx = sliceCanvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
      if (headerHeightPx > 0) {
        ctx.drawImage(canvas, 0, headerTopPx, canvas.width, headerHeightPx, 0, 0, canvas.width, headerHeightPx);
      }
      ctx.drawImage(canvas, 0, bodyTopPx, canvas.width, bodyHeightPx, 0, headerHeightPx, canvas.width, bodyHeightPx);

      // JPEG at high quality keeps the page looking identical while producing a
      // file many times smaller than PNG — important for sharing over chat apps.
      const imgData = sliceCanvas.toDataURL("image/jpeg", 0.92);
      const sliceHeightMm = sliceCanvas.height / pxPerCssPx / pxPerMm;

      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, marginTopMm, pageWidthMm, sliceHeightMm, undefined, "MEDIUM");

      // Re-attach clickable regions for any link whose original position falls
      // within this page's body slice (accounting for the repeated header, if any).
      linkEls.forEach((l) => {
        const overlapTop = Math.max(l.topPx, bodyTopPx);
        const overlapBottom = Math.min(l.bottomPx, bodyBottomPx);
        if (overlapBottom <= overlapTop) return;
        const yWithinSlicePx = headerHeightPx + (overlapTop - bodyTopPx);
        const hPx = overlapBottom - overlapTop;
        const xMm = l.leftPx / pxPerCssPx / pxPerMm;
        const wMm = (l.rightPx - l.leftPx) / pxPerCssPx / pxPerMm;
        const yMm = marginTopMm + yWithinSlicePx / pxPerCssPx / pxPerMm;
        const hMm = hPx / pxPerCssPx / pxPerMm;
        pdf.link(xMm, yMm, wMm, hMm, { url: l.href });
      });

      if (totalPages > 1) {
        pdf.setFontSize(8);
        pdf.setTextColor(120, 120, 120);
        pdf.text(`${i + 1}/${totalPages}`, pageWidthMm / 2, pageHeightMm - 6, { align: "center" });
      }
    }

    // Deliver the file. On mobile, sharing a blob: URL via an <a download> link
    // makes Safari's share sheet split it into "1 document + 1 link" (2 separate
    // files land in the chat app), so we use the Web Share API with a real File
    // there instead. On desktop, some browsers now also support Web Share with
    // files (opening the OS-level share panel) — but on desktop people expect a
    // plain download to their Downloads folder, not a share dialog, so we only
    // use Web Share when we're actually on a phone/tablet.
    const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const blob = pdf.output("blob");
    const file = new File([blob], filename, { type: "application/pdf" });
    let delivered = false;
    if (isMobileDevice && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        delivered = true;
      } catch (shareErr) {
        // User cancelled the share sheet, or share failed — fall back to a normal download.
        delivered = shareErr && shareErr.name === "AbortError";
      }
    }
    if (!delivered) {
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    }
  } finally {
    document.body.removeChild(el);
  }
}

// Chuyển tên dự án có dấu tiếng Việt thành tên file gọn, không dấu, dễ đọc
// (ví dụ "Dự án Cầu KT10" -> "Du_an_Cau_KT10"), thay vì xóa sạch mọi chữ có dấu.
export function slugify(str) {
  return String(str || "")
    .replace(/đ/g, "d").replace(/Đ/g, "D")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "report";
}

// ============================================================
// EQUIPMENT CHECK IN / CHECK OUT REPORTS
// ============================================================
function equipItemName(it, lang) {
  if (it.customName) return it.customName;
  const cat = EQUIPMENT_CATALOG.find((e) => e.id === it.itemId);
  return cat ? (lang === "vi" ? cat.vi : cat.en) : it.itemId;
}
function reportHead(lang, exportedAt) {
  return `<div class="report-head">
      <div class="brand">
        <div class="mark">DR</div>
        <div>
          <div class="name">Daily Report</div>
          <div class="tag">${lang === "vi" ? "Hệ thống quản lý quy trình khảo sát" : "Field survey workflow management system"}</div>
        </div>
      </div>
      <div class="meta"><div><b>${t("exportedAt")}:</b> ${exportedAt}</div></div>
    </div>`;
}
function reportSignRow(currentUser) {
  return `<div class="sign-row">
      <div><div class="role">${t("preparedBy")}</div><div class="name">${escapeHtml(currentUser?.name || currentUser?.email || "")}</div></div>
      <div><div class="role">${t("checkedBy")}</div><div class="name">&nbsp;</div></div>
      <div><div class="role">${t("headOfDept")}</div><div class="name">&nbsp;</div></div>
    </div>`;
}

export function buildEquipmentCheckoutHTML({ project, log, currentUser, lang }) {
  const exportedAt = new Date().toLocaleString(lang === "vi" ? "vi-VN" : "en-US");
  const items = log?.items || [];
  const rows = items.map((it, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td>${escapeHtml(equipItemName(it, lang))}</td>
      <td>${escapeHtml(it.spec || "—")}</td>
      <td class="num">${it.qty}</td>
      <td></td>
    </tr>`).join("");

  return `
  <div class="report-page" id="equipCheckoutPrintArea">
    ${reportHead(lang, exportedAt)}
    <div class="report-title">${t("equipmentCheckoutTitle")}</div>
    <div class="report-section">
      <table class="report-info-table report-table-closed">
        <tr><td>${t("project")}</td><td>${escapeHtml(project?.name || "—")}</td></tr>
        <tr><td>${t("projectLocation")}</td><td>${escapeHtml(project?.location || "—")}</td></tr>
        <tr><td>${t("fieldEngineer")}</td><td>${escapeHtml(project?.siteEngineer || "—")}</td></tr>
        <tr><td>${t("manager")}</td><td>${escapeHtml(project?.manager || "—")}</td></tr>
      </table>
    </div>
    <div class="report-section">
      <table class="report-table-closed">
        <thead><tr>
          <th>No.</th><th>${t("equipmentName")}</th><th>${t("specColumn")}</th><th>${t("quantity")}</th><th>${t("noteCol")}</th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="5" style="text-align:center;color:#888;">${t("noItems")}</td></tr>`}</tbody>
      </table>
    </div>
    ${reportSignRow(currentUser)}
  </div>`;
}

export function buildEquipmentCheckinHTML({ project, log, currentUser, lang }) {
  const exportedAt = new Date().toLocaleString(lang === "vi" ? "vi-VN" : "en-US");
  const items = log?.checkin?.items || [];
  const totals = items.reduce((a, it) => {
    a.issued += Number(it.issuedQty) || 0; a.returned += Number(it.returnedQty) || 0;
    a.damaged += Number(it.damagedQty) || 0; a.lost += Number(it.lostQty) || 0;
    return a;
  }, { issued: 0, returned: 0, damaged: 0, lost: 0 });

  const rows = items.map((it, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td>${escapeHtml(equipItemName(it, lang))}</td>
      <td>${escapeHtml(it.spec || "—")}</td>
      <td class="num">${it.issuedQty}</td>
      <td class="num">${it.returnedQty}</td>
      <td class="num">${it.damagedQty}</td>
      <td class="num">${it.lostQty}</td>
      <td>${escapeHtml(it.note || "")}</td>
    </tr>`).join("");

  return `
  <div class="report-page" id="equipCheckinPrintArea">
    ${reportHead(lang, exportedAt)}
    <div class="report-title">${t("equipmentCheckinTitle")}</div>
    <div class="report-section">
      <table class="report-info-table report-table-closed">
        <tr><td>${t("project")}</td><td>${escapeHtml(project?.name || "—")}</td></tr>
        <tr><td>${t("projectLocation")}</td><td>${escapeHtml(project?.location || "—")}</td></tr>
        <tr><td>${t("fieldEngineer")}</td><td>${escapeHtml(project?.siteEngineer || "—")}</td></tr>
        <tr><td>${t("manager")}</td><td>${escapeHtml(project?.manager || "—")}</td></tr>
      </table>
    </div>
    <div class="report-section">
      <table class="report-table-closed">
        <thead><tr>
          <th>No.</th><th>${t("equipmentName")}</th><th>${t("specColumn")}</th>
          <th>${t("issuedQty")}</th><th>${t("returnedQty")}</th><th>${t("damagedQty")}</th><th>${t("lostQty")}</th><th>${t("noteCol")}</th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="8" style="text-align:center;color:#888;">${t("noItems")}</td></tr>`}</tbody>
      </table>
    </div>
    <div class="report-section">
      <table class="report-info-table report-table-closed">
        <tr><td>${t("totalIssued")}</td><td>${totals.issued}</td><td>${t("totalReturned")}</td><td>${totals.returned}</td></tr>
        <tr><td>${t("totalDamaged")}</td><td>${totals.damaged}</td><td>${t("totalLost")}</td><td>${totals.lost}</td></tr>
      </table>
    </div>
    ${reportSignRow(currentUser)}
  </div>`;
}

// ============================================================
// MATERIALS PRICE LIST REPORT
// ============================================================
function isUrlLikeReport(str) { return /^https?:\/\//i.test(String(str || "").trim()); }
function formatMaterialPriceReport(m) {
  const val = Number(m.price) || 0;
  if (m.currency === "USD") return "$" + val.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return val.toLocaleString("vi-VN") + " ₫";
}
function formatMaterialTimeReport(ts, lang) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const locale = lang === "vi" ? "vi-VN" : "en-US";
  return d.toLocaleDateString(locale) + " " + d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

function splitLegacyBuyLocationReport(str) {
  const s = String(str || "").trim();
  if (!s) return { name: "", url: "" };
  const m = s.match(/(https?:\/\/\S+)/i);
  if (!m) return { name: s, url: "" };
  const url = m[1];
  const name = s.replace(url, "").replace(/[-–—:|]+$/, "").replace(/^[-–—:|]+/, "").trim();
  return { name, url };
}
function buyLocationDisplayReport(m) {
  const name = (m.buyLocationName || "").trim();
  const url = (m.buyLocationUrl || "").trim();
  if (name || url) return { text: name || url, url: url || null };
  const legacy = splitLegacyBuyLocationReport(m.buyLocation);
  if (!legacy.name && !legacy.url) return null;
  return { text: legacy.name || legacy.url, url: legacy.url || null };
}

export function buildMaterialsPdfHTML({ materials, currentUser, lang }) {
  const exportedAt = new Date().toLocaleString(lang === "vi" ? "vi-VN" : "en-US");
  const rows = (materials || []).map((m, i) => {
    const loc = buyLocationDisplayReport(m);
    return `<tr>
      <td class="num">${i + 1}</td>
      <td>${escapeHtml(m.name || "—")}</td>
      <td class="num">${escapeHtml(formatMaterialPriceReport(m))}</td>
      <td>${loc ? (loc.url ? `<a href="${escapeHtml(loc.url)}">${escapeHtml(loc.text)}</a>` : escapeHtml(loc.text)) : "—"}</td>
      <td>${m.imageUrl ? `<a href="${escapeHtml(m.imageUrl)}">${escapeHtml(t("viewImage"))}</a>` : "—"}</td>
      <td>${escapeHtml(formatMaterialTimeReport(m.updatedAt, lang))}</td>
    </tr>`;
  }).join("");

  return `
  <div class="report-page" id="materialsPrintArea">
    ${reportHead(lang, exportedAt)}
    <div class="report-title">${t("materialsReportTitle")}</div>
    <div class="report-section">
      <table class="report-table-closed">
        <thead><tr>
          <th>${t("no")}</th><th>${t("materialName")}</th><th>${t("price")}</th><th>${t("buyLocation")}</th><th>${t("viewImage")}</th><th>${t("lastUpdated")}</th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="6" style="text-align:center;color:#888;">${t("noMaterials")}</td></tr>`}</tbody>
      </table>
    </div>
    ${reportSignRow(currentUser)}
  </div>`;
}

// ============================================================
// KHỐI LƯỢNG ĐỘI KHOAN (Drill Team Payment) REPORT
// ============================================================
function dtpMoney(val, currency) {
  const n = Number(val) || 0;
  if (currency === "USD") return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toLocaleString("vi-VN") + " ₫";
}
function dtpFormatTotalsReport(totals) {
  const entries = Object.entries(totals || {}).filter(([, v]) => Math.abs(v) > 1e-9 || Object.keys(totals).length === 1);
  if (!entries.length) return [dtpMoney(0, "VND")];
  return entries.map(([cur, v]) => dtpMoney(v, cur));
}

export function buildDrillTeamPaymentPdfHTML({
  project, method, team, drillTeamRep, boreholes, days,
  soilRate, soilCurrency, rockRate, rockCurrency,
  workerCurrency, laborCurrency, startDate, endDate,
  allowanceAmount, allowanceCurrency, advances, totals, currentUser, lang,
}) {
  const exportedAt = new Date().toLocaleString(lang === "vi" ? "vi-VN" : "en-US");
  const totalAdvance = {};
  (advances || []).forEach((a) => { totalAdvance[a.currency] = (totalAdvance[a.currency] || 0) + (Number(a.amount) || 0); });

  let volumeSection, volumeTotalsLine;
  if (method === "contract") {
    const totalSoilM = (boreholes || []).reduce((s, b) => s + (Number(b.soilM) || 0), 0);
    const totalRockM = (boreholes || []).reduce((s, b) => s + (Number(b.rockM) || 0), 0);
    const totalSoilMoney = totalSoilM * soilRate;
    const totalRockMoney = totalRockM * rockRate;
    const rows = (boreholes || []).map((b) => {
      const soilM = Number(b.soilM) || 0, rockM = Number(b.rockM) || 0;
      const soilMoney = soilM * soilRate, rockMoney = rockM * rockRate;
      return `<tr>
        <td>${escapeHtml(b.name || "—")}</td>
        <td class="num">${soilM}</td><td class="num">${dtpMoney(soilRate, soilCurrency)}</td><td class="num">${dtpMoney(soilMoney, soilCurrency)}</td>
        <td class="num">${rockM}</td><td class="num">${dtpMoney(rockRate, rockCurrency)}</td><td class="num">${dtpMoney(rockMoney, rockCurrency)}</td>
        <td class="num">${soilCurrency === rockCurrency ? dtpMoney(soilMoney + rockMoney, soilCurrency) : `${dtpMoney(soilMoney, soilCurrency)} + ${dtpMoney(rockMoney, rockCurrency)}`}</td>
      </tr>`;
    }).join("");
    volumeSection = `
      <div class="report-section">
        <table class="report-table-closed">
          <thead><tr>
            <th>${t("boreholeName")}</th><th>${t("soilM")}</th><th>${t("soilRate")}</th><th>${t("soilMoney")}</th>
            <th>${t("rockM")}</th><th>${t("rockRate")}</th><th>${t("rockMoney")}</th><th>${t("total")}</th>
          </tr></thead>
          <tbody>${rows || `<tr><td colspan="8" style="text-align:center;color:#888;">${t("noCompletedBoreholes")}</td></tr>`}</tbody>
          <tfoot><tr class="report-total-row">
            <td>${t("total")}</td><td class="num">${totalSoilM}</td><td></td><td class="num">${dtpMoney(totalSoilMoney, soilCurrency)}</td>
            <td class="num">${totalRockM}</td><td></td><td class="num">${dtpMoney(totalRockMoney, rockCurrency)}</td>
            <td class="num">${soilCurrency === rockCurrency ? dtpMoney(totalSoilMoney + totalRockMoney, soilCurrency) : `${dtpMoney(totalSoilMoney, soilCurrency)} + ${dtpMoney(totalRockMoney, rockCurrency)}`}</td>
          </tr></tfoot>
        </table>
      </div>`;
    volumeTotalsLine = soilCurrency === rockCurrency
      ? [dtpMoney(totalSoilMoney + totalRockMoney, soilCurrency)]
      : [dtpMoney(totalSoilMoney, soilCurrency), dtpMoney(totalRockMoney, rockCurrency)];
  } else {
    const rows = (days || []).map((d) => {
      const workerMoney = d.workerCount * d.workerRate, laborMoney = d.laborCount * d.laborRate;
      return `<tr>
        <td>${d.dKey.split("-").reverse().join("/")}</td>
        <td class="num">${d.workerCount}</td><td class="num">${dtpMoney(d.workerRate, workerCurrency)}</td><td class="num">${dtpMoney(workerMoney, workerCurrency)}</td>
        <td class="num">${d.laborCount}</td><td class="num">${dtpMoney(d.laborRate, laborCurrency)}</td><td class="num">${dtpMoney(laborMoney, laborCurrency)}</td>
        <td class="num">${workerCurrency === laborCurrency ? dtpMoney(workerMoney + laborMoney, workerCurrency) : `${dtpMoney(workerMoney, workerCurrency)} + ${dtpMoney(laborMoney, laborCurrency)}`}</td>
      </tr>`;
    }).join("");
    const totalWorkerMoney = (days || []).reduce((s, d) => s + d.workerCount * d.workerRate, 0);
    const totalLaborMoney = (days || []).reduce((s, d) => s + d.laborCount * d.laborRate, 0);
    volumeSection = `
      <div class="report-section">
        <table class="report-info-table report-table-closed">
          <tr><td>${t("startDate")}</td><td>${startDate ? startDate.split("-").reverse().join("/") : "—"}</td><td>${t("endDate")}</td><td>${endDate ? endDate.split("-").reverse().join("/") : "—"}</td></tr>
          <tr><td>${t("totalDays")}</td><td colspan="3">${(days || []).length} ${t("days")}</td></tr>
        </table>
      </div>
      <div class="report-section">
        <table class="report-table-closed">
          <thead><tr>
            <th>${t("dateCol")}</th><th>${t("workerCount")}</th><th>${t("workerRate")}</th><th>${t("workerMoney")}</th>
            <th>${t("laborCount")}</th><th>${t("laborRate")}</th><th>${t("laborMoney")}</th><th>${t("dayTotal")}</th>
          </tr></thead>
          <tbody>${rows || `<tr><td colspan="8" style="text-align:center;color:#888;">${t("selectDateRangeFirst")}</td></tr>`}</tbody>
          <tfoot><tr class="report-total-row">
            <td>${t("total")}</td><td></td><td></td><td class="num">${dtpMoney(totalWorkerMoney, workerCurrency)}</td>
            <td></td><td></td><td class="num">${dtpMoney(totalLaborMoney, laborCurrency)}</td>
            <td class="num">${workerCurrency === laborCurrency ? dtpMoney(totalWorkerMoney + totalLaborMoney, workerCurrency) : `${dtpMoney(totalWorkerMoney, workerCurrency)} + ${dtpMoney(totalLaborMoney, laborCurrency)}`}</td>
          </tr></tfoot>
        </table>
      </div>`;
    volumeTotalsLine = workerCurrency === laborCurrency
      ? [dtpMoney(totalWorkerMoney + totalLaborMoney, workerCurrency)]
      : [dtpMoney(totalWorkerMoney, workerCurrency), dtpMoney(totalLaborMoney, laborCurrency)];
  }

  const advanceRows = (advances || []).map((a) => `<tr>
      <td>${a.date ? a.date.split("-").reverse().join("/") : "—"}</td>
      <td class="num">${dtpMoney(a.amount, a.currency)}</td>
      <td>${escapeHtml(a.note || "—")}</td>
    </tr>`).join("");
  const advancesSection = (advances || []).length ? `
    <div class="report-section">
      <table class="report-table-closed">
        <thead><tr><th>${t("advanceDate")}</th><th>${t("advanceAmount")}</th><th>${t("noteCol")}</th></tr></thead>
        <tbody>${advanceRows}</tbody>
      </table>
    </div>` : "";

  return `
  <div class="report-page" id="drillPayPrintArea">
    ${reportHead(lang, exportedAt)}
    <div class="report-title">${method === "contract" ? t("drillPayContractTitle") : t("drillPayDailyTitle")}</div>
    <div class="report-section">
      <table class="report-info-table report-table-closed">
        <tr><td>${t("project")}</td><td>${escapeHtml(project?.name || "—")}</td></tr>
        <tr><td>${t("fieldEngineer")}</td><td>${escapeHtml(project?.siteEngineer || "—")}</td></tr>
        <tr><td>${t("drillTeamLabel")}</td><td>${escapeHtml(team || "—")}</td></tr>
      </table>
    </div>

    ${volumeSection}
    ${advancesSection}

    <div class="report-section dtp-payment-block">
      <table class="report-info-table report-table-closed">
        <tr><td>${t("volumeTotalLabel")}</td><td>${volumeTotalsLine.join("; ")}</td></tr>
        <tr><td>+ ${t("allowanceTitle")}</td><td>${allowanceAmount ? dtpMoney(allowanceAmount, allowanceCurrency) : dtpMoney(0, "VND")}</td></tr>
        <tr><td>− ${t("totalAdvanceLabel")}</td><td>${Object.keys(totalAdvance).length ? Object.entries(totalAdvance).map(([c, v]) => dtpMoney(v, c)).join("; ") : dtpMoney(0, "VND")}</td></tr>
      </table>
      <div class="dtp-grand-final">
        <div class="dtp-grand-final-label">${t("grandTotalFinalLabel")}</div>
        ${dtpFormatTotalsReport(totals).map((line) => `<div class="dtp-grand-final-value">${line}</div>`).join("")}
      </div>
    </div>

    <div class="sign-row" style="grid-template-columns: repeat(2, 1fr);">
      <div>
        <div class="role">${t("preparedBy")}</div>
        <div class="name">${escapeHtml(currentUser?.name || currentUser?.email || "")}</div>
      </div>
      <div>
        <div class="role">${t("drillTeamRepLabel")}</div>
        <div class="name">${escapeHtml(drillTeamRep || "")}${drillTeamRep ? "" : "&nbsp;"}</div>
      </div>
    </div>
  </div>`;
}

// ============================================================
// VẬT TƯ TIÊU HAO (Consumables) REPORT
// ============================================================
export function buildConsumablesReportHTML({ project, items, currentUser, lang }) {
  const exportedAt = new Date().toLocaleString(lang === "vi" ? "vi-VN" : "en-US");
  const rows = [];
  (items || []).forEach((it) => {
    const log = it.dailyLog || {};
    Object.keys(log).sort().forEach((dKey) => {
      const qty = Number(log[dKey]) || 0;
      if (qty <= 0) return;
      rows.push({ dKey, name: it.name, unit: it.unit, qty });
    });
  });
  rows.sort((a, b) => a.dKey === b.dKey ? a.name.localeCompare(b.name) : a.dKey.localeCompare(b.dKey));

  const totalsByItem = {};
  rows.forEach((r) => {
    const key = r.name + "|" + (r.unit || "");
    totalsByItem[key] = (totalsByItem[key] || 0) + r.qty;
  });

  const rowsHtml = rows.map((r) => `<tr>
      <td class="num">${r.dKey.split("-").reverse().join("/")}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.unit || "—")}</td>
      <td class="num">${r.qty}</td>
    </tr>`).join("");

  const totalsRows = Object.entries(totalsByItem).map(([key, total]) => {
    const [name, unit] = key.split("|");
    return `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(unit || "—")}</td><td class="num">${total}</td></tr>`;
  }).join("");

  return `
  <div class="report-page" id="consumablesPrintArea">
    ${reportHead(lang, exportedAt)}
    <div class="report-title">${t("consumablesReportTitle")}</div>
    <div class="report-section">
      <table class="report-info-table report-table-closed">
        <tr><td>${t("project")}</td><td>${escapeHtml(project?.name || "—")}</td></tr>
      </table>
    </div>
    <div class="report-section">
      <div class="section-title">${t("consumablesTotalTitle")}</div>
      <table class="report-table-closed">
        <thead><tr><th>${t("materialName")}</th><th>${t("unitLabel")}</th><th>${t("totalQty")}</th></tr></thead>
        <tbody>${totalsRows || `<tr><td colspan="3" style="text-align:center;color:#888;">${t("noConsumables")}</td></tr>`}</tbody>
      </table>
    </div>
    <div class="report-section">
      <div class="section-title">${t("consumablesDailyTitle")}</div>
      <table class="report-table-closed">
        <thead><tr><th>${t("reportDate")}</th><th>${t("materialName")}</th><th>${t("unitLabel")}</th><th>${t("quantity")}</th></tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="4" style="text-align:center;color:#888;">${t("noConsumables")}</td></tr>`}</tbody>
      </table>
    </div>
    ${reportSignRow(currentUser)}
  </div>`;
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
