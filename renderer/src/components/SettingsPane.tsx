'use client'

/**
 * Settings: how the application looks, and where it keeps things.
 *
 * Two tabs because the two answer different questions. **Giao diện** is a set
 * of choices the user makes and changes; **Nơi lưu trữ** is a set of facts
 * about this machine they can only read. Mixing them would put a row of
 * unchangeable paths in the middle of a form.
 *
 * Appearance is applied the instant it changes — no Save button. Every option
 * here is reversible, visible immediately, and cheap to try; a confirmation
 * step would only stand between the user and the feedback they need to decide.
 * `Đặt lại mặc định` is the undo.
 */

import {
  Check,
  Download,
  FolderOpen,
  HardDrive,
  Palette,
  RefreshCw,
  RotateCcw,
} from 'lucide-react'
import { useState } from 'react'

import { formatBytes, formatRelativeDate } from '@/lib/format'
import {
  APP_ZOOM_MAX,
  APP_ZOOM_MIN,
  CONTENT_SCALE_MAX,
  CONTENT_SCALE_MIN,
  MONO_FONTS,
  TEXT_FONTS,
  THEMES,
  usePrefs,
  type FontOption,
  type ThemeName,
} from '@/lib/prefs'
import { messageFor } from '@/lib/messages'
import { useVault } from '@/lib/store'
import { Button, ProgressBar, SettingRow, Spinner, ZoomControl, selectClass } from './ui'

type Tab = 'appearance' | 'storage'

export function SettingsPane() {
  const [tab, setTab] = useState<Tab>('appearance')

  return (
    <div id="pane-settings" className="mx-auto max-w-3xl px-8 py-8">
      <div
        role="tablist"
        aria-label="Nhóm cài đặt"
        className="mb-6 inline-flex gap-1 rounded-xl border border-surface-3 bg-surface-1 p-1"
      >
        <TabButton
          id="tab-settings-appearance"
          active={tab === 'appearance'}
          onClick={() => setTab('appearance')}
        >
          <Palette className="size-4" aria-hidden />
          Giao diện
        </TabButton>
        <TabButton
          id="tab-settings-storage"
          active={tab === 'storage'}
          onClick={() => setTab('storage')}
        >
          <HardDrive className="size-4" aria-hidden />
          Nơi lưu trữ
        </TabButton>
      </div>

      {tab === 'appearance' ? <AppearanceTab /> : <StorageTab />}
    </div>
  )
}

function TabButton({
  id,
  active,
  onClick,
  children,
}: {
  id: string
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      id={id}
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm transition ${
        active
          ? 'bg-accent-soft font-medium text-ink-1'
          : 'text-ink-3 hover:bg-surface-2 hover:text-ink-1'
      }`}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

function AppearanceTab() {
  const prefs = usePrefs()

  return (
    <div role="tabpanel" aria-labelledby="tab-settings-appearance">
      <Section
        title="Chủ đề màu"
        description="Áp dụng ngay cho toàn bộ ứng dụng. Lựa chọn được ghi nhớ cho lần mở sau."
      >
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {THEMES.map((theme) => (
            <ThemeCard
              key={theme.value}
              theme={theme.value}
              label={theme.label}
              hint={theme.hint}
              swatch={theme.swatch}
              active={prefs.theme === theme.value}
              onClick={() => prefs.set('theme', theme.value)}
            />
          ))}
        </div>
      </Section>

      <Section
        title="Cỡ chữ"
        description="Hai thang tách rời: một cho cả cửa sổ, một chỉ cho nội dung tài liệu. Muốn giao diện gọn mà chữ tài liệu lớn thì tăng riêng thang thứ hai."
      >
        <SettingRow
          label="Thu phóng ứng dụng"
          hint="Phóng to mọi thứ: thanh bên, nút, bảng, và cả trình xem PDF. Phím tắt Ctrl + và Ctrl −, Ctrl 0 để về 100%."
        >
          <ZoomControl
            id="zoom-app"
            label="Thu phóng ứng dụng"
            hint="Ctrl + / Ctrl − / Ctrl 0"
            scale={prefs.appZoom}
            onStep={prefs.stepAppZoom}
            onReset={prefs.resetAppZoom}
            atMin={prefs.appZoom <= APP_ZOOM_MIN}
            atMax={prefs.appZoom >= APP_ZOOM_MAX}
          />
        </SettingRow>

        <SettingRow
          label="Cỡ chữ nội dung"
          hint="Chỉ áp dụng cho tài liệu đang đọc và khung soạn thảo, không đụng tới giao diện. Trong trình đọc và trình soạn thảo còn có thể giữ Ctrl và cuộn chuột."
        >
          <ZoomControl
            id="zoom-content"
            label="Cỡ chữ nội dung"
            scale={prefs.contentScale}
            onStep={prefs.stepContentScale}
            onReset={prefs.resetContentScale}
            atMin={prefs.contentScale <= CONTENT_SCALE_MIN}
            atMax={prefs.contentScale >= CONTENT_SCALE_MAX}
          />
        </SettingRow>
      </Section>

      <Section
        title="Phông chữ"
        description="Chỉ liệt kê những phông có sẵn trên máy — ứng dụng không tải phông từ mạng. Nếu một phông không được cài, hệ thống tự chọn phông thay thế gần nhất."
      >
        <FontRow
          id="setting-ui-font"
          label="Phông giao diện"
          hint="Thanh bên, tiêu đề, nút bấm, hộp thoại."
          options={TEXT_FONTS}
          value={prefs.uiFont}
          onChange={(value) => prefs.set('uiFont', value)}
        />
        <FontRow
          id="setting-doc-font"
          label="Phông tài liệu"
          hint="Nội dung Markdown và Word đã kết xuất, và ghi chú văn bản thuần. Phông có chân dễ đọc hơn với tài liệu dài."
          options={TEXT_FONTS}
          value={prefs.docFont}
          onChange={(value) => prefs.set('docFont', value)}
        />
        <FontRow
          id="setting-mono-font"
          label="Phông mã nguồn"
          hint="Khung soạn Markdown, khối mã, và tệp văn bản xem nguyên trạng."
          options={MONO_FONTS}
          value={prefs.monoFont}
          onChange={(value) => prefs.set('monoFont', value)}
          mono
        />
      </Section>

      <Section
        title="Xem trước"
        description="Đúng những phông và cỡ chữ đang chọn, ở cùng ba vai trò."
      >
        <Preview />
      </Section>

      <div className="flex items-center gap-3">
        <Button id="btn-reset-appearance" variant="subtle" onClick={prefs.resetAll}>
          <RotateCcw className="size-4" />
          Đặt lại mặc định
        </Button>
        <p className="text-xs text-ink-3">
          Trả chủ đề, phông và cả hai thang cỡ chữ về giá trị ban đầu.
        </p>
      </div>
    </div>
  )
}

function ThemeCard({
  theme,
  label,
  hint,
  swatch,
  active,
  onClick,
}: {
  theme: ThemeName
  label: string
  hint: string
  swatch: readonly [string, string, string]
  active: boolean
  onClick: () => void
}) {
  const [background, panel, accent] = swatch

  return (
    <button
      id={`btn-theme-${theme}`}
      onClick={onClick}
      aria-pressed={active}
      title={hint}
      className={`rounded-xl border p-2.5 text-left transition ${
        active
          ? 'border-accent bg-accent-soft'
          : 'border-surface-3 bg-surface-1 hover:border-surface-3 hover:bg-surface-2'
      }`}
    >
      {/*
        A literal miniature of the theme, painted with its own hex values rather
        than with tokens — the point is to show a theme that is *not* currently
        applied, which tokens by definition cannot do.
      */}
      <span
        aria-hidden
        className="mb-2 flex h-10 w-full items-end gap-1 overflow-hidden rounded-lg border border-black/10 p-1.5"
        style={{ background }}
      >
        <span className="h-full w-1/3 rounded" style={{ background: panel }} />
        <span className="h-1.5 flex-1 rounded-full" style={{ background: accent }} />
      </span>
      <span className={`block text-xs ${active ? 'font-medium text-ink-1' : 'text-ink-2'}`}>
        {label}
      </span>
    </button>
  )
}

function FontRow({
  id,
  label,
  hint,
  options,
  value,
  onChange,
  mono,
}: {
  id: string
  label: string
  hint: string
  options: readonly FontOption[]
  value: string
  onChange: (value: string) => void
  mono?: boolean
}) {
  return (
    <SettingRow label={label} hint={hint} htmlFor={id}>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${selectClass} min-w-56`}
        // Renders each name in its own family, so the list previews itself.
        style={{ fontFamily: `var(--font-stack-${value})` }}
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            style={{ fontFamily: `var(--font-stack-${option.value})` }}
          >
            {option.label}
            {mono ? '' : ' — Tiếng Việt có dấu'}
          </option>
        ))}
      </select>
    </SettingRow>
  )
}

/**
 * Shows the three font roles at their real sizes.
 *
 * The document and source samples are wrapped in the same classes the real
 * panes use (`doc-prose`, `font-mono` plus the content scale), so this cannot
 * drift into looking better than the thing it is previewing.
 */
function Preview() {
  return (
    <div className="overflow-hidden rounded-xl border border-surface-3">
      <p className="border-b border-surface-3 bg-surface-2 px-4 py-2 text-sm">
        Giao diện — Nhóm kiến thức, Ghi chú, Thêm tài liệu
      </p>

      <div className="border-b border-surface-3 px-4 py-3">
        <div className="doc-prose !max-w-none">
          <p style={{ margin: 0 }}>
            Tài liệu — chữ ở đây theo phông tài liệu và cỡ chữ nội dung. Đoạn văn dài đọc dễ hay
            khó phụ thuộc vào hai lựa chọn đó.
          </p>
        </div>
      </div>

      <pre
        className="overflow-x-auto px-4 py-3 font-mono leading-relaxed text-ink-2"
        style={{ fontSize: 'calc(13px * var(--content-scale))' }}
      >
        {'# Mã nguồn\n- danh sách  ·  `mã trong dòng`  ·  0O1lI'}
      </pre>
    </div>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-6 rounded-[14px] border border-surface-3 bg-surface-1 p-5">
      <h3 className="text-sm font-semibold text-ink-1">{title}</h3>
      <p className="mb-2 mt-1 text-xs leading-relaxed text-ink-3">{description}</p>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

/**
 * Version, and the state of the update flow.
 *
 * The banner across the top only appears when there is something to act on.
 * This is where the states that are *not* worth interrupting anyone for live:
 * "you are up to date", "the check failed", "this copy cannot update itself".
 * A user who wants to know goes looking; a user who does not is not told.
 */
function UpdateSection() {
  const { update, checkForUpdate, downloadUpdate, installUpdate, busy } = useVault()

  if (!update) return null

  const checking = update.status === 'checking'

  return (
    <section
      id="settings-update"
      className="mb-6 rounded-[14px] border border-surface-3 bg-surface-1 p-5"
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-ink-1">Phiên bản</h3>
          <p id="settings-version" className="mt-0.5 text-sm text-ink-2">
            Knowledge Hub{' '}
            <span className="font-mono text-xs text-ink-1">{update.currentVersion}</span>
          </p>
        </div>

        {update.status !== 'unsupported' && (
          <Button
            id="btn-check-update"
            variant="subtle"
            disabled={busy || checking || update.status === 'downloading'}
            onClick={() => void checkForUpdate()}
          >
            <RefreshCw className={`size-4 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Đang kiểm tra…' : 'Kiểm tra bản mới'}
          </Button>
        )}
      </div>

      <UpdateStatusLine />

      {update.status === 'available' && (
        <Button
          id="btn-download-update-settings"
          variant="primary"
          className="mt-3"
          disabled={busy}
          onClick={() => void downloadUpdate()}
        >
          <Download className="size-4" />
          Tải bản {update.availableVersion}
        </Button>
      )}

      {update.status === 'downloaded' && (
        <Button
          id="btn-install-update-settings"
          variant="primary"
          className="mt-3"
          disabled={busy}
          onClick={() => void installUpdate()}
        >
          <RotateCcw className="size-4" />
          Khởi động lại & cập nhật
        </Button>
      )}
    </section>
  )
}

/** One sentence describing where the flow is. */
function UpdateStatusLine() {
  const { update } = useVault()
  if (!update) return null

  const when =
    update.checkedAt !== null ? ` · đã kiểm tra ${formatRelativeDate(update.checkedAt)}` : ''

  switch (update.status) {
    case 'unsupported':
      return (
        <p id="settings-update-status" className="text-sm leading-relaxed text-ink-3">
          Bản này không tự cập nhật được — đây là bản chạy từ mã nguồn hoặc bản chép tay. Chỉ bản
          cài đặt tải từ trang phát hành mới nhận được cập nhật tự động.
        </p>
      )
    case 'available':
      return (
        <p id="settings-update-status" className="text-sm text-accent">
          Đã có phiên bản {update.availableVersion}.
        </p>
      )
    case 'downloading':
      return (
        <div id="settings-update-status">
          <ProgressBar
            percent={update.percent ?? 0}
            tone="var(--color-accent)"
            label={`Đang tải bản cập nhật: ${update.percent ?? 0}%`}
          />
          <p className="mt-1.5 text-sm text-ink-3">
            Đang tải {update.availableVersion}… {update.percent ?? 0}%
          </p>
        </div>
      )
    case 'downloaded':
      return (
        <p id="settings-update-status" className="text-sm text-success">
          Đã tải xong {update.availableVersion}, sẵn sàng cài đặt.
        </p>
      )
    case 'not-available':
      return (
        <p id="settings-update-status" className="flex items-center gap-1.5 text-sm text-ink-3">
          <Check className="size-4 text-success" aria-hidden />
          Bạn đang dùng phiên bản mới nhất{when}.
        </p>
      )
    case 'error':
      return (
        <p id="settings-update-status" className="text-sm text-danger">
          {messageFor(update.error ?? '')}
        </p>
      )
    default:
      return (
        <p id="settings-update-status" className="text-sm text-ink-3">
          Ứng dụng tự kiểm tra một lần sau khi mở, và không bao giờ tải hay cài đặt nếu bạn chưa
          đồng ý{when}.
        </p>
      )
  }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/**
 * Where the data is.
 *
 * The vault deliberately lives outside the application directory and may sit
 * on another drive, so this screen exists to answer "where are my files?"
 * without the user having to read the source or the docs.
 */
function StorageTab() {
  const { vaultInfo, openVaultFolder } = useVault()

  if (!vaultInfo) return <Spinner />

  return (
    <div role="tabpanel" aria-labelledby="tab-settings-storage">
      <div className="mb-6 flex items-center gap-3">
        <div className="rounded-xl bg-surface-2 p-2.5">
          <HardDrive className="size-5 text-accent" aria-hidden />
        </div>
        <div>
          <h2 className="text-base font-semibold">Nơi lưu trữ</h2>
          <p className="text-xs text-ink-3">
            Toàn bộ dữ liệu nằm trên máy bạn. Không có máy chủ, không có tài khoản.
          </p>
        </div>
      </div>

      <section className="mb-6 rounded-[14px] border border-surface-3 bg-surface-1 p-5">
        <PathRow id="settings-data-dir" label="Thư mục dữ liệu" value={vaultInfo.dataDir} />
        <PathRow id="settings-db-path" label="Tệp cơ sở dữ liệu" value={vaultInfo.databasePath} />
        <PathRow id="settings-assets-dir" label="Thư mục tệp" value={vaultInfo.assetsDir} />
        <PathRow id="settings-notes-dir" label="Thư mục ghi chú" value={vaultInfo.notesDir} />

        <Button id="btn-open-vault-folder" variant="primary" onClick={() => void openVaultFolder()}>
          <FolderOpen className="size-4" />
          Mở thư mục dữ liệu
        </Button>
      </section>

      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat id="stat-categories" label="Nhóm" value={String(vaultInfo.categoryCount)} />
        <Stat id="stat-items" label="Tài liệu" value={String(vaultInfo.itemCount)} />
        <Stat id="stat-assets" label="Tệp" value={String(vaultInfo.assetCount)} />
        <Stat id="stat-notes" label="Ghi chú" value={String(vaultInfo.noteCount)} />
        <Stat id="stat-checklists" label="Checklist" value={String(vaultInfo.checklistCount)} />
        <Stat id="stat-size" label="Dung lượng" value={formatBytes(vaultInfo.totalAssetBytes)} />
      </section>

      <UpdateSection />

      <section className="rounded-[14px] border border-surface-3 bg-surface-1 p-5 text-sm leading-relaxed text-ink-2">
        <h3 className="mb-2 font-medium text-ink-1">Sao lưu và di chuyển</h3>
        <p className="mb-3">
          Mỗi ghi chú còn được ghi ra một tệp <Code>.md</Code> hoặc <Code>.txt</Code> trong thư mục
          ghi chú ở trên, kèm phần đầu ghi rõ tiêu đề, loại và thời hạn — mở bằng bất kỳ trình soạn
          thảo nào cũng đọc được.
        </p>
        <p className="mb-3">
          Checklist thì ngược lại: chúng chỉ nằm trong tệp cơ sở dữ liệu, không có bản sao ra tệp
          riêng. Bản sao lưu nào thiếu <Code>knowledge.db</Code> là mất toàn bộ kế hoạch.
        </p>
        <p className="mb-3">
          Sao chép toàn bộ thư mục dữ liệu ở trên là đã sao lưu đầy đủ — cả chỉ mục lẫn tệp gốc. Để
          chuyển sang ổ khác, đóng ứng dụng, di chuyển thư mục, rồi sửa <Code>KB_DATA_DIR</Code>{' '}
          trong tệp <Code>.env</Code>.
        </p>
        <p className="mb-3 text-xs text-ink-3">
          Lựa chọn giao diện ở tab bên cạnh không nằm trong thư mục này — chúng thuộc về máy đang
          dùng, nên sao lưu vault không mang chúng theo.
        </p>
        <p className="text-xs text-ink-3">
          Phiên bản lược đồ cơ sở dữ liệu: v{vaultInfo.schemaVersion}
        </p>
      </section>
    </div>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{children}</code>
}

function PathRow({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div className="mb-4">
      <p className="mb-1 text-xs font-medium text-ink-3">{label}</p>
      <p
        id={id}
        className="break-all rounded-lg bg-surface-0 px-3 py-2 font-mono text-[13px] text-ink-1"
      >
        {value}
      </p>
    </div>
  )
}

function Stat({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div className="rounded-[14px] border border-surface-3 bg-surface-1 px-4 py-3">
      <p className="text-xs text-ink-3">{label}</p>
      <p id={id} className="mt-0.5 text-lg font-semibold tabular-nums">
        {value}
      </p>
    </div>
  )
}
