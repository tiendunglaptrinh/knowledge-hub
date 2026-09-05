/**
 * Boots the real application against a throwaway vault, seeds it, drives the
 * UI through its element ids and writes PNGs.
 *
 * This is the visual counterpart to `scripts/smoke.ts`: the smoke test proves
 * the services behave, this proves the window actually renders and that the
 * ids the UI exposes are the ones documented in docs/08-ui-guide.md.
 *
 *   npm run shots            # writes to ./shots
 *   SHOT_DIR=/tmp/x npm run shots
 *
 * Requires a display. Under WSL that is WSLg, which is present by default.
 */

import { app, BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createContainer } from '../src/main/container'
import { registerIpcHandlers } from '../src/main/ipc/register'
import { installAppProtocol, registerAppScheme, RENDERER_ORIGIN } from '../src/main/protocol'
import { writeDocx } from './make-docx'

registerAppScheme()

const OUT_DIR = process.env.SHOT_DIR ?? path.join(process.cwd(), 'shots')

/**
 * Which renderer to point at. Defaults to the static export over `app://`,
 * which is what a packaged build serves. Set `SHOT_URL=http://localhost:3100`
 * to capture the dev server instead — the two differ in CSP and in
 * `webSecurity`, so "it works packaged" is not proof it works in development.
 */
const TARGET_URL = process.env.SHOT_URL ?? `${RENDERER_ORIGIN}/index.html`

async function main(): Promise<void> {
  await app.whenReady()

  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-shots-'))
  const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-shots-src-'))
  await fs.mkdir(OUT_DIR, { recursive: true })

  const container = await createContainer({
    isDev: false,
    dataDir,
    databasePath: path.join(dataDir, 'knowledge.db'),
    devServerUrl: '',
    logLevel: 'warn',
  })

  await seed(container, sourceDir)

  installAppProtocol(container.store, path.join(process.cwd(), 'renderer', 'out'))
  registerIpcHandlers(container)

  const window = new BrowserWindow({
    width: 1360,
    height: 880,
    show: false,
    backgroundColor: '#0b1020',
    webPreferences: {
      preload: path.join(__dirname, 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      plugins: true,
    },
  })

  // Surface renderer-side failures here rather than in a blank screenshot.
  window.webContents.on('console-message', (_event, level, message) => {
    console.log(`  [renderer:${level}] ${message}`)
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`  renderer gone: ${details.reason}`)
  })

  await window.loadURL(TARGET_URL)
  await settle(window, 1200)
  await shoot(window, '01-recent.png')

  // Open the item that actually has attachments. Doubles as an assertion that
  // the id contract holds: if `card-item-*` were renamed this returns false
  // and the run fails rather than producing a misleading screenshot.
  const opened = await window.webContents.executeJavaScript(
    `(() => {
       const cards = Array.from(document.querySelectorAll('[id^="card-item-"]'))
       const target = cards.find((c) => c.textContent.includes('OWASP'))
       if (!target) return false
       target.click()
       return true
     })()`,
  )
  if (!opened) throw new Error('no OWASP item card found — the id contract has drifted')
  await settle(window, 1500)
  await shoot(window, '02-item-detail-word.png')

  // Second attachment is the markdown file.
  const buttons = await window.webContents.executeJavaScript(
    `Array.from(document.querySelectorAll('[id^="btn-select-asset-"]')).length`,
  )
  if (buttons > 1) {
    await window.webContents.executeJavaScript(
      `document.querySelectorAll('[id^="btn-select-asset-"]')[1].click(); true`,
    )
    // Longer than it looks necessary: the window is hidden, so the compositor
    // can lag the DOM and capture a frame from before the row highlight moved.
    await settle(window, 2000)
    await shoot(window, '03-item-detail-markdown.png')
  }

  await click(window, '#btn-back-to-list')
  await settle(window, 600)

  // The upload dialog before Settings: `#btn-add-item` only exists on a list
  // view, so opening it after navigating to Settings would silently no-op.
  await click(window, '#btn-add-item')
  await settle(window, 800)
  await shoot(window, '04-add-item-dialog.png')

  await click(window, '#btn-cancel-item')
  await settle(window, 400)
  await click(window, '#nav-settings')
  await settle(window, 1000)
  await shoot(window, '05-settings.png')

  // Notes: the list first, then the Markdown editor's two sections.
  await click(window, '#nav-notes')
  await settle(window, 1000)
  await shoot(window, '06-notes.png')

  const openedNote = await window.webContents.executeJavaScript(
    `(() => {
       const buttons = Array.from(document.querySelectorAll('[id^="btn-open-note-"]'))
       const target = buttons.find((b) => b.textContent.includes('Spring Security'))
       if (!target) return false
       target.click()
       return true
     })()`,
  )
  if (!openedNote) throw new Error('no Spring Security note found — the id contract has drifted')
  await settle(window, 1500)
  await shoot(window, '07-note-editor.png')

  // Collapsed rail, from the screen that benefits most from the extra width.
  await click(window, '#btn-toggle-sidebar')
  await settle(window, 800)
  await shoot(window, '08-sidebar-collapsed.png')
  await click(window, '#btn-toggle-sidebar')
  await settle(window, 400)

  // The confirmation every destructive action goes through. Captured from the
  // item it protects, so the dialog in the picture is naming a real title.
  await click(window, '#btn-back-to-notes')
  await settle(window, 400)
  await click(window, '#nav-recent')
  await settle(window, 800)

  const openedForDelete = await window.webContents.executeJavaScript(
    `(() => {
       const cards = Array.from(document.querySelectorAll('[id^="card-item-"]'))
       const target = cards.find((c) => c.textContent.includes('OWASP'))
       if (!target) return false
       target.click()
       return true
     })()`,
  )
  if (!openedForDelete) throw new Error('no OWASP item card found — the id contract has drifted')
  await settle(window, 1200)

  await click(window, '#btn-delete-item')
  await settle(window, 700)
  await shoot(window, '09-confirm-delete.png')
  await click(window, '#btn-cancel-delete-item')
  await settle(window, 300)

  // Writing a document instead of uploading one: the choice, then the editor.
  await click(window, '#btn-back-to-list')
  await settle(window, 600)
  await click(window, '#btn-add-item')
  await settle(window, 600)
  await click(window, '#btn-source-compose')
  // Long, for the reason in docs/12-testing.md: the window is hidden, so the
  // compositor can lag the DOM and capture the highlight on the old card.
  await settle(window, 2000)

  // A screenshot is evidence about pixels, not about state, so the toggle is
  // asserted rather than eyeballed in the picture.
  const composeSelected = await window.webContents.executeJavaScript(
    `document.querySelector('#btn-source-compose')?.getAttribute('aria-pressed')`,
  )
  if (composeSelected !== 'true') {
    throw new Error(`compose source did not become active (aria-pressed=${composeSelected})`)
  }

  await shoot(window, '10-compose-dialog.png')

  // Drive the whole compose flow rather than cancelling out of it: typing a
  // title and submitting must land in the editor. Nothing else covers that
  // hand-off, and it is where the filename normalisation is easy to get wrong.
  await window.webContents.executeJavaScript(
    `(() => {
       const input = document.getElementById('item-title')
       const setter = Object.getOwnPropertyDescriptor(
         window.HTMLInputElement.prototype, 'value').set
       setter.call(input, 'Nháp kiến trúc thanh toán')
       input.dispatchEvent(new Event('input', { bubbles: true }))
       return true
     })()`,
  )
  await settle(window, 400)
  await click(window, '#btn-submit-item')
  await settle(window, 2500)

  const inEditor = await window.webContents.executeJavaScript(
    `!!document.getElementById('doc-editor-source')`,
  )
  if (!inEditor) {
    throw new Error('creating a composed document did not open the editor on it')
  }

  // Back out of the newly created document before looking for the seeded one.
  await click(window, '#btn-cancel-edit-asset')
  await settle(window, 500)
  await click(window, '#btn-back-to-list')
  await settle(window, 800)

  const openedComposed = await window.webContents.executeJavaScript(
    `(() => {
       const cards = Array.from(document.querySelectorAll('[id^="card-item-"]'))
       const target = cards.find((c) => c.textContent.includes('code review'))
       if (!target) return false
       target.click()
       return true
     })()`,
  )
  if (!openedComposed) throw new Error('no composed item card found — the id contract has drifted')
  await settle(window, 1500)

  await click(window, '#btn-edit-asset')
  await settle(window, 1500)
  await shoot(window, '11-document-editor.png')

  // Editing the item's own fields. Driven all the way through rather than
  // cancelled out of: the dialog is only worth a screenshot if submitting it
  // actually changes what the header says.
  await click(window, '#btn-cancel-edit-asset')
  await settle(window, 600)
  await click(window, '#btn-edit-item-info')
  await settle(window, 900)

  // Prefill is the whole contract of an edit dialog — an empty form here would
  // silently clear the summary and tags on submit.
  const prefilled = await window.webContents.executeJavaScript(
    `(() => {
       const title = document.getElementById('item-info-title')
       const heading = document.getElementById('item-detail-title')
       return !!title && !!heading && title.value.trim() === heading.textContent.trim()
     })()`,
  )
  if (!prefilled) throw new Error('the info dialog did not open prefilled with the current title')

  await shoot(window, '12-item-info-dialog.png')

  await window.webContents.executeJavaScript(
    `(() => {
       const input = document.getElementById('item-info-title')
       const setter = Object.getOwnPropertyDescriptor(
         window.HTMLInputElement.prototype, 'value').set
       setter.call(input, 'Quy trình code review (đã sửa)')
       input.dispatchEvent(new Event('input', { bubbles: true }))
       return true
     })()`,
  )
  await settle(window, 400)
  await click(window, '#btn-submit-item-info')
  await settle(window, 2000)

  const renamedInUi = await window.webContents.executeJavaScript(
    `(() => {
       const heading = document.getElementById('item-detail-title')
       const dialog = document.getElementById('modal-item-info')
       return !dialog && !!heading && heading.textContent.includes('(đã sửa)')
     })()`,
  )
  if (!renamedInUi) {
    throw new Error('submitting the info dialog did not close it and update the title on screen')
  }


  // --- checklists ---------------------------------------------------------
  //
  // The dashboard, the three-step wizard, and a plan open with its break-down.
  // Driven through the same element ids the feature documents, so a rename
  // fails this run rather than quietly producing a screenshot of the old UI.

  await click(window, '#nav-checklists')
  await settle(window, 1500)
  await shoot(window, '13-checklist-dashboard.png')

  await click(window, '#btn-add-checklist')
  await settle(window, 700)
  // Today already has a plan, so the wizard is driven as a module checklist —
  // which is also the half with the Eisenhower matrix in it.
  await click(window, '#btn-checklist-kind-module')
  await settle(window, 400)
  await type(window, '#checklist-title', 'Module báo cáo tài chính — quý 4')
  await type(
    window,
    '#checklist-description',
    'Gom toàn bộ đầu việc của quý vào một chỗ, sắp theo ma trận Eisenhower.',
  )
  // Long settles before every capture in this section, deliberately: the
  // window is created with `show: false`, and an unshown window throttles
  // compositing — a short wait captures the *previous* frame and produces a
  // screenshot of the step before the one being documented.
  await settle(window, 1400)
  await shoot(window, '14-checklist-wizard-step1.png')

  await click(window, '#btn-checklist-next')
  await settle(window, 900)

  const seedTasks: Array<[string, string]> = [
    ['Chốt số liệu với kế toán', 'do'],
    ['Dựng khung báo cáo', 'schedule'],
    ['Nhờ trợ lý gom hoá đơn', 'delegate'],
  ]
  for (const [title, quadrant] of seedTasks) {
    await click(window, `#btn-task-quadrant-${quadrant}`)
    await type(window, '#input-task-title', title)
    await click(window, '#btn-add-task')
    await settle(window, 400)
  }
  await settle(window, 1400)
  await shoot(window, '15-checklist-wizard-step2.png')

  await click(window, '#btn-checklist-next')
  await settle(window, 1400)
  await shoot(window, '16-checklist-wizard-step3.png')

  await click(window, '#btn-submit-checklist')
  await settle(window, 2000)

  const landedInPlan = await window.webContents.executeJavaScript(
    `(() => {
       const pane = document.querySelector('[id^="pane-checklist-"]')
       const dialog = document.getElementById('modal-checklist')
       return !dialog && !!pane && pane.textContent.includes('Module báo cáo tài chính')
     })()`,
  )
  if (!landedInPlan) throw new Error('confirming the wizard did not open the new checklist')
  await settle(window, 900)
  await shoot(window, '17-checklist-module-detail.png')

  await click(window, '#btn-close-checklist')
  await settle(window, 1200)

  // Today's plan: the one with a break-down under a big task.
  const openedPlan = await window.webContents.executeJavaScript(
    `(() => {
       const cards = Array.from(document.querySelectorAll('[id^="card-checklist-"]'))
       const target = cards.find((c) => c.textContent.includes('Hôm nay'))
       if (!target) return false
       target.click()
       return true
     })()`,
  )
  if (!openedPlan) throw new Error("no card for today's checklist — the id contract has drifted")
  await settle(window, 1500)
  await shoot(window, '18-checklist-daily-detail.png')

  // Ticking a sub-task must move its parent to "Đang làm" and lift the
  // percentage — the one behaviour of this screen that is not just layout.
  const before = await window.webContents.executeJavaScript(
    `document.querySelector('[id^="progress-checklist-"]').getAttribute('aria-valuenow')`,
  )
  await window.webContents.executeJavaScript(
    `(() => {
       const buttons = Array.from(document.querySelectorAll('[id^="btn-subtask-done-"]'))
       const open = buttons.find((b) => b.getAttribute('aria-checked') === 'false')
       if (!open) return false
       open.click()
       return true
     })()`,
  )
  await settle(window, 1500)
  const after = await window.webContents.executeJavaScript(
    `document.querySelector('[id^="progress-checklist-"]').getAttribute('aria-valuenow')`,
  )
  if (Number(after) <= Number(before)) {
    throw new Error(`ticking a sub-task did not raise the plan's progress (${before} -> ${after})`)
  }
  await shoot(window, '19-checklist-daily-ticked.png')


  // --- update banner ------------------------------------------------------
  //
  // The banner only appears when a real feed reports a newer version, which no
  // test can arrange. What *can* be arranged is the push itself: sending the
  // event the way `UpdateService` sends it exercises the whole renderer path —
  // preload subscription, store reducer, banner — and proves the one
  // main-to-renderer channel in the contract actually arrives.

  const pushUpdateState = async (state: Record<string, unknown>) => {
    window.webContents.send('update:state', state)
    await settle(window, 1200)
  }

  await click(window, '#nav-recent')
  await settle(window, 1000)

  await pushUpdateState({
    status: 'available',
    currentVersion: '0.2.0',
    availableVersion: '0.2.1',
    percent: null,
    releaseNotes: null,
    error: null,
    checkedAt: new Date().toISOString(),
  })

  const bannerShown = await window.webContents.executeJavaScript(
    `(() => {
       const banner = document.getElementById('banner-update')
       return !!banner && banner.textContent.includes('0.2.1')
     })()`,
  )
  if (!bannerShown) throw new Error('the update event did not reach the renderer')
  await shoot(window, '20-update-available.png')

  await pushUpdateState({
    status: 'downloaded',
    currentVersion: '0.2.0',
    availableVersion: '0.2.1',
    percent: 100,
    releaseNotes: null,
    error: null,
    checkedAt: new Date().toISOString(),
  })
  await shoot(window, '21-update-downloaded.png')

  // And the quiet half of the flow, which lives in Settings rather than in a
  // strip across the top.
  await click(window, '#nav-settings')
  await settle(window, 1200)
  await click(window, '#tab-settings-storage')
  // A generous settle, for the compositor reason documented in
  // docs/12-testing.md: this step changes the tab *and* the banner at once,
  // and a short wait captures the frame before either.
  await settle(window, 1800)
  await pushUpdateState({
    status: 'not-available',
    currentVersion: '0.2.0',
    availableVersion: null,
    percent: null,
    releaseNotes: null,
    error: null,
    checkedAt: new Date().toISOString(),
  })

  const settingsShown = await window.webContents.executeJavaScript(
    `(() => {
       const line = document.getElementById('settings-update-status')
       const version = document.getElementById('settings-version')
       return !!line && !!version && version.textContent.includes('0.2.0')
     })()`,
  )
  if (!settingsShown) throw new Error('the version block is missing from Settings')
  await settle(window, 1400)
  await shoot(window, '22-update-settings.png')

  container.dispose()
  await fs.rm(dataDir, { recursive: true, force: true })
  await fs.rm(sourceDir, { recursive: true, force: true })

  console.log(`\nscreenshots written to ${OUT_DIR}`)
  app.exit(0)
}

async function seed(
  container: Awaited<ReturnType<typeof createContainer>>,
  sourceDir: string,
): Promise<void> {
  const { categories, items, notes, checklists } = container

  const software = categories.create({ name: 'Software', icon: 'Code2' })
  const ai = categories.create({ name: 'AI', icon: 'Brain' })
  const english = categories.create({ name: 'Tiếng Anh', icon: 'Languages' })
  categories.create({ name: 'Phỏng vấn', icon: 'Briefcase' })

  const docx = path.join(sourceDir, 'OWASP Top 10.docx')
  await writeDocx(docx, 'OWASP Top 10 — 2021', [
    'A01 Broken Access Control — leo thang đặc quyền, truy cập tài nguyên của người khác.',
    'A02 Cryptographic Failures — dữ liệu nhạy cảm không được mã hoá đúng cách.',
    'A03 Injection — SQL injection, command injection, và cross-site scripting.',
    'Ghi chú: mỗi mục nên đi kèm một ví dụ thực tế và cách phòng chống ở tầng service.',
  ])

  const md = path.join(sourceDir, 'spring-di.md')
  await fs.writeFile(
    md,
    [
      '# Spring — Dependency Injection',
      '',
      'Container quản lý vòng đời bean và **tiêm phụ thuộc** thay cho `new`.',
      '',
      '## Ba cách tiêm',
      '',
      '1. Constructor injection — được khuyến nghị, bất biến và dễ test',
      '2. Setter injection — cho phụ thuộc tuỳ chọn',
      '3. Field injection — ngắn gọn nhưng khó test, nên tránh',
      '',
      '> Nếu một class cần quá nhiều constructor argument, đó là tín hiệu class đó',
      '> đang làm quá nhiều việc.',
      '',
      '```java',
      '@Service',
      'class WalletService {',
      '  private final WalletRepository repository;',
      '',
      '  WalletService(WalletRepository repository) {',
      '    this.repository = repository;',
      '  }',
      '}',
      '```',
      '',
      '| Cách tiêm | Bất biến | Dễ test |',
      '|---|---|---|',
      '| Constructor | Có | Có |',
      '| Setter | Không | Trung bình |',
      '| Field | Không | Khó |',
    ].join('\n'),
  )

  await items.create({
    categoryId: software.id,
    title: 'OWASP Top 10 — tổng hợp và ví dụ',
    summary: 'Mười rủi ro bảo mật phổ biến nhất, kèm cách phòng chống ở tầng service.',
    tags: ['security', 'owasp', 'backend'],
    filePaths: [docx, md],
  })

  await items.create({
    categoryId: software.id,
    title: 'Spring Boot — Dependency Injection',
    summary: 'Ba cách tiêm phụ thuộc và khi nào dùng cách nào.',
    tags: ['spring', 'java'],
    filePaths: [md],
  })

  // Written in the app rather than uploaded — the shot of the document editor
  // needs something with real structure in it.
  await items.create({
    categoryId: software.id,
    title: 'Chuẩn hoá code review',
    summary: 'Tự soạn trong ứng dụng, không tải tệp nào lên.',
    tags: ['process', 'team'],
    composed: [
      {
        filename: 'Chuẩn hoá code review',
        format: 'markdown',
        content: [
          '# Chuẩn hoá code review',
          '',
          'Mục tiêu: review **nhanh** mà vẫn bắt được lỗi thật.',
          '',
          '## Ba mức ưu tiên',
          '',
          '1. **Chặn merge** — sai logic, lỗ hổng bảo mật, mất dữ liệu',
          '2. **Nên sửa** — khó đọc, thiếu test cho nhánh quan trọng',
          '3. **Tuỳ tác giả** — sở thích đặt tên, thứ tự hàm',
          '',
          '> Nếu một nhận xét không rơi vào mức 1 hay 2, hãy nói rõ là',
          '> "không bắt buộc" — người đọc không phải đoán.',
          '',
          '```java',
          '// Chặn merge: userId lấy từ request thay vì từ token',
          'var user = repo.findById(request.getUserId());',
          '```',
          '',
          '| Mức | Ai quyết định | Thời hạn |',
          '|---|---|---|',
          '| Chặn merge | Reviewer | Trước khi merge |',
          '| Nên sửa | Tác giả | Trong tuần |',
        ].join('\n'),
      },
    ],
  })

  await items.create({
    categoryId: ai.id,
    title: 'Transformer — cơ chế Attention',
    summary: 'Self-attention, multi-head, và vì sao positional encoding là bắt buộc.',
    tags: ['deep-learning', 'nlp'],
  })

  await items.create({
    categoryId: english.id,
    title: 'Phrasal verbs thường gặp trong họp',
    summary: 'follow up, circle back, run by, touch base — kèm ví dụ.',
    tags: ['vocabulary', 'business'],
  })

  // Notes, chosen to show the list doing its one clever thing: the overdue
  // deadline and the one due soon sort above everything else, and the
  // finished note sinks to the bottom.
  const inDays = (days: number, hour: number): string => {
    const when = new Date()
    when.setDate(when.getDate() + days)
    when.setHours(hour, 0, 0, 0)
    return when.toISOString()
  }

  await notes.create({
    title: 'Nộp bài tập lớn môn Bảo mật',
    kind: 'deadline',
    format: 'text',
    dueAt: inDays(-1, 17),
    content: 'Nộp qua hệ thống của trường, kèm mã nguồn và bản mô tả kiến trúc.',
  })

  await notes.create({
    title: 'Chuẩn bị demo cho buổi review',
    kind: 'task',
    format: 'text',
    dueAt: inDays(3, 9),
    content: 'Dựng sẵn dữ liệu mẫu, kiểm tra đường truyền, in sẵn kịch bản demo.',
  })

  await notes.create({
    title: 'Spring Security — filter chain',
    kind: 'study',
    format: 'markdown',
    content: [
      '# Spring Security — filter chain',
      '',
      'Mỗi request đi qua **một chuỗi filter** trước khi tới controller.',
      '',
      '## Thứ tự đáng nhớ',
      '',
      '1. `SecurityContextPersistenceFilter` — nạp context từ session',
      '2. `UsernamePasswordAuthenticationFilter` — xử lý form login',
      '3. `FilterSecurityInterceptor` — quyết định cho qua hay chặn',
      '',
      '> Đặt filter tự viết sai chỗ là nguyên nhân phổ biến nhất của lỗi',
      '> "đã đăng nhập nhưng vẫn bị 403".',
      '',
      '```java',
      'http.addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class);',
      '```',
      '',
      '| Filter | Việc nó làm |',
      '|---|---|',
      '| SecurityContextPersistenceFilter | Nạp và lưu SecurityContext |',
      '| ExceptionTranslationFilter | Đổi exception thành 401/403 |',
    ].join('\n'),
  })

  await notes.create({
    title: 'Nhật ký 01/08 — đọc xong chương 4',
    kind: 'daily',
    format: 'markdown',
    content: 'Đọc xong chương 4, phần transaction propagation vẫn còn mơ hồ, mai đọc lại.',
  })

  const done = await notes.create({
    title: 'Ý tưởng: gom câu lệnh git hay dùng',
    kind: 'idea',
    format: 'markdown',
    content: '`git switch -c`, `git restore --staged`, `git log --oneline --graph`.',
  })
  await notes.update({ id: done.id, done: true })

  // Checklists, chosen so the dashboard has something to say: a finished day,
  // a half-finished day, today's plan still mostly open, and a module plan
  // holding one task in each Eisenhower quadrant.
  const dayOf = (offset: number): string => {
    const when = new Date()
    when.setDate(when.getDate() + offset)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`
  }

  const twoDaysAgo = checklists.create({
    kind: 'daily',
    day: dayOf(-2),
    description: 'Dọn nốt phần việc tồn của tuần trước.',
    tasks: [
      { title: 'Trả lời phản hồi của khách hàng', priority: 'high' },
      { title: 'Dọn nhánh git đã merge', priority: 'normal' },
    ],
  })
  for (const task of twoDaysAgo.tasks) {
    checklists.updateTask({ id: task.id, status: 'done' })
  }

  const yesterday = checklists.create({
    kind: 'daily',
    day: dayOf(-1),
    tasks: [
      {
        title: 'Viết tài liệu API cho module ví',
        priority: 'high',
        children: [{ title: 'Mô tả request/response' }, { title: 'Bổ sung ví dụ lỗi' }],
      },
      { title: 'Họp kế hoạch sprint', priority: 'normal' },
    ],
  })
  checklists.updateTask({ id: yesterday.tasks[0]!.children[0]!.id, status: 'done' })

  const todayPlan = checklists.create({
    kind: 'daily',
    day: dayOf(0),
    description: 'Ưu tiên xong phần thanh toán trước giờ demo chiều nay.',
    tasks: [
      {
        title: 'Hoàn thiện API thanh toán',
        description: 'Chốt hợp đồng dữ liệu với frontend trước khi viết test.',
        priority: 'high',
        children: [
          { title: 'Viết endpoint tạo giao dịch' },
          { title: 'Viết test cho luồng hoàn tiền' },
          { title: 'Cập nhật tài liệu Swagger' },
        ],
      },
      {
        title: 'Chuẩn bị slide demo',
        priority: 'high',
        dueAt: (() => {
          const when = new Date()
          when.setHours(16, 0, 0, 0)
          return when.toISOString()
        })(),
      },
      {
        title: 'Review PR của team',
        description: 'Ba PR đang chờ, ưu tiên PR sửa lỗi đăng nhập.',
        priority: 'normal',
        children: [{ title: 'PR #412 — sửa lỗi đăng nhập' }, { title: 'PR #415 — dọn log' }],
      },
    ],
  })
  checklists.updateTask({ id: todayPlan.tasks[0]!.children[0]!.id, status: 'done' })
  checklists.updateTask({ id: todayPlan.tasks[0]!.children[1]!.id, status: 'doing' })

  const wallet = checklists.create({
    kind: 'module',
    title: 'Module ví điện tử — giai đoạn 1',
    description: 'Bốn mươi đầu việc, chạy trong hai tháng. Không chia nhỏ theo ngày được.',
    dueAt: (() => {
      const when = new Date()
      when.setDate(when.getDate() + 45)
      when.setHours(17, 0, 0, 0)
      return when.toISOString()
    })(),
    tasks: [
      { title: 'Sửa lỗi trừ tiền hai lần khi retry', quadrant: 'do' },
      { title: 'Chốt luồng đối soát với ngân hàng', quadrant: 'do' },
      {
        title: 'Thiết kế lại màn hình lịch sử giao dịch',
        description: 'Chưa gấp nhưng ảnh hưởng toàn bộ giai đoạn 2.',
        quadrant: 'schedule',
      },
      { title: 'Viết kịch bản test hồi quy', quadrant: 'schedule' },
      { title: 'Nhờ QA chạy bộ test thủ công', quadrant: 'delegate' },
      { title: 'Gom log thừa của môi trường staging', quadrant: 'eliminate' },
    ],
  })
  checklists.updateTask({ id: wallet.tasks[0]!.id, status: 'done' })
  checklists.updateTask({ id: wallet.tasks[1]!.id, status: 'doing' })
}

async function shoot(window: BrowserWindow, filename: string): Promise<void> {
  const image = await window.webContents.capturePage()
  const target = path.join(OUT_DIR, filename)
  await fs.writeFile(target, image.toPNG())
  console.log(`  wrote ${filename}`)
}

/**
 * Clicks by selector and fails loudly when the element is absent.
 *
 * A silent no-op here produces a screenshot of the wrong screen, which is
 * worse than no screenshot: it looks like evidence.
 */
async function click(window: BrowserWindow, selector: string): Promise<void> {
  const hit = await window.webContents.executeJavaScript(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)});
       if (!el) return false; el.click(); return true; })()`,
  )
  if (!hit) throw new Error(`element not found: ${selector}`)
}

/**
 * Types into a React-controlled field.
 *
 * Setting `.value` directly is invisible to React — it caches the last value
 * on the DOM node — so the native setter is called and an `input` event is
 * dispatched, which is what React actually listens for.
 */
async function type(window: BrowserWindow, selector: string, value: string): Promise<void> {
  const hit = await window.webContents.executeJavaScript(
    `(() => {
       const el = document.querySelector(${JSON.stringify(selector)});
       if (!el) return false;
       const proto = el.tagName === 'TEXTAREA'
         ? window.HTMLTextAreaElement.prototype
         : window.HTMLInputElement.prototype;
       Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
       el.dispatchEvent(new Event('input', { bubbles: true }));
       return true;
     })()`,
  )
  if (!hit) throw new Error(`element not found: ${selector}`)
}

/** Waits for the paint after a state change. */
function settle(window: BrowserWindow, ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch((error) => {
  console.error(error)
  app.exit(1)
})
