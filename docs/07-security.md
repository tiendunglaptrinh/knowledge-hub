# 07 · Security

## Threat model

A single-user, offline desktop application has a narrow but real threat surface. Being explicit
about what is and is not being defended against keeps the mitigations proportionate.

### In scope

| Threat | Why it is real |
|---|---|
| **A malicious or malformed document** | The user imports files from the internet. A `.docx` is a zip of XML that a converter parses; the HTML it produces is then put into the DOM. |
| **Path traversal from the renderer** | The renderer supplies a `relPath` that becomes a filesystem read through the `app://asset/…` handler. |
| **A supply-chain compromise in a renderer dependency** | `marked`, `dompurify`, `lucide-react` and React all execute in the renderer. |
| **Accidental data destruction** | Not an attacker, but the same outcome. A misclick that deletes a category's worth of documents is the most likely real loss. |

### Out of scope

| Not defended against | Why |
|---|---|
| An attacker with local shell access | They can read the vault directly. Nothing the application does changes that. |
| Physical theft of the machine | Encryption at rest is the operating system's job (BitLocker, LUKS). |
| A malicious main-process dependency | It runs with the user's full privileges by definition. Mitigated by having few dependencies, not by a sandbox. |
| Network attackers | There is no network code. No server, no fetch, no telemetry. |

---

## Process isolation

```ts
webPreferences: {
  contextIsolation: true,     // renderer JS and preload JS in separate contexts
  nodeIntegration: false,     // no require, no process, no Buffer in the renderer
  sandbox: true,              // OS-level sandbox on the renderer process
  plugins: true,              // required for the built-in PDF viewer
  webSecurity: !isDev,        // dev serves over http from localhost
  spellcheck: false,
}
```

The first three are the actual boundary. With them set, a renderer that is fully compromised —
arbitrary JavaScript execution — still cannot open a file, spawn a process, or reach the
network beyond what Chromium's sandbox permits. Its entire reach is the preload bridge.

`plugins: true` is worth noting because it sounds like a weakening. It is not the old NPAPI
plugin system; it enables Chromium's bundled PDF viewer, which is what renders a stored PDF in
an `<iframe>`. Without it a PDF would have to be handed off to an external application.

---

## The bridge is the whole surface

`src/preload/preload.ts` exposes exactly twenty-six methods. Each is a one-line
`ipcRenderer.invoke` on a channel declared in the shared contract. There is no
`invoke(channel, payload)` escape hatch, because that would make the answer to "what can the
renderer do?" unbounded rather than enumerable.

Reviewing the security of the renderer boundary means reading one file, once.

The preload itself runs sandboxed, so it has no `require`, no `fs`, and nothing from Node
beyond what Electron exposes to a sandboxed preload: `ipcRenderer`, `contextBridge` and
`webUtils`.

`webUtils.getPathForFile` is the single reason `webUtils` is imported. Electron 32 removed
`File.path`; this is its supported replacement, and it is what makes drag-and-drop possible at
all. It converts a `File` the user dropped into a path — it cannot enumerate the filesystem.

---

## Path traversal

Every filesystem access in both halves of the vault — `FsAssetStore` and `FsNoteStore` — goes
through one function, `resolveInVault` in `src/storage/fs/vault-path.ts`. It lives in its own
file for exactly one reason: a second copy of this check is a second place to get it wrong.

```ts
export function resolveInVault(rootDir: string, relPath: string): string {
  const absolute = path.resolve(rootDir, relPath)
  const prefix = rootDir + path.sep
  if (absolute !== rootDir && !absolute.startsWith(prefix)) {
    throw new AppError(ErrorCode.VAULT_PATH_ESCAPE, …)
  }
  return absolute
}
```

This matters because the `app://asset/…` protocol handler turns a renderer-supplied string into
a `net.fetch` of a `file://` URL. `app://asset/../../../etc/passwd` has to be impossible, not
merely unlikely.

Resolving first and then comparing against the root is the correct order: it normalises `..`,
symlink-free relative segments and mixed separators before the check, rather than trying to
pattern-match dangerous input.

The renderer half of the protocol handler applies the same check against the renderer root.

Covered by a smoke check (`path traversal refused`).

---

## HTML sanitisation

A `.docx` becomes HTML through mammoth, and that HTML is inserted with
`dangerouslySetInnerHTML`. Markdown becomes HTML through `marked` and takes the same route —
whether it came from a stored `.md` file or from the note the user is typing right now, since
the note editor's review pane renders live.

All of it goes through one module, `renderer/src/lib/markdown.ts`, which exports
`renderMarkdown` (parse **and** sanitise) and `sanitizeHtml`, and deliberately does not export
a parse-without-sanitising function — that is the shape of the bug this arrangement exists to
prevent. Both pass through DOMPurify:

```ts
const PURIFY_CONFIG: PurifyConfig = {
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'meta'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'style'],
  ALLOW_DATA_ATTR: false,
}
```

`data:` URIs survive in `img-src` because that is how mammoth embeds images extracted from a
Word file. Inline `style` attributes are dropped: they cannot execute, but they can absolutely
be used to make a document overlay the application's own chrome.

**Markdown is parsed in the renderer, not the main process.** Sending source rather than HTML
means the parser and the sanitiser sit on the same side of the boundary, and there is never a
moment where unsanitised HTML exists as a string that some later code path might render
directly.

---

## Content Security Policy

Set as a `<meta>` tag in `renderer/src/app/layout.tsx`.

```
default-src 'self' app:
script-src  'self' app: 'unsafe-inline'          ← production
style-src   'self' app: 'unsafe-inline'
img-src     'self' app: data: blob:
font-src    'self' app: data:
frame-src   app: blob:
connect-src 'self' app:                          ← production
object-src  'none'
base-uri    'none'
form-action 'none'
```

### `'unsafe-inline'` on scripts, honestly

A statically exported Next application bootstraps through inline `<script>` tags. The two ways
to allow those — a per-request nonce or a build-time hash list — both need a server, which this
application does not have. Without `'unsafe-inline'` the page loads and never hydrates. This
was confirmed empirically: the first build produced a blank window and a console full of
`Refused to execute inline script`.

That is a genuine weakening, so it is worth being precise about what the policy still buys:

- every script in this window comes from the local bundle; there is no remote origin
- no user-supplied HTML reaches the DOM unsanitised
- there is no network origin to exfiltrate to
- remote script hosts, `<object>`/`<embed>`, form submission and base-tag hijacking are still
  blocked

**The CSP is defence in depth here, not the boundary.** The boundary is `contextIsolation`,
`sandbox`, `nodeIntegration: false` and the fixed preload method list. A CSP bypass in the
renderer buys an attacker the same twenty-six operations they already had.

`'unsafe-eval'` is development-only — the Next dev server needs it for hot reload. `NODE_ENV`
is substituted at build time, so it is absent from the packaged policy.

---

## Navigation

```ts
window.webContents.setWindowOpenHandler(({ url }) => {
  if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
  return { action: 'deny' }
})

window.webContents.on('will-navigate', (event, url) => {
  const allowed = isDev ? url.startsWith('http://localhost:') : url.startsWith(RENDERER_ORIGIN)
  if (!allowed) { event.preventDefault(); if (url.startsWith('http')) void shell.openExternal(url) }
})
```

A link inside a rendered document must open in the user's browser, never as a new Electron
window — a new window would inherit the preload and hand the bridge to a remote page. The same
reasoning applies to in-place navigation: this window shows our renderer and nothing else, for
its whole lifetime.

---

## The `app://` scheme

Registered as `standard` and `secure` before `app.whenReady()`, because Chromium reads the
privilege table while bootstrapping the network service and a later registration is silently
ignored.

Using a custom scheme rather than `file://` is partly a security decision and partly a
practical one. `file://` has an opaque origin, which disables anything keyed on origin and
makes a sane CSP impossible to express. A registered standard scheme gives the renderer a real,
stable origin — `app://kb` — that `'self'` can refer to.

Two hosts, one handler: `app://kb/…` serves the renderer bundle (packaged builds only),
`app://asset/…` streams a file from the vault. `stream: true` in the privilege table is what
enables range requests, which the PDF viewer needs to page through a large document.

---

## Data safety

Not a security property in the classical sense, but the failure the user is most likely to
actually experience.

| Risk | Mitigation |
|---|---|
| Deleting a category destroys its documents | Refused while non-empty — at the service (`CATEGORY_NOT_EMPTY`) *and* in the schema (`ON DELETE RESTRICT`) |
| Deleting anything by misclick | A confirmation dialog naming the thing and what goes with it, for documents, files, categories and notes alike |
| A crash leaves a row pointing at a missing file | Copy the file first, insert the row second, unwind on failure ([ADR 0005](adr/0005-copy-then-insert.md)) |
| Import destroys the user's original | Files are copied, never moved. Covered by a smoke check |
| An index rebuild is impossible | `item.json` sidecar beside every item's files |
| A note exists only in the index | Every note is mirrored to a `.md`/`.txt` with its metadata in front matter |

---

## Dependency posture

The main process has two runtime dependencies: `better-sqlite3` and `mammoth`. Everything else
— React, Next, Tailwind, marked, DOMPurify, lucide — is a build-time dependency bundled into
the static renderer, and Electron and electron-builder are development tools.

Keeping the runtime list at two is deliberate. Those two run with the user's full privileges,
and no sandbox changes that; the only real mitigation is for the list to be short enough to
audit.

`npm audit` currently reports findings in the `electron-builder` dependency tree. Those are
packaging-time tools that never ship in the application bundle. Findings in `better-sqlite3` or
`mammoth` would be a different matter and should be treated as such.
