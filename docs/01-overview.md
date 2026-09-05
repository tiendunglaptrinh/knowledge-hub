# 01 · Overview

## The problem

Study material arrives as files and stays as files. A PDF lands in Downloads, a `.docx` comes
out of a course, a Markdown note gets written into whichever folder was open at the time. Six
months later the material exists but is unfindable: the filename does not say what is inside,
the folder structure reflects when things were saved rather than what they are about, and
searching by filename finds nothing because the useful words are in the third paragraph.

The usual answers each cost something:

| Approach | What it costs |
|---|---|
| Notion, Evernote, Obsidian Sync | A subscription, an account, and your material on someone else's disk |
| A folder tree | No search inside documents, no tags, no cross-cutting organisation |
| Obsidian alone | Excellent for Markdown, but a PDF or `.docx` is an opaque attachment |

## What this is

A single-window desktop application that keeps a **vault**: a directory holding an SQLite index
and the original files, unmodified, in ordinary subfolders. The application organises and
searches; it does not take custody. Copy the vault directory and you have copied everything.
Delete the application and the files are still there, still openable by Word and Acrobat.

It holds three kinds of thing. **Items** are documents filed into categories you define —
either material you brought in (a PDF, a `.docx`, a Markdown file) or a document you write
here, with the source beside a live preview. **Notes** are shorter things that belong to no
category: a lesson summary, a diary entry, a deadline. **Checklists** are plans with state — a
plan for one day, or a plan for a body of work that will not fit in one — with a percentage
over them and a dashboard that reports the week or the month.

Everything written in the app becomes an ordinary `.md` or `.txt` file in the same vault, so
the promise above holds for it too — and any Markdown or text file, however it arrived, can be
edited in place.

## Goals

1. **Local-first, unconditionally.** No account, no network calls, no telemetry. The
   application works with the machine offline forever.
2. **Files stay files.** Documents are copied into the vault as-is, never rewritten into a
   proprietary container. A file manager can browse the vault and it makes sense.
3. **Search finds what is inside.** Titles and tags are not enough; the text of a Markdown
   note or a Word document is indexed, and so is the body of every note written in the app.
4. **The user always knows where their data is.** A dedicated screen shows the resolved paths
   and opens the folder.
5. **Extensible without re-architecting.** Adding a viewer, a field or an entity should touch
   a known set of files and not force a rewrite. This is why the layering in
   [03-architecture.md](03-architecture.md) is stricter than a four-screen application
   strictly needs.
6. **Installable by someone who is not the author.** No terminal, no configuration file, no
   assumption about where it was installed or who is running it. Each person gets their own
   vault in their own account. See [13-distribution.md](13-distribution.md).

## Non-goals

Stated explicitly, because each one is a thing a reasonable person would expect and its absence
is a decision rather than an oversight.

| Not doing | Why |
|---|---|
| Sync between machines | Needs a server or a third-party account; the whole premise is neither. A vault on a synced drive is the user's own call. |
| A shared vault with accounts and permissions | One user per installation. Many people may each install their own copy — that is supported and is a different thing. A vault two people read and write is a different product; see [ADR 0007](adr/0007-single-user-per-install.md). |
| Editing **binary** documents in-app | Markdown and plain text are editable, including uploaded ones. A `.docx` is not: mammoth converts one way, and writing back an approximation would destroy formatting nobody asked us to touch. *Open with the system application* covers it. |
| A web version | The whole design assumes direct filesystem access. A hosted version would be a different product. |
| Rich WYSIWYG note authoring | Notes are authored as Markdown or plain text, with a live preview beside the source. A WYSIWYG surface would produce something only this application can read, which is the opposite of the point. |
| Version history of documents | Genuinely useful, genuinely large. Recorded in the [roadmap](11-roadmap.md), not built. |

## Who it is for

A developer who reads a lot, in two languages, and wants their own material back later —
and, in time, anyone else who installs it for the same reason.

**One user per installation** is the load-bearing assumption. It is why there are no
permissions, why SQLite is enough, and why a synchronous database API is acceptable. It does
*not* mean only one person may ever use the software: many people each running their own copy
against their own vault is supported, and is what [13-distribution.md](13-distribution.md) is
about. What is out of scope is several people sharing one vault.

## Glossary

Terms used with a specific meaning throughout the documentation and the code.

| Term | Meaning |
|---|---|
| **Vault** | The directory holding the SQLite index and all stored files. Its location is configurable; it lives outside the application directory. |
| **Category** | A user-defined grouping — *Software*, *AI*, *Tiếng Anh*. Flat in v0.1; the schema already carries `parent_id` for later nesting. |
| **Item** | One thing learned, brought in from outside. Has a title, an optional summary, tags, and zero or more attached files. |
| **Note** | One thing written *here*: a lesson, a diary entry, a deadline. Has a kind, a format, an optional due date, and no attachments. Deliberately not an item. |
| **Kind** (of note) | What a note is *for* — `study`, `daily`, `deadline`, `task`, `idea`, `meeting`, `snippet`, `other`. Stored, unlike an asset's kind. |
| **Asset** | One file belonging to an item. An item with a PDF and a Markdown note has two assets. |
| **Composed document** | An asset whose bytes were typed in the app rather than uploaded. Not a distinct kind of thing — once written it is an asset like any other. |
| **Kind** (of asset) | How an asset should be displayed — `pdf`, `word`, `markdown`, `text`, `image`, `other`. Derived from the extension at read time, never stored. |
| **Sidecar** | `item.json`, written next to an item's files, mirroring its metadata so the index can be rebuilt from the vault alone. A note's equivalent is the front matter in its own file. |
| **Checklist** | A plan with tasks: one per calendar day, or one per body of work. Ranked, tickable, and reported on as a percentage. |
| **Leaf task** | A task with no break-down under it. The unit progress is counted in — a big task split into three counts as three, not four. |
| **Bridge** | The object the preload script exposes as `window.knowledgeHub`. The renderer's only route to the outside world. |

## Current state

Version 0.2.0 — notes, checklists and auto-update on top of 0.1. The flows in
[02-requirements.md](02-requirements.md) marked *Built* are implemented and covered by
`npm run smoke` (186 checks against a real database and real files). Everything else is in
[11-roadmap.md](11-roadmap.md).
