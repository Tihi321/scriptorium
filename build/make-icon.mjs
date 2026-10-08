// Draws the app icon (a pixel-art book with a quill) with code and writes build/icon.png and build/icon.ico.
// Run: node build/make-icon.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const N = 32
const px = new Array(N * N).fill(null)
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 255]
const set = (x, y, c) => {
  if (x >= 0 && y >= 0 && x < N && y < N) px[y * N + x] = hex(c)
}
const rect = (x, y, w, h, c) => {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c)
}

const OUT = '#14182b'
// book: outline, cover, spine, pages
rect(3, 9, 23, 20, OUT)
rect(4, 10, 21, 18, '#2f5fd0')
rect(4, 10, 4, 18, '#1d3f93') // spine
rect(8, 10, 1, 18, '#5b86ec')
rect(4, 10, 21, 1, '#5b86ec')
rect(25, 11, 3, 18, OUT) // page block outline
rect(25, 12, 2, 16, '#f4ecd8')
for (let y = 13; y < 28; y += 2) set(26, y, '#cdbf9a')
rect(5, 27, 22, 2, OUT)
rect(6, 27, 20, 1, '#f4ecd8')
// emblem and title lines in gold
const GOLD = '#f2c14e'
rect(13, 14, 7, 1, GOLD)
rect(15, 13, 3, 1, GOLD)
rect(15, 15, 3, 1, GOLD)
rect(11, 19, 11, 1, GOLD)
rect(12, 22, 9, 1, GOLD)
rect(4, 14, 4, 1, GOLD) // bands on the spine
rect(4, 22, 4, 1, GOLD)

// quill: a diagonal shaft from lower left to upper right, with a feather around its upper part
const shaft = []
for (let t = 0; t <= 15; t++) shaft.push([13 + t, 15 - t])
for (const [x, y] of shaft.slice(5)) {
  // feather vane on both sides of the shaft
  set(x - 1, y - 1, OUT)
  set(x + 1, y + 1, OUT)
  set(x, y - 1, '#ffffff')
  set(x, y + 1, '#dfe8f5')
  set(x - 1, y, '#ffffff')
  set(x + 1, y, '#dfe8f5')
}
for (const [x, y] of shaft.slice(0, 6)) set(x, y, '#8a5a2b')
set(shaft[0][0] - 1, shaft[0][1] + 1, OUT)
set(shaft[15][0] + 1, shaft[15][1] - 1, OUT)
for (const [x, y] of shaft.slice(5)) set(x, y, '#e8eef9')

function scaled(size) {
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = px[Math.floor((y * N) / size) * N + Math.floor((x * N) / size)] ?? [0, 0, 0, 0]
      out.set(c, (y * size + x) * 4)
    }
  }
  return out
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size) {
  const raw = scaled(size)
  const rows = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0
    raw.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

const sizes = [16, 32, 48, 64, 128, 256]
const images = sizes.map((s) => png(s))
const head = Buffer.alloc(6)
head.writeUInt16LE(1, 2)
head.writeUInt16LE(sizes.length, 4)
let offset = 6 + 16 * sizes.length
const dir = []
sizes.forEach((s, i) => {
  const e = Buffer.alloc(16)
  e[0] = s === 256 ? 0 : s
  e[1] = s === 256 ? 0 : s
  e.writeUInt16LE(1, 4)
  e.writeUInt16LE(32, 6)
  e.writeUInt32LE(images[i].length, 8)
  e.writeUInt32LE(offset, 12)
  offset += images[i].length
  dir.push(e)
})
writeFileSync(path.join(here, 'icon.ico'), Buffer.concat([head, ...dir, ...images]))
writeFileSync(path.join(here, 'icon.png'), png(256))
console.log('wrote build/icon.ico and build/icon.png')
