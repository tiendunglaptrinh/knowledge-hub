# 0006 · Render each format where it is cheapest, and decline the rest

**Status:** Accepted
**Date:** 2026-08-01

## Context

Documents arrive in several formats and each needs a different treatment. Two questions had to
be answered per format: *which process does the work*, and *is it worth supporting at all*.

The constraints:

- A 200 MB PDF must not travel through IPC.
- HTML produced from a user's document ends up in the DOM and must be sanitised.
- The renderer bundle should stay small; the main process should not pay startup cost for a
  converter that may go unused.
- Getting a format *slightly* wrong is worse than not supporting it, because the user then
  trusts a bad rendering.

## Decision

| Format | Where the work happens | What crosses IPC |
|---|---|---|
| PDF, images | Chromium, streaming from `app://asset/…` | A URL |
| `.docx` | mammoth, in the main process | HTML string |
| Markdown | `marked`, in the **renderer** | The source text |
| Text | Nowhere | The source text |
| Everything else | Not rendered | Nothing |

### PDF and images: a URL, not bytes

The `app://asset/…` protocol handler streams the file. `stream: true` in the scheme privileges
enables range requests, which is what lets the PDF viewer page through a large document without
loading it whole. Base64-ing a PDF into an IPC message would be absurd on both memory and
latency.

### `.docx`: converted in the main process

mammoth is a large CommonJS dependency tree. Keeping it out of the renderer bundle keeps first
paint fast, and conversion needs filesystem access anyway. It is `require`d lazily on first use,
so an application session that never opens a Word document never loads it.

### Markdown: parsed in the renderer, deliberately

This is the one that looks inconsistent, and it is the one that matters most.

Sending **source** rather than HTML means the parser and the sanitiser sit on the same side of
the boundary. `marked.parse()` and `DOMPurify.sanitize()` are adjacent lines in `AssetViewer`.
There is never a moment where unsanitised HTML exists as a string in a variable that some later
code path might render directly.

If the main process returned HTML, that string would cross IPC, sit in the store, and be one
careless `dangerouslySetInnerHTML` away from being trusted. The `.docx` path does exactly that —
because mammoth cannot run in the renderer — and it is sanitised at the point of use for the
same reason. Markdown does not have to accept that risk, so it does not.

### `AssetKind` is derived, never stored

`classifyAsset(ext)` computes the kind at read time from a table in
`src/core/domain/asset-kind.ts`. There is no `kind` column.

Adding a viewer for `.pptx` should be one entry in that table plus a branch in the viewer
component. With a stored column it would additionally be a migration that rewrites existing
rows, and every row written by an older version would be stale until it ran.

## What is declined, and why

### Legacy `.doc`

mammoth reads the OOXML zip container only. A `.doc` is a binary OLE compound file — an
entirely different format that happens to share three letters.

Supporting it means either a second library for a format Microsoft deprecated in 2007, or
shelling out to LibreOffice, which turns a 150 MB application into one with an office suite as
a runtime dependency.

Attempting it and producing garbage would be the worst option: the user sees text, assumes it
is their document, and does not notice what is missing. `.doc` files are stored, listed, and
offered to the system's default application. `ASSET_RENDER_FAILED` is raised if one is renamed
to `.docx` — a case the smoke test covers, because it is the realistic mistake.

### PDF text extraction for search

PDFs render perfectly but their text is not indexed. Every extraction option has a real cost:
`pdf-parse` is unmaintained, `pdfjs-dist` is large and awkward outside a browser, and a native
binding reintroduces the ABI-rebuild problem `better-sqlite3` already imposes.

Choosing between those deserves its own decision rather than a default. Recorded as R-2 in
[11-roadmap.md](../11-roadmap.md) and stated as a limitation in the user guide, so nobody
discovers it by being surprised.

### `.html` is rendered as source, not as HTML

An imported `.html` file is shown as text in a `<pre>`. Rendering it would mean executing
someone else's page inside the application window. Sanitising it first would strip most of what
makes it an HTML file. Showing the source is honest.

## Consequences

**What it buys**

- No large binary crosses IPC.
- One sanitisation profile, applied at the two points HTML enters the DOM.
- A new format is a table entry plus a component branch — no migration.
- Unsupported formats degrade to a useful screen (file details, *open externally*), never an
  error.

**Costs**

- The split is not uniform, so where a format is handled must be looked up. Hence the table at
  the top of this record and in [05-ipc-contract.md](../05-ipc-contract.md#rendering).
- PDF contents are invisible to search, which for a PDF-heavy vault is a real gap.
- `RenderedAsset` carries optional `html`, `text` and `url` fields, only one of which is
  populated. A discriminated union on `kind` would be tighter; the flat shape was kept because
  it survives structured cloning across IPC without ceremony.
