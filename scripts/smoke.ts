/**
 * End-to-end smoke test for the main-process half of the application.
 *
 * Runs the real storage layer and the real services against a throwaway vault
 * — no mocks, no fakes, no Electron window. `better-sqlite3` is compiled
 * against Electron's ABI by `electron-builder install-app-deps`, so this must
 * be run through Electron's Node rather than the system one:
 *
 *   npm run smoke
 *   # => ELECTRON_RUN_AS_NODE=1 electron dist/smoke.js
 *
 * It deliberately exercises the paths that are easy to get wrong and
 * impossible to see from a screenshot: migrations, the FTS index, the
 * copy-then-insert ordering, cross-cutting deletes, and Vietnamese search.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { openDatabase } from '../src/storage/database'
import { LATEST_SCHEMA_VERSION } from '../src/storage/migrations'
import { FsAssetStore } from '../src/storage/fs/asset-store'
import { FsNoteStore } from '../src/storage/fs/note-store'
import { SqliteAssetRepository } from '../src/storage/sqlite/asset.repository'
import { SqliteCategoryRepository } from '../src/storage/sqlite/category.repository'
import { SqliteChecklistRepository } from '../src/storage/sqlite/checklist.repository'
import { SqliteItemRepository } from '../src/storage/sqlite/item.repository'
import { SqliteNoteRepository } from '../src/storage/sqlite/note.repository'
import { SqliteTagRepository } from '../src/storage/sqlite/tag.repository'
import { AssetService } from '../src/modules/asset/asset.service'
import { CategoryService } from '../src/modules/category/category.service'
import { ChecklistService } from '../src/modules/checklist/checklist.service'
import { DocumentService } from '../src/modules/document/document.service'
import { ItemService } from '../src/modules/item/item.service'
import { NoteService } from '../src/modules/note/note.service'
import { VaultService } from '../src/modules/vault/vault.service'
import { AppError, ErrorCode } from '../src/shared/errors'
import type { UnitOfWork } from '../src/core/ports/repositories'
import { monthDir } from '../src/storage/fs/vault-path'
import { writeDocx } from './make-docx'

let passed = 0

function check(label: string, condition: boolean): void {
  if (!condition) throw new Error(`FAILED: ${label}`)
  passed += 1
  console.log(`  ok  ${label}`)
}

async function expectCode(label: string, code: string, work: () => unknown): Promise<void> {
  try {
    await work()
  } catch (error) {
    check(label, error instanceof AppError && error.code === code)
    return
  }
  throw new Error(`FAILED: ${label} — expected ${code}, nothing was thrown`)
}

async function main(): Promise<void> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-smoke-'))
  const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-src-'))
  console.log(`vault: ${dataDir}\n`)

  // --- wiring, mirroring src/main/container.ts -----------------------------

  const store = new FsAssetStore(dataDir)
  await store.init()

  const noteStore = new FsNoteStore(dataDir)
  await noteStore.init()

  const { db, fromVersion, toVersion } = openDatabase(path.join(dataDir, 'knowledge.db'))
  check('migrations run on a fresh database', fromVersion === 0 && toVersion === 4)

  const categoryRepo = new SqliteCategoryRepository(db)
  const itemRepo = new SqliteItemRepository(db)
  const tagRepo = new SqliteTagRepository(db)
  const assetRepo = new SqliteAssetRepository(db)
  const noteRepo = new SqliteNoteRepository(db)
  const checklistRepo = new SqliteChecklistRepository(db)
  const uow: UnitOfWork = { run: (work) => db.transaction(work)() }

  const documents = new DocumentService(store)
  const assetService = new AssetService(assetRepo, store)
  const categories = new CategoryService(categoryRepo)
  const items = new ItemService(
    itemRepo, tagRepo, assetRepo, store, uow, categories, assetService, documents,
  )
  const notes = new NoteService(noteRepo, noteStore, uow)
  const checklists = new ChecklistService(checklistRepo, uow)
  const vault = new VaultService(db, assetRepo, store, noteStore, path.join(dataDir, 'knowledge.db'))

  // --- categories ----------------------------------------------------------

  console.log('categories')
  const software = categories.create({ name: 'Software', icon: 'Code2' })
  const english = categories.create({ name: 'Tiếng Anh' })

  check('slug strips Vietnamese diacritics', english.slug === 'tieng-anh')
  check('colours are assigned round-robin', software.color !== english.color)
  check('list returns both with a zero count', categories.list().length === 2)

  await expectCode('duplicate name is rejected', ErrorCode.CATEGORY_NAME_DUPLICATE, () =>
    categories.create({ name: 'software' }),
  )
  await expectCode('empty name is rejected', ErrorCode.CATEGORY_NAME_REQUIRED, () =>
    categories.create({ name: '   ' }),
  )

  // --- items with real files ------------------------------------------------

  console.log('\nitems and uploads')
  const mdPath = path.join(sourceDir, 'spring-di.md')
  await fs.writeFile(
    mdPath,
    '# Dependency Injection\n\nSpring quản lý vòng đời bean và tiêm phụ thuộc.\n',
  )

  const txtPath = path.join(sourceDir, 'ghi-chu.txt')
  await fs.writeFile(txtPath, 'ApplicationContext là trung tâm của Spring container.')

  const created = await items.create({
    categoryId: software.id,
    title: 'Spring Boot — Dependency Injection',
    summary: 'Ghi chú buổi học đầu tiên',
    tags: ['spring', 'backend', 'spring'], // duplicate on purpose
    filePaths: [mdPath, txtPath],
  })

  check('two assets recorded', created.assets.length === 2)
  check('duplicate tag collapsed', created.tags.length === 2)
  check('sort order assigned', created.assets[0]!.sortOrder === 0 && created.assets[1]!.sortOrder === 1)
  check('checksum computed', /^[0-9a-f]{64}$/.test(created.assets[0]!.checksum))

  const storedRel = created.assets[0]!.relPath
  check('vault path is relative and POSIX', !path.isAbsolute(storedRel) && !storedRel.includes('\\'))
  check('file exists in the vault', await store.exists(storedRel))
  check('original source file survives the import', await fileExists(mdPath))

  const sidecar = path.join(path.dirname(store.resolve(storedRel)), 'item.json')
  check('item.json sidecar written', await fileExists(sidecar))

  // --- stored filenames are readable ---------------------------------------
  //
  // The display name and the stored name are different things: the row keeps
  // what the user chose, the disk gets something boring that survives any
  // filesystem. Neither carries an id any more.

  check('stored under a slug, with no id prefix', path.basename(storedRel) === 'spring-di.md')
  check('the display name is untouched', created.assets[0]!.filename === 'spring-di.md')

  const shouty = path.join(sourceDir, 'OWASP Tổng Hợp.PDF')
  await fs.writeFile(shouty, '%PDF-1.4')
  const shoutyItem = await items.create({
    categoryId: software.id,
    title: 'OWASP',
    filePaths: [shouty],
  })
  check(
    'case, spaces and diacritics are slugged out of the stored name',
    path.basename(shoutyItem.assets[0]!.relPath) === 'owasp-tong-hop.pdf',
  )
  check(
    'the original name is still what the interface shows',
    shoutyItem.assets[0]!.filename === 'OWASP Tổng Hợp.PDF',
  )

  // Two files whose names slug identically must not overwrite each other.
  const dupA = path.join(sourceDir, 'Ghi Chú.txt')
  const dupB = path.join(sourceDir, 'ghi chu.txt')
  await fs.writeFile(dupA, 'first')
  await fs.writeFile(dupB, 'second')
  const dupItem = await items.create({
    categoryId: software.id,
    title: 'Trùng tên',
    filePaths: [dupA, dupB],
  })
  const names = dupItem.assets.map((a) => path.basename(a.relPath))
  check('a name collision gets a numeric suffix', JSON.stringify(names) ===
    JSON.stringify(['ghi-chu.txt', 'ghi-chu-2.txt']))
  check(
    'both files survived, neither overwrote the other',
    (await store.readText(dupItem.assets[0]!.relPath)) === 'first' &&
      (await store.readText(dupItem.assets[1]!.relPath)) === 'second',
  )

  await items.delete(shoutyItem.id)
  await items.delete(dupItem.id)

  // --- search ---------------------------------------------------------------

  console.log('\nsearch')
  check('finds by title word', items.search({ query: 'dependency' }).length === 1)
  check('finds by prefix as you type', items.search({ query: 'depend' }).length === 1)
  check('finds by body text inside the markdown', items.search({ query: 'bean' }).length === 1)
  check('finds by body text inside the txt', items.search({ query: 'ApplicationContext' }).length === 1)
  check('diacritic-insensitive', items.search({ query: 'ghi chu' }).length === 1)
  check('unrelated term finds nothing', items.search({ query: 'kubernetes' }).length === 0)
  check('scoped search excludes other categories',
    items.search({ query: 'dependency', categoryId: english.id }).length === 0)
  check('FTS operators are treated as literals, not syntax',
    items.search({ query: 'NEAR( "unbalanced' }).length === 0)

  // --- ownership of the derived list projection ------------------------------

  console.log('\nlist projection')
  const listed = items.listByCategory(software.id)
  check('one item in Software', listed.length === 1)
  check('category name joined in', listed[0]!.categoryName === 'Software')
  check('asset count is correct', listed[0]!.assetCount === 2)
  check('tags come back sorted', JSON.stringify(listed[0]!.tags) === JSON.stringify(['backend', 'spring']))
  check('sidebar count updated', categories.list().find((c) => c.id === software.id)!.itemCount === 1)

  // --- editing an item's own fields ------------------------------------------
  //
  // On its own item, created and deleted here, so the counts and search results
  // the sections above and below assert on are not disturbed.

  console.log('\nitem metadata')
  const editablePath = path.join(sourceDir, 'ghi-chep-tam.md')
  // The body deliberately shares no word with the title, so the "old title left
  // the index" check cannot pass on body text that was never edited.
  await fs.writeFile(editablePath, '# Ghi chép\n\nBuổi này có nhắc tới JUnit.\n')

  const draft = await items.create({
    categoryId: software.id,
    title: 'Bản nháp chưa đặt tên',
    summary: 'Mô tả cũ',
    tags: ['nhap'],
    filePaths: [editablePath],
  })
  const draftAssetPath = draft.assets[0]!.relPath

  const retitled = await items.update({
    id: draft.id,
    title: 'Kiểm thử tích hợp với Testcontainers',
    summary: 'Ghi chép sau buổi seminar',
    tags: ['testing', 'docker', 'testing'],
  })

  check('title updated', retitled.title === 'Kiểm thử tích hợp với Testcontainers')
  check('summary updated', retitled.summary === 'Ghi chép sau buổi seminar')
  check('tags replaced, not merged', JSON.stringify(retitled.tags) === JSON.stringify(['docker', 'testing']))
  check('updatedAt moved forward', retitled.updatedAt >= draft.updatedAt)
  check('attachments untouched by a metadata edit', retitled.assets.length === 1)
  check('the file did not move', retitled.assets[0]!.relPath === draftAssetPath)
  check('the file is still on disk', await store.exists(draftAssetPath))

  check('the index dropped the old title', items.search({ query: 'nháp' }).length === 0)
  check('the index picked up the new title', items.search({ query: 'Testcontainers' }).length === 1)
  check('the index picked up the new summary', items.search({ query: 'seminar' }).length === 1)
  check('body text still indexed after a metadata edit',
    items.search({ query: 'JUnit' }).length === 1)

  // An omitted field means "leave alone", not "clear".
  const partial = await items.update({ id: draft.id, summary: 'Chỉ đổi mô tả' })
  check('omitted title is preserved', partial.title === 'Kiểm thử tích hợp với Testcontainers')
  check('omitted tags are preserved', JSON.stringify(partial.tags) === JSON.stringify(['docker', 'testing']))
  check('summary that was sent did change', partial.summary === 'Chỉ đổi mô tả')

  // Tags can be cleared, but only by sending an explicit empty list.
  check('tags cleared by an explicit empty list',
    (await items.update({ id: draft.id, tags: [] })).tags.length === 0)

  // Moving between categories, which the dialog's Nhóm selector does.
  const moved = await items.update({ id: draft.id, categoryId: english.id })
  check('category changed', moved.category.id === english.id)
  check('category name follows on the detail', moved.category.name === 'Tiếng Anh')
  check('gone from the old category list', items.listByCategory(software.id).every((i) => i.id !== draft.id))
  check('present in the new category list', items.listByCategory(english.id).some((i) => i.id === draft.id))
  check('old sidebar count fell',
    categories.list().find((c) => c.id === software.id)!.itemCount === 1)
  check('new sidebar count rose',
    categories.list().find((c) => c.id === english.id)!.itemCount === 1)
  check('scoped search follows the move',
    items.search({ query: 'Testcontainers', categoryId: english.id }).length === 1)

  const movedSidecar = JSON.parse(
    await fs.readFile(path.join(path.dirname(store.resolve(draftAssetPath)), 'item.json'), 'utf8'),
  ) as { title: string }
  check('sidecar rewritten with the new title',
    movedSidecar.title === 'Kiểm thử tích hợp với Testcontainers')

  await expectCode('editing an unknown item is refused', ErrorCode.ITEM_NOT_FOUND, () =>
    items.update({ id: 'khong-ton-tai', title: 'x' }),
  )
  await expectCode('moving to an unknown category is refused', ErrorCode.CATEGORY_NOT_FOUND, () =>
    items.update({ id: draft.id, categoryId: 'khong-ton-tai' }),
  )

  await items.delete(draft.id)

  // --- rendering -------------------------------------------------------------

  console.log('\nrendering')
  const mdAsset = created.assets.find((a) => a.ext === 'md')!
  const renderedMd = await documents.render(mdAsset)
  check('markdown returns source, not html', renderedMd.kind === 'markdown' && !!renderedMd.text)
  check('markdown content is intact', renderedMd.text!.includes('Dependency Injection'))

  const txtAsset = created.assets.find((a) => a.ext === 'txt')!
  check('text classified as text', (await documents.render(txtAsset)).kind === 'text')

  // --- Word conversion, against a real OOXML package -------------------------

  console.log('\nword conversion')
  const docxPath = path.join(sourceDir, 'owasp.docx')
  await writeDocx(docxPath, 'OWASP Top 10', [
    'A01: Broken Access Control là rủi ro đứng đầu.',
    'A02: Cryptographic Failures.',
  ])

  const wordItem = await items.create({
    categoryId: software.id,
    title: 'OWASP Top 10 — tổng hợp',
    filePaths: [docxPath],
  })

  const docxAsset = wordItem.assets[0]!
  check('docx mime recorded', docxAsset.mime.includes('wordprocessingml'))

  const renderedDocx = await documents.render(docxAsset)
  check('docx converted to html', renderedDocx.kind === 'word' && !!renderedDocx.html)
  check('heading became a real h1', renderedDocx.html!.includes('<h1>OWASP Top 10</h1>'))
  check('vietnamese body preserved', renderedDocx.html!.includes('Broken Access Control'))
  check('docx body reached the search index',
    items.search({ query: 'Cryptographic' }).length === 1)

  // A .doc renamed to .docx is the realistic failure, and it must surface as
  // a code the UI can explain rather than an unhandled throw.
  const fakePath = path.join(sourceDir, 'not-really.docx')
  await fs.writeFile(fakePath, 'this is plain text pretending to be Word')
  const fakeItem = await items.create({
    categoryId: software.id,
    title: 'Tệp hỏng',
    filePaths: [fakePath],
  })
  await expectCode('corrupt docx fails cleanly', ErrorCode.ASSET_RENDER_FAILED, () =>
    documents.render(fakeItem.assets[0]!),
  )

  await items.delete(wordItem.id)
  await items.delete(fakeItem.id)

  // --- composed documents --------------------------------------------------
  //
  // A document typed in the editor must be indistinguishable from an uploaded
  // one the moment it is written: same table, same directory, same checksum
  // discipline, same search index. Editing is the one operation that changes
  // an asset's bytes after the fact, so the row has to follow the file.

  console.log('\ncomposed documents')

  const composedItem = await items.create({
    categoryId: software.id,
    title: 'Kiến trúc hệ thống — bản nháp',
    summary: 'Tự soạn trong ứng dụng.',
    composed: [
      {
        filename: 'Kiến trúc hệ thống',
        format: 'markdown',
        content: '# Kiến trúc\n\nDịch vụ thanh toán gọi sang ví qua hàng đợi.\n',
      },
    ],
  })

  const composedAsset = composedItem.assets[0]!
  check('composed document became an ordinary asset', composedItem.assets.length === 1)
  check('extension derived from the format', composedAsset.filename === 'Kiến trúc hệ thống.md')
  check(
    'and it is stored under a readable slug',
    path.basename(composedAsset.relPath) === 'kien-truc-he-thong.md',
  )
  check('mime recorded like any markdown file', composedAsset.mime === 'text/markdown')
  check('checksum computed', /^[0-9a-f]{64}$/.test(composedAsset.checksum))
  check('file written into the item directory', await store.exists(composedAsset.relPath))
  check(
    'stored beside uploads, not somewhere else',
    composedAsset.relPath.startsWith('assets/') && composedAsset.relPath.includes(composedItem.id),
  )
  check(
    'content reached the search index',
    items.search({ query: 'hàng đợi' }).length === 1,
  )

  const composedText = await documents.render(composedAsset)
  check('renders as markdown', composedText.kind === 'markdown')
  check('content is intact', composedText.text!.includes('Dịch vụ thanh toán'))

  // A name that already carries one of our extensions must not gain a second.
  const twice = await items.composeAsset({
    itemId: composedItem.id,
    filename: 'ghi-chu.txt',
    format: 'markdown',
    content: 'x',
  })
  check('an existing text extension is replaced, not appended', twice.filename === 'ghi-chu.md')
  check('appended after the existing asset', twice.sortOrder === 1)

  await expectCode('an empty document name is rejected', ErrorCode.ASSET_NAME_REQUIRED, () =>
    items.composeAsset({ itemId: composedItem.id, filename: '   ', format: 'text', content: '' }),
  )

  // --- editing a stored document --------------------------------------------

  const beforeEdit = composedAsset.checksum
  const edited = await items.updateAssetText({
    id: composedAsset.id,
    content: '# Kiến trúc\n\nĐổi sang gọi đồng bộ qua gRPC.\n',
  })

  check('checksum follows the new bytes', edited.checksum !== beforeEdit)
  check('size follows the new bytes', edited.sizeBytes !== composedAsset.sizeBytes)
  check(
    'the row on disk agrees with the row in the database',
    (await store.readText(edited.relPath)).includes('gRPC'),
  )
  check('the path did not move', edited.relPath === composedAsset.relPath)
  check('the index dropped the old text', items.search({ query: 'hàng đợi' }).length === 0)
  check('the index picked up the new text', items.search({ query: 'gRPC' }).length === 1)
  check(
    'no temporary file left behind',
    (await fs.readdir(path.dirname(store.resolve(edited.relPath)))).every(
      (name) => !name.endsWith('.tmp'),
    ),
  )

  // Only markdown and text round-trip. A .docx has no way back through
  // mammoth, and the service refuses rather than trusting the UI to hide it.
  const pdfLike = path.join(sourceDir, 'so-tay.pdf')
  await fs.writeFile(pdfLike, '%PDF-1.4 not really')
  const pdfItem = await items.create({
    categoryId: software.id,
    title: 'Sổ tay PDF',
    filePaths: [pdfLike],
  })
  await expectCode('a pdf cannot be edited as text', ErrorCode.ASSET_NOT_EDITABLE, () =>
    items.updateAssetText({ id: pdfItem.assets[0]!.id, content: 'nope' }),
  )

  await items.delete(pdfItem.id)
  await items.delete(composedItem.id)
  check('composed files removed with their item', !(await store.exists(composedAsset.relPath)))

  // --- notes -------------------------------------------------------------------
  //
  // Notes are the only content with no uploaded file behind them, so the pair
  // of claims worth proving is that the row and the vault mirror stay in step:
  // renaming moves the file, changing format changes the extension, deleting
  // removes it.

  console.log('\nnotes')

  const noteFileFor = async (note: { relPath: string }) => path.join(dataDir, note.relPath)

  const study = await notes.create({
    title: '  Ôn tập   Spring Security  ',
    kind: 'study',
    format: 'markdown',
    content: '# Buổi 3\n\nFilter chain và cách đặt thứ tự các filter.\n',
  })

  check('title is trimmed and whitespace collapsed', study.title === 'Ôn tập Spring Security')
  check('undated note has no due date', study.dueAt === null && study.doneAt === null)

  const studyFile = await noteFileFor(study)
  check('note mirrored to a file in the vault', await fileExists(studyFile))
  check(
    'the note file is named after its title, with no id in it',
    study.relPath === 'notes/2026/08/on-tap-spring-security.md'.replace(
      '2026/08',
      monthDir('notes', study.createdAt).split('/').slice(1).join('/'),
    ),
  )

  const written = await fs.readFile(studyFile, 'utf8')
  check('note file carries front matter', written.startsWith('---\n'))
  check('front matter names the kind', written.includes("kind: 'study'"))
  check('note body follows the front matter', written.includes('Filter chain'))

  await expectCode('empty note title is rejected', ErrorCode.NOTE_TITLE_REQUIRED, () =>
    notes.create({ title: '   ' }),
  )
  await expectCode('a deadline with no date is rejected', ErrorCode.NOTE_DUE_REQUIRED, () =>
    notes.create({ title: 'Nộp báo cáo', kind: 'deadline' }),
  )
  await expectCode('an unusable date is rejected', ErrorCode.NOTE_DUE_INVALID, () =>
    notes.create({ title: 'Nộp báo cáo', kind: 'deadline', dueAt: 'thứ ba tuần sau' }),
  )

  const deadlineBody = 'Bản in nộp trực tiếp.'
  const deadline = await notes.create({
    title: 'Nộp báo cáo cuối kỳ',
    kind: 'deadline',
    format: 'text',
    dueAt: '2026-09-01T09:00:00+07:00',
    content: deadlineBody,
  })
  check('due date normalised to UTC ISO', deadline.dueAt === '2026-09-01T02:00:00.000Z')
  check('text notes are mirrored as .txt', await fileExists(await noteFileFor(deadline)))

  // Ordering is the whole point of a due date, so it is asserted rather than
  // assumed: dated-and-open first, done last.
  check('dated note sorts above the undated one', notes.list()[0]!.id === deadline.id)
  check(
    'list omits the body but reports its length',
    notes.list()[0]!.contentLength === deadlineBody.length,
  )

  await notes.update({ id: deadline.id, done: true })
  check('a finished note sinks below the open one', notes.list()[0]!.id === study.id)
  await notes.update({ id: deadline.id, done: false })

  check('filtering by kind excludes the others', notes.list({ kind: 'study' }).length === 1)
  check('search finds a note by title', notes.list({ query: 'Spring' }).length === 1)
  check('search finds a note by body text', notes.list({ query: 'filter' }).length === 1)
  check('note search is diacritic-insensitive', notes.list({ query: 'on tap' }).length === 1)
  check('an unrelated term finds no note', notes.list({ query: 'kubernetes' }).length === 0)

  // Renaming and reformatting both move the file, which is the failure mode a
  // filename derived from mutable fields invites.
  const renamed = await notes.update({
    id: study.id,
    title: 'Spring Security — tổng hợp',
    format: 'text',
  })
  check('the old note file is gone after a rename', !(await fileExists(studyFile)))
  check('the new note file is written', await fileExists(await noteFileFor(renamed)))
  check('reindexed under the new title', notes.list({ query: 'tổng hợp' }).length === 1)

  const cleared = await notes.update({ id: deadline.id, kind: 'task', dueAt: null })
  check('clearing the due date is possible once it is not a deadline', cleared.dueAt === null)

  const keptTitle = await notes.update({ id: cleared.id, content: 'Đã đổi nội dung.' })
  check('an omitted field is left alone', keptTitle.title === 'Nộp báo cáo cuối kỳ')

  await expectCode('missing note', ErrorCode.NOTE_NOT_FOUND, () => notes.get('nope'))

  const deletedFile = await noteFileFor(renamed)
  await notes.delete(renamed.id)
  check('note row gone', noteRepo.findById(renamed.id) === null)
  check('note file gone from the vault', !(await fileExists(deletedFile)))
  check('deleted note is out of the index', notes.list({ query: 'Spring' }).length === 0)

  await notes.delete(cleared.id)
  check('every note removed', notes.list().length === 0)

  // --- checklists ---------------------------------------------------------------
  //
  // The rules worth proving are the ones no schema constraint can state: one
  // plan per day, a plan is never empty, a big task follows its break-down,
  // progress counts leaves, and a task cannot be dragged past a task that
  // outranks it.

  console.log('\nchecklists')

  const today = '2026-09-05'

  const plan = checklists.create({
    kind: 'daily',
    day: today,
    tasks: [
      {
        title: '  Hoàn thiện   API thanh toán  ',
        priority: 'high',
        children: [{ title: 'Viết endpoint' }, { title: 'Viết test' }],
      },
      { title: 'Review PR của team', priority: 'normal' },
      { title: 'Chuẩn bị slide demo', priority: 'high' },
    ],
  })

  check('daily checklist has no title', plan.title === null && plan.day === today)
  check('task title trimmed and collapsed', plan.tasks[0]!.title === 'Hoàn thiện API thanh toán')
  check('three top-level tasks', plan.tasks.length === 3)
  check(
    'high priority sorts above normal',
    plan.tasks[0]!.priority === 'high' &&
      plan.tasks[1]!.priority === 'high' &&
      plan.tasks[2]!.priority === 'normal',
  )
  check('sub-tasks carry no priority of their own', plan.tasks[0]!.children[0]!.priority === null)
  check(
    'progress counts leaves, not parents',
    plan.progress.total === 4 && plan.progress.done === 0 && plan.progress.percent === 0,
  )

  await expectCode('a second plan for the same day is refused', ErrorCode.CHECKLIST_DAY_TAKEN, () =>
    checklists.create({ kind: 'daily', day: today, tasks: [{ title: 'Việc khác' }] }),
  )
  await expectCode('an empty checklist is refused', ErrorCode.CHECKLIST_EMPTY, () =>
    checklists.create({ kind: 'daily', day: '2026-09-06', tasks: [] }),
  )
  await expectCode('a daily checklist may not carry a title', ErrorCode.CHECKLIST_TITLE_NOT_ALLOWED, () =>
    checklists.create({
      kind: 'daily',
      day: '2026-09-06',
      title: 'Không hợp lệ',
      tasks: [{ title: 'Việc' }],
    }),
  )
  await expectCode('a module checklist needs a title', ErrorCode.CHECKLIST_TITLE_REQUIRED, () =>
    checklists.create({ kind: 'module', tasks: [{ title: 'Việc' }] }),
  )
  await expectCode('a nonsense date is refused', ErrorCode.CHECKLIST_DAY_INVALID, () =>
    checklists.create({ kind: 'daily', day: '2026-02-31', tasks: [{ title: 'Việc' }] }),
  )

  // Ticking the break-down drives the big task, one sub-task at a time.
  const bigTask = plan.tasks[0]!
  const afterFirst = checklists.updateTask({ id: bigTask.children[0]!.id, status: 'done' })
  check(
    'a partly finished break-down puts its parent in progress',
    afterFirst.tasks[0]!.status === 'doing',
  )
  check('progress follows the leaves', afterFirst.progress.done === 1)

  const afterSecond = checklists.updateTask({ id: bigTask.children[1]!.id, status: 'done' })
  check('a finished break-down finishes its parent', afterSecond.tasks[0]!.status === 'done')
  check('the parent records when it finished', afterSecond.tasks[0]!.doneAt !== null)

  // ...and ticking the big task carries the break-down with it.
  const untick = checklists.updateTask({ id: bigTask.id, status: 'todo' })
  check(
    'un-ticking a big task un-ticks its whole break-down',
    untick.tasks[0]!.children.every((child) => child.status === 'todo'),
  )
  const retick = checklists.updateTask({ id: bigTask.id, status: 'done' })
  check(
    'ticking a big task ticks its whole break-down',
    retick.tasks[0]!.children.every((child) => child.status === 'done'),
  )
  check('two of four leaves are done', retick.progress.done === 2 && retick.progress.percent === 50)

  // Reordering: within a group yes, across groups no.
  const [firstHigh, secondHigh, onlyNormal] = retick.tasks as [
    (typeof retick.tasks)[number],
    (typeof retick.tasks)[number],
    (typeof retick.tasks)[number],
  ]

  const reordered = checklists.moveTask({
    id: secondHigh.id,
    targetId: firstHigh.id,
    position: 'before',
  })
  check('a task can be reordered within its group', reordered.tasks[0]!.id === secondHigh.id)
  check('the group itself does not move', reordered.tasks[2]!.id === onlyNormal.id)

  await expectCode(
    'a task cannot be dragged past a higher priority',
    ErrorCode.CHECKLIST_TASK_PRIORITY_MISMATCH,
    () => checklists.moveTask({ id: onlyNormal.id, targetId: firstHigh.id, position: 'before' }),
  )

  // Re-ranking is how a task changes group, and it lands at the end of the one
  // it arrives in.
  const promoted = checklists.updateTask({ id: onlyNormal.id, priority: 'high' })
  check('a re-ranked task joins its new group', promoted.tasks[2]!.id === onlyNormal.id)
  check('every task is now high priority', promoted.tasks.every((t) => t.priority === 'high'))

  // Adding, and the one-level nesting rule.
  const withExtra = checklists.addTask({
    checklistId: plan.id,
    title: 'Việc thêm buổi chiều',
    priority: 'normal',
  })
  check('a task can be added to an existing plan', withExtra.tasks.length === 4)

  const added = withExtra.tasks.find((t) => t.title === 'Việc thêm buổi chiều')!
  const withChild = checklists.addTask({
    checklistId: plan.id,
    parentId: added.id,
    title: 'Bước 1',
  })
  check(
    'a sub-task can be added under a task',
    withChild.tasks.find((t) => t.id === added.id)!.children.length === 1,
  )

  const grandchildParent = withChild.tasks.find((t) => t.id === added.id)!.children[0]!
  await expectCode(
    'a sub-task cannot own sub-tasks',
    ErrorCode.CHECKLIST_TASK_NESTING_TOO_DEEP,
    () => checklists.addTask({ checklistId: plan.id, parentId: grandchildParent.id, title: 'Sâu' }),
  )

  // Deleting down to nothing is the empty checklist by another route.
  const solo = checklists.create({
    kind: 'daily',
    day: '2026-09-07',
    tasks: [{ title: 'Việc duy nhất' }],
  })
  await expectCode('the last task cannot be deleted', ErrorCode.CHECKLIST_EMPTY, () =>
    checklists.deleteTask(solo.tasks[0]!.id),
  )

  // Module plans: the Eisenhower matrix orders them instead.
  const module = checklists.create({
    kind: 'module',
    title: 'Module thanh toán — giai đoạn 1',
    description: 'Bốn mươi đầu việc trong hai tháng.',
    dueAt: '2026-11-05T17:00:00+07:00',
    tasks: [
      { title: 'Dọn log thừa', quadrant: 'eliminate' },
      { title: 'Sửa lỗi cổng thanh toán', quadrant: 'do' },
      { title: 'Nhờ QA test hồi quy', quadrant: 'delegate' },
      { title: 'Thiết kế lại luồng hoàn tiền', quadrant: 'schedule' },
    ],
  })

  check('module checklist carries a title and no day', module.title !== null && module.day === null)
  check('the deadline is stored as UTC', module.dueAt === '2026-11-05T10:00:00.000Z')
  check(
    'tasks sort by the Eisenhower matrix',
    module.tasks.map((t) => t.quadrant).join(',') === 'do,schedule,delegate,eliminate',
  )
  check('module tasks carry no daily priority', module.tasks.every((t) => t.priority === null))

  await expectCode(
    'quadrants cannot be reordered past each other',
    ErrorCode.CHECKLIST_TASK_PRIORITY_MISMATCH,
    () =>
      checklists.moveTask({
        id: module.tasks[3]!.id,
        targetId: module.tasks[0]!.id,
        position: 'before',
      }),
  )

  // The dashboard's numbers.
  const stats = checklists.stats({ from: '2026-09-01', to: '2026-09-30' })
  check('both daily plans of the month are counted', stats.daily.checklistCount === 2)
  check('the day breakdown is ordered', stats.daily.days[0]!.day === today)
  check(
    'the daily tally sums every leaf',
    stats.daily.taskTotal === 6 && stats.daily.taskDone === 2,
  )
  check('module plans are counted regardless of the range', stats.module.checklistCount === 1)
  check('module progress starts at zero', stats.module.percent === 0)

  const narrowed = checklists.stats({ from: '2026-09-06', to: '2026-09-06' })
  check('a narrower range excludes the other day', narrowed.daily.checklistCount === 0)
  check('module plans survive a narrow range', narrowed.module.checklistCount === 1)

  await expectCode('a backwards range is refused', ErrorCode.CHECKLIST_DAY_INVALID, () =>
    checklists.stats({ from: '2026-09-30', to: '2026-09-01' }),
  )

  check('the plan for a day can be looked up by date', checklists.findByDay(today)?.id === plan.id)
  check('a day with no plan reports none', checklists.findByDay('2026-09-20') === null)

  // Deleting the plan takes its tasks with it.
  checklists.delete(module.id)
  check('module checklist gone', checklists.list({ kind: 'module' }).length === 0)
  check(
    'its tasks cascaded',
    (db.prepare('SELECT COUNT(*) AS n FROM checklist_tasks WHERE checklist_id = ?')
      .get(module.id) as { n: number }).n === 0,
  )

  checklists.delete(plan.id)
  checklists.delete(solo.id)
  check('every checklist removed', checklists.count() === 0)

  await expectCode('missing checklist', ErrorCode.CHECKLIST_NOT_FOUND, () => checklists.get('nope'))
  await expectCode('missing task', ErrorCode.CHECKLIST_TASK_NOT_FOUND, () =>
    checklists.deleteTask('nope'),
  )

  // --- deletion rules ---------------------------------------------------------

  console.log('\ndeletion rules')
  await expectCode('non-empty category cannot be deleted', ErrorCode.CATEGORY_NOT_EMPTY, () =>
    categories.delete(software.id),
  )
  check('empty category can be deleted', categories.delete(english.id).id === english.id)

  await items.removeAsset(txtAsset.id)
  check('asset row gone', assetRepo.findById(txtAsset.id) === null)
  check('asset file gone from the vault', !(await store.exists(txtAsset.relPath)))
  check('index no longer matches the removed body', items.search({ query: 'ApplicationContext' }).length === 0)
  check('index still matches the remaining body', items.search({ query: 'bean' }).length === 1)

  await items.delete(created.id)
  check('item gone', itemRepo.findById(created.id) === null)
  check('assets cascaded', assetRepo.listForItem(created.id).length === 0)
  check('item directory removed from the vault', !(await store.exists(storedRel)))
  check('orphan tags pruned', (db.prepare('SELECT COUNT(*) AS n FROM tags').get() as { n: number }).n === 0)
  check('now-empty category can be deleted', categories.delete(software.id).id === software.id)

  // --- not-found paths ---------------------------------------------------------

  console.log('\nnot found')
  await expectCode('missing item', ErrorCode.ITEM_NOT_FOUND, () => items.get('nope'))
  await expectCode('missing category', ErrorCode.CATEGORY_NOT_FOUND, () => categories.require('nope'))
  await expectCode('missing asset', ErrorCode.ASSET_NOT_FOUND, () => assetService.require('nope'))
  await expectCode('path traversal refused', ErrorCode.VAULT_PATH_ESCAPE, () =>
    store.resolve('../../../etc/passwd'),
  )

  // --- a vault from the future --------------------------------------------
  //
  // The guard has to live in the *older* application to be worth anything, so
  // it is tested the only way it can happen in the wild: a database whose
  // user_version is ahead of what this build knows.

  console.log('\nschema guard')

  const futureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-future-'))
  const futurePath = path.join(futureDir, 'knowledge.db')

  const fresh = openDatabase(futurePath)
  check('a fresh vault opens at the current version', fresh.toVersion === LATEST_SCHEMA_VERSION)

  // Pretend a newer build has been here. Done through the open handle rather
  // than by reopening, because reopening is the thing under test.
  fresh.db.pragma('user_version = 99')
  fresh.db.close()

  await expectCode('a vault from a newer version is refused', ErrorCode.VAULT_TOO_NEW, () =>
    openDatabase(futurePath),
  )

  await fs.rm(futureDir, { recursive: true, force: true })

  // --- vault info ---------------------------------------------------------------

  const info = vault.info()
  check('vault reports the empty state', info.itemCount === 0 && info.categoryCount === 0)
  check('note count reported', info.noteCount === 0)
  check('notes directory reported', info.notesDir === path.join(dataDir, 'notes'))
  check('checklist count reported', info.checklistCount === 0)
  check('schema version reported', info.schemaVersion === 4)

  db.close()
  await fs.rm(dataDir, { recursive: true, force: true })
  await fs.rm(sourceDir, { recursive: true, force: true })

  console.log(`\n${passed} checks passed`)
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

main().catch((error) => {
  console.error(`\n${String(error?.message ?? error)}`)
  assert.fail(String(error))
})
