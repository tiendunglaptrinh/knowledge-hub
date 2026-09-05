# 0001 · Use Electron with a Next.js renderer

**Status:** Accepted
**Date:** 2026-08-01

## Context

The application must be a real desktop application: a window, a desktop icon, launched without
a terminal. It must read and write the local filesystem, run an embedded database, and render
PDF and Word documents.

Constraints outside the code:

- No budget for hosting. Local-first is the premise, not a preference.
- The author's working languages are TypeScript, Next.js and Java/Spring.
- The development machine has Node 22 and **no Rust toolchain**.

## Options considered

### Electron + Next.js

Node in the main process, Chromium in the renderer. `better-sqlite3` and `mammoth` are both
mature Node packages. Chromium ships a PDF viewer, so rendering a PDF is an `<iframe>`.

Against it: roughly 150 MB per installed application, and a Chromium instance's memory
footprint.

### Tauri + Next.js

A ~10 MB binary, lower memory, and the system webview instead of a bundled Chromium.

Against it: the backend is Rust, which is not installed and which the author does not write.
Every filesystem operation, the SQLite layer and the Word conversion would have to be written
in a language being learned at the same time as the application. Rendering `.docx` would need
either a Rust OOXML library or a WASM build of mammoth. The system webview also varies by
platform, so PDF rendering is no longer a given.

### A local web application plus a desktop shortcut

`next dev` and a `.desktop` file that opens a browser.

Against it: not actually a desktop application. It needs a terminal, the browser cannot receive
a real file path from an upload — only its bytes — and the file dialog is the browser's, with
no way to place files precisely. The transparency requirement ("the user always knows where
their files are") is unachievable when the runtime is a sandboxed browser tab.

## Decision

**Electron with a statically exported Next.js renderer.**

The deciding factor is not performance, it is that every hard part of this application —
SQLite, filesystem access, `.docx` conversion, PDF rendering — is a solved problem in the Node
and Chromium ecosystem and an open project in the Rust one. The 150 MB is paid once, by one
user, on a machine with 212 GB free on the drive that matters.

Next.js specifically, rather than Vite + React: it is what the author already writes daily. The
static export mode is used, so there is no Node server in the packaged application — the
renderer is plain HTML and JavaScript served over a custom protocol.

## Consequences

**Accepted costs**

- ~150 MB installed; ~100 MB of that is Chromium.
- A statically exported Next app bootstraps through inline scripts, which forces
  `'unsafe-inline'` in the CSP. See [07-security.md](../07-security.md#content-security-policy).
- Server Components, route handlers and `next/image` optimisation are all unavailable. This is
  a client application that talks to the main process over IPC rather than HTTP.
- `better-sqlite3` must be rebuilt against Electron's ABI, which shapes both the install step
  and the packaging configuration.

**What it buys**

- PDF rendering is free.
- `.docx` conversion is one mature dependency.
- The author can be productive immediately, which for a personal project is the difference
  between finished and abandoned.

**Revisit if** the bundle size becomes a real problem, or Tauri grows a comfortable path for
OOXML and PDF — and the author has learned enough Rust that rewriting the main process is a
weekend rather than a project.
