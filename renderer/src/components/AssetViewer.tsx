'use client'

/**
 * Renders one stored file.
 *
 * Division of labour with the main process:
 *   pdf, image   main returns an `app://asset/…` URL; Chromium does the rest
 *   word         main converts .docx to HTML with mammoth; this sanitises it
 *   markdown     main returns the source; this parses AND sanitises it
 *   text         main returns the source; shown verbatim in a <pre>
 *   other        no viewer — offer the OS default application instead
 *
 * Markdown is parsed here rather than in the main process on purpose: parser
 * and sanitiser then live in the same place, and there is no moment where
 * unsanitised HTML exists as a string that someone might later render. Both
 * live in `lib/markdown.ts`, shared with the note editor's review pane so the
 * two cannot render the same source differently.
 */

import { ExternalLink, FileQuestion, FolderOpen, PenLine } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import type { Asset, RenderedAsset } from '@shared/types'
import { bridge, codeOf, unwrap } from '@/lib/bridge'
import { formatBytes } from '@/lib/format'
import { renderMarkdown, sanitizeHtml } from '@/lib/markdown'
import { messageFor } from '@/lib/messages'
import {
  CONTENT_SCALE_MAX,
  CONTENT_SCALE_MIN,
  useContentZoomWheel,
  usePrefs,
} from '@/lib/prefs'
import { Button, Spinner, ZoomControl } from './ui'

export function AssetViewer({ asset, onEdit }: { asset: Asset; onEdit?: () => void }) {
  const [rendered, setRendered] = useState<RenderedAsset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const zoomRef = useContentZoomWheel<HTMLDivElement>()

  useEffect(() => {
    let cancelled = false
    setRendered(null)
    setError(null)

    void (async () => {
      try {
        const result = unwrap(await bridge().asset.render(asset.id))
        if (!cancelled) setRendered(result)
      } catch (caught) {
        if (!cancelled) setError(messageFor(codeOf(caught)))
      }
    })()

    // Switching assets quickly must not let a slow conversion overwrite the
    // newer one.
    return () => {
      cancelled = true
    }
  }, [asset.id])

  const html = useMemo(() => {
    if (!rendered) return null

    if (rendered.kind === 'word' && rendered.html !== undefined) {
      return sanitizeHtml(rendered.html)
    }
    if (rendered.kind === 'markdown' && rendered.text !== undefined) {
      return renderMarkdown(rendered.text)
    }
    return null
  }, [rendered])

  if (error) {
    return <ViewerFallback asset={asset} message={error} />
  }
  if (!rendered) {
    return <Spinner label="Đang mở tài liệu…" />
  }

  switch (rendered.kind) {
    case 'pdf':
      return (
        <iframe
          id={`viewer-pdf-${asset.id}`}
          src={rendered.url}
          title={asset.filename}
          className="h-full w-full border-0 bg-surface-0"
        />
      )

    case 'image':
      return (
        <div className="flex h-full items-center justify-center overflow-auto bg-surface-0 p-6">
          {/* Not next/image: the source is a custom protocol and the static
              export ships no image optimiser. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            id={`viewer-image-${asset.id}`}
            src={rendered.url}
            alt={asset.filename}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      )

    case 'markdown':
    case 'word':
      return (
        <div className="relative h-full overflow-y-auto px-8 py-6" ref={zoomRef}>
          <ReaderTools onEdit={rendered.kind === 'markdown' ? onEdit : undefined} />
          {rendered.warnings.length > 0 && (
            <details
              id={`viewer-warnings-${asset.id}`}
              className="mb-5 rounded-lg border border-surface-3 bg-surface-1 px-4 py-2.5 text-xs text-ink-3"
            >
              <summary className="cursor-pointer">
                {rendered.warnings.length} chi tiết định dạng không chuyển đổi được
              </summary>
              <ul className="mt-2 space-y-1 pl-4">
                {rendered.warnings.slice(0, 20).map((warning, index) => (
                  <li key={index} className="list-disc">
                    {warning}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <article
            id={`viewer-doc-${asset.id}`}
            className="doc-prose"
            // Sanitised immediately above; see PURIFY_CONFIG.
            dangerouslySetInnerHTML={{ __html: html ?? '' }}
          />
        </div>
      )

    case 'text':
      return (
        <div className="relative h-full" ref={zoomRef}>
          <ReaderTools onEdit={onEdit} />
          <pre
            id={`viewer-text-${asset.id}`}
            className="h-full overflow-auto bg-surface-0 px-8 py-6 font-mono leading-relaxed text-ink-1"
            // Follows the content scale, like every other reading surface.
            style={{ fontSize: 'calc(13px * var(--content-scale))' }}
          >
            {rendered.text}
          </pre>
        </div>
      )

    case 'other':
    default:
      return (
        <ViewerFallback
          asset={asset}
          message="Định dạng này chưa có trình xem trong ứng dụng. Tệp vẫn được lưu trữ an toàn."
        />
      )
  }
}

/**
 * Floats over the document rather than sitting in a toolbar above it.
 *
 * A permanent bar would cost every reader vertical space to advertise actions
 * most of them are not taking — the common case here is reading. It stays
 * visible rather than appearing on hover, because a control nobody knows exists
 * is not a feature.
 *
 * Zoom comes first and is always present: making a document readable is the
 * thing a reader is most likely to want. `Sửa` only appears for the formats the
 * editor accepts, which is why `onEdit` is optional — a `.docx` has no editor,
 * so it must not be offered one.
 */
function ReaderTools({ onEdit }: { onEdit?: () => void }) {
  const { contentScale, stepContentScale, resetContentScale } = usePrefs()

  return (
    <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
      <ZoomControl
        id="zoom-viewer"
        label="Cỡ chữ tài liệu"
        hint="Cỡ chữ của tài liệu này — hoặc giữ Ctrl và cuộn chuột"
        scale={contentScale}
        onStep={stepContentScale}
        onReset={resetContentScale}
        atMin={contentScale <= CONTENT_SCALE_MIN}
        atMax={contentScale >= CONTENT_SCALE_MAX}
      />

      {onEdit && (
        <button
          id="btn-edit-asset"
          onClick={onEdit}
          title="Sửa nội dung tệp này"
          className="inline-flex items-center gap-1.5 rounded-lg border border-surface-3
            bg-surface-1/95 px-2.5 py-1.5 text-xs text-ink-2 shadow-lg backdrop-blur
            transition hover:border-accent/50 hover:text-ink-1"
        >
          <PenLine className="size-3.5" aria-hidden />
          Sửa
        </button>
      )}
    </div>
  )
}

function ViewerFallback({ asset, message }: { asset: Asset; message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="rounded-2xl bg-surface-2 p-4">
        <FileQuestion className="size-7 text-ink-3" aria-hidden />
      </div>
      <div>
        <p className="text-sm text-ink-1">{asset.filename}</p>
        <p className="mt-1 text-xs text-ink-3">
          {asset.ext.toUpperCase() || 'Tệp'} · {formatBytes(asset.sizeBytes)}
        </p>
      </div>
      <p id="message-viewer-fallback" className="max-w-sm text-sm text-ink-3">
        {message}
      </p>
      <div className="flex gap-2">
        <Button
          id={`btn-open-external-${asset.id}`}
          variant="primary"
          onClick={() => void bridge().asset.openExternal(asset.id)}
        >
          <ExternalLink className="size-4" />
          Mở bằng ứng dụng ngoài
        </Button>
        <Button
          id={`btn-reveal-${asset.id}`}
          onClick={() => void bridge().asset.revealInFolder(asset.id)}
        >
          <FolderOpen className="size-4" />
          Mở thư mục chứa
        </Button>
      </div>
    </div>
  )
}
