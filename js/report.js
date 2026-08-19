import { sumDailyLog } from "./store.js";
import { t } from "./i18n.js";

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
      assignee: s.assignee || "—",
      contract, today, total, pct,
      type: "survey",
    });
  });
  // Ưu tiên hạng mục đang thực hiện lên đầu báo cáo, rồi tới chưa bắt đầu, hoàn thành xuống cuối.
  rows.sort((a, b) => {
    const rank = (r) => (r.pct > 0 && r.pct < 100 ? 0 : r.pct <= 0 ? 1 : 2);
    return rank(a) - rank(b);
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
           <td>${escapeHtml(r.label)}</td>
           <td class="num">${escapeHtml(r.coordN || "—")}</td>
           <td class="num">${escapeHtml(r.coordE || "—")}</td>
           <td class="num">${escapeHtml(r.elevation || "—")}</td>
           <td class="num">${escapeHtml(r.waterLevel || "—")}</td>
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
        <div class="progress-bar"><div style="width:${Math.max(overallPct, overallPct > 0 ? 1 : 0).toFixed(0)}%"></div></div>
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
        const table = child.querySelector("table");
        const hasRows = table && table.querySelectorAll("tbody tr").length > 0;
        if (hasRows) {
          // Keep filling the current page (if any) with as many rows as fit, then
          // continue on fresh pages — rather than always pushing the whole table
          // onto a new page and leaving the current one mostly blank.
          const firstPieceTop = pageHasContent ? pageTop : childTop;
          const firstPieceBudgetBottom = firstPieceTop + usableHeightPx;
          pieces.push(...splitTableSection(child, table, elRect.top, usableHeightPx, childTop, childBottom, firstPieceTop, firstPieceBudgetBottom));
          pageHasContent = false;
        } else if (childHeight > usableHeightPx) {
          flushPage();
          pieces.push({ top: childTop, bottom: childBottom, headerRect: null }); // oversized, nothing to split by — best effort
        } else {
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

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
