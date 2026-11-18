// Generate original PNG artwork locally; no image downloads or extra dependencies.
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

function chunk(type, data) {
  const bytes = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, bytes, checksum]);
}
const directory = new URL('../dist/icons/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const size of [16, 20, 24, 32, 48, 128]) {
  const pixels = Buffer.alloc(size * (size * 4 + 1));
  // Chrome Web Store square artwork uses a 96 px mark on a 128 px canvas.
  const padding = size === 128 ? 16 : 0;
  const artworkSize = size - 2 * padding;
  for (let y = 0; y < artworkSize; y++) for (let x = 0; x < artworkSize; x++) {
    // Integrate coverage over each pixel so the Q and the transparent corners
    // have smooth edges even at 16 px. Use a heavier stroke at toolbar sizes.
    const samples = 8;
    let visible = 0, ink = 0;
    for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
      const u = (x + (sx + .5) / samples) / artworkSize, v = (y + (sy + .5) / samples) / artworkSize;
      const dx = Math.max(.24 - u, 0, u - .76), dy = Math.max(.24 - v, 0, v - .76);
      if (Math.hypot(dx, dy) > .24) continue;
      visible++;
      const ring = Math.hypot(u - .46, v - .45);
      const tail = Math.max(0, Math.min(.17, (u + v - 1.12) / 2));
      if ((ring <= .305 && ring >= (size <= 24 ? .175 : .193)) || Math.hypot(u - .56 - tail, v - .56 - tail) < .069) ink++;
    }
    const mix = ink / (visible || 1), gradient = y / artworkSize;
    const offset = (y + padding) * (size * 4 + 1) + 1 + (x + padding) * 4;
    const rgb = [38 + 25 * gradient, 148 - 50 * gradient, 249].map(channel => Math.round(channel + (255 - channel) * mix));
    pixels.set([...rgb, Math.round(255 * visible / (samples * samples))], offset);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  await writeFile(new URL(`${size}.png`, directory), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
}
console.log('QiangMacNav extension ready: extensions/qiangmacnav/dist');
