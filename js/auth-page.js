import {
  auth, db,
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updateProfile, doc, setDoc, getDoc, getDocs, collection, serverTimestamp,
} from "./firebase.js";
import { applyI18n, getLang, setLang, t } from "./i18n.js";
import { initTheme, toggleTheme, getTheme } from "./theme.js";

initTheme();
applyI18n();
document.getElementById("themeToggle").textContent = getTheme() === "dark" ? "🌙" : "☀️";
document.querySelectorAll("#langToggle button").forEach((b) => {
  b.classList.toggle("active", b.dataset.lang === getLang());
  b.addEventListener("click", () => {
    setLang(b.dataset.lang);
    applyI18n();
    document.querySelectorAll("#langToggle button").forEach((x) => x.classList.toggle("active", x.dataset.lang === b.dataset.lang));
  });
});
document.getElementById("themeToggle").addEventListener("click", () => {
  const th = toggleTheme();
  document.getElementById("themeToggle").textContent = th === "dark" ? "🌙" : "☀️";
});

// redirect if already logged in
onAuthStateChanged(auth, (user) => {
  if (user) window.location.href = "app.html";
});

const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
document.getElementById("showRegister").addEventListener("click", () => {
  loginForm.classList.add("hidden");
  registerForm.classList.remove("hidden");
  document.getElementById("toRegisterLine").classList.add("hidden");
  document.getElementById("toLoginLine").classList.remove("hidden");
});
document.getElementById("showLogin").addEventListener("click", () => {
  registerForm.classList.add("hidden");
  loginForm.classList.remove("hidden");
  document.getElementById("toLoginLine").classList.add("hidden");
  document.getElementById("toRegisterLine").classList.remove("hidden");
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const pass = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("loginError");
  errEl.textContent = "";
  const btn = document.getElementById("loginBtn");
  btn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    window.location.href = "app.html";
  } catch (err) {
    errEl.textContent = friendlyError(err);
  } finally {
    btn.disabled = false;
  }
});

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("regName").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const pass = document.getElementById("regPassword").value;
  const pass2 = document.getElementById("regPassword2").value;
  const errEl = document.getElementById("registerError");
  errEl.textContent = "";
  if (pass !== pass2) {
    errEl.textContent = t("password") + " " + (getLang() === "vi" ? "không khớp" : "does not match");
    return;
  }
  const btn = document.getElementById("registerBtn");
  btn.disabled = true;
  try {
    // Is this the very first user in the system? If so, make them admin.
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
await updateProfile(cred.user, { displayName: name });

// Là người đầu tiên trong hệ thống? Nếu đúng thì tự động là Admin.
const usersSnap = await getDocs(collection(db, "users"));
const isFirstUser = usersSnap.empty;

await setDoc(doc(db, "users", cred.user.uid), {
      name,
      email,
      role: isFirstUser ? "admin" : "engineer",
      createdAt: serverTimestamp(),
    });
    window.location.href = "app.html";
  } catch (err) {
    errEl.textContent = friendlyError(err);
  } finally {
    btn.disabled = false;
  }
});

function friendlyError(err) {
  const code = err.code || "";
  const vi = getLang() === "vi";
  if (code.includes("auth/invalid-credential") || code.includes("auth/wrong-password") || code.includes("auth/user-not-found"))
    return vi ? "Email hoặc mật khẩu không đúng." : "Incorrect email or password.";
  if (code.includes("auth/email-already-in-use"))
    return vi ? "Email này đã được đăng ký." : "This email is already registered.";
  if (code.includes("auth/weak-password"))
    return vi ? "Mật khẩu cần tối thiểu 6 ký tự." : "Password must be at least 6 characters.";
  if (code.includes("auth/invalid-email"))
    return vi ? "Email không hợp lệ." : "Invalid email address.";
  if (code.includes("auth/configuration-not-found") || code.includes("auth/api-key"))
    return vi ? "Chưa cấu hình Firebase đúng. Xem lại firebase-config.js." : "Firebase is not configured correctly. Check firebase-config.js.";
  return err.message || (vi ? "Đã xảy ra lỗi." : "Something went wrong.");
}
