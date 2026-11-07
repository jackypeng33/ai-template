import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const dir = join(process.cwd(), 'public', 'brand');
const symbol = await readFile(join(dir, 'logo-symbol.svg'));
const compact = await readFile(join(dir, 'logo-symbol-compact.svg'));

async function png(input, size, name, background) {
  const image = sharp(input, { density: 384 }).resize(size, size);
  await image.flatten({ background }).png().toFile(join(dir, name));
}

await png(symbol, 512, 'logo-symbol-512.png', '#0B0B0F');
await png(symbol, 180, 'apple-touch-icon.png', '#0B0B0F');
await sharp(await readFile(join(dir, 'og-rapvideomaker.svg')), { density: 192 })
  .resize(1200, 630).png().toFile(join(dir, 'og-rapvideomaker.png'));

const frames = [];
for (const size of [16, 32, 48, 64]) {
  const source = size === 16 ? compact : symbol;
  frames.push(await sharp(source, { density: 384 })
    .resize(size, size).flatten({ background: '#0B0B0F' }).png().toBuffer());
}
const count = frames.length;
const header = Buffer.alloc(6 + count * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(count, 4);
let offset = header.length;
frames.forEach((frame, i) => {
  const size = [16, 32, 48, 64][i];
  const p = 6 + i * 16;
  header.writeUInt8(size === 64 ? 64 : size, p);
  header.writeUInt8(size === 64 ? 64 : size, p + 1);
  header.writeUInt16LE(1, p + 4);
  header.writeUInt16LE(32, p + 6);
  header.writeUInt32LE(frame.length, p + 8);
  header.writeUInt32LE(offset, p + 12);
  offset += frame.length;
});
await writeFile(join(dir, 'favicon.ico'), Buffer.concat([header, ...frames]));
console.log('Generated PNG and multi-size ICO assets');
