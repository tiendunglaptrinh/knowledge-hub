/**
 * Builds a minimal but genuinely valid .docx, with no dependencies.
 *
 * Used by the smoke test so the Word conversion path is exercised against a
 * real OOXML package rather than a fixture checked into the repository or —
 * worse — a document borrowed from the user's own drive.
 *
 * A .docx is a ZIP containing three entries. Written with the "store" method
 * (no compression): the archive is a few hundred bytes, and store-mode ZIP is
 * short enough to implement correctly by hand, whereas deflate is not.
 *
 * Format reference: PKWARE APPNOTE, sections 4.3.7 (local file header),
 * 4.3.12 (central directory) and 4.3.16 (end of central directory).
 */

import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

function documentXml(heading: string, paragraphs: string[]): string {
  const body = [
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${escapeXml(heading)}</w:t></w:r></w:p>`,
    ...paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(p)}</w:t></w:r></w:p>`),
  ].join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}</w:body>
</w:document>`
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Writes a .docx containing one heading and some paragraphs. */
export async function writeDocx(
  outputPath: string,
  heading: string,
  paragraphs: string[],
): Promise<void> {
  const entries: Array<[string, string]> = [
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', RELS],
    ['word/document.xml', documentXml(heading, paragraphs)],
  ]
  await fs.writeFile(outputPath, zipStore(entries))
}

// ---------------------------------------------------------------------------
// Minimal store-mode ZIP writer
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function zipStore(entries: Array<[string, string]>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const [name, content] of entries) {
    const nameBytes = Buffer.from(name, 'utf8')
    const data = Buffer.from(content, 'utf8')
    const crc = crc32(data)

    const local = Buffer.alloc(30 + nameBytes.length)
    local.writeUInt32LE(0x04034b50, 0) // signature
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(0, 8) // method: store
    local.writeUInt16LE(0, 10) // mod time — fixed, keeps output reproducible
    local.writeUInt16LE(0x21, 12) // mod date: 1980-01-01
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18) // compressed size
    local.writeUInt32LE(data.length, 22) // uncompressed size
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28) // extra field length
    nameBytes.copy(local, 30)

    const central = Buffer.alloc(46 + nameBytes.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk number
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42) // offset of local header
    nameBytes.copy(central, 46)

    locals.push(local, data)
    centrals.push(central)
    offset += local.length + data.length
  }

  const centralBuffer = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4) // this disk
  end.writeUInt16LE(0, 6) // disk with central dir
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([...locals, centralBuffer, end])
}
