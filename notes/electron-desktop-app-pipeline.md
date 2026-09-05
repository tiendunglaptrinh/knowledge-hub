# Từ source code tới icon trên Desktop — pipeline đóng gói Electron

> Ghi chú thực chiến, viết ngày **01/08/2026**, dựa trên lần dựng thật ứng dụng Knowledge Hub
> trên máy WSL2 + Windows 11.
>
> Bản tài liệu được bảo trì nằm ở `docs/09-development.md` và `docs/13-distribution.md` trong
> repo. File này là ảnh chụp tại một thời điểm — nếu thấy khác code thì tin repo.

---

## Vấn đề

Có source code TypeScript chạy được bằng `npm run dev`. Cần biến nó thành **một icon trên
Desktop**, bấm vào là chạy, không cần terminal, không cần cài Node.

Nghe đơn giản. Thực tế vướng ba chỗ mà không tài liệu nào nói trước.

---

## Toàn cảnh

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  A. BUILD  —  từ source thành thứ Windows chạy được                          ║
╚══════════════════════════════════════════════════════════════════════════════╝

  /home/app/knowledge-hub   (WSL / ext4 — nhanh, để code)
  │
  │  ┌─ src/main + src/preload ──────────────────────────────────────────┐
  ├─▶│ esbuild → dist/main/*.js                                          │
  │  │ CORE: bundle TS thành CommonJS. Native/nặng để "external"         │
  │  │       (electron, better-sqlite3, mammoth) — .node không bundle    │
  │  │       được, và NODE_ENV cố ý KHÔNG inline để runtime tự quyết     │
  │  └───────────────────────────────────────────────────────────────────┘
  │
  │  ┌─ renderer/ (Next.js) ─────────────────────────────────────────────┐
  ├─▶│ next build → renderer/out/*.html + *.js                           │
  │  │ CORE: static export. App đóng gói KHÔNG có Node server —          │
  │  │       UI là HTML tĩnh, nói chuyện với backend qua IPC, không HTTP │
  │  └───────────────────────────────────────────────────────────────────┘
  │
  │  ┌─ scripts/make-icon.mjs ───────────────────────────────────────────┐
  └─▶│ → build/icon.ico                                                  │
     │ CORE: tự vẽ pixel + tự encode PNG (zlib+CRC32), rồi bọc PNG       │
     │       vào vỏ ICO. Không thêm dependency ảnh nào                   │
     └───────────────────────────────────────────────────────────────────┘
                                   │
                    rsync (bỏ node_modules, data, .git)
                    CORE: build Windows phải chạy TRÊN Windows.
                          Cross-compile cần Wine → không có
                                   ▼
  D:\dev\knowledge-hub   (đường dẫn Windows — chỉ để build)
  │
  ├─▶ npm install --ignore-scripts
  │   CORE: chặn better-sqlite3 tự build cho ABI của Node 24
  │         → không có prebuilt → rơi xuống node-gyp → cần Python + VS
  │         Ta không cần bản Node. Ta cần bản Electron.
  │
  ├─▶ electron-builder install-app-deps
  │   CORE: kéo đúng prebuilt electron-v133-win32-x64
  │         (Electron 35 = ABI 133). KHÔNG cần compiler.
  │
  ├─▶ [gỡ kẹt] giải nén sẵn winCodeSign, bỏ cờ -snld
  │   CORE: gói ký số chứa 2 symlink .dylib của macOS; tạo symlink trên
  │         Windows cần quyền admin. Bỏ cờ đó → skip 2 file vô dụng
  │
  └─▶ electron-builder --win --x64 --dir
      CORE: gộp [Electron runtime] + [app.asar] + [.node để ngoài asar]
            rcedit nhúng icon.ico vào exe
                                   ▼
                    release\win-unpacked\Knowledge Hub.exe


╔══════════════════════════════════════════════════════════════════════════════╗
║  B. DEPLOY  —  3 thứ tách rời nhau, cố ý                                     ║
╚══════════════════════════════════════════════════════════════════════════════╝

  D:\Apps\Knowledge Hub\          ◀── APP    (xoá được, cài lại được)
      Knowledge Hub.exe
      .env          → KB_DATA_DIR=D:\KnowledgeHub
      portable.txt  → CORE: đánh dấu "vault nằm cạnh app", opt-in
                            (mặc định của bản phát hành là %APPDATA%)

  D:\KnowledgeHub\                ◀── DATA   (không bao giờ bị build/gỡ đụng tới)
      knowledge.db  + assets/
      CORE: vòng đời dữ liệu ≠ vòng đời code

  Desktop\Knowledge Hub.lnk       ◀── LỐI VÀO
      CORE: PowerShell + COM WScript.Shell tạo shortcut
            target = exe, icon lấy từ chính exe (,0)


╔══════════════════════════════════════════════════════════════════════════════╗
║  C. RUNTIME  —  chuyện gì xảy ra khi click                                   ║
╚══════════════════════════════════════════════════════════════════════════════╝

  click .lnk
     ▼
  registerAppScheme()      CORE: phải chạy TRƯỚC app.whenReady() —
                                 Chromium đọc bảng quyền lúc khởi động
     ▼
  loadConfig()             CORE: đọc .env CẠNH exe (không phải trong asar,
                                 vì trong asar user không sửa được)
     ▼
  createContainer()        CORE: thứ tự bắt buộc —
     │                           ① tạo + thử ghi vault  ② mở SQLite + migrate
     │                           đảo lại = DB tạo ok nhưng không lưu file được
     ▼
  ┌──────────────────────────────┬───────────────────────────────────────────┐
  │  MAIN PROCESS (full Node)    │   RENDERER (sandbox, KHÔNG có Node)       │
  │  SQLite · vault · docx→html  │   app://kb/index.html  ← HTML tĩnh        │
  └──────────────┬───────────────┴─────────────────┬─────────────────────────┘
                 │        preload bridge           │
                 └──── 19 hàm cố định, hết ────────┘
                 CORE: renderer không đọc được file. Muốn gì phải gọi
                       1 trong 19 hàm. Toàn bộ bề mặt tấn công = 1 file.
```

---

## Ba ý cốt lõi

Nếu chỉ nhớ được ba thứ từ ghi chú này:

1. **Build phải chạy trên chính OS đích.** Nên có hai thư mục: WSL để code (ext4, build nhanh),
   `D:\dev` để build Windows. Cross-compile sang Windows cần Wine; sang macOS thì bất khả thi
   vì còn phải ký số.
2. **Native module lấy prebuilt theo ABI của Electron, không phải của Node.** Đây là lý do
   không cần cài Visual Studio Build Tools.
3. **App / Data / Shortcut là ba thứ rời nhau.** Xoá app không mất data. Rebuild app không đụng
   data. Shortcut chỉ là con trỏ.

---

## Ba chỗ vướng thật, và cách gỡ

### 1. `npm install` chết vì native module

```
gyp ERR! find Python   Could not find any Python installation to use
gyp ERR! cwd .../node_modules/better-sqlite3
```

**Nguyên nhân:** script cài của `better-sqlite3` build cho **ABI của Node** đang chạy (Node 24).
Không có prebuilt cho Node 24 → nó rơi xuống `node-gyp` → cần Python + Visual Studio Build
Tools. Máy không có cả hai.

**Điểm mấu chốt:** app chạy trên **Electron**, không phải Node. Cái cần là bản
`electron-v133-win32-x64` — và bản đó *có* tồn tại.

```bat
npm install --ignore-scripts
npx electron-builder install-app-deps
```

Lệnh thứ hai gọi `@electron/rebuild`, nó tải đúng prebuilt theo ABI của Electron.
Không cần compiler.

> **Cách tra ABI:** Electron 33 = 130 · 34 = 132 · **35 = 133** · 36 = 135 · 37 = 136.
> Kiểm tra prebuilt có tồn tại không bằng cách xem assets của GitHub release tương ứng.

### 2. `electron-builder` chết ở winCodeSign

```
ERROR: Cannot create symbolic link : A required privilege is not held by the client.
       ...\winCodeSign\<hash>\darwin\10.12\lib\libcrypto.dylib
```

**Nguyên nhân:** electron-builder tải gói ký số và giải nén bằng `7za -snld`. Trong gói có 2
symlink `.dylib` của **macOS**. Tạo symlink trên Windows cần Developer Mode hoặc quyền admin.

Lỗi này xảy ra **kể cả khi không ký gì cả**, kể cả với `--dir`.

**Cách gỡ:** giải nén sẵn, **bỏ cờ `-snld`** → bỏ qua đúng 2 file vô dụng đó:

```bat
set CACHE=%LOCALAPPDATA%\electron-builder\Cache\winCodeSign
"node_modules\7zip-bin\win\x64\7za.exe" x -bd -y "%CACHE%\<hash>.7z" -o"%CACHE%\winCodeSign-2.6.0"
```

Vẫn báo `Sub items Errors: 2` — kệ nó. Thứ Windows cần (`rcedit-x64.exe`,
`windows-10\signtool.exe`) đã ra đủ. electron-builder thấy thư mục `winCodeSign-2.6.0` có sẵn
thì bỏ qua bước giải nén của nó.

*(Cách sạch hơn: bật Windows Developer Mode.)*

### 3. Cửa sổ trắng trơn vì CSP

Bản build production mở ra trắng tinh. Console:

```
Refused to execute inline script because it violates the following
Content Security Policy directive: "script-src 'self'"
```

**Nguyên nhân:** Next.js static export khởi động bằng các thẻ `<script>` inline. Hai cách hợp
lệ để cho phép — nonce theo request, hoặc danh sách hash lúc build — **đều cần một server**.
App này không có server.

**Kết luận:** buộc phải có `'unsafe-inline'` trong `script-src`. Nhưng phải hiểu đúng cái giá:

- Ranh giới an ninh thật **không phải CSP**, mà là `contextIsolation` + `sandbox` +
  `nodeIntegration: false` + danh sách 19 hàm cố định trong preload.
- Phá được CSP thì kẻ tấn công vẫn chỉ có đúng 19 hàm đó.
- CSP vẫn chặn script từ host lạ, `<object>`, submit form, base-tag hijack.
- `'unsafe-eval'` thì chỉ bật ở dev (Next cần cho hot reload), đã loại khỏi bản production.

---

## Bài học chung, không riêng Electron

**Lỗi khó nhất luôn nằm ở môi trường, không nằm ở code.** Cả ba chỗ vướng trên đều không phải
bug logic. Chúng là: sai ABI, sai quyền hệ điều hành, sai giả định về runtime.

**Đo, đừng đoán.** App chạy trong WSL lag. Giả thuyết dễ nhất là "code nặng". Đo thật:

```
gpu_compositing: disabled_software     ← CPU đang vẽ từng pixel
```

Thử 5 cấu hình ép GPU (`--use-gl=angle`, `egl`, ozone wayland, `--ignore-gpu-blocklist`, ép
`d3d12`) — không cái nào ăn. Đó là giới hạn của WSLg, không phải của code. Bản Windows native
có `--type=gpu-process` chạy thật. Nếu không đo thì đã đi tối ưu nhầm chỗ cả buổi.

**Mặc định của mình thường là mặc định cho riêng máy mình.** Vault ban đầu mặc định nằm cạnh
file exe — đúng với máy này (ổ C: đầy), nhưng nếu đưa người khác:

- cài vào `C:\Program Files` → user thường **không ghi được**
- hai tài khoản Windows trên một máy → **dùng chung một kho**

Đổi thành thư mục dữ liệu riêng theo tài khoản (`%APPDATA%`), còn "cạnh exe" thành tuỳ chọn
opt-in bằng file `portable.txt`. Chỉ lộ ra khi đặt câu hỏi *"nếu người khác cài thì sao?"*

**Ảnh chụp màn hình là bằng chứng về pixel, không phải về trạng thái.** Có lần ảnh chụp cho
thấy highlight ở sai dòng. Query thẳng DOM thì đúng — cửa sổ ẩn nên compositor trễ một frame.
Khi hai thứ mâu thuẫn, tin DOM.

---

## Checklist tái sử dụng cho dự án Electron khác

```
□ esbuild cho main + preload, external: electron + mọi native module
□ KHÔNG define process.env.NODE_ENV lúc build (để runtime tự quyết)
□ UI: static export, phục vụ qua custom protocol (app://), không phải file://
    → file:// có origin rỗng, hỏng đường dẫn tuyệt đối /_next/*
    → scheme phải đăng ký standard + secure + stream (stream = PDF range request)
□ CSP: chấp nhận 'unsafe-inline' cho script; loại 'unsafe-eval' khỏi production
□ Native module: dùng prebuilt theo ABI Electron, không phải ABI Node
□ asarUnpack cho file .node — không đọc được từ trong asar
□ Đọc .env CẠNH exe, không phải trong asar
□ Vault mặc định = thư mục dữ liệu theo tài khoản; portable là opt-in
□ Chặn navigation + window.open ra ngoài origin của mình
□ Build trên chính OS đích
□ Kiểm thử bản đóng gói trên máy CHƯA từng chạy app
```

---

## Lệnh đầy đủ

```bash
# 1. WSL — đồng bộ source sang đường dẫn Windows
rsync -a --delete \
  --exclude node_modules --exclude dist --exclude release \
  --exclude 'renderer/.next' --exclude 'renderer/out' \
  --exclude data --exclude .git \
  /home/app/knowledge-hub/ /mnt/d/dev/knowledge-hub/
```

```bat
:: 2. Windows — trong D:\dev\knowledge-hub
npm install --ignore-scripts
npx electron-builder install-app-deps
npm run build
npx electron-builder --win --x64 --dir
```

```powershell
# 3. Tạo shortcut Desktop
$ws  = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut("$env:USERPROFILE\Desktop\Knowledge Hub.lnk")
$lnk.TargetPath       = "D:\Apps\Knowledge Hub\Knowledge Hub.exe"
$lnk.WorkingDirectory = "D:\Apps\Knowledge Hub"
$lnk.IconLocation     = "D:\Apps\Knowledge Hub\Knowledge Hub.exe,0"
$lnk.Save()
```

---

## Còn thiếu gì để đưa cho người lạ

Bản hiện tại **chưa ký số**, nên:

| Nền tảng | Người dùng thấy gì |
|---|---|
| Windows | SmartScreen: *"Unknown publisher"* — phải bấm **More info → Run anyway** |
| macOS | Gatekeeper chặn thẳng |
| Linux | Không sao cả |

Ổn nếu gửi cho vài người quen báo trước. Không ổn với người lạ — đa số sẽ không bấm qua cảnh
báo bảo mật, và họ đúng khi làm vậy.

Chi phí nếu muốn ký: **~200–400 USD/năm** (chứng chỉ Windows OV/EV, từ 2023 khoá riêng phải nằm
trên phần cứng hoặc HSM đám mây) và **99 USD/năm** (Apple Developer Program, còn phải notarize).

Hai việc rẻ nên làm **trước khi người thứ hai cài**:

- **Ghi log ra file.** Hiện log ra stdout — người cài bằng icon không bao giờ thấy. Không có nó
  thì "máy tôi bị lỗi" là báo cáo không xử lý được.
- **Chặn mở vault của phiên bản mới hơn.** Bản cũ mở vault có `user_version` cao hơn đang lỗi ở
  đâu đó trong câu query thay vì báo rõ. Một phép so sánh là xong. Đây là bug hình dạng
  mất-dữ-liệu.
