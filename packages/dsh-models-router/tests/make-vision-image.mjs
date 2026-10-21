// Generate a simple test image for the vision (needs.images) path: a blue field
// with a red circle and a green square — describable by any vision model.
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const W = 320, H = 240
const raw = Buffer.alloc(H * (1 + W * 3))
let p = 0
for (let y = 0; y < H; y += 1) {
  raw[p++] = 0 // filter: none
  for (let x = 0; x < W; x += 1) {
    const inCircle = (x - 90) ** 2 + (y - 80) ** 2 < 55 ** 2
    const inSquare = x > 180 && x < 290 && y > 120 && y < 210
    raw[p++] = inCircle ? 220 : inSquare ? 40 : 30   // R
    raw[p++] = inCircle ? 50 : inSquare ? 180 : 90   // G
    raw[p++] = inCircle ? 50 : inSquare ? 80 : 200   // B
  }
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crcTable = []
  for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0 }
  let crc = 0xFFFFFFFF
  for (const b of body) crc = crcTable[(crc ^ b) & 0xFF] ^ (crc >>> 8)
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE((crc ^ 0xFFFFFFFF) >>> 0)
  return Buffer.concat([len, body, crcBuf])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2 // 8-bit RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
])
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vision-test.png')
writeFileSync(out, png)
console.log(`wrote ${out} (${png.length} bytes, ${W}x${H})`)
