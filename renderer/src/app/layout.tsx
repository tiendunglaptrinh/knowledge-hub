import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Knowledge Hub',
  description: 'Kho kiến thức cá nhân — lưu trữ hoàn toàn trên máy của bạn.',
}

export const viewport: Viewport = {
  themeColor: '#0b1020',
}

/**
 * Content Security Policy for the renderer.
 *
 * `script-src` must include `'unsafe-inline'`. A statically exported Next app
 * bootstraps through inline `<script>` tags, and the two ways to allow those
 * — a per-request nonce or a build-time hash list — both need a server we do
 * not have. Without it the page loads and never hydrates.
 *
 * That is an honest weakening, so it is worth being precise about what the
 * policy still buys. Every script in this window comes from the local bundle;
 * there is no remote content, no user-supplied HTML that reaches the DOM
 * unsanitised (see AssetViewer), and no network origin to exfiltrate to. The
 * policy still blocks remote script hosts, `<object>`/`<embed>`, form
 * submission and base-tag hijacking.
 *
 * The real isolation boundary is not this header — it is `contextIsolation`,
 * `sandbox`, `nodeIntegration: false` and the fixed method list in the preload
 * bridge. See docs/07-security.md.
 *
 * `'unsafe-eval'` is development-only: the Next dev server needs it for hot
 * reload. `NODE_ENV` is substituted at build time, so the packaged policy does
 * not contain it.
 */
const CSP = [
  "default-src 'self' app:",
  process.env.NODE_ENV === 'production'
    ? "script-src 'self' app: 'unsafe-inline'"
    : "script-src 'self' app: 'unsafe-inline' 'unsafe-eval'",
  // Next injects a style element at runtime; Tailwind output is a static file.
  "style-src 'self' app: 'unsafe-inline'",
  // `data:` is how mammoth embeds images extracted from a .docx.
  "img-src 'self' app: data: blob:",
  "font-src 'self' app: data:",
  // Chromium's built-in PDF viewer renders a stored file in an iframe.
  "frame-src app: blob:",
  process.env.NODE_ENV === 'production'
    ? "connect-src 'self' app:"
    : "connect-src 'self' app: ws://localhost:3100 http://localhost:3100",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

/**
 * Applies the saved appearance before the first paint.
 *
 * Without this the window draws in the dark default, React mounts, and only
 * then does the chosen theme arrive — a white flash on the light theme, on
 * every launch. React cannot prevent it: reading `localStorage` during the
 * first render would disagree with the prerendered HTML and the tree would be
 * thrown away.
 *
 * So it runs synchronously in `<head>`, before `<body>` exists. It is
 * deliberately dumb — it validates, sets variables, and gives up silently. The
 * parse that actually decides the session's state is `parsePrefs` in
 * lib/prefs.tsx, which runs a moment later and overwrites all of this.
 *
 * `--font-stack-*` are defined in globals.css, so the names below are the only
 * thing duplicated here — never a font list. `KEY` and the variable names must
 * stay in step with `PREFS_KEY` and `apply()` in lib/prefs.tsx.
 *
 * The preload bridge is installed before any page script runs, which is why the
 * zoom factor can be restored from here too.
 */
const PREPAINT = `
try {
  var KEY = 'kb.prefs';
  var p = JSON.parse(localStorage.getItem(KEY) || '{}');
  var r = document.documentElement;
  var safe = /^[a-z]+$/;
  if (['dark','light','sepia','contrast'].indexOf(p.theme) >= 0) r.dataset.theme = p.theme;
  if (safe.test(p.uiFont || '')) r.style.setProperty('--ui-font', 'var(--font-stack-' + p.uiFont + ')');
  if (safe.test(p.docFont || '')) r.style.setProperty('--doc-font', 'var(--font-stack-' + p.docFont + ')');
  if (safe.test(p.monoFont || '')) r.style.setProperty('--mono-font', 'var(--font-stack-' + p.monoFont + ')');
  if (typeof p.contentScale === 'number' && p.contentScale > 0)
    r.style.setProperty('--content-scale', String(p.contentScale));
  if (typeof p.appZoom === 'number' && p.appZoom > 0 && window.knowledgeHub)
    window.knowledgeHub.view.setZoomFactor(p.appZoom);
} catch (e) {}
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <head>
        <meta httpEquiv="Content-Security-Policy" content={CSP} />
        {/* Inline on purpose: an external file would be fetched after paint,
            which is the flash this exists to prevent. Allowed by the
            `'unsafe-inline'` in `script-src` that the static export needs
            anyway — see the note on CSP above. */}
        <script dangerouslySetInnerHTML={{ __html: PREPAINT }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
