import {
  db, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  collection, query, orderBy, onSnapshot, serverTimestamp,
} from "./firebase.js";

// ---------- Users ----------
export async function getUserDoc(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
export function watchUsers(cb) {
  return onSnapshot(collection(db, "users"), (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}
export async function setUserRole(uid, role) {
  await updateDoc(doc(db, "users", uid), { role });
}

// ---------- Projects ----------
export function watchProjects(cb) {
  const q = query(collection(db, "projects"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}
export async function getProject(id) {
  const snap = await getDoc(doc(db, "projects", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
export async function createProject(data, user) {
  const ref_ = await addDoc(collection(db, "projects"), {
    ...data,
    createdBy: user.uid,
    createdByName: user.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await logActivity(ref_.id, user, "created", data.name);
  return ref_.id;
}
export async function updateProject(id, data, user, itemLabel) {
  await updateDoc(doc(db, "projects", id), { ...data, updatedAt: serverTimestamp() });
  await logActivity(id, user, "updated", itemLabel || data.name || "project info");
}
export async function deleteProject(id) {
  await deleteDoc(doc(db, "projects", id));
}
// Kế hoạch ngày tiếp theo — lưu theo từng ngày trong 1 map trên chính document dự án.
export async function updateNextDayPlan(projectId, dKey, text, user) {
  await updateDoc(doc(db, "projects", projectId), {
    [`nextDayPlan.${dKey}`]: text,
    updatedAt: serverTimestamp(),
  });
  await logActivity(projectId, user, "updated", `Next day plan (${dKey})`);
}
// Ảnh vị trí dự án được nén nhỏ ngay trên trình duyệt và lưu thẳng vào Firestore
// dưới dạng chuỗi base64 (KHÔNG dùng Firebase Storage, nên không cần nâng cấp gói Blaze).
export function resizeImageToDataUrl(file, maxWidth = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Không đọc được file ảnh"));
    reader.onload = () => {
      img.onerror = () => reject(new Error("Ảnh không hợp lệ"));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------- Boreholes (Soil investigation) ----------
export function watchBoreholes(projectId, cb) {
  const q = query(collection(db, "projects", projectId, "boreholes"), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
export async function addBorehole(projectId, data, user) {
  await addDoc(collection(db, "projects", projectId, "boreholes"), {
    ...data,
    dailyLog: {},
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await logActivity(projectId, user, "created", `Hố khoan ${data.name}`);
}
export async function updateBorehole(projectId, id, data, user, label) {
  await updateDoc(doc(db, "projects", projectId, "boreholes", id), { ...data, updatedAt: serverTimestamp() });
  await logActivity(projectId, user, "updated", label);
}
export async function deleteBorehole(projectId, id, user, label) {
  await deleteDoc(doc(db, "projects", projectId, "boreholes", id));
  await logActivity(projectId, user, "deleted", label);
}

// ---------- Survey items ----------
export function watchSurveyItems(projectId, cb) {
  const q = query(collection(db, "projects", projectId, "surveyItems"), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
export async function addSurveyItem(projectId, data, user) {
  await addDoc(collection(db, "projects", projectId, "surveyItems"), {
    ...data,
    dailyLog: {},
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await logActivity(projectId, user, "created", data.type);
}
export async function updateSurveyItem(projectId, id, data, user, label) {
  await updateDoc(doc(db, "projects", projectId, "surveyItems", id), { ...data, updatedAt: serverTimestamp() });
  await logActivity(projectId, user, "updated", label);
}
export async function deleteSurveyItem(projectId, id, user, label) {
  await deleteDoc(doc(db, "projects", projectId, "surveyItems", id));
  await logActivity(projectId, user, "deleted", label);
}

// ---------- Activity log ----------
export async function logActivity(projectId, user, action, itemLabel) {
  try {
    await addDoc(collection(db, "projects", projectId, "activity"), {
      userName: user.name || user.email || "—",
      action,
      itemLabel: itemLabel || "",
      ts: serverTimestamp(),
    });
  } catch (e) {
    console.warn("activity log failed", e);
  }
}
export function watchActivity(projectId, cb, max = 100) {
  const q = query(collection(db, "projects", projectId, "activity"), orderBy("ts", "desc"));
  return onSnapshot(q, (snap) => cb(snap.docs.slice(0, max).map((d) => ({ id: d.id, ...d.data() }))));
}

// ---------- Helpers ----------
export function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function sumDailyLog(dailyLog) {
  if (!dailyLog) return 0;
  return Object.values(dailyLog).reduce((a, b) => a + (Number(b) || 0), 0);
}
