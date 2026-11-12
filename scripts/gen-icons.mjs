// Генерирует PNG-иконки PWA без внешних зависимостей: бирюзовый фон и белый знак «÷».
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

// внутри ли белой фигуры точка (в координатах 0..1)
function inGlyph(x, y) {
  const bar = Math.abs(y - 0.5) < 0.045 && Math.abs(x - 0.5) < 0.24
  const dot = (cy) => (x - 0.5) ** 2 + (y - cy) ** 2 < 0.062 ** 2
  return bar || dot(0.31) || dot(0.69)
}

function png(size) {
  const bg = [13, 148, 136]
  const ss = 4
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      let hit = 0
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) if (inGlyph((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size)) hit++
      const a = hit / (ss * ss)
      const o = y * (size * 4 + 1) + 1 + x * 4
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(bg[i] * (1 - a) + 255 * a)
      raw[o + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync('public/icons', { recursive: true })
for (const [name, size] of [['icon-192', 192], ['icon-512', 512], ['apple-touch-icon', 180]]) {
  writeFileSync(`public/icons/${name}.png`, png(size))
  console.log(`public/icons/${name}.png`)
}
