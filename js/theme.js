// ============================================================
// theme.js — Chế độ sáng / tối
// ============================================================
export function getTheme() {
  return localStorage.getItem("sh_theme") || "dark";
}
export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("sh_theme", theme);
}
export function initTheme() {
  applyTheme(getTheme());
}
export function toggleTheme() {
  const cur = getTheme();
  applyTheme(cur === "dark" ? "light" : "dark");
  return getTheme();
}
