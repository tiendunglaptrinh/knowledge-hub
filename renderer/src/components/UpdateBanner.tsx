'use client'

import { Download, RefreshCw, RotateCcw, X } from 'lucide-react'
import { useState } from 'react'

import { useVault } from '@/lib/store'
import { Button, ProgressBar } from './ui'

/**
 * "There is a newer version" — and nothing more forceful than that.
 *
 * The application never downloads or installs on its own (see
 * `UpdateService`), so this strip is the entire update experience: it appears
 * when the feed reports a newer version, and every step after that is a click
 * the user makes.
 *
 * It is dismissible, and dismissal is remembered only for the session. A user
 * who does not want to update today should not have to re-read the same strip
 * every time they change screens — but should be told again next launch,
 * because an update they never install is a bug they keep.
 *
 * Nothing renders in the states that are not worth a strip across the top:
 * `idle`, `checking`, `not-available`, `unsupported`, and `error` all report
 * themselves in Settings instead, where the user went looking for them.
 */
export function UpdateBanner() {
  const { update, downloadUpdate, installUpdate, busy } = useVault()
  const [dismissed, setDismissed] = useState<string | null>(null)

  if (!update) return null
  if (update.availableVersion !== null && dismissed === update.availableVersion) return null

  const version = update.availableVersion

  if (update.status === 'available') {
    return (
      <Strip onDismiss={() => setDismissed(version)}>
        <span className="min-w-0 flex-1">
          Đã có phiên bản <strong className="font-semibold">{version}</strong>. Bạn đang dùng{' '}
          {update.currentVersion}.
        </span>
        <Button
          id="btn-download-update"
          variant="primary"
          disabled={busy}
          onClick={() => void downloadUpdate()}
        >
          <Download className="size-4" />
          Tải bản mới
        </Button>
      </Strip>
    )
  }

  if (update.status === 'downloading') {
    return (
      <Strip>
        <span className="shrink-0">Đang tải {version}…</span>
        <ProgressBar
          id="progress-update"
          percent={update.percent ?? 0}
          tone="var(--color-accent)"
          label={`Đang tải bản cập nhật: ${update.percent ?? 0}%`}
          className="max-w-xs"
        />
        <span className="shrink-0 tabular-nums">{update.percent ?? 0}%</span>
      </Strip>
    )
  }

  if (update.status === 'downloaded') {
    return (
      <Strip onDismiss={() => setDismissed(version)}>
        <span className="min-w-0 flex-1">
          Đã tải xong <strong className="font-semibold">{version}</strong>. Khởi động lại để cài
          đặt — công việc đang mở sẽ được lưu như bình thường.
        </span>
        <Button
          id="btn-install-update"
          variant="primary"
          disabled={busy}
          onClick={() => void installUpdate()}
        >
          <RotateCcw className="size-4" />
          Khởi động lại & cập nhật
        </Button>
      </Strip>
    )
  }

  return null
}

function Strip({
  children,
  onDismiss,
}: {
  children: React.ReactNode
  onDismiss?: () => void
}) {
  return (
    <div
      id="banner-update"
      role="status"
      className="flex items-center gap-3 border-b border-accent/30 bg-accent-soft px-6 py-2.5 text-sm text-ink-1"
    >
      <RefreshCw className="size-4 shrink-0 text-accent" aria-hidden />
      {children}
      {onDismiss && (
        <button
          id="btn-dismiss-update"
          onClick={onDismiss}
          aria-label="Để sau"
          title="Để sau — sẽ nhắc lại ở lần mở tiếp theo"
          className="shrink-0 rounded p-1 text-ink-3 transition hover:text-ink-1"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}
