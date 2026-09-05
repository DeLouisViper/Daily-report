import {
  db, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  collection, query, orderBy, onSnapshot, serverTimestamp, deleteField,
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
// Xuất/Nhập dự án dạng JSON — gồm thông tin dự án + toàn bộ hố khoan + hạng mục khảo sát.
export async function getProjectFullData(projectId) {
  const project = await getProject(projectId);
  const [bhSnap, svSnap] = await Promise.all([
    getDocs(collection(db, "projects", projectId, "boreholes")),
    getDocs(collection(db, "projects", projectId, "surveyItems")),
  ]);
  const boreholes = bhSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const surveyItems = svSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return { project, boreholes, surveyItems };
}
export async function importProjectFullData(data, user) {
  const src = data.project || {};
  const projectData = { ...src };
  delete projectData.id;
  delete projectData.createdAt;
  delete projectData.updatedAt;
  delete projectData.createdBy;
  delete projectData.createdByName;
  const newId = await createProject(projectData, user);
  for (const b of data.boreholes || []) {
    const bd = { ...b };
    delete bd.id; delete bd.createdAt; delete bd.updatedAt;
    await addDoc(collection(db, "projects", newId, "boreholes"), { ...bd, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
  for (const s of data.surveyItems || []) {
    const sd = { ...s };
    delete sd.id; delete sd.createdAt; delete sd.updatedAt;
    await addDoc(collection(db, "projects", newId, "surveyItems"), { ...sd, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
  await logActivity(newId, user, "created", `${projectData.name || "project"} (imported)`);
  return newId;
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
// Xóa đúng 1 ngày trong nhật ký khối lượng (không mất dữ liệu các ngày khác).
export async function resetBoreholeDay(projectId, id, dKey, user, label) {
  await updateDoc(doc(db, "projects", projectId, "boreholes", id), {
    [`dailyLog.${dKey}`]: deleteField(),
    updatedAt: serverTimestamp(),
  });
  await logActivity(projectId, user, "updated", `${label}: reset ${dKey}`);
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
// Xóa đúng 1 ngày trong nhật ký khối lượng (không mất dữ liệu các ngày khác).
export async function resetSurveyItemDay(projectId, id, dKey, user, label) {
  await updateDoc(doc(db, "projects", projectId, "surveyItems", id), {
    [`dailyLog.${dKey}`]: deleteField(),
    updatedAt: serverTimestamp(),
  });
  await logActivity(projectId, user, "updated", `${label}: reset ${dKey}`);
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

// ---------- Drilling machines (Nhật ký máy khoan) ----------
export function watchDrillingMachines(projectId, cb) {
  const q = query(collection(db, "projects", projectId, "drillingMachines"), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
export async function addDrillingMachine(projectId, data, user) {
  await addDoc(collection(db, "projects", projectId, "drillingMachines"), {
    ...data,
    dailyLogs: {},
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await logActivity(projectId, user, "created", `Máy khoan ${data.name}`);
}
export async function updateDrillingMachine(projectId, id, data, user, label) {
  await updateDoc(doc(db, "projects", projectId, "drillingMachines", id), { ...data, updatedAt: serverTimestamp() });
  await logActivity(projectId, user, "updated", label);
}
export async function deleteDrillingMachine(projectId, id, user, label) {
  await deleteDoc(doc(db, "projects", projectId, "drillingMachines", id));
  await logActivity(projectId, user, "deleted", label);
}
// Lưu nhật ký của 1 ngày cho 1 máy khoan (không đụng tới các ngày khác).
export async function saveDrillingMachineDayLog(projectId, id, dKey, logData, user, label) {
  await updateDoc(doc(db, "projects", projectId, "drillingMachines", id), {
    [`dailyLogs.${dKey}`]: logData,
    updatedAt: serverTimestamp(),
  });
  await logActivity(projectId, user, "updated", `${label} (${dKey})`);
}
// Lưu đúng 1 trường trong nhật ký của 1 ngày (tránh ghi đè các trường khác).
export async function updateDrillingMachineField(projectId, id, dKey, field, value, user, label) {
  await updateDoc(doc(db, "projects", projectId, "drillingMachines", id), {
    [`dailyLogs.${dKey}.${field}`]: value,
    updatedAt: serverTimestamp(),
  });
  await logActivity(projectId, user, "updated", `${label} (${dKey})`);
}

// ---------- Equipment Check In / Check Out ----------
// Mỗi lượt "xuất kho" cho 1 dự án là 1 document trong projects/{id}/equipmentLogs.
// Khi thu hồi (check-in), ta cập nhật field "checkin" ngay trên document đó,
// không tạo doc mới, để lịch sử luôn gắn liền 1 cặp xuất-nhập.
export function watchEquipmentLogs(projectId, cb) {
  const q = query(collection(db, "projects", projectId, "equipmentLogs"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
export async function getEquipmentLog(projectId, logId) {
  const snap = await getDoc(doc(db, "projects", projectId, "equipmentLogs", logId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
// Lấy lượt xuất kho gần nhất của MỘT dự án bất kỳ (kể cả dự án khác) để "Lặp lại dự án trước".
export async function getLatestEquipmentLog(projectId) {
  const q = query(collection(db, "projects", projectId, "equipmentLogs"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}
export async function createEquipmentCheckout(projectId, items, user) {
  const ref = await addDoc(collection(db, "projects", projectId, "equipmentLogs"), {
    items,
    createdAt: serverTimestamp(),
    createdBy: user?.name || user?.email || "—",
    checkin: null,
  });
  await logActivity(projectId, user, "created", `Xuất kho thiết bị (${items.length} mục)`);
  return ref.id;
}
export async function updateEquipmentCheckout(projectId, logId, items, user) {
  await updateDoc(doc(db, "projects", projectId, "equipmentLogs", logId), { items });
  await logActivity(projectId, user, "updated", `Xuất kho thiết bị (${items.length} mục)`);
}
export async function saveEquipmentCheckin(projectId, logId, checkinItems, user) {
  await updateDoc(doc(db, "projects", projectId, "equipmentLogs", logId), {
    checkin: {
      items: checkinItems,
      checkedInAt: serverTimestamp(),
      checkedInBy: user?.name || user?.email || "—",
    },
  });
  await logActivity(projectId, user, "updated", `Nhập kho thiết bị (${checkinItems.length} mục)`);
}
export async function deleteEquipmentLog(projectId, logId, user) {
  await deleteDoc(doc(db, "projects", projectId, "equipmentLogs", logId));
  await logActivity(projectId, user, "deleted", "Phiếu xuất/nhập thiết bị");
}

// ---------- Materials Price List (Bảng giá vật tư) ----------
// Danh sách giá vật tư/thiết bị dùng CHUNG cho toàn hệ thống (không theo từng
// dự án, vì giá vật tư thường không đổi theo dự án). Mỗi lần sửa giá sẽ cập
// nhật "updatedAt" để biết giá được xác nhận gần nhất vào lúc nào.
export function watchMaterials(cb) {
  const q = query(collection(db, "materials"), orderBy("name"));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
export async function addMaterial(data, user) {
  const ref = await addDoc(collection(db, "materials"), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user?.name || user?.email || "—",
    updatedBy: user?.name || user?.email || "—",
  });
  return ref.id;
}
export async function updateMaterial(id, data, user) {
  await updateDoc(doc(db, "materials", id), {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: user?.name || user?.email || "—",
  });
}
export async function deleteMaterial(id) {
  await deleteDoc(doc(db, "materials", id));
}

// ---------- Khối lượng đội khoan (Drill Team Payment) ----------
// Mỗi lần lập bảng thanh toán được lưu thành 1 document để có thể tra cứu lại
// sau này (mở rộng lịch sử thanh toán trong tương lai theo yêu cầu).
export function watchDrillTeamPayments(projectId, cb) {
  const q = query(collection(db, "projects", projectId, "drillTeamPayments"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
export async function saveDrillTeamPayment(projectId, data, user) {
  const ref = await addDoc(collection(db, "projects", projectId, "drillTeamPayments"), {
    ...data,
    createdAt: serverTimestamp(),
    createdBy: user?.name || user?.email || "—",
  });
  await logActivity(projectId, user, "created", `Bảng khối lượng đội khoan (${data.team || "—"})`);
  return ref.id;
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
