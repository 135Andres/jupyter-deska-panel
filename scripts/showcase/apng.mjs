// Joins same-sized PNG screenshots into one animated PNG (APNG), which GitHub and
// every current browser play inline, like a GIF but lossless. No dependency: the
// IDAT data of each frame is reused as is, only re-chunked into fcTL/fdAT.
import { crc32 } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function chunks(png) {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG')
  const list = []
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at)
    list.push({ type: png.toString('latin1', at + 4, at + 8), data: png.subarray(at + 8, at + 8 + length) })
    at += 12 + length
  }
  return list
}

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0)
  return Buffer.concat([head, data, crc])
}

/** frames: [{ png: Buffer, ms: number }]. Loops forever. */
export function encodeApng(frames) {
  if (!frames.length) throw new Error('no frames')
  const parsed = frames.map((f) => chunks(f.png))
  const ihdr = parsed[0].find((c) => c.type === 'IHDR').data
  for (const p of parsed) {
    if (!p.find((c) => c.type === 'IHDR').data.equals(ihdr)) throw new Error('frames differ in size or colour type')
  }
  const width = ihdr.readUInt32BE(0)
  const height = ihdr.readUInt32BE(4)
  const actl = Buffer.alloc(8)
  actl.writeUInt32BE(frames.length, 0)
  actl.writeUInt32BE(0, 4)
  const out = [SIGNATURE, chunk('IHDR', ihdr), chunk('acTL', actl)]
  let seq = 0
  parsed.forEach((p, i) => {
    const fctl = Buffer.alloc(26)
    fctl.writeUInt32BE(seq++, 0)
    fctl.writeUInt32BE(width, 4)
    fctl.writeUInt32BE(height, 8)
    fctl.writeUInt32BE(0, 12)
    fctl.writeUInt32BE(0, 16)
    fctl.writeUInt16BE(Math.max(1, Math.round(frames[i].ms)), 20)
    fctl.writeUInt16BE(1000, 22)
    fctl.writeUInt8(0, 24)
    fctl.writeUInt8(0, 25)
    out.push(chunk('fcTL', fctl))
    for (const c of p.filter((c) => c.type === 'IDAT')) {
      if (i === 0) out.push(chunk('IDAT', c.data))
      else {
        const seqBuf = Buffer.alloc(4)
        seqBuf.writeUInt32BE(seq++)
        out.push(chunk('fdAT', Buffer.concat([seqBuf, c.data])))
      }
    }
  })
  out.push(chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(out)
}
