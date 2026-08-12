[README.md](https://github.com/user-attachments/files/30963622/README.md)
# Daily Report — Quy trình hiện trường

Web app quản lý dự án khảo sát (Địa chất & Địa hình), báo cáo ngày dạng A4, xuất PDF, 2 ngôn ngữ Việt/Anh, chế độ sáng/tối. Chạy hoàn toàn tĩnh (HTML/CSS/JS thuần, không cần build, không cần cài Node.js), dữ liệu lưu trên **Firebase** (Auth + Firestore — **không dùng Firebase Storage** nên không cần nâng cấp gói trả phí Blaze), host miễn phí trên **GitHub Pages**.

Hướng dẫn dưới đây viết cho người **chưa từng dùng Firebase hay GitHub**. Làm theo đúng thứ tự nhé.

---

## MỤC LỤC
1. Tạo dự án Firebase
2. Bật Authentication (đăng nhập)
3. Tạo Firestore Database (lưu dữ liệu)
4. Lấy cấu hình Firebase và dán vào code
5. Thiết lập Quy tắc bảo mật (Security Rules)
6. Đưa code lên GitHub
7. Bật GitHub Pages để chạy app
8. Sử dụng app lần đầu (tạo tài khoản admin)
9. Hướng dẫn sử dụng các chức năng
10. Xử lý lỗi thường gặp

---

## 1. Tạo dự án Firebase

1. Vào https://console.firebase.google.com, đăng nhập bằng tài khoản Google.
2. Bấm **"Add project" / "Thêm dự án"**.
3. Đặt tên, ví dụ `surveyhub`. Bấm **Continue**.
4. Tắt Google Analytics (không cần thiết) → bấm **Create project**.
5. Đợi vài giây, bấm **Continue** để vào trang quản lý dự án.

## 2. Bật Authentication (đăng nhập)

1. Trong menu bên trái, chọn **Build → Authentication**.
2. Bấm **Get started**.
3. Trong tab **Sign-in method**, chọn **Email/Password**.
4. Bật (Enable) công tắc đầu tiên → **Save**.

## 3. Tạo Firestore Database (lưu dữ liệu)

1. Menu bên trái → **Build → Firestore Database**.
2. Bấm **Create database**.
3. Chọn **Start in production mode** → **Next**.
4. Chọn vị trí server gần nhất (ví dụ `asia-southeast1`) → **Enable**.

## 4. Lấy cấu hình Firebase và dán vào code

1. Menu bên trái, bấm biểu tượng **⚙ (Project settings)** cạnh "Project Overview".
2. Kéo xuống mục **Your apps** → bấm biểu tượng **`</>`** (Web).
3. Đặt tên app, ví dụ `surveyhub-web` → bấm **Register app** (không cần tick Hosting).
4. Firebase sẽ hiện đoạn code `firebaseConfig = {...}`. Copy toàn bộ đoạn này.
5. Mở file **`js/firebase-config.js`** trong code đã tải về, dán đè vào phần `firebaseConfig`, ví dụ:

```js
export const firebaseConfig = {
  apiKey: "AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxx",
  authDomain: "surveyhub-xxxxx.firebaseapp.com",
  projectId: "surveyhub-xxxxx",
  storageBucket: "surveyhub-xxxxx.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef123456",
};
```

6. Lưu file lại.

## 5. Thiết lập Quy tắc bảo mật (Security Rules)

Vào **Firestore Database → tab Rules**, xóa hết nội dung, dán đoạn sau, rồi bấm **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isSignedIn() { return request.auth != null; }
    function myRole() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role;
    }
    function isAdmin() { return isSignedIn() && myRole() == 'admin'; }
    function canEdit() { return isSignedIn() && (myRole() == 'admin' || myRole() == 'engineer'); }

    match /users/{uid} {
      allow read: if isSignedIn();
      allow create: if isSignedIn() && request.auth.uid == uid;
      allow update: if isSignedIn() && (request.auth.uid == uid || isAdmin());
      allow delete: if isAdmin();
    }

    match /projects/{projectId} {
      allow read: if isSignedIn();
      allow create: if canEdit();
      allow update: if canEdit();
      allow delete: if isAdmin();

      match /boreholes/{id} {
        allow read: if isSignedIn();
        allow write: if canEdit();
      }
      match /surveyItems/{id} {
        allow read: if isSignedIn();
        allow write: if canEdit();
      }
      match /activity/{id} {
        allow read: if isSignedIn();
        allow create: if isSignedIn();
      }
    }
  }
}
```

---

## 6. Đưa code lên GitHub

1. Vào https://github.com, đăng nhập / tạo tài khoản nếu chưa có.
2. Bấm nút **+** góc trên phải → **New repository**.
3. Đặt tên repo, ví dụ `surveyhub`. Để chế độ **Public**. Bấm **Create repository**.
4. Trên trang repo vừa tạo, bấm nút **"uploading an existing file"** (hoặc "Add file → Upload files").
5. Mở thư mục project trên máy anh, **kéo thả toàn bộ file và thư mục** (`index.html`, `app.html`, `css/`, `js/`, `README.md`, …) vào khung upload của GitHub.
6. Kéo xuống, bấm **Commit changes**.

> Cách khác (nếu anh biết dùng Git/terminal):
> ```bash
> git init
> git add .
> git commit -m "Daily Report initial commit"
> git branch -M main
> git remote add origin https://github.com/<tên-tài-khoản>/surveyhub.git
> git push -u origin main
> ```

## 7. Bật GitHub Pages để chạy app

1. Trong repo trên GitHub, vào tab **Settings**.
2. Menu bên trái chọn **Pages**.
3. Ở mục **Build and deployment → Source**, chọn **Deploy from a branch**.
4. Ở mục **Branch**, chọn `main` và thư mục `/ (root)` → bấm **Save**.
5. Đợi khoảng 1-2 phút, tải lại trang, GitHub sẽ hiện link dạng:
   `https://<tên-tài-khoản>.github.io/surveyhub/`
6. Bấm vào link đó — app đã chạy!

### Cho phép domain GitHub Pages đăng nhập được Firebase
1. Quay lại Firebase Console → **Authentication → Settings → Authorized domains**.
2. Bấm **Add domain**, nhập: `<tên-tài-khoản>.github.io` → **Add**.

(File `.github/workflows/deploy.yml` đi kèm cũng tự động deploy lại mỗi khi anh cập nhật code và push lên nhánh `main` — không bắt buộc, GitHub Pages ở bước trên đã đủ dùng.)

---

## 8. Sử dụng app lần đầu (tạo tài khoản admin)

1. Mở link app → bấm **"Đăng ký ngay"**.
2. Điền họ tên, email, mật khẩu → **Tạo tài khoản**.
3. **Người đăng ký đầu tiên sẽ tự động là Quản trị viên (Admin)** — có toàn quyền, kể cả xóa dự án và phân quyền cho người khác.
4. Những người đăng ký sau sẽ mặc định là **Kỹ sư (Engineer)** — có thể tạo/sửa dự án nhưng không xóa được và không phân quyền được.
5. Admin vào **Cài đặt → Quản lý người dùng** để đổi quyền (Admin / Kỹ sư / Người xem) cho từng thành viên.

---

## 9. Hướng dẫn sử dụng các chức năng

- **Tổng quan**: số liệu nhanh về số dự án, hạng mục.
- **Dự án hiện tại**: bấm **"+ Dự án mới"** để tạo dự án — nhập tên, vị trí, kỹ sư hiện trường, người phụ trách, tick chọn Khảo sát địa chất/Địa hình, tải ảnh vị trí. Bấm vào 1 thẻ dự án để xem chi tiết.
- Trong trang chi tiết dự án có các tab:
  - **Khảo sát địa chất**: bấm "+ Thêm hố khoan" để tạo hố khoan mới với đầy đủ thông tin đội khoan, ngày, khối lượng hợp đồng, tọa độ... Mỗi ngày kỹ sư chỉ cần nhập số vào ô **"Khối lượng hoàn thành hôm nay"**, app tự cộng dồn và tính % hoàn thành.
  - **Khảo sát địa hình**: bấm "+ Thêm hạng mục", chọn loại hạng mục có sẵn (Đổ mốc, Chôn mốc, Kiểm tra mốc, Dẫn thủy chuẩn, Đo RTK, Đo công trình ngầm, Bay drone), nhập khối lượng hợp đồng. Mỗi ngày nhập số lượng hoàn thành hôm nay tương tự.
  - **Báo cáo ngày**: chọn dự án + ngày, app hiển thị báo cáo A4 đầy đủ: thông tin dự án, bảng khối lượng từng hạng mục, tiến độ chung, danh sách hạng mục còn thiếu, ảnh vị trí, nhật ký hoạt động trong ngày, và mục ký tên (Người lập / Người kiểm tra / Trưởng phòng).
- **Xuất PDF / In**: bấm nút **"Xuất PDF / In"** trong trang Báo cáo ngày để tải file PDF khổ A4 về máy.
- **Sao chép tóm tắt**: copy nhanh nội dung tóm tắt tiến độ dạng văn bản (dùng để dán vào Zalo/email).
- **Nhật ký**: xem toàn bộ lịch sử ai đã tạo/sửa/xóa gì, lúc nào, theo từng dự án.
- **Cài đặt**: đổi ngôn ngữ VI/EN, đổi chế độ sáng/tối, và (chỉ Admin) quản lý phân quyền thành viên.
- App **tự động lưu** ngay khi anh nhập/chỉnh sửa — góc dưới bên trái màn hình sẽ hiện chữ "Đã lưu lúc ...".

### Phân quyền
| Quyền | Tạo/sửa dự án & hạng mục | Xóa dự án | Quản lý người dùng |
|---|---|---|---|
| Admin | ✅ | ✅ | ✅ |
| Kỹ sư (Engineer) | ✅ | ❌ | ❌ |
| Người xem (Viewer) | ❌ (chỉ xem) | ❌ | ❌ |

---

## 10. Xử lý lỗi thường gặp

- **"Chưa cấu hình Firebase đúng"**: kiểm tra lại `js/firebase-config.js` đã dán đúng thông tin từ Firebase Console chưa.
- **Đăng nhập báo lỗi / không tạo được tài khoản**: kiểm tra đã bật **Email/Password** ở bước 2 chưa, và domain GitHub Pages đã được thêm vào **Authorized domains** chưa (bước 7).
- **Không lưu được dữ liệu / màn hình trắng**: mở Firestore Rules (bước 5), đảm bảo đã **Publish** đúng nội dung.
- **Ảnh vị trí dự án không hiện lên / báo lỗi khi tải ảnh**: ảnh được nén và lưu thẳng trong Firestore (không dùng Firebase Storage), nên chỉ cần Firestore Rules ở bước 5 là đủ. Nếu ảnh gốc quá lớn hoặc mạng chậm, đợi vài giây để app nén ảnh xong rồi mới bấm **Lưu**.
- **Sửa code xong không thấy thay đổi trên web**: GitHub Pages có thể mất 1-2 phút để cập nhật, hoặc bấm Ctrl+Shift+R để xóa cache trình duyệt.

---

## Cấu trúc thư mục

```
surveyhub/
├── index.html          # Trang đăng nhập / đăng ký
├── app.html             # Ứng dụng chính (sau khi đăng nhập)
├── css/style.css        # Toàn bộ giao diện + style báo cáo A4
├── js/
│   ├── firebase-config.js  # ⚠️ Dán key Firebase của anh vào đây
│   ├── firebase.js         # Khởi tạo Firebase
│   ├── store.js            # Đọc/ghi dữ liệu Firestore + nén ảnh sang base64
│   ├── i18n.js              # Từ điển Việt/Anh
│   ├── theme.js             # Chế độ sáng/tối
│   ├── auth-page.js         # Logic trang đăng nhập
│   ├── main.js               # Logic toàn bộ app sau đăng nhập
│   └── report.js             # Tạo báo cáo A4 + xuất PDF
└── .github/workflows/deploy.yml  # (tuỳ chọn) tự động deploy GitHub Pages
```

Chúc anh triển khai thành công! Nếu cần chỉnh sửa thêm tính năng, chỉ cần sửa trực tiếp các file `.js`/`.css` rồi upload lại lên GitHub.
