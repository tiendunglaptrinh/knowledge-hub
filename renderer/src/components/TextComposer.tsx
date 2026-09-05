'use client'

/**
 * The writing surface: Markdown source beside its live review.
 *
 * One component, two callers — the note editor and the document editor. They
 * are the same problem, and two implementations would drift into two
 * behaviours for the same keystrokes. The review renders through
 * `lib/markdown.ts`, which is also what the viewer for a stored `.md` uses, so
 * a document looks the same while it is being written as it does afterwards.
 *
 * Plain text gets a single pane. A preview of unformatted text is the same
 * text in a different font, and offering the toggle anyway would be a control
 * that visibly does nothing.
 */

import { Columns2, Eye, Pencil } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { TextFormat } from '@shared/types'
import { renderMarkdown } from '@/lib/markdown'
import {
  CONTENT_SCALE_MAX,
  CONTENT_SCALE_MIN,
  useContentZoomWheel,
  usePrefs,
} from '@/lib/prefs'
import { ZoomControl } from './ui'

/** Which of the two sections is on screen. */
export type ComposerPane = 'source' | 'split' | 'review'

const PANES: Array<{ value: ComposerPane; label: string; icon: typeof Pencil }> = [
  { value: 'source', label: 'Soạn thảo', icon: Pencil },
  { value: 'split', label: 'Chia đôi', icon: Columns2 },
  { value: 'review', label: 'Xem trước', icon: Eye },
]

export function TextComposer({
  idPrefix,
  format,
  value,
  onChange,
  placeholder,
  meta,
  autoFocus,
}: {
  /** Element ids are `<prefix>-source`, `<prefix>-review`, `btn-<prefix>-pane-*`. */
  idPrefix: string
  format: TextFormat
  value: string
  onChange: (next: string) => void
  placeholder?: string
  /** Right-hand side of the toolbar — character count, target filename, … */
  meta?: React.ReactNode
  autoFocus?: boolean
}) {
  const [pane, setPane] = useState<ComposerPane>('split')
  const sourceRef = useRef<HTMLTextAreaElement>(null)
  const reviewRef = useRef<HTMLDivElement>(null)

  const { contentScale, stepContentScale, resetContentScale } = usePrefs()
  const zoomRef = useContentZoomWheel<HTMLDivElement>()

  const html = useMemo(
    () => (format === 'markdown' ? renderMarkdown(value) : ''),
    [format, value],
  )

  useEffect(() => {
    if (autoFocus) sourceRef.current?.focus()
  }, [autoFocus])

  /**
   * Keep the review roughly where the source is.
   *
   * Proportional rather than block-mapped: mapping source lines to rendered
   * blocks needs the parser to emit positions, and being approximately right
   * is worth far more here than being exactly right — without it, editing the
   * bottom of a long document means watching the top of the preview.
   */
  function syncScroll() {
    const source = sourceRef.current
    const review = reviewRef.current
    if (!source || !review || pane !== 'split') return

    const scrollable = source.scrollHeight - source.clientHeight
    if (scrollable <= 0) return

    const ratio = source.scrollTop / scrollable
    review.scrollTop = ratio * (review.scrollHeight - review.clientHeight)
  }

  const plain = format === 'text'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-surface-3 px-6 py-2">
        {!plain &&
          PANES.map(({ value: paneValue, label, icon: Icon }) => (
            <button
              key={paneValue}
              id={`btn-${idPrefix}-pane-${paneValue}`}
              onClick={() => setPane(paneValue)}
              aria-pressed={pane === paneValue}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition
                ${
                  pane === paneValue
                    ? 'bg-accent-soft text-ink-1'
                    : 'text-ink-3 hover:bg-surface-2 hover:text-ink-1'
                }`}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </button>
          ))}
        {meta && <span className="ml-auto text-[11px] text-ink-3">{meta}</span>}

        {/* Scales the writing surface and the preview, not the chrome. The
            application-wide equivalent is Ctrl+= / Ctrl+− — see lib/prefs.tsx. */}
        <span className={meta ? 'ml-3' : 'ml-auto'}>
          <ZoomControl
            id="zoom-composer"
            label="Cỡ chữ nội dung"
            hint="Cỡ chữ khung soạn thảo và khung xem trước — hoặc giữ Ctrl và cuộn chuột"
            scale={contentScale}
            onStep={stepContentScale}
            onReset={resetContentScale}
            atMin={contentScale <= CONTENT_SCALE_MIN}
            atMax={contentScale >= CONTENT_SCALE_MAX}
          />
        </span>
      </div>

      <div className="flex min-h-0 flex-1" ref={zoomRef}>
        {(plain || pane !== 'review') && (
          <section
            className={`flex min-w-0 flex-col ${
              !plain && pane === 'split' ? 'w-1/2 border-r border-surface-3' : 'flex-1'
            }`}
          >
            {!plain && <SectionLabel>Markdown</SectionLabel>}
            <textarea
              id={`${idPrefix}-source`}
              ref={sourceRef}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onScroll={syncScroll}
              spellCheck={false}
              placeholder={placeholder}
              className={`min-h-0 flex-1 resize-none bg-surface-0 outline-none placeholder:text-ink-3
                text-ink-1 leading-relaxed ${plain ? 'px-8 py-5' : 'px-6 py-4 font-mono'}`}
              // Sized here rather than with a utility so it can follow the
              // content scale. Plain prose reads a shade larger than source.
              style={{
                fontSize: `calc(${plain ? 14 : 13}px * var(--content-scale))`,
                // Markdown source is code and takes the monospace setting via
                // `font-mono`; a plain-text note is prose, so it should be
                // written in the same family it will be read in.
                ...(plain ? { fontFamily: 'var(--doc-font)' } : {}),
              }}
            />
          </section>
        )}

        {!plain && pane !== 'source' && (
          <section className={`flex min-w-0 flex-col ${pane === 'split' ? 'w-1/2' : 'flex-1'}`}>
            <SectionLabel>Xem trước</SectionLabel>
            <div ref={reviewRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              {value.trim().length === 0 ? (
                <p className="text-sm italic text-ink-3">Chưa có nội dung để xem trước.</p>
              ) : (
                <article
                  id={`${idPrefix}-review`}
                  className="doc-prose"
                  // Sanitised in renderMarkdown; see lib/markdown.ts.
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-b border-surface-3 bg-surface-1 px-6 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
      {children}
    </p>
  )
}
