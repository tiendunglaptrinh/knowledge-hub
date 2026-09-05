# 06 · Storage layout

## The vault

Everything the application owns lives in one directory. Copy it and you have copied the whole
application state.

```
<KB_DATA_DIR>/
├── knowledge.db              SQLite index — and the *only* home of checklists
├── knowledge.db-wal          write-ahead log (transient)
├── knowledge.db-shm          shared memory (transient)
├── assets/
│   └── 2026/
│       └── 08/
│           └── 3f2a9c14-…/            ← one directory per item
│               ├── item.json          ← sidecar
│               ├── owasp-top-10.docx
│               └── spring-di.md
└── notes/
    └── 2026/
        └── 08/
            ├── spring-security-filter-chain.md
            └── nop-bao-cao-cuoi-ky.txt
```

### Why this shape

**Year/month** keeps any single directory small enough that a file manager opens it
comfortably, without the hashed fan-out (`ab/cd/abcdef…`) that makes a vault unbrowsable by a
human. The month comes from the *item's* `created_at`, so an item added in August stays in
`2026/08` no matter when its files are attached.

**One directory per item** means deleting an item is one `rm -r`, and a person browsing the
vault sees related files together rather than scattered by upload date.

**A document typed in the app lands here too**, in the same directory, named the same way.
Nothing on disk marks it as having been composed rather than uploaded, and nothing needs to: it
is a `.md` file in a folder either way. See
[ADR 0009](adr/0009-compose-documents-in-app.md).

### Stored names

**A file is named after the document, slugged**: `OWASP Tổng Hợp.PDF` is stored as
`owasp-tong-hop.pdf`. The name the user chose is not lost — it stays in `assets.filename` and is
what every screen shows. These two are deliberately different things:

| | Kept in | Example |
|---|---|---|
| Display name | `assets.filename` | `OWASP Tổng Hợp.PDF` |
| Stored name | the last segment of `rel_path` | `owasp-tong-hop.pdf` |

Slugged rather than merely sanitised, because a stored name has to survive things a display name
does not: a case-insensitive filesystem sitting beside a case-sensitive one, a shell that treats
spaces as separators, and Vietnamese diacritics travelling through a zip or a sync client. The
stem is capped at 80 characters, which keeps `directory + filename` clear of Windows' MAX_PATH.

**Names that slug identically get `-2`, `-3` …** `Ghi Chú.txt` and `ghi chu.txt` in one item
become `ghi-chu.txt` and `ghi-chu-2.txt`. The uniqueness test is the write itself — an exclusive
create that fails with `EEXIST` — so there is no window between checking and writing.

**Earlier versions prefixed every file with its row id** (`7b1e2c3d-…-OWASP Top 10.docx`). That
made collisions impossible for free, and made the vault unreadable — which works directly
against the reason files are stored as plain files at all. `npm run tidy:filenames` brings an
older vault into line; see [09-development.md](09-development.md#tidying-an-older-vaults-filenames).

**Notes get a flat month directory, not one folder each**, because a note is a single file with
nothing to keep it company.

---

## Notes

Every note is written to disk as an ordinary Markdown or text file:

```markdown
---
id: '5e8f2a71-…'
title: 'Spring Security — filter chain'
kind: 'study'
format: 'markdown'
dueAt: null
doneAt: null
createdAt: '2026-08-02T01:12:00.000Z'
updatedAt: '2026-08-02T03:40:00.000Z'
---

# Spring Security — filter chain

Mỗi request đi qua **một chuỗi filter** trước khi tới controller.
```

**Why a note gets a file at all.** Everything else in this application is a copy of a file the
user already had, so a lost index costs organisation but never content. A note is written
*here* — without a mirror it would live in `knowledge.db` and nowhere else, which is the exact
shape of data loss the whole vault design exists to prevent (NFR-1.4).

**Why front matter rather than a JSON sidecar.** A note is already a text file. A second file
beside it explaining what it is would be worse than the convention every Markdown tool already
reads — as written, the file opens correctly in Obsidian, and `grep` over `notes/` finds
things. A `.txt` note carries the same header: four lines, and one recovery format instead of
two.

**Why the title is in the filename.** Same reason an asset is named after its document: a
directory of UUIDs is not browsable. The cost is that the path moves when the title or the
format changes — so `notes.rel_path` records where the file currently is, and a save deletes the
file it replaced. That column is the whole reason migration 3 exists; without an id in the name
there is nothing to scan the directory for.

A vault written before that migration still has `<noteId>-title.md` files. Each save sweeps them
away as it goes, so an upgraded vault tidies itself; `npm run tidy:filenames` does the rest in
one pass.

Like `item.json`, this is a mirror and **not a source of truth**. SQLite is authoritative;
writing happens after the transaction commits and a failure is swallowed. Deleting is the
exception — a file left behind after a delete is a copy of content the user asked to destroy,
so that failure is reported.

---

## Checklists

**Checklists have no file in the vault. They live in `knowledge.db` and nowhere else.**

That is a deliberate exception to the rule the two sections above follow, and it rests on what
each kind of content actually is:

| | Behind it | Mirror on disk | What a lost index costs |
|---|---|---|---|
| Item / asset | A file the user already had | The file itself, plus `item.json` | Organisation. The content is still there |
| Note | Prose the user typed here | One `.md` / `.txt` with front matter | Nothing, once rebuilt from the files |
| Checklist | Rows with state, rank and order | — | The checklists |

A note is a body of text with a title, so a text file *is* the note — the mirror loses nothing.
A checklist is a set of rows carrying status, rank, parent, position and two timestamps, with a
percentage computed over them. Writing that to Markdown means inventing a format, parsing it
back to answer "how much of this week is done", and rewriting the whole file on every tick —
for a mirror that would still be lossy at the edges (`sort_order` and `done_at` have no natural
Markdown form).

The honest trade: **a checklist is the one thing in this application that only the database
holds**, so `knowledge.db` is the only file that must be in a backup for checklists to survive.
The [backup section](#backup) below covers it, because copying the vault copies the database
too — but a backup strategy that only preserved `assets/` and `notes/` would silently drop
every plan.

Two things make that a bounded risk rather than a design smell:

- The data is small and structured. A month of daily plans is a few hundred rows.
- It is the *only* content with a short useful life. A document from last year is still worth
  reading; the checklist for a Tuesday six months ago is a record, not material.

A `checklists/2026/09/2026-09-05.md` mirror is a reasonable future addition — as an **export**,
written for a human to read, not as a recovery format the importer has to parse back.

---

## Where the vault lives

Resolution order, in `resolveDataDir()` in `src/main/config.ts`:

1. **`KB_DATA_DIR`**, if set — an explicit path always wins
2. **Development** (unpackaged) → `<project>/data`, so a fresh clone works with no setup
3. **Packaged, portable** → `<exe dir>/data`, opt in with a `portable.txt` beside the executable
4. **Packaged, installed** → the OS per-user application data directory

```
Windows   %APPDATA%\Knowledge Hub\data
macOS     ~/Library/Application Support/Knowledge Hub/data
Linux     ~/.config/Knowledge Hub/data
```

**Rule 4 is the default, and it exists for other people's machines.** An installed application
usually sits somewhere a standard user cannot write — `C:\Program Files`, `/opt`,
`/Applications` — so a vault beside the executable fails on first save. On a shared computer it
would also give every account one vault. `app.getPath('userData')` is per account and always
writable.

**Rule 3 is opt-in** because portable should be a decision, not an accident. It is the right
mode for a full system drive or a vault on a USB stick. See
[13-distribution.md](13-distribution.md#where-an-installed-copy-keeps-its-data).

`.env` itself is read from the project root when unpackaged and from **beside the executable**
when packaged — never from inside the asar archive, where the user could not place or edit a
file. Without that distinction `KB_DATA_DIR` would be unreachable for an installed copy, which
is precisely the case that needs it.

The directory is created on first run by `FsAssetStore.init()`, which also writes and removes a
probe file. A vault on an unwritable path fails at startup with `VAULT_UNWRITABLE`, not at the
moment the user first tries to save something.

### On this machine: use D:

```bash
# .env
KB_DATA_DIR=/mnt/d/KnowledgeHub
```

C: has roughly 15 GB free of 201 GB; D: has 212 GB free of 256 GB. The vault is the only part
of this project that grows without bound — a few hundred PDFs is several gigabytes.

Source code and `node_modules` stay on the Linux filesystem (`/home/app/knowledge-hub`), which
is an ext4 volume rather than a 9p mount and is dramatically faster for the thousands of small
reads a build performs. Splitting them this way gives fast builds and roomy storage.

Reasoning recorded in [ADR 0004](adr/0004-vault-location.md).

### Moving an existing vault

```bash
# 1. quit the application  (so the WAL is checkpointed and the lock released)
# 2. move it
mv /home/app/knowledge-hub/data /mnt/d/KnowledgeHub
# 3. point .env at the new location
echo 'KB_DATA_DIR=/mnt/d/KnowledgeHub' >> .env
# 4. start again — the Nơi lưu trữ screen should show the new path
```

Nothing in the database stores an absolute path, which is what makes this a move rather than a
migration.

---

## The sidecar

Every item writes `item.json` alongside its files:

```json
{
  "schema": 1,
  "id": "3f2a9c14-…",
  "title": "OWASP Top 10 — tổng hợp và ví dụ",
  "summary": "Mười rủi ro bảo mật phổ biến nhất…",
  "category": { "id": "…", "name": "Software" },
  "tags": ["backend", "owasp", "security"],
  "assets": [
    { "id": "7b1e…", "filename": "OWASP Top 10.docx",
      "relPath": "assets/2026/08/3f2a9c14-…/7b1e…-OWASP Top 10.docx",
      "sizeBytes": 1932, "checksum": "a3f1…" }
  ],
  "createdAt": "2026-08-01T05:14:00.000Z",
  "updatedAt": "2026-08-01T05:14:00.000Z"
}
```

**It is not a source of truth.** SQLite is authoritative; the sidecar exists for two reasons:

1. A lost or corrupted index can be rebuilt from the vault alone.
2. If this application disappears, the files remain meaningful — a directory of documents with
   a small JSON file saying what they are beats a directory of UUID-prefixed filenames.

Writing it is best-effort and happens *after* the transaction commits. A failed sidecar write is
swallowed: it is a recovery aid, and losing it must never lose the user's work.

---

## Backup

The whole strategy: **copy the directory.**

```bash
# quit the app first, so the WAL is checkpointed into the .db
rsync -a --delete /mnt/d/KnowledgeHub/ /mnt/d/Backups/KnowledgeHub-$(date +%F)/
```

If the application is running, the `-wal` and `-shm` files hold uncommitted state and a naive
copy can capture a torn database. Either quit first, or use SQLite's own backup:

```bash
sqlite3 /mnt/d/KnowledgeHub/knowledge.db ".backup '/tmp/knowledge-backup.db'"
```

The `assets/` tree can be copied live. Most files there are never touched again after they are
written; the exception is a Markdown or text document edited in the app, and that write goes to
a temporary name in the same directory and is then `rename`d over the target. A rename within
one filesystem is atomic, so a copy running at the same moment sees either the whole old
version or the whole new one — never half of either.

### Version control

The vault *can* be committed to git, and for a single user that is a reasonable backup. Two
caveats worth knowing before choosing it:

- `knowledge.db` is a binary that changes on every write, so every commit stores a full new
  copy. A 50 MB index and daily use makes for a large repository quickly.
- PDFs and `.docx` files do not delta-compress.

`.gitignore` excludes `*.db-wal` and `*.db-shm` (transient, never useful in a commit) but
deliberately does **not** exclude `knowledge.db` — that choice is left to whoever sets up the
repository.

---

## Recovery

### The index is corrupt or missing, the files are fine

Currently a manual procedure; the automated command is in the
[roadmap](11-roadmap.md).

```bash
find /mnt/d/KnowledgeHub/assets -name item.json | head
```

Each sidecar carries everything needed to reconstruct one item: its title, summary, category
name, tags, and the relative path, size and checksum of each asset. Deleting `knowledge.db` and
restarting produces a fresh, empty, correctly migrated database; the sidecars are the input a
rebuild would read.

Notes are the easier half: every file under `notes/` is a complete note, body and metadata
together, and needs no other file to be understood.

```bash
head -12 /mnt/d/KnowledgeHub/notes/2026/08/*.md
```

### A file is in the index but missing from disk

`asset:render` raises `ASSET_FILE_MISSING`, and the UI says so in Vietnamese rather than
failing blankly. The usual cause is the file being deleted outside the application. Remove the
asset from the item to clear the row.

### A file is on disk but not in the index

An orphan — the harmless half of the copy-then-insert ordering
([ADR 0005](adr/0005-copy-then-insert.md)). It wastes disk and nothing points at it. The
sidecar next to it says which item it was meant for.

---

## Limits

| Limit | Value | Where |
|---|---|---|
| Maximum file size | 200 MB | `MAX_ASSET_BYTES` |
| Maximum text indexed per file | 2 MB | `MAX_INDEXED_TEXT_BYTES` |
| Maximum stored filename length | 120 chars | `safeFilename()` |
| Search results | 50 default, 200 max | `ItemService` |
| Recent items | 30 default, 200 max | `ItemService` |
| Note list | 100 default, 500 max | `NoteService` |
| Note title | 200 chars | `NoteService` |
| Note card excerpt | 280 chars | `SqliteNoteRepository` |

The 2 MB indexing limit exists so that one large log file cannot bloat the FTS index; the file
is still stored and still viewable, it simply does not contribute its body text to search.
