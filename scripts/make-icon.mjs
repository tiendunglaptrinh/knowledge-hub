// Generates the application icon: build/icon.png (512) and build/icon.ico (256).
//
// Written by hand rather than pulled from an icon library because the project
// has no image dependency and does not need one for a shape this simple: a
// rounded tile in the application's own surface colours with three accent bars
// standing in for lines of a document.
//
// The .ico wraps a PNG payload, which Windows has supported since Vista and
// which electron-builder accepts. Antialiasing is 3x supersampling — cheap,
// and enough for an icon that renders at 16 px in a taskbar.
//
//   node scripts/make-icon.mjs
//
// Re-run and commit the output when the palette in globals.css changes.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'build')

const SS = 3 // supersampling factor

/** Tokens copied from renderer/src/app/globals.css. */
const SURFACE_TOP = [0x1b, 0x25, 0x40]
const SURFACE_BOTTOM = [0x0b, 0x10, 0x20]
const BORDER = [0x38, 0xbd, 0xf8]
const BARS = [
  { y: 0.30, x0: 0.24, x1: 0.76, rgb: [0x38, 0xbd, 0xf8], a: 1.0 },
  { y: 0.50, x0: 0.24, x1: 0.64, rgb: [0x7d, 0xd3, 0xfc], a: 0.85 },
  { y: 0.70, x0: 0.24, x1: 0.53, rgb: [0x38, 0xbd, 0xf8], a: 0.5 },
]

/** Signed distance to a rounded rectangle; negative inside. */
function sdRoundRect(px, py, x0, y0, x1, y1, r) {
  const cx = Math.max(x0 + r, Math.min(px, x1 - r))
  const cy = Math.max(y0 + r, Math.min(py, y1 - r))
  const dx = px - cx
  const dy = py - cy
  const d = Math.hypot(dx, dy)
  const inside = px >= x0 && px <= x1 && py >= y0 && py <= y1
  if (inside && d <= r) return d - r
  return inside ? Math.max(-Math.min(px - x0, x1 - px, py - y0, y1 - py), d - r) : d - r
}

function overlay(dst, src, alpha) {
  // src over dst, both straight (non-premultiplied) RGB with a scalar alpha
  for (let c = 0; c < 3; c += 1) dst[c] = dst[c] * (1 - alpha) + src[c] * alpha
}

function renderRgba(size) {
  const S = size * SS
  const acc = new Float64Array(size * size * 4)

  const tileR = S * 0.22
  const barH = S * 0.085
  const barR = barH / 2

  for (let sy = 0; sy < S; sy += 1) {
    for (let sx = 0; sx < S; sx += 1) {
      const inTile = sdRoundRect(sx + 0.5, sy + 0.5, 0, 0, S, S, tileR) <= 0
      if (!inTile) continue

      // vertical gradient background
      const t = sy / S
      const px = [
        SURFACE_TOP[0] + (SURFACE_BOTTOM[0] - SURFACE_TOP[0]) * t,
        SURFACE_TOP[1] + (SURFACE_BOTTOM[1] - SURFACE_TOP[1]) * t,
        SURFACE_TOP[2] + (SURFACE_BOTTOM[2] - SURFACE_TOP[2]) * t,
      ]

      // thin accent rim, fading inward
      const rim = -sdRoundRect(sx + 0.5, sy + 0.5, 0, 0, S, S, tileR)
      if (rim < S * 0.012) overlay(px, BORDER, 0.22 * (1 - rim / (S * 0.012)))

      for (const bar of BARS) {
        const cy = S * bar.y
        const d = sdRoundRect(sx + 0.5, sy + 0.5, S * bar.x0, cy - barH / 2, S * bar.x1, cy + barH / 2, barR)
        if (d <= 0) overlay(px, bar.rgb, bar.a)
      }

      const di = ((sy / SS) | 0) * size * 4 + (((sx / SS) | 0) * 4)
      acc[di] += px[0]
      acc[di + 1] += px[1]
      acc[di + 2] += px[2]
      acc[di + 3] += 255
    }
  }

  const n = SS * SS
  const out = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i += 1) {
    const a = acc[i * 4 + 3] / n
    // colour was only accumulated on covered samples, so divide by coverage
    const cov = a === 0 ? 1 : acc[i * 4 + 3] / 255
    out[i * 4] = Math.round(acc[i * 4] / cov)
    out[i * 4 + 1] = Math.round(acc[i * 4 + 1] / cov)
    out[i * 4 + 2] = Math.round(acc[i * 4 + 2] / cov)
    out[i * 4 + 3] = Math.round(a)
  }
  return out
}

// --- PNG ---------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  // 10..12 = compression, filter, interlace — all 0

  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** ICO containing a single PNG image. Windows Vista and later accept this. */
function encodeIco(png, size) {
  const dir = Buffer.alloc(6)
  dir.writeUInt16LE(0, 0) // reserved
  dir.writeUInt16LE(1, 2) // type: icon
  dir.writeUInt16LE(1, 4) // count

  const entry = Buffer.alloc(16)
  entry[0] = size >= 256 ? 0 : size // 0 means 256
  entry[1] = size >= 256 ? 0 : size
  entry[2] = 0 // palette
  entry[3] = 0 // reserved
  entry.writeUInt16LE(1, 4) // colour planes
  entry.writeUInt16LE(32, 6) // bits per pixel
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(22, 12) // offset

  return Buffer.concat([dir, entry, png])
}

// --- write -------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true })

const png512 = encodePng(renderRgba(512), 512)
writeFileSync(path.join(OUT_DIR, 'icon.png'), png512)

const png256 = encodePng(renderRgba(256), 256)
writeFileSync(path.join(OUT_DIR, 'icon.ico'), encodeIco(png256, 256))

console.log(`build/icon.png  ${png512.length} bytes`)
console.log(`build/icon.ico  ${encodeIco(png256, 256).length} bytes`)
